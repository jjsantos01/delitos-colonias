# Guía de Arquitectura para Agentes de Código Autónomo

Si eres un modelo de lenguaje (LLM), asistente y agente de código trabajando sobre este repositorio a petición del usuario, por favor considera el siguiente contexto rígido **antes de manipular, refactorizar o alterar la lógica base del sistema**.

## 1. Patrón Anti-saturación: Arquitectura Static Data Lake

Dado que la colección de la Fiscalía es masiva (2.1M registros) y los recursos por IP en la API de CKAN no son ilimitados, la aplicación ha migrado de consultas dinámicas SQL a una **Arquitectura Static Data Lake**. 

- **Query 1 (Catálogo Estático - `catalog.json`)**: Descarga el registro unificado en la carga inicial para hidratar los filtros laterales. Actualizado mensualmente vía GitHub Actions.
- **Query 2 y 3 (Datos analíticos, KPIs y Geoposicionamiento)**: Ya no se realizan consultas a la API de CKAN. La aplicación hace `fetch` de archivos JSON estáticos altamente optimizados que se encuentran pre-calculados en `/data/{alcaldia}/{colonia}.json`.
- El archivo maestro CSV de 600MB es procesado en background por `scripts/build_static_api.py` utilizando Pandas.

**CRÍTICO**: Bajo NINGUNA circunstancia propongas revertir esta arquitectura a consultas dinámicas de SQL (`fetchSQL`). Esta estructura de archivos JSON garantiza cargas instantáneas y evita superar los límites de transferencia del navegador o de CKAN. La única excepción donde se utiliza SQL dinámico es en el botón de "Descargar CSV" crudo (`getQuarterDetails`).

## 2. Clasificaciones y Macro-categorías Locales

Las cinco (5) ramificaciones actuales llamadas `macro_cat` NO provienen de la API original, son construidas al interactuar los datos recabados en código JavaScript por medio del enjambre provisto en `CategoryMapper` (Ver en `app.js`).
Esto se hizo deliberadamente para romper el estancamiento de la categoría subyacente *'DELITO DE BAJO IMPACTO'*.

Si el usuario solicita ajustar grupos, agregar nuevas categorías, segmentar violencias u homicidios aparte:
1. No rearmes o integres el filtro lógico al pipeline ETL original, a menos que sea estrictamente necesario.
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

## 6. Campos de Ubicación: `_hecho` vs `_catalogo`

El dataset de FGJ tiene dos pares de campos geográficos:
- `alcaldia_hecho` / `colonia_hecho` — Ubicación declarada por el denunciante (mayúsculas, nombres genéricos).
- `alcaldia_catalogo` / `colonia_catalogo` — Ubicación normalizada contra el catálogo oficial de colonias de CDMX (Title Case, sub-colonias precisas).

**Convención actual del proyecto:**
- **Alcaldía**: Se usa `alcaldia_hecho`. El campo `alcaldia_catalogo` está **vacío en el 98.8%** de los registros y NO es utilizable.
- **Colonia**: Se usa `colonia_catalogo` con fallback a `colonia_hecho` mediante `COALESCE(NULLIF(colonia_catalogo, ''), INITCAP(colonia_hecho))`. Se aplica `INITCAP` al fallback para normalizar a Title Case y evitar duplicados entre catálogo (Title Case) y hecho (MAYÚSCULAS). Esto ofrece mayor granularidad (ej: "NARVARTE" → "Narvarte Poniente" / "Narvarte Oriente") sin perder registros rurales que carecen de catálogo.

**CRÍTICO**: No cambiar a `alcaldia_catalogo` — está vacío. No eliminar el fallback `COALESCE` para colonias — hay ~16K registros rurales que solo tienen `colonia_hecho`. No remover `INITCAP` del fallback — sin él se generan duplicados.
