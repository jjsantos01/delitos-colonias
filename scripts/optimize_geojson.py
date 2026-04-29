"""
optimize_geojson.py — Simplify polygon coordinates to reduce file size.

Uses Douglas-Peucker simplification to reduce coordinate density while
preserving polygon shapes.

Usage: uv run scripts/optimize_geojson.py
"""
# /// script
# requires-python = ">=3.10"
# dependencies = ["shapely"]
# ///

import json
from pathlib import Path
from shapely.geometry import shape, mapping

ROOT = Path(__file__).resolve().parent.parent

def count_coords(geojson):
    total = 0
    for ft in geojson['features']:
        geom = ft['geometry']
        if geom['type'] == 'Polygon':
            for ring in geom['coordinates']:
                total += len(ring)
        elif geom['type'] == 'MultiPolygon':
            for poly in geom['coordinates']:
                for ring in poly:
                    total += len(ring)
    return total

def simplify_and_round(geojson, tolerance=0.0001, decimal_places=5):
    """Simplify geometries and round coordinates."""
    out = {"type": "FeatureCollection", "features": []}
    
    for ft in geojson['features']:
        geom = shape(ft['geometry'])
        
        # Simplify using Douglas-Peucker
        simplified = geom.simplify(tolerance, preserve_topology=True)
        
        if simplified.is_empty:
            continue
        
        # Convert back to GeoJSON and round coordinates
        geom_dict = mapping(simplified)
        
        def round_coords(coords):
            if isinstance(coords[0], (list, tuple)):
                return [round_coords(c) for c in coords]
            return [round(coords[0], decimal_places), round(coords[1], decimal_places)]
        
        if geom_dict['type'] == 'Polygon':
            geom_dict['coordinates'] = [round_coords(ring) for ring in geom_dict['coordinates']]
        elif geom_dict['type'] == 'MultiPolygon':
            geom_dict['coordinates'] = [[round_coords(ring) for ring in poly] for poly in geom_dict['coordinates']]
        
        new_ft = {
            "type": "Feature",
            "properties": ft['properties'],
            "geometry": geom_dict
        }
        out['features'].append(new_ft)
    
    return out

def main():
    path = ROOT / 'colonias_geo.json'
    
    print("Loading colonias_geo.json...")
    with open(path, 'r', encoding='utf-8') as f:
        geojson = json.load(f)
    
    n_features = len(geojson['features'])
    n_coords_before = count_coords(geojson)
    size_before = path.stat().st_size / (1024*1024)
    print(f"  {n_features} features, {n_coords_before:,} coordinates, {size_before:.1f} MB")
    
    print("Simplifying geometries (tolerance=0.0001)...")
    optimized = simplify_and_round(geojson, tolerance=0.0001, decimal_places=5)
    
    n_coords_after = count_coords(optimized)
    
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(optimized, f, ensure_ascii=False, separators=(',', ':'))
    
    size_after = path.stat().st_size / (1024*1024)
    
    print(f"\nOptimization results:")
    print(f"  Features: {n_features} -> {len(optimized['features'])}")
    print(f"  Coordinates: {n_coords_before:,} -> {n_coords_after:,} ({100*n_coords_after/n_coords_before:.0f}%)")
    print(f"  File size: {size_before:.1f} MB -> {size_after:.1f} MB ({100*size_after/size_before:.0f}%)")

if __name__ == '__main__':
    main()
