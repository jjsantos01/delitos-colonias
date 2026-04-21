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

    static getCatalog() {
        return this.fetchSQL(`
            SELECT DISTINCT alcaldia_hecho, colonia_hecho
            FROM "${RESOURCE_ID}"
            WHERE alcaldia_hecho IS NOT NULL
              AND alcaldia_hecho != 'nan'
              AND colonia_hecho IS NOT NULL
              AND colonia_hecho != ''
            ORDER BY alcaldia_hecho, colonia_hecho
        `);
    }

    static getQuarterlyData(alcaldia, colonia) {
        return this.fetchSQL(`
            SELECT anio_hecho,
                   EXTRACT(QUARTER FROM fecha_hecho)::int AS trimestre,
                   delito,
                   COUNT(*) AS total
            FROM "${RESOURCE_ID}"
            WHERE alcaldia_hecho = '${alcaldia.replace(/'/g, "''")}'
              AND colonia_hecho = '${colonia.replace(/'/g, "''")}'
              AND anio_hecho >= 2019
            GROUP BY anio_hecho, trimestre, delito
            ORDER BY anio_hecho, trimestre
        `);
    }

    static getMapPoints(alcaldia, colonia, year, quarter) {
        return this.fetchSQL(`
            SELECT latitud, longitud, delito, fecha_hecho, hora_hecho
            FROM "${RESOURCE_ID}"
            WHERE alcaldia_hecho = '${alcaldia.replace(/'/g, "''")}'
              AND colonia_hecho = '${colonia.replace(/'/g, "''")}'
              AND anio_hecho = ${year}
              AND EXTRACT(QUARTER FROM fecha_hecho) = ${quarter}
              AND latitud IS NOT NULL
              AND longitud IS NOT NULL
            LIMIT 32000
        `);
    }

    // Query 4 — Usuario solicita descarga explícita de datos crudos del Q seleccionado.
    // Acotado a una colonia + trimestre específico, nunca la base completa.
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
              AND colonia_hecho = '${colonia.replace(/'/g, "''")}'
              AND anio_hecho = ${year}
              AND EXTRACT(QUARTER FROM fecha_hecho) = ${quarter}
            ORDER BY fecha_hecho, hora_hecho
            LIMIT 32000
        `);
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
    
    selectedAlcaldia: null,
    selectedColonia: null,
    selectedYear: null,   // Selected Q info
    selectedQuarter: null,
    
    activeCategories: new Set(Object.keys(CategoryMapper.CATEGORIES)),
    selectedDelitos: [],  // Empty means all
    heatmapMode: false
};

const UI = {
    loading: document.getElementById('loading-overlay'),
    emptyState: document.getElementById('empty-state'),
    contentWrapper: document.getElementById('content-wrapper'),
    
    // Selects (TomSelect instances later)
    alcaldiaSelect: null,
    coloniaSelect: null,
    trimestreSelect: null,
    delitoSelect: null,
    
    // Subcomponents
    chart: null,
    map: null,
    pointsGroup: null,
    heatLayer: null,
    
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
        setupDownloadCSV();
        
        State.catalog = await CKANClient.getCatalog();
        initSelects();
        loadInitialStateFromUrl();
    } catch (e) {
        alert("Error cargando el catálogo de colonias. Revisa la consola.");
    } finally {
        UI.showLoading(false);
    }
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
    
    if(qUrl) State.urlRequestedQ = qUrl;

    if (alcaldiaUrl) {
        // Find if alcaldia exists in TomSelect options
        const match = Object.keys(UI.alcaldiaSelect.options).find(k => k === alcaldiaUrl);
        if(match) {
            UI.alcaldiaSelect.setValue(match); 
            if (coloniaUrl) {
                setTimeout(() => {
                    UI.coloniaSelect.setValue(coloniaUrl);
                }, 100);
            }
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
    const alcaldias = [...new Set(State.catalog.map(r => r.alcaldia_hecho))].sort();
    
    UI.alcaldiaSelect = new TomSelect('#alcaldia-select', {
        options: alcaldias.map(a => ({value: a, text: a})),
        onChange: onAlcaldiaChange
    });

    UI.coloniaSelect = new TomSelect('#colonia-select', {
        valueField: 'value', labelField: 'text', searchField: 'text',
        onChange: onColoniaChange
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
// Event Handlers
// ==========================================
function onAlcaldiaChange(alcaldia) {
    State.selectedAlcaldia = alcaldia;
    UI.coloniaSelect.clear();
    UI.coloniaSelect.clearOptions();
    
    if (alcaldia) {
        const colonias = State.catalog
            .filter(r => r.alcaldia_hecho === alcaldia)
            .map(r => ({value: r.colonia_hecho, text: r.colonia_hecho}));
        UI.coloniaSelect.addOption(colonias);
        UI.coloniaSelect.enable();
    } else {
        UI.coloniaSelect.disable();
    }
}

async function onColoniaChange(colonia) {
    State.selectedColonia = colonia;
    if (!colonia) {
        UI.showContent(false);
        return;
    }

    UI.showLoading(true);
    try {
        // Fetch Aggregated data
        const rawData = await CKANClient.getQuarterlyData(State.selectedAlcaldia, colonia);
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
            State.mapPoints = await CKANClient.getMapPoints(State.selectedAlcaldia, State.selectedColonia, State.selectedYear, State.selectedQuarter);
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

    // Filter local data
    State.filteredData = State.coloniaData.filter(r => {
        const catMatch = State.activeCategories.has(r.macro_cat);
        const subDelitoMatch = State.selectedDelitos.length === 0 || State.selectedDelitos.includes(r.delito);
        return catMatch && subDelitoMatch;
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
        return catMatch && subDelitoMatch;
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
            
            // Custom dot marker
            const markerHTML = `<div style="background-color: ${catConfig.color}; width: 10px; height: 10px; border-radius: 50%; border: 1px solid white;"></div>`;
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

    // Only fit bounds when loading new data, not when just toggling layers
    if (hasPoints && !preserveView) {
        UI.map.fitBounds(bounds, {padding: [50, 50], maxZoom: 16});
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

    // 3. Build Datasets
    const datasets = [];
    
    // Only add 'Total General' if more than one category is selected OR if none are
    if (State.activeCategories.size !== 1) {
        datasets.push({
            label: 'Total General',
            data: allQs.map(q => qTotals[q] || 0),
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
                data: allQs.map(q => catTotals[id][q] || 0),
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
    
    // Attempt to add a vertical line plugin for the selected quarter
    // Easiest is just ensuring points render.
    
    UI.chart.update();
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
    document.getElementById('kpi-total').textContent = curVal.toLocaleString();
    
    document.getElementById('kpi-prev-total').textContent = prevQVal.toLocaleString();
    const bdgQoQ = document.getElementById('kpi-qoq-badge');
    bdgQoQ.textContent = formatPct(qoqPct);
    bdgQoQ.className = `kpi-badge ${getBadgeClass(qoqPct)}`;

    document.getElementById('kpi-yoy-total').textContent = prevYQVal.toLocaleString();
    const bdgYoY = document.getElementById('kpi-yoy-badge');
    bdgYoY.textContent = formatPct(yoyPct);
    bdgYoY.className = `kpi-badge ${getBadgeClass(yoyPct)}`;

    document.getElementById('kpi-ytd-total').textContent = curYTD.toLocaleString();
    document.getElementById('kpi-ytd-prev-total').textContent = prevYTD.toLocaleString();
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
            <td class="col-num">${cur.toLocaleString('es-MX')}</td>
            <td class="col-num">${prevQ.toLocaleString('es-MX')} ${badge(pct(cur, prevQ))}</td>
            <td class="col-num">${prevYQ.toLocaleString('es-MX')} ${badge(pct(cur, prevYQ))}</td>
            <td class="col-num">${curYTD.toLocaleString('es-MX')} / ${prevYTD.toLocaleString('es-MX')} ${badge(pct(curYTD, prevYTD))}</td>
        `;
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

// Start
document.addEventListener('DOMContentLoaded', init);
