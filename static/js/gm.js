// static/js/gm.js
// Version: 1.76 (Load Help.png on Startup)

// --- Global Variables ---
const currentSessionId = "my-game"; // Hardcoded Session ID
let availableFilters = {};
let mapList = [];
let currentState = {}; // Holds the full state including filters, view, fog
let socket = null;
let currentMapFilename = null;
const DEFAULT_HELP_MAP = "Help.png"; // Define the default map filename

// --- Fog of War State ---
let currentInteractionMode = 'idle';
let isDrawingFogEnabled = false;
let isCurrentlyDrawingPolygon = false;
let currentFogPolygonVertices = [];
let selectedPolygonId = null;
let svgOverlay = null;
let svgDrawingLayer = null;
let svgCompletedLayer = null;
let gmMapRect = null;
let gmMapDisplayRect = null;
const FOG_VERTEX_CLOSING_THRESHOLD = 10;
const FOG_DEFAULT_COLOR = '#000000';
let lastFogColor = FOG_DEFAULT_COLOR;

// --- Auto-Save State ---
let debounceTimer = null;
const DEBOUNCE_DELAY = 1500;

// --- DOM Elements ---
const filterSelect = document.getElementById('filter-select');
const mapSelect = document.getElementById('map-select');
const playerUrlDisplay = document.getElementById('player-url-display');
const gmMapDisplay = document.getElementById('gm-map-display');
const gmMapImage = document.getElementById('gm-map-image');
const gmMapPlaceholder = document.getElementById('gm-map-placeholder');
const filterControlsContainer = document.getElementById('filter-controls');
const mapUploadForm = document.getElementById('map-upload-form');
const mapFileInput = document.getElementById('map-file-input');
const uploadStatus = document.getElementById('upload-status');
const copyPlayerUrlButton = document.getElementById('copy-player-url');
const copyStatusDisplay = document.getElementById('copy-status');
const viewXInput = document.getElementById('view-center-x');
const viewYInput = document.getElementById('view-center-y');
const viewScaleInput = document.getElementById('view-scale');
const toggleFogDrawingButton = document.getElementById('toggle-fog-drawing-button');
const fogColorDisplay = document.getElementById('fog-color-display');
const fogInteractionPopup = document.getElementById('fog-interaction-popup');
const fogDeleteButton = document.getElementById('fog-delete-button');
const fogColorButton = document.getElementById('fog-color-button');
svgOverlay = document.getElementById('gm-svg-overlay');
const eyedropperCanvas = document.getElementById('eyedropper-canvas');
const eyedropperCtx = eyedropperCanvas ? eyedropperCanvas.getContext('2d', { willReadFrequently: true }) : null;
const mapViewPanel = document.querySelector('.map-view-panel');


// --- Initialization ---
document.addEventListener('DOMContentLoaded', async () => {
    console.log("GM View Initializing (v1.76 - Load Help.png)..."); // Version updated
    console.log(`GM controlling HARDCODED Session ID: ${currentSessionId}`);

    if (!eyedropperCtx) { console.error("Failed to get 2D context for eyedropper canvas!"); }
    if (!mapViewPanel) { console.error("Failed to get reference to .map-view-panel for popup positioning!"); }
    if (!svgOverlay) svgOverlay = document.getElementById('gm-svg-overlay');
    setupSvgLayers();

    console.log("Loading initial data (Filters and Maps)...");
    try {
        await loadAvailableFilters();
        populateFilterList();
        await populateMapList(); // Populates mapList and mapSelect dropdown

        // *** ADDED: Attempt to load default map ***
        console.log(`Checking for default map: ${DEFAULT_HELP_MAP}`);
        const helpMapOption = Array.from(mapSelect.options).find(opt => opt.value === DEFAULT_HELP_MAP);
        if (helpMapOption) {
            console.log(`Default map '${DEFAULT_HELP_MAP}' found. Auto-selecting.`);
            mapSelect.value = DEFAULT_HELP_MAP;
            // Trigger the same logic as if the user selected it
            await handleMapSelectionChange({ target: mapSelect });
        } else {
            console.log(`Default map '${DEFAULT_HELP_MAP}' not found in map list.`);
            resetUI(); // Ensure UI is in default state if help map isn't loaded
        }
        // *** END ADDED ***

        console.log("Setting up UI, WebSocket, Listeners...");
        updatePlayerUrlDisplay(); // Update URL display initially
        connectWebSocket();
        setupEventListeners();
        // resetUI(); // resetUI is now called conditionally above or within loadMapDataForGM

        console.log("GM Initialization complete.");
    } catch (error) {
        console.error("Error during initialization:", error);
        alert("Failed to load initial data. Check console.");
        resetUI(); // Reset UI on error
    }
});

// --- SVG Setup ---
function setupSvgLayers() {
    if (!svgOverlay) {
        console.error("setupSvgLayers: svgOverlay not found!");
        return;
    }
    svgOverlay.innerHTML = '';
    svgCompletedLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    svgCompletedLayer.id = 'fog-completed-layer';
    svgOverlay.appendChild(svgCompletedLayer);
    svgDrawingLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    svgDrawingLayer.id = 'fog-drawing-layer';
    svgOverlay.appendChild(svgDrawingLayer);
    console.log("SVG layers setup.");
}

// --- WebSocket Handling ---
function connectWebSocket() {
    console.log("--- connectWebSocket() called ---");
    if (typeof io === 'undefined') {
        console.error("WS Error: Socket.IO library not loaded!");
        return;
    }
    console.log(`Attempting WebSocket connection...`);
    try {
        socket = io();
        console.log("Socket.IO object created:", socket);
    } catch (error) {
        console.error("Error initializing Socket.IO connection:", error);
        return;
    }
    console.log("Setting up Socket.IO event handlers...");
    socket.on('connect', () => {
        console.log(`WebSocket connected: ${socket.id}`);
    });
    socket.on('disconnect', (reason) => {
        console.warn(`WebSocket disconnected: ${reason}`);
    });
    socket.on('connect_error', (error) => {
        console.error('WS connection error:', error);
    });
    socket.on('error', (data) => {
        console.error('Server WS Error:', data.message || data);
    });
    console.log("WebSocket event handlers set up.");
}

// --- Data Loading & UI Population ---
// Functions loadAvailableFilters, populateFilterList, populateMapList, addMapOption, addFilterOption remain unchanged (condensed)
async function loadAvailableFilters() {
    console.log("[loadAvailableFilters] Fetching...");
    try {
        const r = await fetch('/api/filters');
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        availableFilters = await r.json() || {};
        console.log("[loadAvailableFilters] Assigned:", Object.keys(availableFilters));
    } catch (e) {
        console.error("[loadAvailableFilters] Error:", e);
        availableFilters = {};
        throw e;
    }
}

function populateFilterList() {
    console.log("Populating filter list...");
    if (!filterSelect) return;
    filterSelect.innerHTML = '';
    if (!availableFilters || typeof availableFilters !== 'object' || Object.keys(availableFilters).length === 0) {
        filterSelect.innerHTML = '<option value="">-- No Filters --</option>';
        return;
    }
    try {
        const sortedIds = Object.keys(availableFilters).sort((a, b) => {
            if (a === 'none') return -1;
            if (b === 'none') return 1;
            return (availableFilters[a]?.name || a).localeCompare(availableFilters[b]?.name || b);
        });
        sortedIds.forEach(id => addFilterOption(availableFilters[id]?.name || id, id));
        const defaultSel = availableFilters['none'] ? 'none' : (sortedIds[0] || '');
        if (filterSelect.options.length > 0) {
            if (filterSelect.querySelector(`option[value="${defaultSel}"]`)) filterSelect.value = defaultSel;
            else filterSelect.value = filterSelect.options[0].value;
        }
        console.log("Filter list populated.");
    } catch (e) {
        console.error("Error populating filters:", e);
        filterSelect.innerHTML = '<option value="">-- Error --</option>';
    }
}
async function populateMapList() {
    console.log("Populating map list...");
    if (!mapSelect) return;
    mapSelect.innerHTML = '<option value="">-- Loading --</option>';
    try {
        const r = await fetch('/api/maps');
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        mapList = await r.json() || [];
        console.log("Map list fetched:", mapList);
        mapSelect.innerHTML = '<option value="">-- Select Map --</option>';
        if (mapList && mapList.length > 0) {
            mapList.forEach(addMapOption);
        } else {
            mapSelect.innerHTML = '<option value="">-- No Maps --</option>';
        }
        currentMapFilename = null;
    } catch (e) {
        console.error('Error fetching maps:', e);
        mapSelect.innerHTML = '<option value="">-- Error --</option>';
        mapList = [];
        throw e;
    }
}

function addMapOption(filename) {
    if (!mapSelect) return;
    const o = document.createElement('option');
    o.value = filename;
    o.textContent = filename;
    try {
        mapSelect.appendChild(o);
    } catch (e) {
        console.error(`Error adding map ${filename}:`, e);
    }
}

function addFilterOption(displayName, filterId) {
    if (!filterSelect) return;
    const o = document.createElement('option');
    o.value = filterId;
    o.textContent = displayName;
    try {
        filterSelect.appendChild(o);
    } catch (e) {
        console.error(`Error adding filter ${filterId}:`, e);
    }
}

// --- UI Reset ---
function resetUI() {
    console.log("Resetting GM UI...");
    if (gmMapImage) {
        gmMapImage.onload = null;
        gmMapImage.onerror = null;
        gmMapImage.src = '';
        gmMapImage.style.display = 'none';
    }
    if (gmMapDisplay) {
        gmMapDisplay.style.display = 'none';
    }
    if (gmMapPlaceholder) {
        gmMapPlaceholder.style.display = 'block';
        gmMapPlaceholder.textContent = 'Select a map...';
    }
    if (filterSelect && filterSelect.options.length > 0) {
        const defaultId = availableFilters['none'] ? 'none' : (Object.keys(availableFilters)[0] || '');
        if (filterSelect.querySelector(`option[value="${defaultId}"]`)) filterSelect.value = defaultId;
        else filterSelect.value = filterSelect.options[0].value;
    }
    if (filterControlsContainer) {
        filterControlsContainer.innerHTML = '<p>Select map first.</p>';
    }
    if (viewXInput) viewXInput.disabled = true;
    if (viewYInput) viewYInput.disabled = true;
    if (viewScaleInput) viewScaleInput.disabled = true;
    const xSpan = viewXInput?.previousElementSibling?.querySelector('.slider-value');
    const ySpan = viewYInput?.previousElementSibling?.querySelector('.slider-value');
    const scaleSpan = viewScaleInput?.previousElementSibling?.querySelector('.slider-value');
    if (xSpan) xSpan.textContent = ` (0.50)`;
    if (ySpan) ySpan.textContent = ` (0.50)`;
    if (scaleSpan) scaleSpan.textContent = ` (1.00x)`;
    if (mapSelect && mapSelect.options.length > 0) {
        mapSelect.value = "";
    }
    currentMapFilename = null;
    currentState = {};
    // Reset Fog State
    setInteractionMode('idle');
    isDrawingFogEnabled = false;
    isCurrentlyDrawingPolygon = false;
    currentFogPolygonVertices = [];
    selectedPolygonId = null;
    if (svgOverlay) {
        svgOverlay.innerHTML = '';
        setupSvgLayers();
    }
    if (toggleFogDrawingButton) {
        toggleFogDrawingButton.textContent = "Draw New Polygons";
        toggleFogDrawingButton.disabled = true;
    }
    if (fogInteractionPopup) fogInteractionPopup.style.display = 'none';
    lastFogColor = FOG_DEFAULT_COLOR;
    updateFogColorDisplay();
    gmMapRect = null;
    gmMapDisplayRect = null;
    console.log(" -> resetUI complete.");
}

// --- Map Loading for GM ---
async function loadMapDataForGM(filename) {
    if (!filename) {
        console.log("loadMapDataForGM: no filename, resetting.");
        resetUI();
        return;
    }
    currentMapFilename = filename;
    console.log(`Loading GM data for: ${filename}`);
    if (gmMapPlaceholder) gmMapPlaceholder.style.display = 'none';
    if (gmMapImage) gmMapImage.style.display = 'none';
    if (gmMapDisplay) gmMapDisplay.style.display = 'flex';
    if (svgOverlay) {
        svgOverlay.innerHTML = '';
        setupSvgLayers();
    }
    deselectPolygon();

    try {
        const apiUrl = `/api/config/${encodeURIComponent(filename)}?t=${Date.now()}`;
        console.log(`Fetching config: ${apiUrl}`);
        const configResponse = await fetch(apiUrl);
        if (!configResponse.ok) {
            throw new Error(`Config load failed (${configResponse.status})`);
        }
        const mapConfig = await configResponse.json();
        console.log("Loaded map config:", mapConfig);

        currentState = mapConfig;
        if (!currentState || typeof currentState !== 'object') {
            throw new Error("Invalid config data.");
        }
        // Defaulting state structure
        currentState.view_state = currentState.view_state || {
            center_x: 0.5,
            center_y: 0.5,
            scale: 1.0
        };
        currentState.current_filter = currentState.current_filter || (availableFilters['none'] ? 'none' : Object.keys(availableFilters)[0] || '');
        currentState.filter_params = currentState.filter_params || get_default_filter_params();
        currentState.fog_of_war = currentState.fog_of_war || {
            hidden_polygons: []
        };
        currentState.fog_of_war.hidden_polygons = currentState.fog_of_war.hidden_polygons || [];
        currentState.display_type = "image";
        currentState.map_content_path = currentState.map_content_path || `maps/${filename}`; // Ensure original path

        const imageUrl = currentState.map_content_path; // Use original path for GM preview
        if (!imageUrl) {
            throw new Error("Map content path missing.");
        }

        console.log("Updating UI controls...");
        if (availableFilters[currentState.current_filter]) {
            if (filterSelect) filterSelect.value = currentState.current_filter;
        }
        updateFilterControls();
        updateViewControls();
        if (viewXInput) viewXInput.disabled = false;
        if (viewYInput) viewYInput.disabled = false;
        if (viewScaleInput) viewScaleInput.disabled = false;
        if (toggleFogDrawingButton) toggleFogDrawingButton.disabled = false;
        updateFogColorDisplay();

        console.log("Setting up image load handlers...");
        if (gmMapImage) {
            gmMapImage.onload = () => {
                console.log(">>> gmMapImage.onload");
                gmMapImage.style.display = 'block';
                requestAnimationFrame(() => { // Ensure layout is stable
                    try {
                        updateMapAndSvgDimensions();
                        drawExistingFogPolygons();
                        prepareEyedropperCanvas();
                        console.log("<<< gmMapImage.onload finished.");
                    } catch (e) {
                        console.error("Error in gmMapImage.onload:", e);
                        alert("Error setting up map overlay.");
                    }
                });
            };
            gmMapImage.onerror = () => {
                console.error("Failed load GM image:", imageUrl);
                alert("Failed load map preview.");
                resetUI();
            };
            console.log(`Setting gmMapImage.src = ${imageUrl}`);
            gmMapImage.src = imageUrl;
            gmMapImage.alt = `Preview of ${filename}`;
        } else {
            console.error("loadMapDataForGM: gmMapImage missing!");
        }

    } catch (error) {
        console.error(`Error loading GM data for ${filename}:`, error);
        alert(`Error loading preview: ${error.message}`);
        resetUI();
    }
}


// --- Filter & View Control Updates ---
// Functions updateFilterControls, updateViewControls remain unchanged (condensed)
function updateFilterControls() {
    if (!filterControlsContainer) return;
    filterControlsContainer.innerHTML = '';
    if (!currentState || !currentState.current_filter) {
        filterControlsContainer.innerHTML = '<p>Select map.</p>';
        return;
    }
    const filterId = currentState.current_filter;
    const filterDef = availableFilters[filterId];
    if (!filterDef) {
        filterControlsContainer.innerHTML = `<p style="color:red;">Filter missing.</p>`;
        return;
    }
    if (!filterDef.params || Object.keys(filterDef.params).length === 0) {
        filterControlsContainer.innerHTML = `<p>No params.</p>`;
        return;
    }
    const fieldset = document.createElement('fieldset');
    const legend = document.createElement('legend');
    legend.textContent = `${filterDef.name || filterId} Params`;
    fieldset.appendChild(legend);
    currentState.filter_params = currentState.filter_params || {};
    currentState.filter_params[filterId] = currentState.filter_params[filterId] || {};
    const currentParams = currentState.filter_params[filterId];
    for (const paramKey in filterDef.params) {
        if (paramKey === 'backgroundImageFilename') continue;
        const paramConfig = filterDef.params[paramKey];
        const currentVal = currentParams[paramKey] ?? paramConfig.value;
        if (currentParams[paramKey] === undefined) {
            currentParams[paramKey] = paramConfig.value;
        }
        const div = document.createElement('div');
        const label = document.createElement('label');
        label.htmlFor = `param-${paramKey}`;
        label.textContent = paramConfig.label || paramKey;
        let input, valueSpan = null;
        if (paramConfig.min === 0 && paramConfig.max === 1 && paramConfig.step === 1) {
            input = document.createElement('input');
            input.type = 'checkbox';
            input.checked = (currentVal === 1.0 || currentVal === 1);
            label.style.display = 'inline-block';
            input.style.cssText = 'vertical-align: middle; margin-left: 5px; width: auto;';
            label.appendChild(input);
        } else {
            input = document.createElement('input');
            input.type = 'range';
            input.min = paramConfig.min ?? 0;
            input.max = paramConfig.max ?? 1;
            input.step = paramConfig.step ?? 0.01;
            const numVal = parseFloat(currentVal);
            input.value = isNaN(numVal) ? paramConfig.value : Math.max(input.min, Math.min(input.max, numVal));
            valueSpan = document.createElement('span');
            valueSpan.className = 'slider-value';
            valueSpan.id = `param-value-${paramKey}`;
            valueSpan.textContent = ` (${parseFloat(input.value).toFixed(paramConfig?.step >= 0.1 ? 2 : 3)})`;
            label.appendChild(valueSpan);
            div.appendChild(label);
            div.appendChild(input);
        }
        input.id = `param-${paramKey}`;
        input.dataset.paramKey = paramKey;
        input.dataset.filterId = filterId;
        input.addEventListener('input', handleControlChange);
        input.addEventListener('change', handleControlChange);
        if (input.type === 'checkbox') fieldset.appendChild(label);
        else fieldset.appendChild(div);
    }
    filterControlsContainer.appendChild(fieldset);
}

function updateViewControls() {
    console.log("Updating view controls...");
    if (!currentState?.view_state) {
        if (viewXInput) viewXInput.disabled = true;
        if (viewYInput) viewYInput.disabled = true;
        if (viewScaleInput) viewScaleInput.disabled = true;
        return;
    }
    const {
        center_x = 0.5, center_y = 0.5, scale = 1.0
    } = currentState.view_state;
    console.log(` -> State: x=${center_x}, y=${center_y}, scale=${scale}`);
    if (viewXInput) viewXInput.value = center_x;
    if (viewYInput) viewYInput.value = center_y;
    if (viewScaleInput) viewScaleInput.value = scale;
    const xSpan = viewXInput?.previousElementSibling?.querySelector('.slider-value');
    const ySpan = viewYInput?.previousElementSibling?.querySelector('.slider-value');
    const scaleSpan = viewScaleInput?.previousElementSibling?.querySelector('.slider-value');
    if (xSpan) xSpan.textContent = ` (${center_x.toFixed(2)})`;
    if (ySpan) ySpan.textContent = ` (${center_y.toFixed(2)})`;
    if (scaleSpan) scaleSpan.textContent = ` (${scale.toFixed(2)}x)`;
    if (viewXInput) viewXInput.disabled = false;
    if (viewYInput) viewYInput.disabled = false;
    if (viewScaleInput) viewScaleInput.disabled = false;
}

// --- Event Handling ---
function setupEventListeners() {
    console.log("Setting up event listeners...");
    if (mapSelect) mapSelect.addEventListener('change', handleMapSelectionChange);
    else console.error("mapSelect missing!");
    if (filterSelect) filterSelect.addEventListener('change', handleFilterChange);
    else console.error("filterSelect missing!");
    if (mapUploadForm) mapUploadForm.addEventListener('submit', handleMapUpload);
    else console.error("mapUploadForm missing!");
    if (viewXInput) viewXInput.addEventListener('input', handleViewChange);
    else console.error("viewXInput missing!");
    if (viewYInput) viewYInput.addEventListener('input', handleViewChange);
    else console.error("viewYInput missing!");
    if (viewScaleInput) viewScaleInput.addEventListener('input', handleViewChange);
    else console.error("viewScaleInput missing!");
    if (copyPlayerUrlButton) copyPlayerUrlButton.addEventListener('click', copyPlayerUrlToClipboard);
    else console.error("copyPlayerUrlButton missing!");
    if (toggleFogDrawingButton) toggleFogDrawingButton.addEventListener('click', handleToggleFogDrawing);
    else console.error("toggleFogDrawingButton missing!");
    if (svgOverlay) {
        svgOverlay.addEventListener('click', handleSvgClick);
        svgOverlay.addEventListener('mousemove', handleSvgMouseMove);
    } else console.error("svgOverlay missing!");
    document.addEventListener('keydown', handleKeyDown);
    if (fogDeleteButton) fogDeleteButton.addEventListener('click', handleDeletePolygon);
    else console.error("fogDeleteButton missing!");
    if (fogColorButton) fogColorButton.addEventListener('click', handleChangeColorStart);
    else console.error("fogColorButton missing!");
    window.addEventListener('resize', updateMapAndSvgDimensions);
    console.log("Event listeners setup complete.");
}

// --- Event Handlers ---
// Functions handleMapSelectionChange, handleFilterChange, handleMapUpload, handleControlChange, handleViewChange, copyPlayerUrlToClipboard remain unchanged (condensed)
async function handleMapSelectionChange(event) {
    console.log("Map selection changed...");
    const filename = event.target.value;
    if (!filename) {
        resetUI();
        sendUpdate({
            map_content_path: null,
            display_type: 'image'
        });
        return;
    }
    console.log(`Selected: ${filename}`);
    const newPath = `maps/${filename}`;
    sendUpdate({
        map_content_path: newPath,
        display_type: 'image'
    });
    await loadMapDataForGM(filename);
    console.log(`GM preview updated for ${filename}`);
}

function handleFilterChange(event) {
    console.log("Filter changed...");
    if (!currentMapFilename) {
        alert("Select map first.");
        event.target.value = currentState.current_filter || '';
        return;
    }
    const newFilterId = event.target.value;
    console.log(`Selected: ${newFilterId}`);
    currentState.current_filter = newFilterId;
    currentState.filter_params = currentState.filter_params || {};
    if (!currentState.filter_params[newFilterId]) {
        const filterDef = availableFilters[newFilterId];
        currentState.filter_params[newFilterId] = {};
        if (filterDef?.params) {
            for (const key in filterDef.params) {
                if (key !== 'backgroundImageFilename' && filterDef.params[key].value !== undefined) {
                    currentState.filter_params[newFilterId][key] = filterDef.params[key].value;
                }
            }
        }
    }
    updateFilterControls();
    const payload = {
        current_filter: newFilterId,
        filter_params: {
            [newFilterId]: currentState.filter_params[newFilterId] || {}
        }
    };
    sendUpdate(payload);
    debouncedAutoSave();
}
async function handleMapUpload(event) {
    console.log("Map upload submitted...");
    event.preventDefault();
    if (!mapFileInput?.files?.length) {
        uploadStatus.textContent = 'Select file.';
        return;
    }
    const file = mapFileInput.files[0];
    const allowedTypes = ['image/png', 'image/jpeg', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
        uploadStatus.textContent = 'Invalid type.';
        return;
    }
    const formData = new FormData();
    formData.append('mapFile', file);
    uploadStatus.textContent = 'Uploading...';
    try {
        const r = await fetch('/api/maps', {
            method: 'POST',
            body: formData
        });
        const result = await r.json();
        if (r.ok && result.success) {
            uploadStatus.textContent = `Success: ${result.filename}`;
            mapFileInput.value = '';
            await populateMapList();
            if (mapList.includes(result.filename)) {
                mapSelect.value = result.filename;
                handleMapSelectionChange({
                    target: mapSelect
                });
            }
        } else {
            uploadStatus.textContent = `Failed: ${result.error || 'Server error'}`;
        }
    } catch (e) {
        console.error('Upload error:', e);
        uploadStatus.textContent = 'Failed: Network error.';
    }
}

function handleControlChange(event) {
    console.log("Control changed:", event.target.id);
    if (!currentMapFilename || !currentState?.filter_params) return;
    const input = event.target;
    const filterId = input.dataset.filterId;
    const paramKey = input.dataset.paramKey;
    if (!filterId || !paramKey || paramKey === 'backgroundImageFilename') return;
    let value;
    if (input.type === 'checkbox') value = input.checked ? 1.0 : 0.0;
    else if (input.type === 'range' || input.type === 'number') value = parseFloat(input.value);
    else value = input.value;
    if (input.type === 'range') {
        const valueSpan = document.getElementById(`param-value-${paramKey}`);
        if (valueSpan) {
            const paramConfig = availableFilters[filterId]?.params[paramKey];
            if (paramConfig?.min === 0 && paramConfig?.max === 1 && paramConfig?.step === 1) valueSpan.textContent = ` (${value === 1.0 ? 'On' : 'Off'})`;
            else valueSpan.textContent = ` (${value.toFixed(paramConfig?.step >= 0.1 ? 2 : 3)})`;
        }
    }
    currentState.filter_params = currentState.filter_params || {};
    currentState.filter_params[filterId] = currentState.filter_params[filterId] || {};
    if (currentState.filter_params[filterId][paramKey] !== value) {
        currentState.filter_params[filterId][paramKey] = value;
        const payload = {
            filter_params: {
                [filterId]: {
                    [paramKey]: value
                }
            }
        };
        sendUpdate(payload);
        debouncedAutoSave();
    }
}

function handleViewChange(event) {
    console.log("View changed:", event.target.id);
    if (!currentMapFilename || !currentState?.view_state) return;
    const input = event.target;
    const key = input.id.replace('view-', '').replace('-', '_');
    const value = parseFloat(input.value);
    if (currentState.view_state[key] !== value) {
        currentState.view_state[key] = value;
        updateViewControls();
        const payload = {
            view_state: {
                [key]: value
            }
        };
        sendUpdate(payload);
        debouncedAutoSave();
    }
}

function copyPlayerUrlToClipboard() {
    console.log("Copying player URL...");
    if (!playerUrlDisplay) return;
    playerUrlDisplay.select();
    playerUrlDisplay.setSelectionRange(0, 99999);
    try {
        if (!document.execCommand('copy')) throw new Error('execCommand failed');
        copyStatusDisplay.textContent = 'Copied!';
        copyStatusDisplay.style.color = 'green';
    } catch (err) {
        console.error('Copy failed:', err);
        copyStatusDisplay.textContent = 'Copy failed.';
        copyStatusDisplay.style.color = 'red';
        if (navigator.clipboard) {
            navigator.clipboard.writeText(playerUrlDisplay.value).then(() => {
                copyStatusDisplay.textContent = 'Copied!';
                copyStatusDisplay.style.color = 'green';
            }).catch(clipErr => {
                console.error('Clipboard fallback failed:', clipErr);
                copyStatusDisplay.textContent = 'Copy failed.';
                copyStatusDisplay.style.color = 'red';
            });
        }
    }
    setTimeout(() => {
        copyStatusDisplay.textContent = '';
    }, 2500);
}


// --- Fog of War Handlers ---

// Toggle Logic (Unchanged)
function handleToggleFogDrawing() {
    isDrawingFogEnabled = !isDrawingFogEnabled;
    if (isDrawingFogEnabled) {
        if (currentInteractionMode === 'polygon_selected' || currentInteractionMode === 'eyedropper_active') {
            deselectPolygon();
        }
        setInteractionMode('drawing_enabled');
    } else {
        if (currentInteractionMode === 'drawing_polygon') {
            cancelCurrentPolygon();
        }
        setInteractionMode('idle');
    }
}
// Interaction Mode Setter (Unchanged)
function setInteractionMode(mode) {
    if (currentInteractionMode === mode) return;
    console.log(`Switching Mode: ${currentInteractionMode} -> ${mode}`);
    currentInteractionMode = mode;
    svgOverlay.classList.remove('drawing-active', 'eyedropper-active');
    if (fogInteractionPopup) fogInteractionPopup.style.display = 'none';
    switch (mode) {
        case 'idle':
            isDrawingFogEnabled = false;
            if (toggleFogDrawingButton) toggleFogDrawingButton.textContent = "Enable Drawing";
            isCurrentlyDrawingPolygon = false;
            currentFogPolygonVertices = [];
            renderCurrentDrawing();
            break;
        case 'drawing_enabled':
            isDrawingFogEnabled = true;
            if (toggleFogDrawingButton) toggleFogDrawingButton.textContent = "Disable Drawing";
            svgOverlay.classList.add('drawing-active');
            break;
        case 'drawing_polygon':
            isDrawingFogEnabled = true;
            isCurrentlyDrawingPolygon = true;
            svgOverlay.classList.add('drawing-active');
            break;
        case 'polygon_selected':
            isDrawingFogEnabled = false;
            if (toggleFogDrawingButton) toggleFogDrawingButton.textContent = "Draw New Polygons";
            svgOverlay.classList.add('drawing-active');
            break;
        case 'eyedropper_active':
            isDrawingFogEnabled = false;
            if (toggleFogDrawingButton) toggleFogDrawingButton.textContent = "Draw New Polygons";
            svgOverlay.classList.add('eyedropper-active');
            break;
    }
}
// KeyDown Handler (Unchanged)
function handleKeyDown(event) {
    switch (event.key) {
        case 'Escape':
            if (currentInteractionMode === 'drawing_polygon') cancelCurrentPolygon();
            else if (currentInteractionMode === 'polygon_selected') deselectPolygon();
            else if (currentInteractionMode === 'eyedropper_active') {
                setInteractionMode('polygon_selected');
                showInteractionPopup(event);
            }
            break;
        case 'Delete':
        case 'Backspace':
            if (currentInteractionMode === 'polygon_selected' && selectedPolygonId) handleDeletePolygon();
            break;
    }
}
// Cancel Polygon Drawing (Unchanged)
function cancelCurrentPolygon() {
    currentFogPolygonVertices = [];
    isCurrentlyDrawingPolygon = false;
    renderCurrentDrawing();
    setInteractionMode('drawing_enabled');
}

// Main SVG Click Router (Unchanged)
function handleSvgClick(event) {
    if (!currentMapFilename || !gmMapRect) return;
    const target = event.target;
    const clickedOnPolygonElement = target.closest('.fog-polygon-complete');
    console.log(`SVG Click - Mode: ${currentInteractionMode}, Target:`, target);
    switch (currentInteractionMode) {
        case 'eyedropper_active':
            handleEyedropperClick(event);
            break;
        case 'polygon_selected':
            if (!clickedOnPolygonElement && !target.closest('#fog-interaction-popup')) deselectPolygon();
            else if (clickedOnPolygonElement && clickedOnPolygonElement.dataset.polygonId !== selectedPolygonId) handlePolygonSelect(event);
            break;
        case 'idle':
            if (clickedOnPolygonElement) handlePolygonSelect(event);
            break;
        case 'drawing_enabled':
            if (clickedOnPolygonElement) handlePolygonSelect(event);
            else startOrContinueDrawing(event);
            break;
        case 'drawing_polygon':
            startOrContinueDrawing(event);
            break;
    }
}
// Start/Continue Drawing (Unchanged)
function startOrContinueDrawing(event) {
    const svgPoint = getSvgCoordinates(event);
    if (!svgPoint) return;
    const relativePoint = svgToRelativeCoords(svgPoint);
    if (!relativePoint) return;
    console.log(`Fog Draw Click: Rel(${relativePoint.x.toFixed(3)}, ${relativePoint.y.toFixed(3)})`);
    setInteractionMode('drawing_polygon');
    if (currentFogPolygonVertices.length >= 3) {
        const firstVertexSvg = relativeToSvgCoords(currentFogPolygonVertices[0]);
        if (!firstVertexSvg) return;
        const dx = svgPoint.x - firstVertexSvg.x;
        const dy = svgPoint.y - firstVertexSvg.y;
        if (Math.sqrt(dx * dx + dy * dy) < FOG_VERTEX_CLOSING_THRESHOLD) {
            console.log("Closing polygon.");
            completeCurrentPolygon();
            return;
        }
    }
    currentFogPolygonVertices.push(relativePoint);
    renderCurrentDrawing();
}
// Mouse Move Handler (Unchanged)
function handleSvgMouseMove(event) {
    if (currentInteractionMode === 'drawing_polygon' && currentFogPolygonVertices.length > 0) {
        const svgPoint = getSvgCoordinates(event);
        if (!svgPoint) return;
        renderRubberBand(svgPoint);
    } else {
        const existingRubberBand = svgDrawingLayer?.querySelector('.fog-polygon-rubberband');
        if (existingRubberBand) existingRubberBand.remove();
    }
}

// Complete Polygon ( *** ADDED sendUpdate *** )
function completeCurrentPolygon() {
    if (currentFogPolygonVertices.length < 3) {
        console.warn("Need at least 3 vertices.");
        cancelCurrentPolygon();
        return;
    }
    const newPolygon = {
        id: generateUniqueId(),
        color: lastFogColor, // Use last selected/default color
        vertices: [...currentFogPolygonVertices]
    };
    console.log("Completed Polygon:", newPolygon);

    // Update internal state
    currentState.fog_of_war = currentState.fog_of_war || {
        hidden_polygons: []
    };
    currentState.fog_of_war.hidden_polygons.push(newPolygon);

    // Reset drawing state
    currentFogPolygonVertices = [];
    isCurrentlyDrawingPolygon = false;
    renderCurrentDrawing(); // Clear temporary drawing lines/points
    drawSingleCompletedPolygon(newPolygon); // Draw the final polygon
    setInteractionMode('drawing_enabled'); // Go back to waiting for next polygon start

    // *** ADDED: Send update to backend/players ***
    console.log("Sending fog update after polygon completion.");
    sendUpdate({
        fog_of_war: currentState.fog_of_war
    });

    // Trigger auto-save (debounced)
    debouncedAutoSave();
}

// --- Polygon Selection, Deletion, Coloring ---

// Select Polygon (Unchanged)
function handlePolygonSelect(event) {
    const polygonElement = event.target.closest('.fog-polygon-complete');
    if (!polygonElement || !polygonElement.dataset.polygonId) return;
    const polygonId = polygonElement.dataset.polygonId;
    console.log("Selected polygon ID:", polygonId);
    deselectPolygon(false);
    selectedPolygonId = polygonId;
    polygonElement.classList.add('fog-polygon-selected');
    setInteractionMode('polygon_selected');
    showInteractionPopup(event);
}
// Deselect Polygon (Unchanged)
function deselectPolygon(changeMode = true) {
    if (selectedPolygonId && svgCompletedLayer) {
        const selectedElement = svgCompletedLayer.querySelector(`.fog-polygon-complete[data-polygon-id="${selectedPolygonId}"]`);
        if (selectedElement) selectedElement.classList.remove('fog-polygon-selected');
    }
    selectedPolygonId = null;
    if (fogInteractionPopup) fogInteractionPopup.style.display = 'none';
    if (changeMode) {
        if (isDrawingFogEnabled) setInteractionMode('drawing_enabled');
        else setInteractionMode('idle');
    }
    if (svgOverlay.classList.contains('eyedropper-active')) svgOverlay.classList.remove('eyedropper-active');
}
// Show Interaction Popup (Unchanged)
function showInteractionPopup(event) {
    if (!fogInteractionPopup || !svgOverlay || !mapViewPanel) return;
    const svgClickPos = getSvgCoordinates(event);
    if (!svgClickPos) return;
    const panelRect = mapViewPanel.getBoundingClientRect();
    const popupWidth = fogInteractionPopup.offsetWidth;
    const popupHeight = fogInteractionPopup.offsetHeight;
    let popupLeft = svgClickPos.x + 10;
    let popupTop = svgClickPos.y + 10;
    if (popupLeft + popupWidth > mapViewPanel.clientWidth) popupLeft = svgClickPos.x - popupWidth - 10;
    if (popupTop + popupHeight > mapViewPanel.clientHeight) popupTop = svgClickPos.y - popupHeight - 10;
    popupLeft = Math.max(5, popupLeft);
    popupTop = Math.max(5, popupTop);
    fogInteractionPopup.style.left = `${popupLeft}px`;
    fogInteractionPopup.style.top = `${popupTop}px`;
    fogInteractionPopup.style.display = 'block';
}
// Delete Polygon (Unchanged)
function handleDeletePolygon() {
    if (!selectedPolygonId || !currentState?.fog_of_war?.hidden_polygons) return;
    console.log("Deleting polygon ID:", selectedPolygonId);
    const initialLength = currentState.fog_of_war.hidden_polygons.length;
    currentState.fog_of_war.hidden_polygons = currentState.fog_of_war.hidden_polygons.filter(p => p.id !== selectedPolygonId);
    if (currentState.fog_of_war.hidden_polygons.length < initialLength) {
        if (svgCompletedLayer) {
            const elementToRemove = svgCompletedLayer.querySelector(`.fog-polygon-complete[data-polygon-id="${selectedPolygonId}"]`);
            if (elementToRemove) elementToRemove.remove();
        }
        sendUpdate({
            fog_of_war: currentState.fog_of_war
        });
        debouncedAutoSave();
        console.log("Polygon deleted.");
    } else {
        console.warn("Polygon ID not found:", selectedPolygonId);
    }
    deselectPolygon();
}
// Start Color Change / Eyedropper (Unchanged)
function handleChangeColorStart() {
    if (!selectedPolygonId) return;
    console.log("Activating eyedropper for:", selectedPolygonId);
    prepareEyedropperCanvas();
    setInteractionMode('eyedropper_active');
    if (fogInteractionPopup) fogInteractionPopup.style.display = 'none';
}
// Handle Eyedropper Click (Unchanged)
function handleEyedropperClick(event) {
    if (currentInteractionMode !== 'eyedropper_active' || !selectedPolygonId || !eyedropperCtx || !gmMapRect) return;
    const svgPoint = getSvgCoordinates(event);
    if (!svgPoint) return;
    const relativePoint = svgToRelativeCoords(svgPoint);
    if (!relativePoint) return;
    const canvasX = Math.floor(relativePoint.x * eyedropperCanvas.width);
    const canvasY = Math.floor(relativePoint.y * eyedropperCanvas.height);
    try {
        const pixelData = eyedropperCtx.getImageData(canvasX, canvasY, 1, 1).data;
        const newColorHex = rgbToHex(pixelData[0], pixelData[1], pixelData[2]);
        console.log(`Eyedropper: (${canvasX},${canvasY}) -> Hex(${newColorHex})`);
        const polygon = currentState.fog_of_war.hidden_polygons.find(p => p.id === selectedPolygonId);
        if (polygon && polygon.color !== newColorHex) {
            polygon.color = newColorHex;
            lastFogColor = newColorHex;
            updateFogColorDisplay();
            if (svgCompletedLayer) {
                const elementToUpdate = svgCompletedLayer.querySelector(`.fog-polygon-complete[data-polygon-id="${selectedPolygonId}"]`);
                if (elementToUpdate) elementToUpdate.setAttribute('fill', newColorHex);
            }
            sendUpdate({
                fog_of_war: currentState.fog_of_war
            });
            debouncedAutoSave();
            console.log("Polygon color updated.");
        } else if (!polygon) console.warn("Polygon not found for color update.");
    } catch (e) {
        console.error("Error using eyedropper:", e);
        alert("Could not sample color.");
    } finally {
        setInteractionMode('polygon_selected');
        showInteractionPopup(event);
    }
}
// Prepare Eyedropper Canvas (Unchanged)
function prepareEyedropperCanvas() {
    if (!eyedropperCtx || !gmMapImage || gmMapImage.naturalWidth === 0) {
        console.error("Cannot prep eyedropper.");
        return;
    }
    console.log("Prepping eyedropper canvas...");
    eyedropperCanvas.width = gmMapImage.naturalWidth;
    eyedropperCanvas.height = gmMapImage.naturalHeight;
    eyedropperCtx.drawImage(gmMapImage, 0, 0, eyedropperCanvas.width, eyedropperCanvas.height);
    console.log(`Eyedropper canvas ready.`);
}
// Update Fog Color Display (Unchanged)
function updateFogColorDisplay() {
    if (fogColorDisplay) fogColorDisplay.style.backgroundColor = lastFogColor;
}

// --- SVG Drawing Functions (Unchanged) ---
function renderCurrentDrawing() {
    if (!svgDrawingLayer) return;
    svgDrawingLayer.innerHTML = '';
    if (currentFogPolygonVertices.length === 0) return;
    if (currentFogPolygonVertices.length > 1) {
        const points = currentFogPolygonVertices.map(p => {
            const svgP = relativeToSvgCoords(p);
            return svgP ? `${svgP.x},${svgP.y}` : null;
        }).filter(p => p !== null).join(' ');
        if (points.length > 0) {
            const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
            polyline.setAttribute('points', points);
            polyline.setAttribute('class', 'fog-polygon-drawing');
            svgDrawingLayer.appendChild(polyline);
        }
    }
    currentFogPolygonVertices.forEach((p, index) => {
        const svgP = relativeToSvgCoords(p);
        if (svgP) {
            const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            circle.setAttribute('cx', svgP.x);
            circle.setAttribute('cy', svgP.y);
            circle.setAttribute('r', index === 0 ? 5 : 3);
            circle.setAttribute('class', 'fog-polygon-vertex');
            svgDrawingLayer.appendChild(circle);
        }
    });
    const existingRubberBand = svgDrawingLayer.querySelector('.fog-polygon-rubberband');
    if (existingRubberBand) existingRubberBand.remove();
}

function renderRubberBand(mouseSvgPos) {
    if (!svgDrawingLayer || currentFogPolygonVertices.length === 0) return;
    const lastVertex = currentFogPolygonVertices[currentFogPolygonVertices.length - 1];
    const lastVertexSvg = relativeToSvgCoords(lastVertex);
    if (!lastVertexSvg) return;
    let rubberBandLine = svgDrawingLayer.querySelector('.fog-polygon-rubberband');
    if (!rubberBandLine) {
        rubberBandLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        rubberBandLine.setAttribute('class', 'fog-polygon-rubberband');
        svgDrawingLayer.appendChild(rubberBandLine);
    }
    rubberBandLine.setAttribute('x1', lastVertexSvg.x);
    rubberBandLine.setAttribute('y1', lastVertexSvg.y);
    rubberBandLine.setAttribute('x2', mouseSvgPos.x);
    rubberBandLine.setAttribute('y2', mouseSvgPos.y);
}

function drawExistingFogPolygons() {
    if (!svgCompletedLayer || !currentState?.fog_of_war?.hidden_polygons) return;
    console.log(`Drawing ${currentState.fog_of_war.hidden_polygons.length} existing polygons.`);
    svgCompletedLayer.innerHTML = '';
    currentState.fog_of_war.hidden_polygons.forEach(drawSingleCompletedPolygon);
}

function drawSingleCompletedPolygon(polygonData) {
    if (!svgCompletedLayer || !polygonData?.vertices || polygonData.vertices.length < 3) return;
    const points = polygonData.vertices.map(p => {
        const svgP = relativeToSvgCoords(p);
        return svgP ? `${svgP.x},${svgP.y}` : null;
    }).filter(p => p !== null).join(' ');
    if (points.length === 0) return;
    const svgPolygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    svgPolygon.setAttribute('points', points);
    svgPolygon.setAttribute('fill', polygonData.color || FOG_DEFAULT_COLOR);
    svgPolygon.classList.add('fog-polygon-complete');
    if (polygonData.id === selectedPolygonId) svgPolygon.classList.add('fog-polygon-selected');
    svgPolygon.dataset.polygonId = polygonData.id;
    svgCompletedLayer.appendChild(svgPolygon);
}

// --- Coordinate Conversion & SVG Sizing (Unchanged) ---
function updateMapAndSvgDimensions() {
    console.log("Updating map/SVG dimensions...");
    if (!gmMapImage || !gmMapDisplay || !svgOverlay) {
        console.error("Missing elements for dimension update.");
        gmMapRect = null;
        gmMapDisplayRect = null;
        return;
    }
    if (gmMapImage.style.display === 'none') {
        console.warn("gmMapImage hidden, cannot get bounds.");
        gmMapRect = null;
        gmMapDisplayRect = null;
        return;
    }
    gmMapRect = gmMapImage.getBoundingClientRect();
    gmMapDisplayRect = gmMapDisplay.getBoundingClientRect();
    if (gmMapRect.width === 0 || gmMapRect.height === 0) {
        console.warn("gmMapImage bounds zero. Retrying.");
        gmMapRect = null;
        gmMapDisplayRect = null;
        setTimeout(updateMapAndSvgDimensions, 100);
        return;
    }
    console.log("Cached map rect:", gmMapRect);
    drawExistingFogPolygons();
}

function getSvgCoordinates(event) {
    if (!svgOverlay) return null;
    const svgRect = svgOverlay.getBoundingClientRect();
    return {
        x: event.clientX - svgRect.left,
        y: event.clientY - svgRect.top
    };
}

function svgToRelativeCoords(svgPoint) {
    if (!gmMapRect || gmMapRect.width === 0 || gmMapRect.height === 0 || !gmMapDisplayRect) return null;
    const imageOffsetX = gmMapRect.left - gmMapDisplayRect.left;
    const imageOffsetY = gmMapRect.top - gmMapDisplayRect.top;
    const imageX = svgPoint.x - imageOffsetX;
    const imageY = svgPoint.y - imageOffsetY;
    const clampedX = Math.max(0, Math.min(imageX, gmMapRect.width));
    const clampedY = Math.max(0, Math.min(imageY, gmMapRect.height));
    return {
        x: clampedX / gmMapRect.width,
        y: clampedY / gmMapRect.height
    };
}

function relativeToSvgCoords(relativePoint) {
    if (!gmMapRect || gmMapRect.width === 0 || gmMapRect.height === 0 || !gmMapDisplayRect || !relativePoint) return null;
    const imageOffsetX = gmMapRect.left - gmMapDisplayRect.left;
    const imageOffsetY = gmMapRect.top - gmMapDisplayRect.top;
    const imageX = relativePoint.x * gmMapRect.width;
    const imageY = relativePoint.y * gmMapRect.height;
    return {
        x: imageX + imageOffsetX,
        y: imageY + imageOffsetY
    };
}

// --- State Updates & Saving (Unchanged) ---
function sendUpdate(updateData) {
    console.log("Sending update:", JSON.stringify(updateData));
    const validIdRegex = /^[a-zA-Z0-9_-]{1,50}$/;
    if (!currentSessionId || !validIdRegex.test(currentSessionId)) {
        console.error("Invalid session ID.");
        return;
    }
    if (!socket || !socket.connected) {
        console.warn("WS disconnected.");
        return;
    }
    const payload = {
        session_id: currentSessionId,
        update_data: updateData
    };
    try {
        socket.emit('gm_update', payload);
        console.log(" -> 'gm_update' emitted.");
    } catch (e) {
        console.error("Error emitting:", e);
    }
}
async function _saveConfigurationInternal() {
    console.log("Auto-saving...");
    if (!currentMapFilename || !currentState?.map_content_path) {
        console.log(" -> Save SKIPPED.");
        return;
    }
    const expectedPath = `maps/${currentMapFilename}`;
    if (currentState.map_content_path !== expectedPath) {
        console.warn(`Adjusting map_content_path before save.`);
        currentState.map_content_path = expectedPath;
    }
    if (currentState.map_image_path) delete currentState.map_image_path;
    if (currentState.filter_params) {
        for (const filterId in currentState.filter_params) {
            const textParams = ['backgroundImageFilename', 'defaultFontFamily', 'defaultTextSpeed', 'fontSize'];
            textParams.forEach(p => {
                if (currentState.filter_params[filterId]?.[p] !== undefined) delete currentState.filter_params[filterId][p];
            });
        }
    }
    currentState.fog_of_war = currentState.fog_of_war || {
        hidden_polygons: []
    };
    currentState.fog_of_war.hidden_polygons = currentState.fog_of_war.hidden_polygons || [];
    console.log("Saving config:", JSON.stringify(currentState));
    try {
        const r = await fetch(`/api/config/${encodeURIComponent(currentMapFilename)}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(currentState),
        });
        if (!r.ok) {
            const errData = await r.json().catch(() => ({
                error: "Unknown save error"
            }));
            throw new Error(errData.error || `Save failed: ${r.status}`);
        }
        const result = await r.json();
        if (result.success) console.log("Auto-save successful.");
        else throw new Error(result.error || "Save failed");
    } catch (e) {
        console.error('Auto-save error:', e);
        alert(`Error auto-saving: ${e.message}`);
    }
}

function debouncedAutoSave() {
    console.log("Debounced auto-save triggered...");
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
        console.log("Debounce timer expired, saving.");
        _saveConfigurationInternal();
    }, DEBOUNCE_DELAY);
}

// --- Session/Player URL Display (Unchanged) ---
function updatePlayerUrlDisplay() {
    console.log("Updating player URL display...");
    const validIdRegex = /^[a-zA-Z0-9_-]{1,50}$/;
    if (playerUrlDisplay && currentSessionId && validIdRegex.test(currentSessionId)) {
        const playerPath = `/player?session=${encodeURIComponent(currentSessionId)}`;
        const fullUrl = window.location.origin + playerPath;
        playerUrlDisplay.value = fullUrl;
    } else if (playerUrlDisplay) {
        playerUrlDisplay.value = "Enter valid Session ID...";
    }
}

// --- Helpers (Unchanged) ---
function get_default_filter_params() {
    const fp = {};
    for (const f_id in availableFilters) {
        const fc = availableFilters[f_id];
        fp[f_id] = {};
        if (fc?.params) {
            for (const key in fc.params) {
                if (fc.params[key].value !== undefined && key !== 'backgroundImageFilename') fp[f_id][key] = fc.params[key].value;
            }
        }
    }
    return fp;
}

function generateUniqueId() {
    return `poly_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
}

function rgbToHex(r, g, b) {
    r = Math.max(0, Math.min(255, Math.round(r)));
    g = Math.max(0, Math.min(255, Math.round(g)));
    b = Math.max(0, Math.min(255, Math.round(b)));
    const componentToHex = (c) => {
        const hex = c.toString(16);
        return hex.length == 1 ? "0" + hex : hex;
    };
    return "#" + componentToHex(r) + componentToHex(g) + componentToHex(b).toUpperCase();
}