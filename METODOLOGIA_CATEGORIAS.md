# Metodología de Macro-Categorías

## El Problema del Dataset Original

El dataset original de *"Carpetas de Investigación FGJ de la Ciudad de México"* clasifica los delitos mediante la columna `categoria_delito`. Al realizar un análisis estructural de la base de datos se detectó un problema de representatividad severo para fines de visualización ciudadana:

De los más de 2 millones de registros, **el 81.5% de todas las carpetas están encasilladas bajo un único valor genérico: `DELITO DE BAJO IMPACTO`**. 

Dentro de esta gigantesca "bolsa de sastre" conviven delitos que tienen naturalezas sumamente distintas, por ejemplo:
- Violencia familiar
- Fraude
- Robo de objetos
- Amenazas
- Narcomenudeo posesión simple
- Abuso de confianza

Utilizar la `categoria_delito` original provocaría que cualquier gráfica se dibujara con una sola línea masiva e incomprensible, ocultando las verdaderas tendencias de inseguridad de cada colonia.

---

## Solución: Reagrupación Dinámica en la Capa Visual

Para resolver este problema sin alterar la consulta SQL original ni descargar bases de datos estáticas enormes, la plataforma implementa una re-clasificación en la capa de interfaz de usuario mediante JavaScript (dentro de la clase `CategoryMapper` ubicada en `app.js`).

La herramienta ignora la `categoria_delito` de origen y recategoriza apoyándose en el campo **`delito`** (que contiene la descripción explícita de uno de los 357 tipos penales distintos capturados por la fiscalía). 

Las reglas se aplican mediante **palabras clave (keywords)** siguiendo un orden de prelación. Todo el esquema se consolida en 5 nuevas "**Macro-Categorías**":

### 1. 🔴 Robos
Busca capturar infracciones ligadas al hurto explícito, asaltos a mano armada y desapoderamiento de bienes.
* **Regla:** Se incluye a esta categoría cualquier registro donde el nombre del `delito` contenga las palabras `"ROBO"` o `"ASALTO"`.

### 2. 🟣 Violencia y Lesiones
Agrupa aquellos actos que atentan directa o indirectamente contra la integridad corporal, física, emocional o vital.
* **Regla:** Se incluye cualquier `delito` que contenga las palabras `"VIOLENCIA FAMILIAR"`, `"LESIONES"`, `"AMENAZAS"`, `"HOMICIDIO"`, `"FEMINICIDIO"` o `"GOLPES"`.

### 3. 🟡 Delitos Patrimoniales
Reúne crímenes de cuello blanco, engaños y manipulaciones financieras, así como desestabilización del patrimonio físico y documental que no impliquen hurto físico (ej. extorsión o despojo).
* **Regla:** Se agrupa bajo este concepto a cualquier `delito` con las palabras `"FRAUDE"`, `"ABUSO DE CONFIANZA"`, `"DESPOJO"`, `"EXTORSION"`, `"USURPACIÓN"`, o `"DAÑO EN PROPIEDAD"`.

### 4. 🔵 Delitos Sexuales
Agrupación de todo delito circunscrito a agresiones de índole sexual.
* **Regla:** La asignación se basa en verificar si existe alguna de las expresiones `"VIOLACIÓN"`, `"ABUSO SEXUAL"`, `"ACOSO"`, o `"ESTUPRO"`.

### 5. ⚪ Otros (Incluye Hechos no Delictivos)
Es la categoría por defecto si ninguna de las 4 reglas anteriores fue accionada. Consiste en incidentes que, aunque requirieron levantar una carpeta, corresponden a un espectro amplio, menor o burocrático de la ley:
* Posesión simple (Narcomenudeo)
* Falsificación de títulos, daño de documentos
* Pérdida de vida por otras causas
* Abuso de autoridad
* Hechos no delictivos (Denuncias de pérdida de pasaportes, extravíos, etc.)

---

## Modificación de las Reglas

Dado que esta lógica se encuentra centralizada en la función estática `CategoryMapper.classify()`, la metodología y las palabras clave pueden auditarse, ajustarse o expandirse fácilmente modificando unas cuantas líneas de código en el archivo JavaScript sin requerir intervención en la base de datos de origen.
