import json

with open('catlogo-de-colonias.json', 'r', encoding='utf-8') as f:
    d = json.load(f)

print(f"Total features: {len(d['features'])}")
props = [ft['properties'] for ft in d['features']]
alcs = set(p['alc'] for p in props)
print(f"Alcaldías: {len(alcs)}")
print(sorted(alcs))
cols = set(p['colonia'] for p in props)
print(f"Colonias únicas: {len(cols)}")
# Show some sample colonia names
for p in sorted(props, key=lambda x: (x['alc'], x['colonia']))[:15]:
    print(f"  {p['alc']} | {p['colonia']} ({p['clasif']})")
