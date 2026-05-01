"""
compute_neighbors.py — Precompute adjacent colonias from the GeoJSON polygons.

Two colonias are "neighbors" if their polygons touch or share a boundary.
Uses Shapely's `touches()` + `intersects()` with a small buffer to handle
floating-point edge cases.

Usage: uv run scripts/compute_neighbors.py
Output: colonias_neighbors.json — adjacency map keyed by "ALCALDIA||colonia"
"""
# /// script
# requires-python = ">=3.10"
# dependencies = ["shapely"]
# ///

import json
from pathlib import Path
from shapely.geometry import shape
from shapely import STRtree

ROOT = Path(__file__).resolve().parent.parent

def main():
    path = ROOT / 'colonias_geo.json'
    print("Loading colonias_geo.json...")
    with open(path, 'r', encoding='utf-8') as f:
        geojson = json.load(f)
    
    features = geojson['features']
    print(f"  {len(features)} features loaded")
    
    # Build geometries and keys
    keys = []
    geoms = []
    for ft in features:
        alc = ft['properties']['alcaldia']
        col = ft['properties']['colonia']
        key = f"{alc}||{col}"
        try:
            geom = shape(ft['geometry'])
            if geom.is_valid and not geom.is_empty:
                keys.append(key)
                geoms.append(geom)
        except Exception:
            pass
    
    print(f"  {len(geoms)} valid geometries")
    
    # Build spatial index (STRtree)
    print("Building spatial index...")
    tree = STRtree(geoms)
    
    # Find neighbors using spatial index
    print("Computing adjacency...")
    # Buffer tolerance for touching detection (in degrees, ~11m)
    TOLERANCE = 0.0001
    
    neighbors = {}
    for i, geom in enumerate(geoms):
        # Query spatial index for candidates near this geometry
        buffered = geom.buffer(TOLERANCE)
        candidate_idxs = tree.query(buffered)
        
        my_neighbors = []
        for j in candidate_idxs:
            if i == j:
                continue
            # Check if polygons actually touch/intersect (not just bounding box overlap)
            if geom.buffer(TOLERANCE).intersects(geoms[j]):
                my_neighbors.append(keys[j])
        
        if my_neighbors:
            neighbors[keys[i]] = sorted(my_neighbors)
    
    # Stats
    n_with_neighbors = len(neighbors)
    avg_neighbors = sum(len(v) for v in neighbors.values()) / max(n_with_neighbors, 1)
    max_neighbors = max((len(v) for v in neighbors.values()), default=0)
    max_key = next((k for k, v in neighbors.items() if len(v) == max_neighbors), None)
    
    print(f"\nResults:")
    print(f"  Colonias with neighbors: {n_with_neighbors}/{len(geoms)}")
    print(f"  Average neighbors: {avg_neighbors:.1f}")
    print(f"  Max neighbors: {max_neighbors} ({max_key})")
    
    # Show some examples
    print("\nExamples:")
    samples = ['CUAUHTEMOC||Roma Norte', 'BENITO JUAREZ||Narvarte Poniente', 'COYOACAN||Copilco Universidad']
    for sample in samples:
        if sample in neighbors:
            ns = neighbors[sample]
            print(f"  {sample}: {len(ns)} neighbors")
            for n in ns[:5]:
                print(f"    - {n}")
            if len(ns) > 5:
                print(f"    ... and {len(ns)-5} more")
        else:
            print(f"  {sample}: no neighbors found")
    
    # Save
    out_path = ROOT / 'colonias_neighbors.json'
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(neighbors, f, ensure_ascii=False, separators=(',', ':'))
    
    size_kb = out_path.stat().st_size / 1024
    print(f"\nSaved: {out_path} ({size_kb:.0f} KB)")

if __name__ == '__main__':
    main()
