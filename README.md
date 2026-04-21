# Dashboard de Delitos por Colonia — CDMX

Este repositorio contiene un dashboard interactivo, de una sola página y sin backend (Single Page Application - SPA), diseñado para visualizar y analizar el índice delictivo a nivel colonia en la Ciudad de México. 

La aplicación se alimenta de la base de datos oficial *"Carpetas de Investigación FGJ"* provista a través del portal de Datos Abiertos de la CDMX, empleando la API **CKAN DataStore SQL**.

## 🚀 Funcionalidades Actuales

- **Consultas Optimizadas**: Acceso a un histórico de más de 2 millones de registros directamente desde la API oficial de la CDMX mediante llamadas SQL `POST` seguras, sin necesidad de replicar o mantener una base de datos propia.
- **Macro-Categorías para Lectura Ciudadana**: El dataset contiene más de 350 tipos penales distintos. Con fines de legibilidad, esta herramienta los re-agrupa en la capa de frontend en 5 macro-categorías comprensibles basadas en el texto descriptivo del delito [(Ver Metodología Completa)](METODOLOGIA_CATEGORIAS.md):
  - 🔴 **Robos**
  - 🟣 **Violencia y Lesiones**
  - 🟡 **Delitos Patrimoniales**
  - 🔵 **Delitos Sexuales**
  - ⚪ **Otros** (Incluye falsedad, narcomenudeo y hechos no delictivos).
- **Selector Temporizado Estricto**: Filtro a nivel trimestral (Q-Level), excluyendo fragmentos incompletos para preservar la uniformidad de las comparaciones históricas.
- **Tarjetas de KPI y Comparativas**: Monitoreo paramétrico del bloque seleccionado evaluado contra:
  - El trimestre inmediato anterior.
  - El trimestre coincidente del año pasado.
  - Avance del año en curso contra año anterior ('Year-To-Date').
- **Interactividad Geo-Espacial y Métrica**:
  - Mapa integrado (`Leaflet` + `MarkerCluster`) enfocado a clústers para evitar saturar el navegador en puntos de muy alta concentración.
  - Histórico volumétrico renderizado en una línea temporal trimestral (`Chart.js`) reactiva.
- **Reportes con Enlaces Compartibles**: Soporte nativo de `URLSearchParams` para clonado de estado universal. Cada selección de alcaldía, colonia y trimestre genera un enlace permanente listado en la barra superior ("Compartir") que puede enviarse a cualquier persona.

## 🛠 Arquitectura Front-End

El proyecto se despliega un modo puramente estático servido desde el cliente (HTML, CSS y Vanilla JS), usando el patrón UI "Dark Mode Glassmorphism". Las dependencias del ecosistema actual se importan mediante CDN público sin requerir `npm install` o `webpack`/`vite`.

### Librerías Externas Implementadas:
- **[TomSelect](https://tom-select.js.org/) (v2.3.1)**: Utilizado para el componente de listas desplegables enriquecidas y auto-completable rápido en menús (Alcaldías, Colonias, Delitos, Trimestres).
- **[Chart.js](https://www.chartjs.org/)**: Implementado en el histórico trimestral multicapa y responsive.
- **[Leaflet](https://leafletjs.com/) (v1.9.4)**: Manejo nativo de los sub-recursos geo-espaciales cartográficos. Usando temas oscuros de base.
- **[Leaflet.MarkerCluster](https://github.com/Leaflet/Leaflet.markercluster)**: Componente base para renderizado ordenado masivo de miles de clavijas de geoposicionamiento en vista macro.

## ⚙️ Correr o Contribuir de Manera Local

No necesitas dependencias de compilación para testarlo:

```bash
# Mediante npx y serve
npx serve .

# O, alternativamente mediante Python:
python -m http.server 8000
```
Dirígete a `http://localhost:8000/` o `http://localhost:3000/` dependiendo tu configuración de puertos.
