import urllib.request
import urllib.parse
import json
import os

API_URL = 'https://datos.cdmx.gob.mx/api/3/action/datastore_search_sql'
RESOURCE_ID = '48fcb848-220c-4af0-839b-4fd8ac812c0f'

SQL_QUERY = f"""
SELECT DISTINCT alcaldia_hecho,
       COALESCE(NULLIF(colonia_catalogo, ''), INITCAP(colonia_hecho)) AS colonia_catalogo
FROM "{RESOURCE_ID}"
WHERE alcaldia_hecho IS NOT NULL
  AND alcaldia_hecho != 'nan'
  AND COALESCE(NULLIF(colonia_catalogo, ''), INITCAP(colonia_hecho)) IS NOT NULL
  AND COALESCE(NULLIF(colonia_catalogo, ''), INITCAP(colonia_hecho)) != ''
ORDER BY alcaldia_hecho, colonia_catalogo
"""

def update_catalog():
    print("Fetching catalog from CKAN...")
    url = f"{API_URL}?sql={urllib.parse.quote(SQL_QUERY.strip())}"
    
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req) as response:
            data = json.loads(response.read().decode())
            
            if not data.get('success'):
                print("API returned an error:", data.get('error'))
                return False
                
            records = data['result']['records']
            print(f"Fetched {len(records)} catalog records.")
            
            # Save to root directory
            output_path = os.path.join(os.path.dirname(__file__), '..', 'catalog.json')
            with open(output_path, 'w', encoding='utf-8') as f:
                json.dump(records, f, ensure_ascii=False, indent=2)
                
            print(f"Successfully saved to {output_path}")
            return True
            
    except Exception as e:
        print(f"Error fetching catalog: {e}")
        return False

if __name__ == '__main__':
    update_catalog()
