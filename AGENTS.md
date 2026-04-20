# Guía de Arquitectura para Agentes de Código Autónomo

Si eres un modelo de lenguaje (LLM), asistente y agente de código trabajando sobre este repositorio a petición del usuario, por favor considera el siguiente contexto rígido **antes de manipular, refactorizar o alterar la lógica base del sistema**.

## 1. Patrón Anti-saturación API

Dado que la colección CKAN es masiva (2.1M registros) y los recursos por IP no son ilimitados, la aplicación emplea una técnica muy cuidadosa en el modo en que extrae la información para ser gentil y optimizar la red:

- **Query 1 (Arranque - `getCatalog`)**: Descarga el registro unificado únicamente una vez para hidratar el filtro lateral.
- **Query 2 (Datos analíticos y KPIs - `getQuarterlyData`)**: Cuando el usuario selecciona una colonia, no descargamos los registros "raw" (no consolidados). Hacemos el recuento agrupándolo desde la misma declaración del script SQL (`SELECT ... GROUP BY anio_hecho, trimestre, delito`).
- **Query 3 (Geoposicionamiento exclusivo temporal - `getMapPoints`)**: Al momento de requerir el mapa, SÓLO se solicita al JSON los puntos para LAT/LONG del **trimestre específico** seleccionado en curso, no del total de los 6 años previos.

**CRÍTICO**: Bajo NINGUNA circunstancia expulses de su esquema este filtro agrupador. NUNCA propongas "Traer la base completa cruda para manipularla en JS", ya que provocará enrutamientos masivos que superan el límite de transferencia de DataStore de CKAN y crashearán el navegador por problemas de RAM.

## 2. Clasificaciones y Macro-categorías Locales

Las cinco (5) ramificaciones actuales llamadas `macro_cat` NO provienen de la API original, son construidas al interactuar los datos recabados en código JavaScript por medio del enjambre provisto en `CategoryMapper` (Ver en `app.js`).
Esto se hizo deliberadamente para romper el estancamiento de la categoría subyacente *'DELITO DE BAJO IMPACTO'*.

Si el usuario solicita ajustar grupos, agregar nuevas categorías, segmentar violencias u homicidios aparte:
1. No rearmes o integres el filtro lógico al query SQL original.
2. Continúa añadiendo el caso al condicional `CategoryMapper.classify(delito)` en `app.js`.

## 3. Caché de Filtrados Internos JS

La estructura operativa tiene 3 fases clave para los datos de los gráficos:
- `State.coloniaData` – Los datos tal como llegaron del API.
- `State.filteredData` – Los datos cruzados luego del filtrado interno para macro-categorías activadas y/o multi-select (Checkboxs / Dropdown).
- Modificar componentes visuales únicamente consume la variante dependiente del array `State.filteredData`.
  
Cualquier función que modifique gráficas debe pasar por `applyFiltersAndRender()`. No se llama a la API nuevamente (ni el botón master switch ni las cajas).

## 4. Estado Atado a Enlace Compartido (URLSearchParams)
La función de Share/Compartir copia del estado el URL base en formato paramétrico mediante las banderas `?alcaldia=..&colonia=..&q=...`.
- Cualquier filtro lateral adicional como el multi-select o el grid no son parte del snapshot del Estado URL compartido.
- Modificar el comportamiento de carga automática asíncrona proveniente de un Request en URl se localiza directamente en `loadInitialStateFromUrl()` en la parte superior. Notarás que usa un `setTimeout` forzoso de 100ms para permitir a la instancia interna `TomSelect` ser rehidratada del objeto select luego de modificar el proxy "Alcaldía" primero.

## 5. Formato Expreso de Trimestres
Se excluyen por directiva "Trimestres no completados" en `getQuarterlyData`. Por el actual año (hacia comienzos del repositorio), esto corresponde a excluir `2025-Q1` directamente ignorándolo desde el `rawData.filter(r => !(r.anio_hecho == 2025 && r.trimestre == 1))` para no generar un desplome falto en la curva de avance histórico en el frente del Dashbooard al usuario general.
