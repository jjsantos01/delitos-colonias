"""
spatial_join.py — Match remaining unmatched crime colonias using crime point centroids.

For each unmatched colonia, fetches sample crime points from CKAN API, computes their
centroid, and finds which GeoJSON polygon contains that centroid.

Usage: uv run scripts/spatial_join.py
Requirements: shapely (via uv run --with shapely)
"""
# /// script
# requires-python = ">=3.10"
# dependencies = ["shapely", "requests"]
# ///

import json, csv, sys
from pathlib import Path
from shapely.geometry import shape, Point

ROOT = Path(__file__).resolve().parent.parent
API_URL = 'https://datos.cdmx.gob.mx/api/3/action/datastore_search_sql'
RESOURCE_ID = '48fcb848-220c-4af0-839b-4fd8ac812c0f'

def fetch_centroid(alc, col):
    """Fetch crime points for a colonia and compute centroid."""
    import requests, urllib.parse
    
    sql = f"""
    SELECT AVG(latitud) AS lat, AVG(longitud) AS lng, COUNT(*) AS n
    FROM "{RESOURCE_ID}"
    WHERE alcaldia_hecho = '{alc.replace("'", "''")}'
      AND COALESCE(NULLIF(colonia_catalogo, ''), INITCAP(colonia_hecho)) = '{col.replace("'", "''")}'
      AND anio_hecho >= 2019
      AND latitud IS NOT NULL AND longitud IS NOT NULL
    """
    
    url = f"{API_URL}?sql={urllib.parse.quote(sql)}"
    resp = requests.get(url, timeout=30)
    data = resp.json()
    
    if not data.get('success') or not data['result']['records']:
        return None, 0
    
    rec = data['result']['records'][0]
    lat, lng, n = rec.get('lat'), rec.get('lng'), rec.get('n', 0)
    
    if lat is None or lng is None or n == 0:
        return None, 0
    
    return Point(float(lng), float(lat)), int(n)

def load_geojson_polygons():
    """Load GeoJSON and build Shapely polygon index."""
    path = ROOT / 'catlogo-de-colonias.json'
    with open(path, 'r', encoding='utf-8') as f:
        geojson = json.load(f)
    
    polys = []
    for ft in geojson['features']:
        try:
            geom = shape(ft['geometry'])
            polys.append((ft, geom))
        except Exception:
            pass
    
    return polys

def find_containing_polygon(point, polys):
    """Find which polygon contains the point."""
    for ft, geom in polys:
        if geom.contains(point):
            return ft
    return None

def main():
    # Load unmatched colonias from match report
    report_path = ROOT / 'scripts' / 'match_report.csv'
    unmatched = []
    with open(report_path, 'r', encoding='utf-8') as f:
        for row in csv.DictReader(f):
            if row['matched'] == 'False':
                unmatched.append((row['alcaldia'], row['colonia_crime']))
    
    print(f"Unmatched colonias to process: {len(unmatched)}")
    
    print("Loading GeoJSON polygons...")
    polys = load_geojson_polygons()
    print(f"  {len(polys)} polygons indexed")
    
    results = []
    matched_count = 0
    
    for i, (alc, col) in enumerate(unmatched):
        print(f"  [{i+1}/{len(unmatched)}] {alc} | {col}", end='', flush=True)
        
        centroid, n_points = fetch_centroid(alc, col)
        
        if centroid is None or n_points < 3:
            print(f" — skipped (n={n_points})")
            results.append({
                'alcaldia': alc, 'colonia_crime': col,
                'colonia_geo': '', 'match_type': 'no_points', 'matched': False,
                'n_points': n_points, 'lat': '', 'lng': ''
            })
            continue
        
        ft = find_containing_polygon(centroid, polys)
        
        if ft:
            matched_count += 1
            geo_col = ft['properties']['colonia']
            geo_alc = ft['properties']['alc']
            print(f" -> {geo_alc} | {geo_col} (n={n_points})")
            results.append({
                'alcaldia': alc, 'colonia_crime': col,
                'colonia_geo': geo_col, 'match_type': 'spatial',
                'matched': True, 'n_points': n_points,
                'lat': centroid.y, 'lng': centroid.x
            })
        else:
            print(f" — no polygon found (n={n_points}, lat={centroid.y:.4f}, lng={centroid.x:.4f})")
            results.append({
                'alcaldia': alc, 'colonia_crime': col,
                'colonia_geo': '', 'match_type': 'spatial_miss', 'matched': False,
                'n_points': n_points, 'lat': centroid.y, 'lng': centroid.x
            })
    
    # Save spatial join results
    out_path = ROOT / 'scripts' / 'spatial_join_results.csv'
    with open(out_path, 'w', encoding='utf-8', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=[
            'alcaldia', 'colonia_crime', 'colonia_geo', 'match_type', 'matched',
            'n_points', 'lat', 'lng'
        ])
        writer.writeheader()
        writer.writerows(results)
    
    print(f"\n{'='*60}")
    print(f"Spatial join: {matched_count}/{len(unmatched)} matched")
    print(f"Saved to: {out_path}")
    print(f"{'='*60}")
    
    # Now merge with main match report and rebuild the lookup GeoJSON
    if matched_count > 0:
        merge_results(results, polys)

def merge_results(spatial_results, polys):
    """Merge spatial matches into the main match_report.csv and rebuild colonias_geo.json."""
    from shapely.geometry import shape as shapely_shape
    
    # Load existing match report
    report_path = ROOT / 'scripts' / 'match_report.csv'
    all_results = []
    with open(report_path, 'r', encoding='utf-8') as f:
        for row in csv.DictReader(f):
            if row['matched'] == 'True':
                all_results.append(row)
    
    # Add spatial matches
    spatial_matched = [r for r in spatial_results if r['matched']]
    for r in spatial_matched:
        all_results.append({
            'alcaldia': r['alcaldia'],
            'colonia_crime': r['colonia_crime'],
            'colonia_geo': r['colonia_geo'],
            'match_type': 'spatial',
            'matched': 'True'
        })
    
    # Add remaining unmatched
    for r in spatial_results:
        if not r['matched']:
            all_results.append({
                'alcaldia': r['alcaldia'],
                'colonia_crime': r['colonia_crime'],
                'colonia_geo': '',
                'match_type': r['match_type'],
                'matched': 'False'
            })
    
    # Save updated report
    with open(report_path, 'w', encoding='utf-8', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=['alcaldia', 'colonia_crime', 'colonia_geo', 'match_type', 'matched'])
        writer.writeheader()
        writer.writerows(all_results)
    
    matched = sum(1 for r in all_results if r['matched'] == 'True')
    print(f"\nUpdated match report: {matched}/{len(all_results)} ({100*matched/len(all_results):.1f}%)")
    
    # Rebuild colonias_geo.json including spatial matches
    # Build polygon lookup by colonia name
    poly_by_col = {}
    for ft, geom in polys:
        key = ft['properties']['colonia']
        poly_by_col[key] = ft
    
    # Load existing colonias_geo.json
    geo_path = ROOT / 'colonias_geo.json'
    with open(geo_path, 'r', encoding='utf-8') as f:
        geo_out = json.load(f)
    
    existing_keys = set()
    for ft in geo_out['features']:
        existing_keys.add((ft['properties']['alcaldia'], ft['properties']['colonia']))
    
    # Add spatial matches
    added = 0
    for r in spatial_matched:
        key = (r['alcaldia'], r['colonia_crime'])
        if key not in existing_keys:
            # Find the polygon feature
            geo_col = r['colonia_geo']
            if geo_col in poly_by_col:
                ft = poly_by_col[geo_col]
                new_ft = {
                    "type": "Feature",
                    "properties": {
                        "alcaldia": r['alcaldia'],
                        "colonia": r['colonia_crime'],
                    },
                    "geometry": ft['geometry']
                }
                geo_out['features'].append(new_ft)
                existing_keys.add(key)
                added += 1
    
    with open(geo_path, 'w', encoding='utf-8') as f:
        json.dump(geo_out, f, ensure_ascii=False)
    
    size_mb = geo_path.stat().st_size / (1024*1024)
    print(f"Added {added} spatial matches to colonias_geo.json ({len(geo_out['features'])} features, {size_mb:.1f} MB)")

if __name__ == '__main__':
    main()
