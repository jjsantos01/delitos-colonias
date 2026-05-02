# Dashboard de Delitos por Colonia — CDMX

Este repositorio contiene un dashboard interactivo diseñado para la inteligencia ciudadana sobre la evolución delictiva a nivel colonia en la Ciudad de México. La aplicación utiliza una **Arquitectura Static Data Lake**, consumiendo archivos JSON pre-procesados para ofrecer un análisis profundo con tiempos de carga instantáneos y sin dependencias de un backend propio ni riesgo de bloqueos por límites de API.

## 🚀 Funcionalidades Principales

- **Análisis de Colonias Vecinas**: Única herramienta que permite expandir el análisis más allá de una sola colonia, incluyendo automáticamente sus vecindarios adyacentes (incluso si pertenecen a otra alcaldía) para entender dinámicas espaciales de seguridad.
- **Rendimiento Ultrarrápido**: Los datos históricos son construidos mediante una canalización (ETL) en GitHub Actions que extrae, optimiza y almacena >2.1M de registros en una colección estática servida desde el propio repositorio.
- **Interactividad Geo-Espacial Avanzada**:
  - **Mapas de Calor (Heatmap)**: Visualización de densidad de incidentes mediante `Leaflet.heat`.
  - **Modo Pantalla Completa**: Interfaz de mapa expandible para análisis detallado.
- **KPIs y Comparativas de Alto Nivel**:
  - **Cuadro de Mando Trimestral**: Comparativas QoQ (Trimestre anterior), YoY (Año anterior) y YTD (Acumulado anual).
  - **Tabla de Desglose por Categoría**: Matriz interactiva que detalla el rendimiento de cada macro-categoría de delito.
- **Transparencia Metodológica**:
  - **Macro-Categorías**: Re-clasificación de más de 350 tipos penales en 5 grupos legibles (Robos, Violencia, Patrimoniales, Sexuales, Otros).
  - **Contexto Diego Valle-Jones**: Incorporación de notas técnicas sobre la aleatorización de puntos (buffer de 200m) para preservar la privacidad.
- **Exportación y Compartición**:
  - **Descarga CSV**: Exportación de datos crudos (anonimizados) del periodo seleccionado.
  - **Reportes PDF**: Generación de reportes listos para imprimir o compartir.
  - **Enlaces Permanentes**: Estado de la aplicación (alcaldía, colonia, trimestre) persistido en la URL.

## 🛠 Arquitectura y Pipeline de Datos

La aplicación sigue el patrón de una aplicación estática sin servidor, apoyada por procesos de integración continua para mantener la información siempre al día.

### Pipeline ETL (Static Data Lake)
- Un flujo de **GitHub Actions** (`.github/workflows/build_static_api.yml`) corre automáticamente cada mes para descargar el último CSV del portal de datos de la CDMX.
- Utiliza **Python y Pandas** para agrupar los millones de registros por alcaldía y colonia, comprimiéndolos en estructuras eficientes de JSON (arrays en lugar de objetos).
- Estos archivos se inyectan dinámicamente en el repositorio dentro de la carpeta `data/`.

### Front-End:
- **Tecnologías Base**: Vanilla JavaScript con un patrón de diseño **Dark Mode Glassmorphism**.
- **[TomSelect](https://tom-select.js.org/) (v2.3.1)**: Autocompletado y multiselect enriquecido.
- **[Chart.js](https://www.chartjs.org/)**: Visualizaciones de series temporales.
- **[Leaflet](https://leafletjs.com/) (v1.9.4)** + **[Leaflet.heat](https://github.com/Leaflet/Leaflet.heat)**: Motor cartográfico y capas de calor.

### Datos de Soporte:
- `catalog.json`: Lista curada de colonias válidas generada estáticamente.
- `colonias_neighbors.json`: Mapa de adyacencia espacial para el análisis de colonias vecinas.

## ⚙️ Uso Local

No requiere pasos de compilación ni instalación de dependencias:

```bash
# Mediante npx (Node.js)
npx serve .

# O mediante Python
python -m http.server 8000
```
Dirígete a `http://localhost:8000/` o `http://localhost:3000/` dependiendo tu configuración de puertos.
