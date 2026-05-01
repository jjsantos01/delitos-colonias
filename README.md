# Dashboard de Delitos por Colonia — CDMX

Este repositorio contiene un dashboard interactivo de una sola página (SPA), diseñado para la inteligencia ciudadana sobre el índice delictivo a nivel colonia en la Ciudad de México. La aplicación consume directamente la API **CKAN DataStore SQL** de la CDMX, permitiendo un análisis profundo sin dependencias de backend propias.

## 🚀 Funcionalidades Principales

- **Análisis de Colonias Vecinas**: Única herramienta que permite expandir el análisis más allá de una sola colonia, incluyendo automáticamente sus vecindarios adyacentes (incluso si pertenecen a otra alcaldía) para entender dinámicas espaciales de seguridad.
- **Consultas SQL**: Acceso al histórico oficial de >2.1M de registros mediante llamadas optimizadas, sin descargas masivas de datos en el cliente.
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

## 🛠 Arquitectura Front-End

El proyecto utiliza un patrón **Dark Mode Glassmorphism** y está construido exclusivamente con tecnologías web estándar (Vanilla JS), servido estáticamente.

### Stack Tecnológico:
- **[TomSelect](https://tom-select.js.org/) (v2.3.1)**: Autocompletado y multiselect enriquecido.
- **[Chart.js](https://www.chartjs.org/)**: Visualizaciones de series temporales.
- **[Leaflet](https://leafletjs.com/) (v1.9.4)** + **[Leaflet.heat](https://github.com/Leaflet/Leaflet.heat)**: Motor cartográfico y capas de calor.

### Datos de Soporte:
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
