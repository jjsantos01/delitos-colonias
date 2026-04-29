"""
match_colonias.py — Match crime data colonias to GeoJSON polygons.

Strategy (in order of priority):
1. Direct match: normalize(alcaldía + colonia) exact match
2. Cross-alcaldía match: same colonia name exists in GeoJSON under different alcaldía
   (many colonias span boundaries or are catalogued differently)
3. Fuzzy match: Levenshtein distance ≤ 2 within same alcaldía
4. Spatial join (Phase 2): for truly unmatched, use crime point centroids

Usage: python scripts/match_colonias.py
"""

import json, csv, unicodedata, re
from pathlib import Path
from difflib import SequenceMatcher

ROOT = Path(__file__).resolve().parent.parent

# ─── Normalization helpers ────────────────────────────────────────────────────

def strip_accents(s):
    """Remove accents/diacritics."""
    return ''.join(c for c in unicodedata.normalize('NFKD', s) if unicodedata.category(c) != 'Mn')

def normalize(name):
    """Normalize a colonia/alcaldía name for matching."""
    if not name:
        return ''
    s = strip_accents(name).upper().strip()
    s = s.replace('.', '').replace(',', '').replace("'", '')
    s = re.sub(r'\s+', ' ', s).strip()
    return s

def normalize_loose(name):
    """Even looser normalization: strip common prefixes."""
    s = normalize(name)
    s = re.sub(r'^(PUEBLO |BARRIO |EX-?HACIENDA (DE )?|AMPLIACION |AMPL |AMPLIACIÓN )', '', s)
    return s

ALCALDIA_MAP = {
    'Álvaro Obregón':         'ALVARO OBREGON',
    'Azcapotzalco':           'AZCAPOTZALCO',
    'Benito Juárez':          'BENITO JUAREZ',
    'Coyoacán':               'COYOACAN',
    'Cuajimalpa de Morelos':  'CUAJIMALPA DE MORELOS',
    'Cuauhtémoc':             'CUAUHTEMOC',
    'Gustavo A. Madero':      'GUSTAVO A. MADERO',
    'Iztacalco':              'IZTACALCO',
    'Iztapalapa':             'IZTAPALAPA',
    'La Magdalena Contreras': 'LA MAGDALENA CONTRERAS',
    'Miguel Hidalgo':         'MIGUEL HIDALGO',
    'Milpa Alta':             'MILPA ALTA',
    'Tláhuac':                'TLAHUAC',
    'Tlalpan':                'TLALPAN',
    'Venustiano Carranza':    'VENUSTIANO CARRANZA',
    'Xochimilco':             'XOCHIMILCO',
}

# ─── Load data ────────────────────────────────────────────────────────────────

def load_geojson():
    path = ROOT / 'catlogo-de-colonias.json'
    with open(path, 'r', encoding='utf-8') as f:
        geojson = json.load(f)
    
    # Build multiple indexes
    by_alc_col = {}      # (alcaldia_hecho, norm_col) → feature
    by_col_only = {}     # norm_col → [features]  (for cross-alcaldía)
    by_alc_loose = {}    # (alcaldia_hecho, loose_col) → feature
    by_col_loose = {}    # loose_col → [features]
    
    for ft in geojson['features']:
        props = ft['properties']
        alc_hecho = ALCALDIA_MAP.get(props['alc'], normalize(props['alc']))
        col_norm = normalize(props['colonia'])
        col_loose = normalize_loose(props['colonia'])
        
        by_alc_col[(alc_hecho, col_norm)] = ft
        by_col_only.setdefault(col_norm, []).append(ft)
        by_alc_loose[(alc_hecho, col_loose)] = ft
        by_col_loose.setdefault(col_loose, []).append(ft)
    
    return geojson, by_alc_col, by_col_only, by_alc_loose, by_col_loose

def load_crime_colonias():
    path = ROOT / 'scripts' / 'crime_colonias.csv'
    rows = []
    with open(path, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            rows.append((row['alcaldia_hecho'], row['colonia']))
    return rows

# ─── Matching ──────────────────────────────────────────────────────────────────

def similarity(a, b):
    return SequenceMatcher(None, a, b).ratio()

def match_all(crime_colonias, by_alc_col, by_col_only, by_alc_loose, by_col_loose):
    results = []
    
    for alc, col in crime_colonias:
        col_norm = normalize(col)
        col_loose = normalize_loose(col)
        
        # 1. Direct match (same alcaldía, same normalized name)
        key = (alc, col_norm)
        if key in by_alc_col:
            ft = by_alc_col[key]
            results.append(mk_result(alc, col, ft, 'direct'))
            continue
        
        # 2. Loose match within same alcaldía (strip prefixes like Pueblo/Barrio)
        lkey = (alc, col_loose)
        if lkey in by_alc_loose:
            ft = by_alc_loose[lkey]
            results.append(mk_result(alc, col, ft, 'loose_prefix'))
            continue
        
        # 3. Cross-alcaldía exact match (colonia name matches but under a neighbor alcaldía)
        if col_norm in by_col_only:
            candidates = by_col_only[col_norm]
            if len(candidates) == 1:
                # Unambiguous cross-alcaldía match
                results.append(mk_result(alc, col, candidates[0], 'cross_alcaldia'))
                continue
            else:
                # Multiple matches — pick by geographic proximity (or just take first)
                # For now take the first match
                results.append(mk_result(alc, col, candidates[0], 'cross_alcaldia_ambiguous'))
                continue
        
        # 4. Cross-alcaldía loose match
        if col_loose in by_col_loose:
            candidates = by_col_loose[col_loose]
            results.append(mk_result(alc, col, candidates[0], 'cross_loose'))
            continue
        
        # 5. Fuzzy match within same alcaldía (similarity > 0.85)
        best_score = 0
        best_ft = None
        for (g_alc, g_col), ft in by_alc_col.items():
            if g_alc != alc:
                continue
            score = similarity(col_norm, g_col)
            if score > best_score:
                best_score = score
                best_ft = ft
        
        if best_score >= 0.85:
            results.append(mk_result(alc, col, best_ft, f'fuzzy_{best_score:.2f}'))
            continue
        
        # 6. Unmatched
        results.append({
            'alcaldia': alc,
            'colonia_crime': col,
            'colonia_geo': '',
            'match_type': 'unmatched',
            'matched': False
        })
    
    return results

def mk_result(alc, col, ft, match_type):
    return {
        'alcaldia': alc,
        'colonia_crime': col,
        'colonia_geo': ft['properties']['colonia'],
        'match_type': match_type,
        'matched': True
    }

# ─── Export ─────────────────────────────────────────────────────────────────────

def export_report(results):
    path = ROOT / 'scripts' / 'match_report.csv'
    with open(path, 'w', encoding='utf-8', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=['alcaldia', 'colonia_crime', 'colonia_geo', 'match_type', 'matched'])
        writer.writeheader()
        writer.writerows(results)
    
    matched = sum(1 for r in results if r['matched'])
    total = len(results)
    
    # Group by match type
    by_type = {}
    for r in results:
        by_type.setdefault(r['match_type'], []).append(r)
    
    print(f"\n{'='*60}")
    print(f"Match Report: {matched}/{total} ({100*matched/total:.1f}%) matched")
    print(f"{'='*60}")
    for mt, items in sorted(by_type.items()):
        print(f"  {mt:30s} : {len(items):4d}")
    
    unmatched = [r for r in results if not r['matched']]
    if unmatched:
        print(f"\nUnmatched colonias ({len(unmatched)}):")
        for r in sorted(unmatched, key=lambda x: (x['alcaldia'], x['colonia_crime']))[:40]:
            print(f"  {r['alcaldia']:25s} | {r['colonia_crime']}")
        if len(unmatched) > 40:
            print(f"  ... and {len(unmatched) - 40} more")
    
    print(f"\nSaved to: {path}")

def build_lookup_geojson(results, by_alc_col, by_col_only, by_alc_loose, by_col_loose):
    """Build optimized GeoJSON with only matched features, keyed by crime colonia name."""
    
    def find_feature(alc, col):
        col_norm = normalize(col)
        col_loose = normalize_loose(col)
        if (alc, col_norm) in by_alc_col:
            return by_alc_col[(alc, col_norm)]
        if (alc, col_loose) in by_alc_loose:
            return by_alc_loose[(alc, col_loose)]
        if col_norm in by_col_only:
            return by_col_only[col_norm][0]
        if col_loose in by_col_loose:
            return by_col_loose[col_loose][0]
        return None
    
    geojson_out = {"type": "FeatureCollection", "features": []}
    seen = set()
    
    for r in results:
        if not r['matched']:
            continue
        key = (r['alcaldia'], r['colonia_crime'])
        if key in seen:
            continue
        seen.add(key)
        
        ft = find_feature(r['alcaldia'], r['colonia_crime'])
        if ft:
            new_ft = {
                "type": "Feature",
                "properties": {
                    "alcaldia": r['alcaldia'],
                    "colonia": r['colonia_crime'],
                },
                "geometry": ft['geometry']
            }
            geojson_out['features'].append(new_ft)
    
    path = ROOT / 'colonias_geo.json'
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(geojson_out, f, ensure_ascii=False)
    
    size_mb = path.stat().st_size / (1024*1024)
    print(f"\nLookup GeoJSON: {len(geojson_out['features'])} features, {size_mb:.1f} MB")
    print(f"Saved to: {path}")

# ─── Main ──────────────────────────────────────────────────────────────────────

def main():
    print("Loading GeoJSON...")
    geojson, by_alc_col, by_col_only, by_alc_loose, by_col_loose = load_geojson()
    print(f"  {len(geojson['features'])} polygons")
    
    print("Loading crime colonias...")
    crime_colonias = load_crime_colonias()
    print(f"  {len(crime_colonias)} crime colonias")
    
    print("Matching...")
    results = match_all(crime_colonias, by_alc_col, by_col_only, by_alc_loose, by_col_loose)
    
    export_report(results)
    build_lookup_geojson(results, by_alc_col, by_col_only, by_alc_loose, by_col_loose)

if __name__ == '__main__':
    main()
