const API_URL = 'https://datos.cdmx.gob.mx/api/3/action/datastore_search_sql';
const RESOURCE_ID = '48fcb848-220c-4af0-839b-4fd8ac812c0f';

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
            SELECT latitud, longitud, delito, fecha_hecho
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
    selectedDelitos: []   // Empty means all
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
    clusterGroup: null,
    
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
        
        State.catalog = await CKANClient.getCatalog();
        initSelects();
    } catch (e) {
        alert("Error cargando el catálogo de colonias. Revisa la consola.");
    } finally {
        UI.showLoading(false);
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
        // Select most recent by default
        if(!State.selectedYear) {
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

    renderMap();
    renderChart();
    renderKPIs();
}

// ==========================================
// Map (Leaflet)
// ==========================================
async function initMap() {
    UI.map = L.map('crimeMap').setView([19.432608, -99.133209], 11);
    
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; CartoDB',
        subdomains: 'abcd',
        maxZoom: 19
    }).addTo(UI.map);

    UI.clusterGroup = L.markerClusterGroup({
        chunkedLoading: true,
        maxClusterRadius: 40
    });
    UI.map.addLayer(UI.clusterGroup);
}

function renderMap() {
    if(!UI.map) return;
    UI.clusterGroup.clearLayers();
    
    let bounds = L.latLngBounds();
    let hasPoints = false;

    // Filter map points (they are already filtered by Q in API)
    const filteredPoints = State.mapPoints.filter(p => {
        const macroCat = CategoryMapper.classify(p.delito);
        const catMatch = State.activeCategories.has(macroCat);
        const subDelitoMatch = State.selectedDelitos.length === 0 || State.selectedDelitos.includes(p.delito);
        return catMatch && subDelitoMatch;
    });

    filteredPoints.forEach(p => {
        const cat = CategoryMapper.classify(p.delito);
        const catConfig = CategoryMapper.CATEGORIES[cat];
        
        // Custom dot marker
        const markerHTML = `<div style="background-color: ${catConfig.color}; width: 10px; height: 10px; border-radius: 50%; border: 1px solid white;"></div>`;
        const icon = L.divIcon({ html: markerHTML, className: '', iconSize: [12, 12] });

        const dDate = new Date(p.fecha_hecho).toLocaleDateString('es-MX', {timeZone: 'UTC'});

        const marker = L.marker([p.latitud, p.longitud], {icon})
            .bindPopup(`<strong>${p.delito}</strong><br/>${catConfig.label}<br/><em>${dDate}</em>`);
        
        UI.clusterGroup.addLayer(marker);
        bounds.extend([p.latitud, p.longitud]);
        hasPoints = true;
    });

    if (hasPoints) {
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
    const datasets = [
        {
            label: 'Total General',
            data: allQs.map(q => qTotals[q] || 0),
            borderColor: '#f8fafc',
            borderWidth: 3,
            backgroundColor: 'transparent',
            tension: 0.3,
            fill: false
        }
    ];

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

// Start
document.addEventListener('DOMContentLoaded', init);
