const API_URL = 'https://datos.cdmx.gob.mx/api/3/action/datastore_search_sql';
const RESOURCE_ID = '48fcb848-220c-4af0-839b-4fd8ac812c0f';

// ── Heatmap visual tuning — adjust to taste ──────────────────────────
const HEATMAP_OPTIONS = {
    radius: 12,   // px de radio por punto (original: 20)
    blur:   10,   // px de desenfoque del halo (original: 15)
    maxZoom: 16
};
// ─────────────────────────────────────────────────────────────────────

// ==========================================
// 1. CKAN Client
// ==========================================
class CKANClient {
    static async fetchColoniaData(alcaldia, colonia) {
        const safeAlcaldia = alcaldia.replace(/\//g, '_').replace(/\\/g, '_');
        const safeColonia = colonia.replace(/\//g, '_').replace(/\\/g, '_');
        const url = `data/${encodeURIComponent(safeAlcaldia)}/${encodeURIComponent(safeColonia)}.json`;
        try {
            const response = await fetch(url);
            if (!response.ok) return null;
            return await response.json();
        } catch(e) {
            console.error("Static data fetch failed:", e);
            return null;
        }
    }

    static async getQuarterlyData(alcaldia, colonia) {
        const data = await this.fetchColoniaData(alcaldia, colonia);
        if (!data || !data.agregados) return [];
        return data.agregados.map(a => ({
            anio_hecho: a[0],
            trimestre: a[1],
            delito: a[2],
            total: a[3]
        }));
    }

    static async getMapPoints(alcaldia, colonia, year, quarter) {
        const data = await this.fetchColoniaData(alcaldia, colonia);
        if (!data || !data.puntos) return [];
        return data.puntos
            .filter(p => p[5] === year && p[6] === quarter)
            .map(p => ({
                latitud: p[0],
                longitud: p[1],
                delito: p[2],
                fecha_hecho: p[3],
                hora_hecho: p[4]
            }));
    }

    // Keep fetchSQL and getQuarterDetails pointing to CKAN for explicit raw CSV downloads.
    static async fetchSQL(sql) {
        try {
            const response = await fetch(`${API_URL}?sql=${encodeURIComponent(sql)}`);
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            const data = await response.json();
            if(!data.success) throw new Error(data.error?.message || 'API Error');
            return data.result.records;
        } catch (error) {
            console.error("CKAN Query Failed:", error);
            throw error;
        }
    }

    static getQuarterDetails(alcaldia, colonia, year, quarter) {
        return this.fetchSQL(`
            SELECT anio_inicio, mes_inicio, fecha_inicio, hora_inicio,
                   anio_hecho, mes_hecho, fecha_hecho, hora_hecho,
                   delito, categoria_delito, competencia,
                   fiscalia, agencia, unidad_investigacion,
                   colonia_hecho, colonia_catalogo,
                   alcaldia_hecho, alcaldia_catalogo,
                   municipio_hecho, latitud, longitud
            FROM "${RESOURCE_ID}"
            WHERE alcaldia_hecho = '${alcaldia.replace(/'/g, "''")}'
              AND COALESCE(NULLIF(colonia_catalogo, ''), INITCAP(colonia_hecho)) = '${colonia.replace(/'/g, "''")}'
              AND anio_hecho = ${year}
              AND EXTRACT(QUARTER FROM fecha_hecho) = ${quarter}
            ORDER BY fecha_hecho, hora_hecho
            LIMIT 32000
        `);
    }

    static async getQuarterlyDataMulti(coloniaList) {
        const promises = coloniaList.map(async c => {
            const data = await this.fetchColoniaData(c.alcaldia, c.colonia);
            if (!data || !data.agregados) return [];
            return data.agregados.map(a => ({
                alcaldia_hecho: c.alcaldia,
                colonia_key: c.colonia,
                anio_hecho: a[0],
                trimestre: a[1],
                delito: a[2],
                total: a[3]
            }));
        });
        const results = await Promise.all(promises);
        return results.flat();
    }

    static async getMapPointsMulti(coloniaList, year, quarter) {
        const promises = coloniaList.map(async c => {
            const data = await this.fetchColoniaData(c.alcaldia, c.colonia);
            if (!data || !data.puntos) return [];
            return data.puntos
                .filter(p => p[5] === year && p[6] === quarter)
                .map(p => ({
                    alcaldia_hecho: c.alcaldia,
                    colonia_key: c.colonia,
                    latitud: p[0],
                    longitud: p[1],
                    delito: p[2],
                    fecha_hecho: p[3],
                    hora_hecho: p[4]
                }));
        });
        const results = await Promise.all(promises);
        return results.flat();
    }
}

// ==========================================
// 2. Category Mapper
// ==========================================
class CategoryMapper {
    static CATEGORIES = {
        'ROBOS': { id: 'ROBOS', label: 'Robos', color: '#ef4444' }, // Red
        'VIOLENCIA': { id: 'VIOLENCIA', label: 'Violencia y Lesiones', color: '#a855f7' }, // Purple
        'PATRIMONIALES': { id: 'PATRIMONIALES', label: 'Delitos Patrimoniales', color: '#eab308' }, // Yellow
        'SEXUALES': { id: 'SEXUALES', label: 'Delitos Sexuales', color: '#3b82f6' }, // Blue
        'OTROS': { id: 'OTROS', label: 'Otros (incluye hechos no delictivos)', color: '#6b7280' } // Gray
    };

    static _cache = new Map();

    static classify(delito) {
        if (!delito) return 'OTROS';
        const d = delito.toUpperCase();
        
        if (this._cache.has(d)) return this._cache.get(d);

        let cat = 'OTROS';
        
        // Reglas de negocio (Keywords en delito)
        if (d.includes('ROBO') || d.includes('ASALTO')) {
            cat = 'ROBOS';
        } else if (d.includes('VIOLENCIA FAMILIAR') || d.includes('LESIONES') || d.includes('AMENAZAS') || d.includes('HOMICIDIO') || d.includes('FEMINICIDIO') || d.includes('GOLPES')) {
            cat = 'VIOLENCIA';
        } else if (d.includes('FRAUDE') || d.includes('ABUSO DE CONFIANZA') || d.includes('DESPOJO') || d.includes('EXTORSION') || d.includes('USURPACIÓN') || d.includes('DAÑO EN PROPIEDAD')) {
            cat = 'PATRIMONIALES';
        } else if (d.includes('VIOLACIÓN') || d.includes('ABUSO SEXUAL') || d.includes('ACOSO') || d.includes('ESTUPRO')) {
            cat = 'SEXUALES';
        }

        this._cache.set(d, cat);
        return cat;
    }
}

// ==========================================
// App State & Controllers
// ==========================================
const State = {
    catalog: [],
    coloniaData: [],      // Raw Q2 records
    filteredData: [],     // Data after applying cat/delito filters
    mapPoints: [],
    coloniaGeoData: null, // GeoJSON FeatureCollection from colonias_geo.json
    neighborsData: null,  // adjacency map from colonias_neighbors.json
    
    selectedAlcaldia: null,
    selectedColonia: null,
    selectedYear: null,   // Selected Q info
    selectedQuarter: null,
    
    activeCategories: new Set(Object.keys(CategoryMapper.CATEGORIES)),
    selectedDelitos: [],  // Empty means all
    heatmapMode: false,
    neighborsEnabled: false,
    activeNeighbors: new Set(),   // Set of "ALCALDIA||colonia" keys
    populationByColonia: {},
    rateMode: false
};

const UI = {
    loading: document.getElementById('loading-overlay'),
    emptyState: document.getElementById('empty-state'),
    contentWrapper: document.getElementById('content-wrapper'),
    
    // Selects (TomSelect instances later)
    coloniaSelect: null,
    trimestreSelect: null,
    delitoSelect: null,
    
    // Subcomponents
    chart: null,
    map: null,
    pointsGroup: null,
    heatLayer: null,
    coloniaPolygonLayer: null,
    neighborPolygonLayer: null,
    
    showLoading(show) { show ? this.loading.classList.add('active') : this.loading.classList.remove('active'); },
    showContent(show) { 
        this.contentWrapper.style.display = show ? 'flex' : 'none';
        this.emptyState.style.display = show ? 'none' : 'flex';
    }
};

// ==========================================
// Format utils
// ==========================================
const formatPct = (val) => {
    if(!isFinite(val) || isNaN(val)) return '-';
    const num = parseFloat(val);
    if(num > 0) return `▲ +${num.toFixed(1)}%`;
    if(num < 0) return `▼ ${num.toFixed(1)}%`;
    return '0%';
};

const getBadgeClass = (val) => {
    if(!isFinite(val) || isNaN(val)) return '';
    return parseFloat(val) > 0 ? 'up-bad' : (parseFloat(val) < 0 ? 'down-good' : '');
};

// ==========================================
// Initialization
// ==========================================
async function init() {
    UI.showLoading(true);
    try {
        await initMap();
        initChart();
        buildCategoryCheckboxes();
        setupShareButton();
        setupExportPDF();
        setupAdvancedFiltersToggle();
        setupHeatmapToggle();
        setupInfoModal();
        setupMapFullscreen();
        setupDownloadCSV();
        setupRateModeToggle();
        
        // Load colonia polygons, neighbors, and catalog in parallel
        const [catalog, geoResp, neighborsResp] = await Promise.all([
            fetch('catalog.json').then(r => r.json()),
            fetch('colonias_geo.json').then(r => r.ok ? r.json() : null).catch(() => null),
            fetch('colonias_neighbors.json').then(r => r.ok ? r.json() : null).catch(() => null)
        ]);
        State.catalog = catalog;
        State.coloniaGeoData = geoResp;
        State.neighborsData = neighborsResp;
        if (!geoResp) console.warn('colonias_geo.json not found — polygon outlines disabled');
        if (!neighborsResp) console.warn('colonias_neighbors.json not found — neighbors feature disabled');
        State.populationByColonia = await fetch('data/colonia_population.json').then(r => r.ok ? r.json() : ({})).catch(() => ({}));

        initSelects();
        setupNeighborsToggle();
        loadInitialStateFromUrl();
    } catch (e) {
        alert("Error cargando el catálogo de colonias. Revisa la consola.");
    } finally {
        UI.showLoading(false);
    }
}

function setupRateModeToggle() {
    const cb = document.getElementById('toggle-rate-mode');
    if (!cb) return;
    cb.checked = State.rateMode;
    cb.addEventListener('change', (e) => {
        State.rateMode = e.target.checked;
        renderKPIs();
        renderKPITable();
        renderChart();
        renderNeighborsTable();
    });
}

function getActivePopulation() {
    if (!State.selectedAlcaldia || !State.selectedColonia) return 0;
    const keys = new Set([`${State.selectedAlcaldia}||${State.selectedColonia}`]);
    if (State.neighborsEnabled) {
        State.activeNeighbors.forEach(k => keys.add(k));
    }
    let total = 0;
    keys.forEach(k => {
        total += parseInt(State.populationByColonia?.[k]?.population || 0, 10);
    });
    return total;
}

function formatMetricValue(value, population) {
    if (!State.rateMode) return Math.round(value).toLocaleString('es-MX');
    if (!population || population <= 0) return 'N/A';
    return ((value / population) * 10000).toFixed(1);
}

// ==========================================
// URL State & Share Logic
// ==========================================
function updateUrlState() {
    if(!State.selectedAlcaldia || !State.selectedColonia) return;
    const params = new URLSearchParams();
    params.set('alcaldia', State.selectedAlcaldia);
    params.set('colonia', State.selectedColonia);
    if(State.selectedYear && State.selectedQuarter) {
        params.set('q', `${State.selectedYear}-Q${State.selectedQuarter}`);
    }
    if (State.neighborsEnabled) {
        params.set('vecinos', 'true');
    }
    const newUrl = `${window.location.pathname}?${params.toString()}`;
    window.history.replaceState({}, '', newUrl);
    
    // Show share & export buttons
    const shareBtn = document.getElementById('btn-share');
    if(shareBtn) shareBtn.style.display = 'inline-flex';
    const exportBtn = document.getElementById('btn-export-pdf');
    if(exportBtn) exportBtn.style.display = 'inline-flex';
}

function loadInitialStateFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const alcaldiaUrl = params.get('alcaldia');
    const coloniaUrl = params.get('colonia');
    const qUrl = params.get('q'); 
    const vecinosUrl = params.get('vecinos');
    
    if(qUrl) State.urlRequestedQ = qUrl;

    if (vecinosUrl === 'true') {
        State.neighborsEnabled = true;
        const cb = document.getElementById('toggle-neighbors-cb');
        if (cb) cb.checked = true;
        const panel = document.getElementById('neighbors-panel');
        if (panel) panel.style.display = 'block';
    }

    if (alcaldiaUrl && coloniaUrl) {
        // Try to find exact match first, then fallback to case-insensitive colonia match
        const exactKey = `${alcaldiaUrl}||${coloniaUrl}`;
        if (UI.coloniaSelect.options[exactKey]) {
            UI.coloniaSelect.setValue(exactKey);
        } else {
            const fallbackKey = Object.keys(UI.coloniaSelect.options).find(k => {
                const [alc, col] = k.split('||');
                return alc === alcaldiaUrl && (col === coloniaUrl || col.toUpperCase() === coloniaUrl.toUpperCase());
            });
            if (fallbackKey) UI.coloniaSelect.setValue(fallbackKey);
        }
    }
}

function setupShareButton() {
    const shareBtn = document.getElementById('btn-share');
    if(shareBtn) {
        shareBtn.addEventListener('click', async () => {
            try {
                await navigator.clipboard.writeText(window.location.href);
                const prevText = shareBtn.innerHTML;
                shareBtn.innerHTML = '✅ <span class="btn-label">Copiado!</span>';
                setTimeout(() => shareBtn.innerHTML = prevText, 2000);
            } catch (err) {
                alert("No se pudo copiar el enlace automáticamente. Copia la URL de tu navegador.");
            }
        });
    }
}

function setupExportPDF() {
    const exportBtn = document.getElementById('btn-export-pdf');
    if(exportBtn) {
        exportBtn.addEventListener('click', exportPDF);
    }
}

// Lazy-load a script and return a promise
function loadScript(src) {
    return new Promise((resolve, reject) => {
        // Check if already loaded
        if (document.querySelector(`script[src="${src}"]`)) {
            resolve();
            return;
        }
        const script = document.createElement('script');
        script.src = src;
        script.onload = resolve;
        script.onerror = () => reject(new Error(`Failed to load ${src}`));
        document.head.appendChild(script);
    });
}

let pdfLibsLoaded = false;

async function ensurePDFLibs() {
    if (pdfLibsLoaded && typeof html2canvas !== 'undefined' && typeof jspdf !== 'undefined') return;
    await Promise.all([
        loadScript('https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js'),
        loadScript('https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js')
    ]);
    pdfLibsLoaded = true;
}

async function exportPDF() {
    const btn = document.getElementById('btn-export-pdf');
    const prevHTML = btn.innerHTML;
    btn.innerHTML = '⏳ <span class="btn-label">Cargando...</span>';
    btn.disabled = true;

    try {
        await ensurePDFLibs();

        btn.innerHTML = '⏳ <span class="btn-label">Generando...</span>';

        const { jsPDF } = jspdf;
        const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' });
        const pageW = pdf.internal.pageSize.getWidth();
        const margin = 12;
        const contentW = pageW - margin * 2;
        let cursorY = margin;

        // Title
        pdf.setFontSize(16);
        pdf.setFont('helvetica', 'bold');
        pdf.text('Reporte trimestral de delitos — CDMX', margin, cursorY + 6);
        cursorY += 10;
        pdf.setFontSize(10);
        pdf.setFont('helvetica', 'normal');
        pdf.setTextColor(100);
        pdf.text(`${State.selectedAlcaldia} — ${State.selectedColonia} | Trimestre: ${State.selectedYear}-Q${State.selectedQuarter}`, margin, cursorY + 4);
        pdf.setTextColor(0);
        cursorY += 10;

        // Helper to capture a section
        async function captureSection(elementId) {
            const el = document.getElementById(elementId);
            if (!el || el.offsetHeight === 0) return null;
            const canvas = await html2canvas(el, {
                backgroundColor: '#0f172a',
                scale: 2,
                useCORS: true,
                logging: false
            });
            return canvas;
        }

        // KPIs
        const kpiCanvas = await captureSection('section-kpis');
        if (kpiCanvas) {
            const kpiH = (kpiCanvas.height / kpiCanvas.width) * contentW;
            pdf.addImage(kpiCanvas.toDataURL('image/png'), 'PNG', margin, cursorY, contentW, kpiH);
            cursorY += kpiH + 6;
        }

        // Chart
        const chartCanvas = await captureSection('section-chart-historical');
        if (chartCanvas) {
            const chartH = (chartCanvas.height / chartCanvas.width) * contentW;
            if (cursorY + chartH > pdf.internal.pageSize.getHeight() - margin) {
                pdf.addPage();
                cursorY = margin;
            }
            pdf.addImage(chartCanvas.toDataURL('image/png'), 'PNG', margin, cursorY, contentW, chartH);
            cursorY += chartH + 6;
        }

        // Map
        const mapCanvas = await captureSection('section-map');
        if (mapCanvas) {
            const mapH = (mapCanvas.height / mapCanvas.width) * contentW;
            if (cursorY + mapH > pdf.internal.pageSize.getHeight() - margin) {
                pdf.addPage();
                cursorY = margin;
            }
            pdf.addImage(mapCanvas.toDataURL('image/png'), 'PNG', margin, cursorY, contentW, mapH);
            cursorY += mapH + 6;
        }

        // Footer
        const footerY = pdf.internal.pageSize.getHeight() - 8;
        pdf.setFontSize(7);
        pdf.setTextColor(150);
        pdf.text('Fuente: Datos abiertos de la Fiscalía General de Justicia de CDMX vía datos.cdmx.gob.mx', margin, footerY);
        pdf.text(`Generado: ${new Date().toLocaleDateString('es-MX')}`, pageW - margin - 35, footerY);

        const filename = `delitos_cdmx_${State.selectedColonia.replace(/\s+/g, '_')}_${State.selectedYear}Q${State.selectedQuarter}.pdf`;
        pdf.save(filename);
    } catch (e) {
        console.error('PDF Export Error:', e);
        alert('Error al generar el PDF. Revisa la consola.');
    } finally {
        btn.innerHTML = prevHTML;
        btn.disabled = false;
    }
}

function setupAdvancedFiltersToggle() {
    const details = document.getElementById('advanced-filters');
    if(details) {
        // On desktop (≥1024px), always open since summary is hidden by CSS
        if(window.matchMedia('(min-width: 1024px)').matches) {
            details.open = true;
        }
        details.addEventListener('toggle', () => {
            // Re-invalidate map size when filters panel expands/collapses on mobile
            if(UI.map) {
                setTimeout(() => UI.map.invalidateSize(), 200);
            }
        });
    }
}

function setupHeatmapToggle() {
    const cb = document.getElementById('toggle-heatmap-cb');
    if(cb) {
        cb.addEventListener('change', (e) => {
            State.heatmapMode = e.target.checked;
            // preserveView=true: only switch layers, don't reset zoom/pan
            renderMap(true);
        });
    }
}

function initSelects() {
    const coloniasOptions = State.catalog.map(r => {
        const colName = r.colonia_catalogo || r.colonia_hecho;
        return {
            value: `${r.alcaldia_hecho}||${colName}`,
            text: colName,
            alcaldia: r.alcaldia_hecho
        };
    }).sort((a, b) => a.text.localeCompare(b.text));

    UI.coloniaSelect = new TomSelect('#colonia-select', {
        options: coloniasOptions,
        valueField: 'value', 
        labelField: 'text', 
        searchField: ['text', 'alcaldia'],
        onChange: onColoniaChange,
        render: {
            option: function(data, escape) {
                return `<div>${escape(data.text)} <span style="font-size: 0.8em; opacity: 0.7;">(${escape(data.alcaldia)})</span></div>`;
            },
            item: function(data, escape) {
                return `<div>${escape(data.text)} <span style="font-size: 0.8em; opacity: 0.7;">(${escape(data.alcaldia)})</span></div>`;
            }
        }
    });

    UI.trimestreSelect = new TomSelect('#trimestre-select', {
        valueField: 'value', labelField: 'text', searchField: 'text',
        onChange: onTrimestreChange
    });

    UI.delitoSelect = new TomSelect('#delito-select', {
        valueField: 'value', labelField: 'text', searchField: 'text',
        plugins: ['remove_button'],
        onChange: onDelitoFilterChange
    });
}

function buildCategoryCheckboxes() {
    const container = document.getElementById('category-checkboxes');
    Object.entries(CategoryMapper.CATEGORIES).forEach(([id, cat]) => {
        const label = document.createElement('label');
        label.className = 'category-checkbox';
        label.innerHTML = `
            <input type="checkbox" value="${id}" class="cat-cb" checked>
            <span class="cat-color-dot" style="background-color: ${cat.color}"></span>
            ${cat.label}
        `;
        label.querySelector('input').addEventListener('change', (e) => {
            if(e.target.checked) State.activeCategories.add(id);
            else State.activeCategories.delete(id);
            updateToggleAllState();
            applyFiltersAndRender();
        });
        container.appendChild(label);
    });

    const toggleAllCheckbox = document.getElementById('toggle-all-cats');
    if (toggleAllCheckbox) {
        toggleAllCheckbox.addEventListener('change', (e) => {
            const isChecked = e.target.checked;
            document.querySelectorAll('.cat-cb').forEach(cb => cb.checked = isChecked);
            if (isChecked) {
                Object.keys(CategoryMapper.CATEGORIES).forEach(id => State.activeCategories.add(id));
            } else {
                State.activeCategories.clear();
            }
            applyFiltersAndRender();
        });
    }
}

function updateToggleAllState() {
    const totalCats = Object.keys(CategoryMapper.CATEGORIES).length;
    const activeCats = State.activeCategories.size;
    const toggleAllCheckbox = document.getElementById('toggle-all-cats');
    if (toggleAllCheckbox) {
        toggleAllCheckbox.checked = (totalCats === activeCats);
    }
}

// ==========================================
// Neighbors Feature
// ==========================================
function setupNeighborsToggle() {
    const cb = document.getElementById('toggle-neighbors-cb');
    if (!cb) return;
    cb.addEventListener('change', (e) => {
        State.neighborsEnabled = e.target.checked;
        const panel = document.getElementById('neighbors-panel');
        if (panel) panel.style.display = State.neighborsEnabled ? 'block' : 'none';
        // Re-fetch data with/without neighbors (this is the big toggle — API call justified)
        if (State.selectedColonia && State.selectedAlcaldia) {
            onColoniaChange(`${State.selectedAlcaldia}||${State.selectedColonia}`);
        }
    });

    // Toggle all neighbors — client-side only, no API call
    const toggleAll = document.getElementById('toggle-all-neighbors');
    if (toggleAll) {
        toggleAll.addEventListener('change', (e) => {
            const isChecked = e.target.checked;
            document.querySelectorAll('.nb-cb').forEach(nb => nb.checked = isChecked);
            if (isChecked) {
                const key = `${State.selectedAlcaldia}||${State.selectedColonia}`;
                const nbs = State.neighborsData?.[key] || [];
                nbs.forEach(n => State.activeNeighbors.add(n));
            } else {
                State.activeNeighbors.clear();
            }
            // Client-side filter only — data already fetched
            applyFiltersAndRender();
        });
    }
}

function buildNeighborPanel() {
    const toggleControl = document.getElementById('neighbors-toggle-control');
    const control = document.getElementById('neighbors-control');
    const container = document.getElementById('neighbors-checkboxes');
    const countEl = document.getElementById('neighbors-count');
    
    if (!State.neighborsData || !toggleControl || !control || !container) {
        if (toggleControl) toggleControl.style.display = 'none';
        if (control) control.style.display = 'none';
        return;
    }

    const key = `${State.selectedAlcaldia}||${State.selectedColonia}`;
    const neighborKeys = State.neighborsData[key] || [];

    if (neighborKeys.length === 0) {
        toggleControl.style.display = 'none';
        control.style.display = 'none';
        return;
    }

    // Show the control
    toggleControl.style.display = 'flex';
    control.style.display = 'flex';
    countEl.textContent = neighborKeys.length;

    // Reset active neighbors to all by default
    State.activeNeighbors = new Set(neighborKeys);
    const toggleAll = document.getElementById('toggle-all-neighbors');
    if (toggleAll) toggleAll.checked = true;

    // Clear existing checkboxes
    container.innerHTML = '';

    // Build sorted neighbor list
    const neighbors = neighborKeys.map(nk => {
        const [alc, col] = nk.split('||');
        return { key: nk, alcaldia: alc, colonia: col };
    }).sort((a, b) => {
        // Same alcaldía first, then alphabetical
        const sameA = a.alcaldia === State.selectedAlcaldia ? 0 : 1;
        const sameB = b.alcaldia === State.selectedAlcaldia ? 0 : 1;
        if (sameA !== sameB) return sameA - sameB;
        return a.colonia.localeCompare(b.colonia);
    });

    neighbors.forEach(nb => {
        const label = document.createElement('label');
        label.className = 'neighbor-checkbox';
        const crossAlcaldia = nb.alcaldia !== State.selectedAlcaldia;
        label.innerHTML = `
            <input type="checkbox" class="nb-cb" value="${nb.key}" checked>
            <span class="neighbor-color-dot"></span>
            <span class="neighbor-name">${nb.colonia}</span>
            ${crossAlcaldia ? `<span class="neighbor-alcaldia-tag">${nb.alcaldia}</span>` : ''}
        `;
        label.querySelector('input').addEventListener('change', (e) => {
            if (e.target.checked) State.activeNeighbors.add(nb.key);
            else State.activeNeighbors.delete(nb.key);
            updateNeighborsToggleAllState();
            // Client-side filter only — data already fetched for all neighbors
            applyFiltersAndRender();
        });
        container.appendChild(label);
    });
}

function updateNeighborsToggleAllState() {
    const key = `${State.selectedAlcaldia}||${State.selectedColonia}`;
    const total = (State.neighborsData?.[key] || []).length;
    const active = State.activeNeighbors.size;
    const toggleAll = document.getElementById('toggle-all-neighbors');
    if (toggleAll) toggleAll.checked = (total === active);
}

function hideNeighborsControl() {
    const toggleControl = document.getElementById('neighbors-toggle-control');
    if (toggleControl) toggleControl.style.display = 'none';
    const control = document.getElementById('neighbors-control');
    if (control) control.style.display = 'none';
    State.activeNeighbors.clear();
    State.neighborsEnabled = false;
    const cb = document.getElementById('toggle-neighbors-cb');
    if (cb) cb.checked = false;
    const panel = document.getElementById('neighbors-panel');
    if (panel) panel.style.display = 'none';
}

/** Build the full list of ALL neighbor colonias (for API fetch). */
function getAllNeighborColoniaList() {
    const key = `${State.selectedAlcaldia}||${State.selectedColonia}`;
    const list = [{ alcaldia: State.selectedAlcaldia, colonia: State.selectedColonia }];
    const nbs = State.neighborsData?.[key] || [];
    nbs.forEach(nk => {
        const [alc, col] = nk.split('||');
        list.push({ alcaldia: alc, colonia: col });
    });
    return list;
}

/** Check if a record's colonia_key belongs to the currently active set. */
function isRecordInActiveColonias(record) {
    // Records from single-colonia queries don't have colonia_key
    if (!record.colonia_key) return true;
    const recKey = `${record.alcaldia_hecho}||${record.colonia_key}`;
    // Always include the selected colonia
    if (record.alcaldia_hecho === State.selectedAlcaldia && record.colonia_key === State.selectedColonia) return true;
    // Check if this neighbor is active
    return State.activeNeighbors.has(recKey);
}

// ==========================================
// Event Handlers
// ==========================================
async function onColoniaChange(coloniaKey) {
    if (!coloniaKey) {
        State.selectedAlcaldia = null;
        State.selectedColonia = null;
        UI.showContent(false);
        hideNeighborsControl();
        return;
    }
    
    const [alcaldia, colonia] = coloniaKey.split('||');
    State.selectedAlcaldia = alcaldia;
    State.selectedColonia = colonia;

    // Build neighbors panel (even if not enabled, so it's ready)
    buildNeighborPanel();

    UI.showLoading(true);
    try {
        // Fetch ALL neighbor data in one shot (or single-colonia if neighbors disabled)
        let rawData;
        if (State.neighborsEnabled) {
            const allColonias = getAllNeighborColoniaList();
            rawData = await CKANClient.getQuarterlyDataMulti(allColonias);
        } else {
            rawData = await CKANClient.getQuarterlyData(State.selectedAlcaldia, colonia);
        }
        // Exclude incomplete quarter (2025-Q1)
        State.coloniaData = rawData.filter(r => !(r.anio_hecho == 2025 && r.trimestre == 1));
        
        // Add macro category to raw data natively
        State.coloniaData.forEach(r => {
            r.macro_cat = CategoryMapper.classify(r.delito);
            r.q_key = `${r.anio_hecho}-Q${r.trimestre}`;
        });

        // Setup Trimestre Dropdown options based on available data
        updateTrimestreChoices();
        
        // Setup Delitos Dropdown options
        updateDelitoChoices();
        
        // Note: Trimestre change handler will trigger the map fetch and render automatically
        // If it doesn't trigger (same Q), call render manually:
        if(State.selectedYear && State.selectedQuarter) {
            onTrimestreChange(`${State.selectedYear}-Q${State.selectedQuarter}`, true);
        }

    } catch (e) {
        alert("Error cargando datos de colonia.");
    } finally {
        UI.showLoading(false);
    }
}

async function onTrimestreChange(qKey, forceMapFetch = false) {
    if(!qKey) return;
    
    const [year, qStr] = qKey.split('-');
    const quarter = parseInt(qStr.replace('Q',''));
    
    const changed = (State.selectedYear != year || State.selectedQuarter != quarter);
    State.selectedYear = parseInt(year);
    State.selectedQuarter = quarter;

    // Fetch new map points if Quarter changed or forced
    if (changed || forceMapFetch) {
        UI.showLoading(true);
        try {
            if (State.neighborsEnabled) {
                const allColonias = getAllNeighborColoniaList();
                State.mapPoints = await CKANClient.getMapPointsMulti(allColonias, State.selectedYear, State.selectedQuarter);
            } else {
                State.mapPoints = await CKANClient.getMapPoints(State.selectedAlcaldia, State.selectedColonia, State.selectedYear, State.selectedQuarter);
            }
        } catch (e) {
            console.error("Map fetch failed", e);
            State.mapPoints = [];
        } finally {
            UI.showLoading(false);
        }
    }
    
    updateUrlState();
    applyFiltersAndRender();
}

function onDelitoFilterChange(delitos) {
    State.selectedDelitos = delitos || [];
    applyFiltersAndRender();
}

// ==========================================
// Rendering Logic
// ==========================================
function updateTrimestreChoices() {
    const qKeys = [...new Set(State.coloniaData.map(r => r.q_key))].sort().reverse();
    UI.trimestreSelect.clear();
    UI.trimestreSelect.clearOptions();
    
    if(qKeys.length > 0) {
        UI.trimestreSelect.addOption(qKeys.map(q => ({value: q, text: q})));
        UI.trimestreSelect.enable();
        // Respond to URL param first if it exists
        if(State.urlRequestedQ && qKeys.includes(State.urlRequestedQ)) {
            UI.trimestreSelect.setValue(State.urlRequestedQ);
            State.urlRequestedQ = null; // consume it
        } else if(!State.selectedYear) {
            UI.trimestreSelect.setValue(qKeys[0]);
        } else {
            const currentQKey = `${State.selectedYear}-Q${State.selectedQuarter}`;
            if(qKeys.includes(currentQKey)) UI.trimestreSelect.setValue(currentQKey);
            else UI.trimestreSelect.setValue(qKeys[0]); // fallback if old Q doesn't exist here
        }
    } else {
        UI.trimestreSelect.disable();
    }
}

function updateDelitoChoices() {
    // Only show delitos that exist in this colonia
    const delitos = [...new Set(State.coloniaData.map(r => r.delito))].sort();
    UI.delitoSelect.clear();
    UI.delitoSelect.clearOptions();
    UI.delitoSelect.addOption(delitos.map(d => ({value: d, text: d})));
}

function applyFiltersAndRender() {
    if(!State.selectedColonia) return;

    // Filter local data (categories + delitos + active neighbor colonias)
    State.filteredData = State.coloniaData.filter(r => {
        const catMatch = State.activeCategories.has(r.macro_cat);
        const subDelitoMatch = State.selectedDelitos.length === 0 || State.selectedDelitos.includes(r.delito);
        const coloniaMatch = isRecordInActiveColonias(r);
        return catMatch && subDelitoMatch && coloniaMatch;
    });

    UI.showContent(true);
    
    // Update labels
    document.querySelectorAll('.kpi-q-label').forEach(el => el.textContent = `${State.selectedYear}-Q${State.selectedQuarter}`);
    const coloniaLabel = document.getElementById('download-label-colonia');
    if (coloniaLabel) coloniaLabel.textContent = State.selectedColonia;

    renderMap();
    renderChart();
    renderKPIs();
    renderKPITable();
    renderNeighborsTable();
}

// ==========================================
// Map (Leaflet)
// ==========================================
async function initMap() {
    UI.map = L.map('crimeMap').setView([19.432608, -99.133209], 11);
    
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/">CARTO</a>',
        subdomains: 'abcd',
        maxZoom: 19
    }).addTo(UI.map);

    // Colonia polygon layer (rendered below points)
    UI.coloniaPolygonLayer = L.geoJSON(null, {
        style: {
            color: '#38bdf8',
            weight: 3,
            opacity: 1,
            fillColor: '#38bdf8',
            fillOpacity: 0.12
        },
        onEachFeature: (feature, layer) => {
            layer.bindTooltip(feature.properties.colonia, {
                permanent: true,
                direction: 'center',
                className: 'colonia-label colonia-label-selected'
            });
        }
    }).addTo(UI.map);

    // Neighbor polygon layer (amber, below selected colonia)
    UI.neighborPolygonLayer = L.geoJSON(null, {
        style: {
            color: '#f59e0b',
            weight: 2,
            opacity: 0.9,
            fillColor: '#fbbf24',
            fillOpacity: 0.10
        },
        onEachFeature: (feature, layer) => {
            layer.bindTooltip(feature.properties.colonia, {
                permanent: true,
                direction: 'center',
                className: 'colonia-label colonia-label-neighbor'
            });
        }
    }).addTo(UI.map);

    UI.pointsGroup = L.layerGroup();
    if(typeof L.heatLayer === 'function') {
        UI.heatLayer = L.heatLayer([], HEATMAP_OPTIONS);
    }
    UI.map.addLayer(UI.pointsGroup);
}

function renderMap(preserveView = false) {
    if(!UI.map) return;
    if(UI.pointsGroup) UI.pointsGroup.clearLayers();
    
    let bounds = L.latLngBounds();
    let hasPoints = false;

    // Filter map points (they are already filtered by Q in API)
    const filteredPoints = State.mapPoints.filter(p => {
        const macroCat = CategoryMapper.classify(p.delito);
        const catMatch = State.activeCategories.has(macroCat);
        const subDelitoMatch = State.selectedDelitos.length === 0 || State.selectedDelitos.includes(p.delito);
        const coloniaMatch = isRecordInActiveColonias(p);
        return catMatch && subDelitoMatch && coloniaMatch;
    });

    if(State.heatmapMode) {
        if(UI.map.hasLayer(UI.pointsGroup)) UI.map.removeLayer(UI.pointsGroup);
        if(UI.heatLayer && !UI.map.hasLayer(UI.heatLayer)) UI.map.addLayer(UI.heatLayer);
    } else {
        if(UI.heatLayer && UI.map.hasLayer(UI.heatLayer)) UI.map.removeLayer(UI.heatLayer);
        if(UI.pointsGroup && !UI.map.hasLayer(UI.pointsGroup)) UI.map.addLayer(UI.pointsGroup);
    }

    const heatData = [];

    filteredPoints.forEach(p => {
        const lat = p.latitud;
        const lng = p.longitud;
        bounds.extend([lat, lng]);
        hasPoints = true;

        if (State.heatmapMode) {
            heatData.push([lat, lng, 1.0]);
        } else {
            const cat = CategoryMapper.classify(p.delito);
            const catConfig = CategoryMapper.CATEGORIES[cat];
            
            // Custom dot marker with opacity
            const markerHTML = `<div style="background-color: ${catConfig.color}; width: 10px; height: 10px; border-radius: 50%; border: 1px solid rgba(255,255,255,0.6); opacity: 0.7;"></div>`;
            const icon = L.divIcon({ html: markerHTML, className: '', iconSize: [12, 12] });

            const dDate = new Date(p.fecha_hecho).toLocaleDateString('es-MX', {timeZone: 'UTC'});
            const dHora = p.hora_hecho ? p.hora_hecho.slice(0, 5) : null; // HH:MM
            const dDateTime = dHora ? `${dDate} &nbsp;🕐 ${dHora}` : dDate;

            const marker = L.marker([lat, lng], {icon})
                .bindPopup(`<strong>${p.delito}</strong><br/>${catConfig.label}<br/><em>${dDateTime}</em>`);
            
            UI.pointsGroup.addLayer(marker);
        }
    });

    if (State.heatmapMode && UI.heatLayer) {
        UI.heatLayer.setLatLngs(heatData);
    }

    // ── Colonia polygon outlines ──────────────────────────────────────
    if (UI.coloniaPolygonLayer) UI.coloniaPolygonLayer.clearLayers();
    if (UI.neighborPolygonLayer) UI.neighborPolygonLayer.clearLayers();

    if (State.coloniaGeoData && State.selectedAlcaldia && State.selectedColonia) {
        // Draw neighbor polygons first (below selected)
        if (State.neighborsEnabled && State.activeNeighbors.size > 0) {
            State.activeNeighbors.forEach(key => {
                const [alc, col] = key.split('||');
                const nFeat = State.coloniaGeoData.features.find(f =>
                    f.properties.alcaldia === alc && f.properties.colonia === col
                );
                if (nFeat && UI.neighborPolygonLayer) {
                    UI.neighborPolygonLayer.addData(nFeat);
                }
            });
            const nbBounds = UI.neighborPolygonLayer.getBounds();
            if (nbBounds.isValid()) bounds.extend(nbBounds);
        }

        // Draw selected colonia polygon (on top)
        const polyFeature = State.coloniaGeoData.features.find(f =>
            f.properties.alcaldia === State.selectedAlcaldia &&
            f.properties.colonia === State.selectedColonia
        );
        if (polyFeature && UI.coloniaPolygonLayer) {
            UI.coloniaPolygonLayer.addData(polyFeature);
            const polyBounds = UI.coloniaPolygonLayer.getBounds();
            if (polyBounds.isValid()) bounds.extend(polyBounds);
        }
    }

    // Only fit bounds when loading new data, not when just toggling layers
    if (hasPoints && !preserveView) {
        UI.map.fitBounds(bounds, {padding: [50, 50], maxZoom: 16});
    } else if (!hasPoints && !preserveView) {
        // Fit to polygons if available
        const allPolyBounds = L.latLngBounds();
        if (UI.coloniaPolygonLayer?.getLayers().length > 0) allPolyBounds.extend(UI.coloniaPolygonLayer.getBounds());
        if (UI.neighborPolygonLayer?.getLayers().length > 0) allPolyBounds.extend(UI.neighborPolygonLayer.getBounds());
        if (allPolyBounds.isValid()) UI.map.fitBounds(allPolyBounds, {padding: [50, 50], maxZoom: 16});
    }
    
    // Invalidate size to prevent half-drawn map issue
    setTimeout(() => UI.map.invalidateSize(), 100);
}

// ==========================================
// Chart.js
// ==========================================
function initChart() {
    const ctx = document.getElementById('historicalChart').getContext('2d');
    Chart.defaults.color = 'rgba(255,255,255,0.7)';
    Chart.defaults.font.family = 'Inter';

    UI.chart = new Chart(ctx, {
        type: 'line',
        data: { labels: [], datasets: [] },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { position: 'bottom' },
                tooltip: { backgroundColor: 'rgba(15,23,42,0.9)', titleColor: '#fff' }
            },
            scales: {
                x: { grid: { color: 'rgba(255,255,255,0.05)' } },
                y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.05)' } }
            }
        }
    });
}

function renderChart() {
    // 1. Get all unique Qs across dataset
    const allQs = [...new Set(State.coloniaData.map(r => r.q_key))].sort(); // Chronological
    
    // 2. Aggregate data per Q
    const qTotals = {};
    const catTotals = {}; // { catId: { qKey: val } }
    
    Object.keys(CategoryMapper.CATEGORIES).forEach(id => catTotals[id] = {});

    State.filteredData.forEach(r => {
        const q = r.q_key;
        const total = parseInt(r.total);
        
        qTotals[q] = (qTotals[q] || 0) + total;
        catTotals[r.macro_cat][q] = (catTotals[r.macro_cat][q] || 0) + total;
    });

    const pop = getActivePopulation();
    const isRate = State.rateMode && pop > 0;
    const factor = isRate ? (10000 / pop) : 1;

    // 3. Build Datasets
    const datasets = [];
    
    // Only add 'Total General' if more than one category is selected OR if none are
    if (State.activeCategories.size !== 1) {
        datasets.push({
            label: 'Total General',
            data: allQs.map(q => (qTotals[q] || 0) * factor),
            borderColor: '#f8fafc',
            borderWidth: 3,
            backgroundColor: 'transparent',
            tension: 0.3,
            fill: false
        });
    }

    Object.entries(CategoryMapper.CATEGORIES).forEach(([id, catInfo]) => {
        if(State.activeCategories.has(id)) {
            datasets.push({
                label: catInfo.label,
                data: allQs.map(q => (catTotals[id][q] || 0) * factor),
                borderColor: catInfo.color,
                borderWidth: 2,
                backgroundColor: catInfo.color,
                tension: 0.3,
                fill: false,
                borderDash: [5, 5]
            });
        }
    });

    UI.chart.data.labels = allQs;
    UI.chart.data.datasets = datasets;
    
    // Add Y axis label indicating if it's a rate or absolute number
    if (UI.chart.options.scales && UI.chart.options.scales.y) {
        UI.chart.options.scales.y.title = {
            display: true,
            text: isRate ? 'Tasa por 10k hab.' : 'Número de delitos',
            color: 'rgba(255,255,255,0.6)',
            font: { size: 11, family: 'Inter' }
        };
    }
    
    // Attempt to add a vertical line plugin for the selected quarter
    // Easiest is just ensuring points render.
    
    UI.chart.update();
    
    // Invalidate size after layout to prevent empty chart on first load
    setTimeout(() => {
        if (UI.chart) UI.chart.resize();
    }, 100);
}

// ==========================================
// KPIs computation
// ==========================================
function renderKPIs() {
    if(!State.selectedYear || !State.selectedQuarter) return;

    const y = State.selectedYear;
    const q = State.selectedQuarter;

    const currentQKey = `${y}-Q${q}`;
    let prevQKey;
    if(q === 1) prevQKey = `${y-1}-Q4`;
    else prevQKey = `${y}-Q${q-1}`;

    const prevYQKey = `${y-1}-Q${q}`;

    // Aggregations helper
    function getQTotal(qKey) {
        return State.filteredData.filter(r => r.q_key === qKey).reduce((sum, r) => sum + parseInt(r.total), 0);
    }
    function getYTDTotal(year, maxQ) {
        return State.filteredData.filter(r => r.anio_hecho == year && r.trimestre <= maxQ).reduce((sum, r) => sum + parseInt(r.total), 0);
    }

    const curVal = getQTotal(currentQKey);
    const prevQVal = getQTotal(prevQKey);
    const prevYQVal = getQTotal(prevYQKey);

    const curYTD = getYTDTotal(y, q);
    const prevYTD = getYTDTotal(y-1, q);

    // Calc %
    const qoqPct = prevQVal > 0 ? ((curVal - prevQVal) / prevQVal) * 100 : 0;
    const yoyPct = prevYQVal > 0 ? ((curVal - prevYQVal) / prevYQVal) * 100 : 0;
    const ytdPct = prevYTD > 0 ? ((curYTD - prevYTD) / prevYTD) * 100 : 0;

    // Render DOM Labels
    document.getElementById('lbl-prev-q').textContent = `(${prevQKey})`;
    document.getElementById('lbl-yoy-q').textContent = `(${prevYQKey})`;
    document.getElementById('lbl-ytd-q').textContent = `(${y-1})`;

    // Render DOM
    const population = getActivePopulation();
    document.getElementById('kpi-total').textContent = formatMetricValue(curVal, population);
    
    document.getElementById('kpi-prev-total').textContent = formatMetricValue(prevQVal, population);
    const bdgQoQ = document.getElementById('kpi-qoq-badge');
    bdgQoQ.textContent = formatPct(qoqPct);
    bdgQoQ.className = `kpi-badge ${getBadgeClass(qoqPct)}`;

    document.getElementById('kpi-yoy-total').textContent = formatMetricValue(prevYQVal, population);
    const bdgYoY = document.getElementById('kpi-yoy-badge');
    bdgYoY.textContent = formatPct(yoyPct);
    bdgYoY.className = `kpi-badge ${getBadgeClass(yoyPct)}`;

    document.getElementById('kpi-ytd-total').textContent = formatMetricValue(curYTD, population);
    document.getElementById('kpi-ytd-prev-total').textContent = formatMetricValue(prevYTD, population);
    const bdgYTD = document.getElementById('kpi-ytd-badge');
    bdgYTD.textContent = formatPct(ytdPct);
    bdgYTD.className = `kpi-badge ${getBadgeClass(ytdPct)}`;
}

// ==========================================
// KPI Breakdown Table
// ==========================================
function renderKPITable() {
    const tbody = document.getElementById('kpi-table-body');
    if (!tbody || !State.selectedYear || !State.selectedQuarter) return;

    const y  = State.selectedYear;
    const q  = State.selectedQuarter;
    const currentQKey = `${y}-Q${q}`;
    const prevQKey    = q === 1 ? `${y-1}-Q4` : `${y}-Q${q-1}`;
    const prevYQKey   = `${y-1}-Q${q}`;

    // Update column sub-labels (mirrors the KPI cards)
    const setTxt = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    setTxt('th-prev-q',  `(${prevQKey})`);
    setTxt('th-yoy-q',   `(${prevYQKey})`);
    setTxt('th-ytd-q',   `(${y-1})`);

    // Aggregation helpers — operate on filteredData
    function sumQ(data, qKey, catId) {
        return data
            .filter(r => r.q_key === qKey && (catId === '__ALL__' || r.macro_cat === catId))
            .reduce((s, r) => s + parseInt(r.total), 0);
    }
    function sumYTD(data, yr, maxQ, catId) {
        return data
            .filter(r => r.anio_hecho == yr && r.trimestre <= maxQ && (catId === '__ALL__' || r.macro_cat === catId))
            .reduce((s, r) => s + parseInt(r.total), 0);
    }

    // Badge helper
    function badge(pct) {
        if (pct === null) return `<span class="kpi-tbl-badge na">N/A</span>`;
        const cls = parseFloat(pct) > 0 ? 'up-bad' : (parseFloat(pct) < 0 ? 'down-good' : '');
        return `<span class="kpi-tbl-badge ${cls}">${formatPct(pct)}</span>`;
    }
    function pct(cur, prev) {
        return prev > 0 ? ((cur - prev) / prev) * 100 : null;
    }

    // Rows: Total first, then each active category
    const rows = [
        { id: '__ALL__', label: 'Total', color: null, isTotal: true },
        ...Object.entries(CategoryMapper.CATEGORIES)
            .filter(([id]) => State.activeCategories.has(id))
            .map(([id, cat]) => ({ id, label: cat.label, color: cat.color, isTotal: false }))
    ];

    tbody.innerHTML = '';

    const population = getActivePopulation();
    rows.forEach(row => {
        const cur    = sumQ(State.filteredData, currentQKey, row.id);
        const prevQ  = sumQ(State.filteredData, prevQKey,    row.id);
        const prevYQ = sumQ(State.filteredData, prevYQKey,   row.id);
        const curYTD  = sumYTD(State.filteredData, y,   q, row.id);
        const prevYTD = sumYTD(State.filteredData, y-1, q, row.id);

        const dotHtml = row.color
            ? `<span class="kpi-table-dot" style="background:${row.color}"></span>`
            : `<span class="kpi-table-dot" style="background:var(--accent-cyan)"></span>`;

        const tr = document.createElement('tr');
        if (row.isTotal) tr.classList.add('row-total');

        tr.innerHTML = `
            <td><div class="kpi-table-cat">${dotHtml}<span>${row.label}</span></div></td>
            <td class="col-num">${formatMetricValue(cur, population)}</td>
            <td class="col-num">${formatMetricValue(prevQ, population)} ${badge(pct(cur, prevQ))}</td>
            <td class="col-num">${formatMetricValue(prevYQ, population)} ${badge(pct(cur, prevYQ))}</td>
            <td class="col-num">${formatMetricValue(curYTD, population)} / ${formatMetricValue(prevYTD, population)} ${badge(pct(curYTD, prevYTD))}</td>
        `;
        tbody.appendChild(tr);
    });
}

// ==========================================
// Neighbors Breakdown Table
// ==========================================
function renderNeighborsTable() {
    const section = document.getElementById('section-neighbors-table');
    const thead = document.getElementById('neighbors-table-head');
    const tbody = document.getElementById('neighbors-table-body');
    
    if (!section || !thead || !tbody) return;

    if (!State.neighborsEnabled || State.activeNeighbors.size === 0) {
        section.style.display = 'none';
        return;
    }

    section.style.display = 'block';

    const y  = State.selectedYear;
    const q  = State.selectedQuarter;
    const currentQKey = `${y}-Q${q}`;

    // Columns: Colonia, Total, [Active Cats]
    const activeCats = Object.entries(CategoryMapper.CATEGORIES)
        .filter(([id]) => State.activeCategories.has(id))
        .map(([id, cat]) => ({ id, label: cat.label, color: cat.color }));

    let theadHtml = `<tr><th class="col-cat">Colonia</th><th class="col-num">Total</th>`;
    activeCats.forEach(cat => {
        theadHtml += `<th class="col-num">${cat.label}</th>`;
    });
    theadHtml += `</tr>`;
    thead.innerHTML = theadHtml;

    // Helper: sum Q for a specific colonia string key
    function sumForColonia(data, qKey, catId, coloniaStr) {
        return data
            .filter(r => r.q_key === qKey && 
                         (catId === '__ALL__' || r.macro_cat === catId) &&
                         `${r.alcaldia_hecho}||${r.colonia_key}` === coloniaStr)
            .reduce((s, r) => s + parseInt(r.total), 0);
    }

    // List of all colonias to show (main + active neighbors)
    const allColonias = [
        `${State.selectedAlcaldia}||${State.selectedColonia}`,
        ...Array.from(State.activeNeighbors)
    ];

    tbody.innerHTML = '';

    allColonias.forEach(colKey => {
        const [, colName] = colKey.split('||');
        // Get population just for this colonia
        const pop = parseInt(State.populationByColonia?.[colKey]?.population || 0, 10);
        
        const totalVal = sumForColonia(State.filteredData, currentQKey, '__ALL__', colKey);
        
        const tr = document.createElement('tr');
        let trHtml = `<td><div class="kpi-table-cat"><span>${colName}</span></div></td>`;
        trHtml += `<td class="col-num"><strong>${formatMetricValue(totalVal, pop)}</strong></td>`;
        
        activeCats.forEach(cat => {
            const catVal = sumForColonia(State.filteredData, currentQKey, cat.id, colKey);
            trHtml += `<td class="col-num" style="color: rgba(255,255,255,0.7);">${formatMetricValue(catVal, pop)}</td>`;
        });
        
        tr.innerHTML = trHtml;
        tbody.appendChild(tr);
    });
}

// ==========================================
// CSV Download
// ==========================================
function setupDownloadCSV() {
    const btn = document.getElementById('btn-download-csv');
    if (btn) btn.addEventListener('click', downloadCSV);
}

async function downloadCSV() {
    if (!State.selectedColonia || !State.selectedYear || !State.selectedQuarter) return;

    const btn = document.getElementById('btn-download-csv');
    const prevHTML = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '⏳ <span class="btn-label">Descargando...</span>';

    try {
        const records = await CKANClient.getQuarterDetails(
            State.selectedAlcaldia,
            State.selectedColonia,
            State.selectedYear,
            State.selectedQuarter
        );

        if (!records.length) {
            alert('No se encontraron registros para este trimestre y colonia.');
            return;
        }

        // Enrich with macro-category and include all dataset fields
        const headers = [
            'anio_inicio', 'mes_inicio', 'fecha_inicio', 'hora_inicio',
            'anio_hecho',  'mes_hecho',  'fecha_hecho',  'hora_hecho',
            'delito', 'categoria_delito', 'macro_categoria', 'competencia',
            'fiscalia', 'agencia', 'unidad_investigacion',
            'colonia_hecho', 'colonia_catalogo',
            'alcaldia_hecho', 'alcaldia_catalogo',
            'municipio_hecho', 'latitud', 'longitud'
        ];

        const rows = records.map(r => {
            const macroId  = CategoryMapper.classify(r.delito);
            const macroLbl = CategoryMapper.CATEGORIES[macroId]?.label ?? macroId;
            const enriched = { ...r, macro_categoria: macroLbl };
            return headers
                .map(h => `"${String(enriched[h] ?? '').replace(/"/g, '""')}"`)
                .join(',');
        });

        // BOM so Excel opens it in UTF-8 without encoding issues
        const csv  = '\uFEFF' + [headers.join(','), ...rows].join('\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href     = url;
        a.download = `delitos_${State.selectedColonia.replace(/\s+/g,'_')}_${State.selectedYear}Q${State.selectedQuarter}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

    } catch (e) {
        console.error('CSV download error:', e);
        alert('Error al descargar los datos. Revisa la consola.');
    } finally {
        btn.innerHTML = prevHTML;
        btn.disabled  = false;
    }
}

// ==========================================
// Info Modal
// ==========================================
function setupInfoModal() {
    const overlay  = document.getElementById('info-modal');
    const closeBtn = document.getElementById('modal-close-btn');
    const infoBtn  = document.getElementById('btn-info');
    const mapInfoBtn = document.getElementById('btn-map-info');

    if (!overlay) return;

    function openModal(scrollToGeo = false) {
        overlay.classList.add('is-open');
        document.body.style.overflow = 'hidden';
        closeBtn.focus();
        if (scrollToGeo) {
            // Small delay so the modal is visible before scrolling
            setTimeout(() => {
                const geoSection = document.getElementById('modal-section-geo');
                if (geoSection) geoSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }, 100);
        }
    }

    function closeModal() {
        overlay.classList.remove('is-open');
        document.body.style.overflow = '';
    }

    if (infoBtn)    infoBtn.addEventListener('click', () => openModal(false));
    if (mapInfoBtn) mapInfoBtn.addEventListener('click', () => openModal(true));
    closeBtn.addEventListener('click', closeModal);

    // Click outside panel closes modal
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeModal();
    });

    // Escape key closes modal
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && overlay.classList.contains('is-open')) closeModal();
    });
}
// ==========================================
// Map Fullscreen Modal
// ==========================================
function setupMapFullscreen() {
    const overlay   = document.getElementById('map-modal-overlay');
    const modalBody = document.getElementById('map-modal-body');
    const openBtn   = document.getElementById('btn-map-fullscreen');
    const closeBtn  = document.getElementById('btn-map-modal-close');
    const inlineCb  = document.getElementById('toggle-heatmap-cb');
    const modalCb   = document.getElementById('toggle-heatmap-modal-cb');
    const mapEl     = document.getElementById('crimeMap');
    const inlineContainer = document.getElementById('section-map');

    if (!overlay || !openBtn || !mapEl) return;

    function openFullscreen() {
        // Sync heatmap checkbox state
        if (modalCb && inlineCb) modalCb.checked = inlineCb.checked;
        // Move map into modal
        modalBody.appendChild(mapEl);
        overlay.classList.add('active');
        // Let Leaflet recalculate dimensions
        setTimeout(() => {
            if (UI.map) UI.map.invalidateSize();
        }, 50);
    }

    function closeFullscreen() {
        // Sync heatmap checkbox state back
        if (inlineCb && modalCb) inlineCb.checked = modalCb.checked;
        // Move map back to inline container
        inlineContainer.appendChild(mapEl);
        overlay.classList.remove('active');
        // Let Leaflet recalculate dimensions
        setTimeout(() => {
            if (UI.map) UI.map.invalidateSize();
        }, 50);
    }

    openBtn.addEventListener('click', openFullscreen);
    closeBtn.addEventListener('click', closeFullscreen);

    // Click outside modal closes
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeFullscreen();
    });

    // Escape closes
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && overlay.classList.contains('active')) closeFullscreen();
    });

    // Modal heatmap toggle synced
    if (modalCb) {
        modalCb.addEventListener('change', (e) => {
            State.heatmapMode = e.target.checked;
            if (inlineCb) inlineCb.checked = e.target.checked;
            renderMap(true);
        });
    }
}

// Start
document.addEventListener('DOMContentLoaded', init);
