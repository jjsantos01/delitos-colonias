"""
Construye una tabla de población por colonia alineada con colonias_geo.json.

Estrategia de matching en etapas:
1) match exacto por llave normalizada alcaldía+colonia.
2) match difuso por similitud de nombre dentro de la misma alcaldía.
3) spatial join: centroide de colonia_geo dentro de polígonos IECM.
4) nearest polygon (fallback) para casos remanentes.

Salida:
- data/colonia_population.json
- scripts/colonia_population_match_report.csv
"""
# /// script
# requires-python = ">=3.10"
# dependencies = ["geopandas", "pandas", "shapely", "requests"]
# ///

from __future__ import annotations

import io
import json
import re
import unicodedata
import zipfile
from pathlib import Path

import difflib
import geopandas as gpd
import pandas as pd
import requests

ROOT = Path(__file__).resolve().parent.parent
SRC_URL = "https://datos.cdmx.gob.mx/dataset/d8f83ce7-163d-4c2a-96e0-ae38d304c4a0/resource/e3bbadb4-f3de-4c52-b3f4-a4ffea4466a3/download/colonias_iecm_2022.zip"


def normalize(txt: str) -> str:
    txt = (txt or "").strip().upper()
    txt = "".join(ch for ch in unicodedata.normalize("NFD", txt) if unicodedata.category(ch) != "Mn")
    txt = re.sub(r"[^A-Z0-9 ]+", " ", txt)
    txt = re.sub(r"\s+", " ", txt).strip()
    return txt


def find_col(df: pd.DataFrame, candidates: list[str]) -> str:
    nmap = {normalize(c): c for c in df.columns}
    for c in candidates:
        if normalize(c) in nmap:
            return nmap[normalize(c)]
    raise RuntimeError(f"No se encontró columna entre candidatos: {candidates}")


resp = requests.get(SRC_URL, timeout=120)
resp.raise_for_status()
zf = zipfile.ZipFile(io.BytesIO(resp.content))
shp_name = next(n for n in zf.namelist() if n.lower().endswith(".shp"))
extract_dir = ROOT / "tmp" / "colonias_iecm_2022"
extract_dir.mkdir(parents=True, exist_ok=True)
zf.extractall(extract_dir)

iecm = gpd.read_file(extract_dir / Path(shp_name).name)
geojson = json.loads((ROOT / "colonias_geo.json").read_text(encoding="utf-8"))
geo = gpd.GeoDataFrame.from_features(geojson["features"], crs="EPSG:4326")

alc_col = find_col(iecm, ["ALCALDIA", "DEMARCACION", "NOM_MUN", "ALC"])
col_col = find_col(iecm, ["COLONIA", "NOMBRE", "NOM_COL", "COL"])
pop_col = find_col(iecm, ["POB_TOTAL", "POBTOT", "POB2020", "POB_2020", "POBLACION", "TOTAL"])

iecm = iecm[[alc_col, col_col, pop_col, "geometry"]].copy()
iecm.columns = ["alcaldia", "colonia", "poblacion", "geometry"]
iecm["poblacion"] = pd.to_numeric(iecm["poblacion"], errors="coerce").fillna(0).astype(int)
iecm["norm_key"] = iecm["alcaldia"].map(normalize) + "||" + iecm["colonia"].map(normalize)

geo = geo[["alcaldia", "colonia", "geometry"]].copy()
geo["norm_key"] = geo["alcaldia"].map(normalize) + "||" + geo["colonia"].map(normalize)
geo["matched_pop"] = pd.NA
geo["match_type"] = ""

# 1) exact key
exact_map = iecm.drop_duplicates("norm_key").set_index("norm_key")["poblacion"]
mask = geo["norm_key"].isin(exact_map.index)
geo.loc[mask, "matched_pop"] = geo.loc[mask, "norm_key"].map(exact_map)
geo.loc[mask, "match_type"] = "exact_key"

# 2) fuzzy within alcaldia
for idx, row in geo[geo["matched_pop"].isna()].iterrows():
    alc = normalize(row["alcaldia"])
    candidates = iecm[iecm["alcaldia"].map(normalize) == alc]
    if candidates.empty:
        continue
    target = normalize(row["colonia"])
    scored = sorted(
        ((difflib.SequenceMatcher(None, target, normalize(r.colonia)).ratio(), r) for r in candidates.itertuples()),
        key=lambda x: x[0],
        reverse=True
    )
    score, best = scored[0]
    if score >= 0.93:
        geo.at[idx, "matched_pop"] = int(best.poblacion)
        geo.at[idx, "match_type"] = f"fuzzy_{int(score * 100)}"

# 3) centroid->polygon spatial
unmatched = geo[geo["matched_pop"].isna()].copy()
if not unmatched.empty:
    iecm_poly = iecm.to_crs(geo.crs)
    unmatched["geometry"] = unmatched.geometry.centroid
    sj = gpd.sjoin(unmatched, iecm_poly[["poblacion", "geometry"]], how="left", predicate="within")
    for idx, r in sj.dropna(subset=["poblacion"]).iterrows():
        geo.at[idx, "matched_pop"] = int(r["poblacion"])
        geo.at[idx, "match_type"] = "spatial_centroid"

# 4) nearest fallback in same alcaldia
for idx, row in geo[geo["matched_pop"].isna()].iterrows():
    alc = normalize(row["alcaldia"])
    pool = iecm[iecm["alcaldia"].map(normalize) == alc]
    if pool.empty:
        pool = iecm
    d = pool.geometry.distance(row.geometry.centroid)
    j = d.idxmin()
    geo.at[idx, "matched_pop"] = int(pool.loc[j, "poblacion"])
    geo.at[idx, "match_type"] = "nearest_fallback"

geo["matched_pop"] = geo["matched_pop"].fillna(0).astype(int)
coverage = (geo["matched_pop"] > 0).mean() * 100

pop_map = {
    f"{r.alcaldia}||{r.colonia}": {"population": int(r.matched_pop), "match_type": r.match_type}
    for r in geo.itertuples()
}
(ROOT / "data" / "colonia_population.json").write_text(
    json.dumps(pop_map, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
)

report = geo[["alcaldia", "colonia", "matched_pop", "match_type"]].copy()
report.to_csv(ROOT / "scripts" / "colonia_population_match_report.csv", index=False)
print(f"Colonias: {len(geo)} | cobertura población>0: {coverage:.1f}%")
print(report["match_type"].value_counts())
