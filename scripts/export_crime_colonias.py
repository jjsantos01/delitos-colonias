"""
export_crime_colonias.py — Export crime colonias list from CKAN API to CSV.

Usage: python scripts/export_crime_colonias.py
Output: scripts/crime_colonias.csv
"""

import json, csv, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
API_URL = 'https://datos.cdmx.gob.mx/api/3/action/datastore_search_sql'
RESOURCE_ID = '48fcb848-220c-4af0-839b-4fd8ac812c0f'

SQL = f"""
SELECT DISTINCT alcaldia_hecho,
       COALESCE(NULLIF(colonia_catalogo, ''), INITCAP(colonia_hecho)) AS colonia
FROM "{RESOURCE_ID}"
WHERE anio_hecho >= 2019
  AND alcaldia_hecho IS NOT NULL
  AND alcaldia_hecho != 'nan'
  AND COALESCE(NULLIF(colonia_catalogo, ''), INITCAP(colonia_hecho)) IS NOT NULL
  AND COALESCE(NULLIF(colonia_catalogo, ''), INITCAP(colonia_hecho)) != ''
ORDER BY alcaldia_hecho, colonia
"""

def main():
    url = f"{API_URL}?sql={urllib.parse.quote(SQL)}"
    print("Fetching from CKAN API...")
    
    req = urllib.request.Request(url)
    with urllib.request.urlopen(req, timeout=60) as resp:
        data = json.loads(resp.read().decode('utf-8'))
    
    records = data['result']['records']
    print(f"  {len(records)} colonias fetched")
    
    out_path = ROOT / 'scripts' / 'crime_colonias.csv'
    with open(out_path, 'w', encoding='utf-8', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=['alcaldia_hecho', 'colonia'])
        writer.writeheader()
        for r in records:
            writer.writerow({'alcaldia_hecho': r['alcaldia_hecho'], 'colonia': r['colonia']})
    
    print(f"  Saved to: {out_path}")

if __name__ == '__main__':
    import urllib.parse
    main()
