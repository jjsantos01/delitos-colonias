import pandas as pd
import numpy as np
import json
import os
import sys
import argparse

def build_static_api(csv_path, output_dir):
    print(f"Reading CSV from {csv_path}...")
    # Read only needed columns to save memory
    usecols = ['anio_hecho', 'fecha_hecho', 'hora_hecho', 'delito', 
               'colonia_hecho', 'colonia_catalogo', 'alcaldia_hecho', 
               'latitud', 'longitud']
    
    df = pd.read_csv(csv_path, usecols=usecols, low_memory=False)
    
    print("Filtering data (>= 2019)...")
    # Clean anio_hecho
    df = df[pd.to_numeric(df['anio_hecho'], errors='coerce').notna()]
    df['anio_hecho'] = df['anio_hecho'].astype(int)
    df = df[df['anio_hecho'] >= 2019]
    
    # Filter valid alcaldias
    df = df[df['alcaldia_hecho'].notna()]
    df = df[df['alcaldia_hecho'] != 'nan']
    df = df[df['alcaldia_hecho'].str.strip() != '']
    
    # Process dates for quarters
    print("Processing dates and quarters...")
    # Slicing the first 10 characters to handle mixed 'YYYY-MM-DD' and 'YYYY-MM-DD HH:MM:SS'
    clean_dates = df['fecha_hecho'].astype(str).str.slice(0, 10)
    fecha_dt = pd.to_datetime(clean_dates, errors='coerce')
    df['trimestre'] = fecha_dt.dt.quarter.fillna(0).astype(int)
    
    # Filter out invalid dates (trimestre == 0)
    df = df[df['trimestre'] > 0]
    
    # Rule 5: Exclude incomplete 2025-Q1
    df = df[~((df['anio_hecho'] == 2025) & (df['trimestre'] == 1))]
    
    print("Normalizing colonias...")
    # COALESCE(NULLIF(colonia_catalogo, ''), INITCAP(colonia_hecho))
    df['colonia_catalogo'] = df['colonia_catalogo'].replace('', np.nan)
    colonia_hecho_title = df['colonia_hecho'].str.title()
    df['colonia_key'] = df['colonia_catalogo'].combine_first(colonia_hecho_title)
    
    # Filter valid colonias
    df = df[df['colonia_key'].notna()]
    df = df[df['colonia_key'].str.strip() != '']
    
    print("Calculating aggregations and building JSONs...")
    
    os.makedirs(output_dir, exist_ok=True)
    
    # Group by alcaldia and colonia
    grouped = df.groupby(['alcaldia_hecho', 'colonia_key'])
    
    count = 0
    for (alcaldia, colonia), group in grouped:
        # Create safe filenames
        safe_alcaldia = str(alcaldia).replace('/', '_').replace('\\', '_')
        safe_colonia = str(colonia).replace('/', '_').replace('\\', '_')
        
        alc_dir = os.path.join(output_dir, safe_alcaldia)
        os.makedirs(alc_dir, exist_ok=True)
        
        file_path = os.path.join(alc_dir, f"{safe_colonia}.json")
        
        # 1. Aggregations (Quarterly Data)
        # GROUP BY anio_hecho, trimestre, delito
        aggs = group.groupby(['anio_hecho', 'trimestre', 'delito']).size().reset_index(name='total')
        aggs = aggs.sort_values(['anio_hecho', 'trimestre'])
        
        # Convert to compact array: [anio, trimestre, delito, total]
        agregados_list = aggs.values.tolist()
        
        # 2. Map Points
        # Filter for rows that have lat/lon
        points_df = group[group['latitud'].notna() & group['longitud'].notna()]
        
        # Only needed columns: lat, lng, delito, fecha_hecho, hora_hecho, anio, trimestre
        points_df = points_df[['latitud', 'longitud', 'delito', 'fecha_hecho', 'hora_hecho', 'anio_hecho', 'trimestre']]
        # Handle nan strings in fecha/hora
        points_df = points_df.fillna({'fecha_hecho': '', 'hora_hecho': ''})
        
        # Convert to compact array to save massive space
        puntos_list = points_df.values.tolist()
        
        # Output structure
        output_data = {
            "agregados": agregados_list,
            "puntos": puntos_list
        }
        
        with open(file_path, 'w', encoding='utf-8') as f:
            json.dump(output_data, f, ensure_ascii=False, separators=(',', ':'))
            
        count += 1
        if count % 100 == 0:
            print(f"Processed {count} colonias...")
            
    print(f"Finished! Generated {count} JSON files in {output_dir}")

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--csv', default=r'C:\Users\jjsan\Downloads\carpetasFGJ_acumulado_2025_01.csv')
    parser.add_argument('--out', default=os.path.join(os.path.dirname(__file__), '..', 'data'))
    args = parser.parse_args()
    
    build_static_api(args.csv, args.out)
