// static/js/gm.js
// Version: 1.77 (SQLite Saves + Auto-load)

// --- Global Variables ---
let lanIp = null;
let lanPort = 5000;
let tunnelUrl = null;
let availableFilters = {};
let mapList = [];
let currentState = {}; // Holds the full state including filters, view, fog
let socket = null;
let currentMapFilename = null;
const DEFAULT_HELP_MAP = "Help.png"; // Define the default map filename

// --- Save/Load State ---
let currentSaveId = null;
let currentSaveName = null;

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

// --- Drag-and-Drop State ---
let isDragging = false;
let dragStartSvgPoint = null;
let dragPolygonOriginalVertices = null;
let dragJustCompleted = false;
const DRAG_THRESHOLD = 5; // px to distinguish click from drag

// --- Vertex Editing State ---
let editingVertexIndex = null;       // Index of vertex being dragged
let editingVertexOriginalPos = null;  // {x, y} for cancel/revert
let svgVertexHandlesLayer = null;

// --- Resize Handle State ---
let resizingCornerIndex = null;      // 0-3 for which corner is being dragged
let resizeOriginalVertices = null;    // deep copy of all vertices before resize
let resizeAnchorCorner = null;       // the fixed opposite corner {x,y} normalized
let resizeShapeType = null;          // shape type of the polygon being resized

// --- Edge Resize Handle State ---
let resizingEdgeIndex = null;       // 0-3 for which edge is being dragged
let edgeResizeBBox = null;          // {minX, minY, maxX, maxY} bounding box during edge drag

// --- Undo/Redo State ---
const fogUndoStack = [];
const fogRedoStack = [];
const FOG_UNDO_MAX = 50;
let pendingUndoSnapshot = null; // holds pre-drag state, committed on mouseup

// --- Shape Tool State ---
let currentShapeTool = null; // null = freehand, or 'circle','ellipse','square','rectangle','triangle'
let shapeAnchorPoint = null; // normalized {x,y} of mousedown
let shapePreviewElement = null; // SVG polygon for live preview

// --- Auto-Save State ---
let debounceTimer = null;
const DEBOUNCE_DELAY = 1500;

// --- Token State ---
let isTokenModeEnabled = false;
let currentTokenLabel = 'A';
let currentTokenColor = '#ff0000';
let tokens = [];
let draggingTokenId = null;
let draggingTokenStartSvg = null;
let svgTokenLayer = null;
let selectedTokenId = null;
let tokenDragOccurred = false;

// --- DOM Elements ---
const filterSelect = document.getElementById('filter-select');
const mapSelect = document.getElementById('map-select');
const gmMapDisplay = document.getElementById('gm-map-display');
const gmMapImage = document.getElementById('gm-map-image');
const gmMapPlaceholder = document.getElementById('gm-map-placeholder');
const filterControlsContainer = document.getElementById('filter-controls');
const mapUploadForm = document.getElementById('map-upload-form');
const mapFileInput = document.getElementById('map-file-input');
const uploadStatus = document.getElementById('upload-status');
const lanPlayerUrlDisplay = document.getElementById('lan-player-url-display');
const tunnelPlayerUrlDisplay = document.getElementById('tunnel-player-url-display');
const copyLanPlayerUrlButton = document.getElementById('copy-lan-player-url');
const copyTunnelPlayerUrlButton = document.getElementById('copy-tunnel-player-url');
const lanCopyStatusDisplay = document.getElementById('lan-copy-status');
const showQrCodeButton = document.getElementById('show-qr-code');
const showQrCodeLanButton = document.getElementById('show-qr-code-lan');
const qrModal = document.getElementById('qr-modal');
const qrModalClose = document.getElementById('qr-modal-close');
const qrCodeContainer = document.getElementById('qr-code-container');
const qrModalUrl = document.getElementById('qr-modal-url');
const viewXInput = document.getElementById('view-center-x');
const viewYInput = document.getElementById('view-center-y');
const viewScaleInput = document.getElementById('view-scale');
const toggleFogDrawingButton = document.getElementById('toggle-fog-drawing-button');
const fogColorPresets = document.getElementById('fog-color-presets');
const fogInteractionPopup = document.getElementById('fog-interaction-popup');
const fogDeleteButton = document.getElementById('fog-delete-button');
const fogColorButton = document.getElementById('fog-color-button');
const fogColorInput = document.getElementById('fog-color-input');
svgOverlay = document.getElementById('gm-svg-overlay');
const shapeToolsContainer = document.getElementById('shape-tools-container');
const mapViewPanel = document.querySelector('.map-view-panel');
const toggleTokenModeButton = document.getElementById('toggle-token-mode-button');
const tokenSettings = document.getElementById('token-settings');
const tokenLabelInput = document.getElementById('token-label-input');
const tokenColorPresets = document.getElementById('token-color-presets');
const tokenInteractionPopup = document.getElementById('token-interaction-popup');
const tokenDeleteButton = document.getElementById('token-delete-button');
const tokenColorButton = document.getElementById('token-color-button');
const tokenColorInput = document.getElementById('token-color-input');
const tunnelStatusDisplay = document.getElementById('tunnel-status');


// --- Initialization ---
document.addEventListener('DOMContentLoaded', async () => {
    console.log("GM View Initializing (v2.0 - Save/Load)...");

    if (!mapViewPanel) { console.error("Failed to get reference to .map-view-panel for popup positioning!"); }
    if (!svgOverlay) svgOverlay = document.getElementById('gm-svg-overlay');
    setupSvgLayers();

    console.log("Loading initial data (Filters and Maps)...");
    try {
        await loadAvailableFilters();
        populateFilterList();
        await populateMapList(); // Populates mapList and mapSelect dropdown

        console.log("Setting up UI, WebSocket, Listeners...");
        fetchLanInfo(); // Fetch and display LAN player URL
        startTunnelPolling(); // Poll for Cloudflare tunnel URL
        connectWebSocket();
        setupEventListeners();

        // Check if a save was auto-loaded on the server
        let saveWasLoaded = false;
        try {
            const saveInfoR = await fetch('/api/saves/current');
            const saveInfo = await saveInfoR.json();
            if (saveInfo.current_save_id) {
                currentSaveId = saveInfo.current_save_id;
                currentSaveName = saveInfo.current_save_name || null;
                // Set map selector to match the save's map
                const saveR = await fetch(`/api/saves/${encodeURIComponent(currentSaveId)}`);
                if (saveR.ok) {
                    const save = await saveR.json();
                    if (!currentSaveName) currentSaveName = save.name;
                    if (save.map_filename && mapSelect) {
                        const opt = Array.from(mapSelect.options).find(o => o.value === save.map_filename);
                        if (opt) {
                            mapSelect.value = save.map_filename;
                            await handleMapSelectionChange({ target: mapSelect });
                        }
                    }
                }
                updateSaveDisplay();
                saveWasLoaded = true;
                console.log(`Auto-loaded save: ${currentSaveId} (${currentSaveName})`);
            }
        } catch (e) { console.warn('Could not fetch current save info:', e); }

        // Only auto-select Help.png if no save was loaded
        if (!saveWasLoaded) {
            console.log(`Checking for default map: ${DEFAULT_HELP_MAP}`);
            const helpMapOption = Array.from(mapSelect.options).find(opt => opt.value === DEFAULT_HELP_MAP);
            if (helpMapOption) {
                console.log(`Default map '${DEFAULT_HELP_MAP}' found. Auto-selecting.`);
                mapSelect.value = DEFAULT_HELP_MAP;
                await handleMapSelectionChange({ target: mapSelect });
            } else {
                console.log(`Default map '${DEFAULT_HELP_MAP}' not found in map list.`);
                resetUI();
            }
        }

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
    svgVertexHandlesLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    svgVertexHandlesLayer.id = 'fog-vertex-handles-layer';
    svgOverlay.appendChild(svgVertexHandlesLayer);
    svgDrawingLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    svgDrawingLayer.id = 'fog-drawing-layer';
    svgOverlay.appendChild(svgDrawingLayer);
    svgTokenLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    svgTokenLayer.id = 'token-layer';
    svgOverlay.appendChild(svgTokenLayer);
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
        // Join the single game room
        socket.emit('join_game');
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
    TokenShared.onTokensUpdate(socket, (newTokens) => {
        tokens = newTokens;
        renderAllTokens();
        console.log(`Tokens updated: ${tokens.length} token(s)`);
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
    // Reset drag/shape/vertex/resize state
    isDragging = false;
    dragStartSvgPoint = null;
    dragPolygonOriginalVertices = null;
    dragJustCompleted = false;
    editingVertexIndex = null;
    editingVertexOriginalPos = null;
    resizingCornerIndex = null;
    resizeOriginalVertices = null;
    resizeAnchorCorner = null;
    resizeShapeType = null;
    currentShapeTool = null;
    shapeAnchorPoint = null;
    // Clear undo/redo stacks
    fogUndoStack.length = 0;
    fogRedoStack.length = 0;
    pendingUndoSnapshot = null;
    cleanupShapePreview();
    if (shapeToolsContainer) shapeToolsContainer.style.display = 'none';
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
    // Reset token state
    isTokenModeEnabled = false;
    draggingTokenId = null;
    draggingTokenStartSvg = null;
    selectedTokenId = null;
    if (tokenInteractionPopup) tokenInteractionPopup.style.display = 'none';
    if (toggleTokenModeButton) {
        toggleTokenModeButton.textContent = 'Enable Token Mode';
        toggleTokenModeButton.disabled = true;
    }
    if (tokenSettings) tokenSettings.style.display = 'none';
    if (svgTokenLayer) svgTokenLayer.innerHTML = '';
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
        if (toggleTokenModeButton) toggleTokenModeButton.disabled = false;

        console.log("Setting up image load handlers...");
        if (gmMapImage) {
            gmMapImage.onload = () => {
                console.log(">>> gmMapImage.onload");
                gmMapImage.style.display = 'block';
                requestAnimationFrame(() => { // Ensure layout is stable
                    try {
                        updateMapAndSvgDimensions();
                        drawExistingFogPolygons();
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
    if (copyLanPlayerUrlButton) copyLanPlayerUrlButton.addEventListener('click', () => copyUrlToClipboard(lanPlayerUrlDisplay));
    if (copyTunnelPlayerUrlButton) copyTunnelPlayerUrlButton.addEventListener('click', () => copyUrlToClipboard(tunnelPlayerUrlDisplay));
    if (showQrCodeButton) showQrCodeButton.addEventListener('click', () => openQrModal('tunnel'));
    if (showQrCodeLanButton) showQrCodeLanButton.addEventListener('click', () => openQrModal('lan'));
    if (qrModalClose) qrModalClose.addEventListener('click', closeQrModal);
    if (qrModal) qrModal.addEventListener('click', function(e) { if (e.target === qrModal) closeQrModal(); });
    if (toggleFogDrawingButton) toggleFogDrawingButton.addEventListener('click', handleToggleFogDrawing);
    else console.error("toggleFogDrawingButton missing!");
    if (svgOverlay) {
        svgOverlay.addEventListener('click', handleSvgClick);
        svgOverlay.addEventListener('mousemove', handleSvgMouseMove);
        svgOverlay.addEventListener('mousedown', handleSvgMouseDown);
        svgOverlay.addEventListener('mouseup', handleSvgMouseUp);
    } else console.error("svgOverlay missing!");
    // Shape tool buttons
    if (shapeToolsContainer) {
        shapeToolsContainer.querySelectorAll('.shape-tool-btn').forEach(btn => {
            btn.addEventListener('click', handleShapeToolSelect);
        });
    }
    document.addEventListener('keydown', handleKeyDown);
    if (fogDeleteButton) fogDeleteButton.addEventListener('click', handleDeletePolygon);
    else console.error("fogDeleteButton missing!");
    setupFogColorPicker();
    setupFogColorSwatches();
    window.addEventListener('resize', updateMapAndSvgDimensions);
    // Token event listeners
    if (toggleTokenModeButton) toggleTokenModeButton.addEventListener('click', handleToggleTokenMode);
    setupTokenColorSwatches();
    setupTokenLabelInput();
    if (svgOverlay) svgOverlay.addEventListener('contextmenu', (e) => {
        if (e.target.closest('.token-group')) e.preventDefault();
    });
    setupTokenContextPopupGM();
    // Save/Load modal
    const openSaveModalBtn = document.getElementById('open-save-modal-btn');
    if (openSaveModalBtn) openSaveModalBtn.addEventListener('click', openSaveLoadModal);
    const saveModalClose = document.getElementById('save-modal-close');
    if (saveModalClose) saveModalClose.addEventListener('click', closeSaveLoadModal);
    const saveModal = document.getElementById('save-modal');
    if (saveModal) saveModal.addEventListener('click', function(e) { if (e.target === saveModal) closeSaveLoadModal(); });
    const saveCreateBtn = document.getElementById('save-create-btn');
    const saveNameInput = document.getElementById('save-name-input');
    if (saveCreateBtn && saveNameInput) {
        saveCreateBtn.addEventListener('click', () => createNewSave(saveNameInput.value));
        saveNameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') createNewSave(saveNameInput.value); });
    }
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

// --- Fog of War Handlers ---

// Toggle Logic (Unchanged)
function handleToggleFogDrawing() {
    // Disable token mode if active (mutual exclusion)
    if (isTokenModeEnabled) {
        isTokenModeEnabled = false;
        if (toggleTokenModeButton) toggleTokenModeButton.textContent = 'Enable Token Mode';
        if (tokenSettings) tokenSettings.style.display = 'none';
    }
    isDrawingFogEnabled = !isDrawingFogEnabled;
    if (isDrawingFogEnabled) {
        if (currentInteractionMode === 'polygon_selected') {
            deselectPolygon();
        }
        setInteractionMode('drawing_enabled');
        // Show shape tools (preserve selected shape)
        if (shapeToolsContainer) shapeToolsContainer.style.display = 'flex';
    } else {
        if (currentInteractionMode === 'drawing_polygon') {
            cancelCurrentPolygon();
        }
        if (currentInteractionMode === 'drawing_shape') {
            cancelCurrentShape();
        }
        setInteractionMode('idle');
        // Hide shape tools (preserve selected shape)
        if (shapeToolsContainer) shapeToolsContainer.style.display = 'none';
    }
}
// Interaction Mode Setter (Unchanged)
function setInteractionMode(mode) {
    if (currentInteractionMode === mode) return;
    console.log(`Switching Mode: ${currentInteractionMode} -> ${mode}`);
    currentInteractionMode = mode;
    svgOverlay.classList.remove('drawing-active', 'dragging-active');
    if (fogInteractionPopup) fogInteractionPopup.style.display = 'none';
    if (tokenInteractionPopup) tokenInteractionPopup.style.display = 'none';
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
        case 'drawing_shape':
            isDrawingFogEnabled = true;
            svgOverlay.classList.add('drawing-active');
            break;
        case 'dragging_polygon':
            svgOverlay.classList.add('drawing-active', 'dragging-active');
            break;
        case 'polygon_selected':
            isDrawingFogEnabled = false;
            if (toggleFogDrawingButton) toggleFogDrawingButton.textContent = "Draw New Polygons";
            svgOverlay.classList.add('drawing-active');
            break;
        case 'editing_vertex':
            svgOverlay.classList.add('drawing-active', 'dragging-active');
            break;
        case 'token_placing':
            svgOverlay.classList.add('drawing-active');
            break;
        case 'token_dragging':
            svgOverlay.classList.add('drawing-active', 'dragging-active');
            break;
        case 'token_selected':
            svgOverlay.classList.add('drawing-active');
            break;
    }
}
// KeyDown Handler (Unchanged)
function handleKeyDown(event) {
    switch (event.key) {
        case 'Escape':
            if (currentInteractionMode === 'editing_vertex') {
                // Check if we're edge-resizing, corner-resizing, or vertex-editing
                if (resizingEdgeIndex !== null) cancelEdgeDrag();
                else if (resizingCornerIndex !== null) cancelResizeDrag();
                else cancelVertexDrag();
            }
            else if (currentInteractionMode === 'dragging_polygon') cancelDrag();
            else if (currentInteractionMode === 'drawing_shape') cancelCurrentShape();
            else if (currentInteractionMode === 'drawing_polygon') cancelCurrentPolygon();
            else if (currentInteractionMode === 'polygon_selected') deselectPolygon();
            else if (currentInteractionMode === 'token_selected') deselectToken();
            break;
        case 'Delete':
        case 'Backspace':
            if (currentInteractionMode === 'polygon_selected' && selectedPolygonId) handleDeletePolygon();
            if (currentInteractionMode === 'token_selected' && selectedTokenId) handleDeleteToken();
            break;
        case 'z':
        case 'Z':
            if (event.ctrlKey && !event.shiftKey) {
                event.preventDefault();
                fogUndo();
            } else if (event.ctrlKey && event.shiftKey) {
                event.preventDefault();
                fogRedo();
            }
            break;
        case 'y':
        case 'Y':
            if (event.ctrlKey) {
                event.preventDefault();
                fogRedo();
            }
            break;
        case 's':
        case 'S':
            if (event.ctrlKey) {
                event.preventDefault();
                if (currentSaveId) {
                    quickSave();
                } else {
                    openSaveLoadModal();
                }
            }
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
    console.log(`handleSvgClick called — mode: ${currentInteractionMode}, mapFile: ${!!currentMapFilename}, gmMapRect: ${!!gmMapRect}`);
    if (!currentMapFilename || !gmMapRect) return;
    // Guard: if a drag just completed, the click event fires right after mouseup — skip it
    if (dragJustCompleted) {
        dragJustCompleted = false;
        return;
    }
    const target = event.target;

    // --- Token placing: place a token on click (unless clicking an existing token) ---
    if (currentInteractionMode === 'token_placing' && !target.closest('.token-group')) {
        const svgPoint = getSvgCoordinates(event);
        if (!svgPoint) { console.warn("Token place: getSvgCoordinates returned null"); return; }
        const relPoint = svgToRelativeCoords(svgPoint);
        if (!relPoint) { console.warn("Token place: svgToRelativeCoords returned null"); return; }
        console.log(`Placing token '${currentTokenLabel}' at (${relPoint.x.toFixed(3)}, ${relPoint.y.toFixed(3)})`);
        TokenShared.emitTokenPlace(socket, currentTokenLabel, currentTokenColor, relPoint.x, relPoint.y);
        return;
    }

    // Skip click if it's on a vertex/resize handle (handled by mousedown)
    if (target.closest('.fog-vertex-handle') || target.closest('.fog-resize-handle') || target.closest('.fog-edge-handle')) return;
    const clickedOnPolygonElement = target.closest('.fog-polygon-complete');
    console.log(`SVG Click - Mode: ${currentInteractionMode}, Target:`, target);
    switch (currentInteractionMode) {
        case 'token_selected':
            if (!target.closest('.token-group') && !target.closest('#token-interaction-popup')) deselectToken();
            return;
        case 'polygon_selected':
            if (!clickedOnPolygonElement && !target.closest('#fog-interaction-popup')) deselectPolygon();
            else if (clickedOnPolygonElement && clickedOnPolygonElement.dataset.polygonId !== selectedPolygonId) handlePolygonSelect(event);
            break;
        case 'idle':
            if (clickedOnPolygonElement) handlePolygonSelect(event);
            break;
        case 'drawing_enabled':
            if (clickedOnPolygonElement) handlePolygonSelect(event);
            else if (!currentShapeTool) startOrContinueDrawing(event); // freehand only when no shape tool
            break;
        case 'drawing_polygon':
            startOrContinueDrawing(event);
            break;
        // drawing_shape and dragging_polygon are handled via mousedown/mouseup, not click
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
    // Shape drawing preview is handled in handleDocumentMouseMoveShape
    // Drag is handled in handleDocumentMouseMoveDrag
}

// --- Drag-and-Drop Handlers ---

function handleSvgMouseDown(event) {
    if (!currentMapFilename || !gmMapRect) return;
    const target = event.target;

    // --- Token drag: start dragging a token ---
    const clickedTokenGroup = target.closest('.token-group');
    if (clickedTokenGroup) {
        event.preventDefault();
        const tokenId = clickedTokenGroup.dataset.tokenId;
        if (!tokenId) return;
        draggingTokenId = tokenId;
        tokenDragOccurred = false;
        const svgPoint = getSvgCoordinates(event);
        draggingTokenStartSvg = svgPoint;
        setInteractionMode('token_dragging');
        document.addEventListener('mousemove', handleDocumentMouseMoveToken);
        document.addEventListener('mouseup', handleDocumentMouseUpToken);
        return;
    }

    // --- Vertex handle: start vertex drag ---
    const clickedVertexHandle = target.closest('.fog-vertex-handle');
    if (clickedVertexHandle && selectedPolygonId && currentInteractionMode === 'polygon_selected') {
        event.preventDefault();
        const vertexIndex = parseInt(clickedVertexHandle.dataset.vertexIndex, 10);
        if (!isNaN(vertexIndex)) {
            startVertexDrag(event, vertexIndex);
            return;
        }
    }

    // --- Resize handle: start resize drag ---
    const clickedResizeHandle = target.closest('.fog-resize-handle');
    if (clickedResizeHandle && selectedPolygonId && currentInteractionMode === 'polygon_selected') {
        event.preventDefault();
        const cornerIndex = parseInt(clickedResizeHandle.dataset.cornerIndex, 10);
        if (!isNaN(cornerIndex)) {
            startResizeDrag(event, cornerIndex);
            return;
        }
    }

    // --- Edge handle: start edge drag ---
    const clickedEdgeHandle = target.closest('.fog-edge-handle');
    if (clickedEdgeHandle && selectedPolygonId && currentInteractionMode === 'polygon_selected') {
        event.preventDefault();
        const edgeIndex = parseInt(clickedEdgeHandle.dataset.edgeIndex, 10);
        if (!isNaN(edgeIndex)) {
            startEdgeDrag(event, edgeIndex);
            return;
        }
    }

    const clickedPolygon = target.closest('.fog-polygon-complete');

    // --- Shape tool: start drawing shape ---
    if (currentShapeTool && (currentInteractionMode === 'drawing_enabled') && !clickedPolygon) {
        event.preventDefault();
        const svgPoint = getSvgCoordinates(event);
        if (!svgPoint) return;
        shapeAnchorPoint = svgToRelativeCoords(svgPoint);
        if (!shapeAnchorPoint) return;
        setInteractionMode('drawing_shape');
        // Create preview element
        shapePreviewElement = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
        shapePreviewElement.setAttribute('class', 'fog-shape-preview');
        svgDrawingLayer.appendChild(shapePreviewElement);
        // Attach document-level listeners for shape drawing
        document.addEventListener('mousemove', handleDocumentMouseMoveShape);
        document.addEventListener('mouseup', handleDocumentMouseUpShape);
        return;
    }

    // --- Drag: start potential drag on a completed polygon ---
    if (clickedPolygon && currentInteractionMode !== 'drawing_polygon' && currentInteractionMode !== 'drawing_shape') {
        event.preventDefault();
        const polygonId = clickedPolygon.dataset.polygonId;
        const polygonData = currentState?.fog_of_war?.hidden_polygons?.find(p => p.id === polygonId);
        if (!polygonData) return;

        const svgPoint = getSvgCoordinates(event);
        if (!svgPoint) return;

        isDragging = false; // not yet — waiting for threshold
        dragStartSvgPoint = svgPoint;
        dragPolygonOriginalVertices = polygonData.vertices.map(v => ({ x: v.x, y: v.y }));

        // Select this polygon
        deselectPolygon(false);
        selectedPolygonId = polygonId;
        clickedPolygon.classList.add('fog-polygon-selected');

        // Attach document-level listeners
        document.addEventListener('mousemove', handleDocumentMouseMoveDrag);
        document.addEventListener('mouseup', handleDocumentMouseUpDrag);
    }
}

function handleSvgMouseUp(event) {
    // Most mouseup logic is handled by the document-level listeners
}

// --- Drag document-level handlers ---

function handleDocumentMouseMoveDrag(event) {
    if (!selectedPolygonId || !dragStartSvgPoint) return;
    const svgRect = svgOverlay.getBoundingClientRect();
    const currentSvgPoint = {
        x: event.clientX - svgRect.left,
        y: event.clientY - svgRect.top
    };

    const dx = currentSvgPoint.x - dragStartSvgPoint.x;
    const dy = currentSvgPoint.y - dragStartSvgPoint.y;

    if (!isDragging) {
        // Check threshold
        if (Math.sqrt(dx * dx + dy * dy) < DRAG_THRESHOLD) return;
        isDragging = true;
        capturePendingUndo();
        setInteractionMode('dragging_polygon');
    }

    // Translate vertices: compute delta in normalized coords
    const polygonData = currentState?.fog_of_war?.hidden_polygons?.find(p => p.id === selectedPolygonId);
    if (!polygonData || !dragPolygonOriginalVertices) return;

    // Convert pixel delta to normalized delta
    const imageOffsetX = gmMapRect.left - gmMapDisplayRect.left;
    const imageOffsetY = gmMapRect.top - gmMapDisplayRect.top;
    const normDx = dx / gmMapRect.width;
    const normDy = dy / gmMapRect.height;

    for (let i = 0; i < polygonData.vertices.length; i++) {
        polygonData.vertices[i].x = dragPolygonOriginalVertices[i].x + normDx;
        polygonData.vertices[i].y = dragPolygonOriginalVertices[i].y + normDy;
    }

    updatePolygonSvgPosition(polygonData);
}

function handleDocumentMouseUpDrag(event) {
    document.removeEventListener('mousemove', handleDocumentMouseMoveDrag);
    document.removeEventListener('mouseup', handleDocumentMouseUpDrag);

    if (isDragging && selectedPolygonId) {
        // Clamp all vertices to [0,1]
        const polygonData = currentState?.fog_of_war?.hidden_polygons?.find(p => p.id === selectedPolygonId);
        if (polygonData) {
            polygonData.vertices.forEach(v => {
                v.x = clampNorm(v.x);
                v.y = clampNorm(v.y);
            });
            updatePolygonSvgPosition(polygonData);
        }

        // Send update
        commitPendingUndo();
        sendUpdate({ fog_of_war: currentState.fog_of_war });
        debouncedAutoSave();
        console.log("Polygon drag completed.");

        dragJustCompleted = true;
        isDragging = false;
        dragStartSvgPoint = null;
        dragPolygonOriginalVertices = null;

        // Go to polygon_selected mode
        setInteractionMode('polygon_selected');
        // Refresh vertex handles after drag
        if (polygonData) showVertexHandles(polygonData);
    } else {
        // Was not a real drag (below threshold) — treat as a select click
        isDragging = false;
        dragStartSvgPoint = null;
        dragPolygonOriginalVertices = null;

        if (selectedPolygonId) {
            setInteractionMode('polygon_selected');
            showInteractionPopup(event);
            // Show vertex handles for the selected polygon
            const selData = currentState?.fog_of_war?.hidden_polygons?.find(p => p.id === selectedPolygonId);
            if (selData) showVertexHandles(selData);
        }
    }
}

function cancelDrag() {
    if (!isDragging || !selectedPolygonId || !dragPolygonOriginalVertices) return;
    // Revert vertices
    const polygonData = currentState?.fog_of_war?.hidden_polygons?.find(p => p.id === selectedPolygonId);
    if (polygonData) {
        for (let i = 0; i < polygonData.vertices.length; i++) {
            polygonData.vertices[i].x = dragPolygonOriginalVertices[i].x;
            polygonData.vertices[i].y = dragPolygonOriginalVertices[i].y;
        }
        updatePolygonSvgPosition(polygonData);
    }

    document.removeEventListener('mousemove', handleDocumentMouseMoveDrag);
    document.removeEventListener('mouseup', handleDocumentMouseUpDrag);
    isDragging = false;
    dragStartSvgPoint = null;
    dragPolygonOriginalVertices = null;
    discardPendingUndo();
    deselectPolygon();
    console.log("Drag cancelled.");
}

function updatePolygonSvgPosition(polygonData) {
    if (!svgCompletedLayer || !polygonData) return;
    const el = svgCompletedLayer.querySelector(`.fog-polygon-complete[data-polygon-id="${polygonData.id}"]`);
    if (!el) return;
    const points = polygonData.vertices.map(p => {
        const svgP = relativeToSvgCoords(p);
        return svgP ? `${svgP.x},${svgP.y}` : null;
    }).filter(p => p !== null).join(' ');
    el.setAttribute('points', points);
}

// --- Vertex Editing Handlers ---

function showVertexHandles(polygonData) {
    hideVertexHandles();
    if (!svgVertexHandlesLayer || !polygonData?.vertices) return;
    // For circles/ellipses, show 4 resize handles instead of 48 vertex handles
    if (polygonData.shapeType === 'circle' || polygonData.shapeType === 'ellipse') {
        showResizeHandles(polygonData);
        return;
    }
    // For squares/rectangles, show corner + edge midpoint handles (Figma-style)
    if (polygonData.shapeType === 'square' || polygonData.shapeType === 'rectangle') {
        showResizeHandles(polygonData);
        showEdgeHandles(polygonData);
        return;
    }
    polygonData.vertices.forEach((vertex, i) => {
        const svgP = relativeToSvgCoords(vertex);
        if (!svgP) return;
        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('cx', svgP.x);
        circle.setAttribute('cy', svgP.y);
        circle.setAttribute('r', 6);
        circle.setAttribute('class', 'fog-vertex-handle');
        circle.dataset.vertexIndex = i;
        svgVertexHandlesLayer.appendChild(circle);
    });
}

function showResizeHandles(polygonData) {
    if (!svgVertexHandlesLayer || !polygonData?.vertices || polygonData.vertices.length === 0) return;
    // Compute bounding box from vertices
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    polygonData.vertices.forEach(v => {
        if (v.x < minX) minX = v.x;
        if (v.y < minY) minY = v.y;
        if (v.x > maxX) maxX = v.x;
        if (v.y > maxY) maxY = v.y;
    });
    const corners = [
        { x: minX, y: minY },  // top-left (0)
        { x: maxX, y: minY },  // top-right (1)
        { x: maxX, y: maxY },  // bottom-right (2)
        { x: minX, y: maxY },  // bottom-left (3)
    ];
    const cursors = ['nwse-resize', 'nesw-resize', 'nwse-resize', 'nesw-resize'];
    corners.forEach((corner, i) => {
        const svgP = relativeToSvgCoords(corner);
        if (!svgP) return;
        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('cx', svgP.x);
        circle.setAttribute('cy', svgP.y);
        circle.setAttribute('r', 7);
        circle.setAttribute('class', 'fog-resize-handle');
        circle.dataset.cornerIndex = i;
        circle.style.cursor = cursors[i];
        svgVertexHandlesLayer.appendChild(circle);
    });
}

function showEdgeHandles(polygonData) {
    if (!svgVertexHandlesLayer || !polygonData?.vertices || polygonData.vertices.length === 0) return;
    // Compute bounding box from vertices
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    polygonData.vertices.forEach(v => {
        if (v.x < minX) minX = v.x;
        if (v.y < minY) minY = v.y;
        if (v.x > maxX) maxX = v.x;
        if (v.y > maxY) maxY = v.y;
    });
    // 4 edge midpoints: top, right, bottom, left
    const edges = [
        { x: (minX + maxX) / 2, y: minY,               cursor: 'ns-resize'  },  // 0: top
        { x: maxX,               y: (minY + maxY) / 2,  cursor: 'ew-resize'  },  // 1: right
        { x: (minX + maxX) / 2, y: maxY,               cursor: 'ns-resize'  },  // 2: bottom
        { x: minX,               y: (minY + maxY) / 2,  cursor: 'ew-resize'  },  // 3: left
    ];
    edges.forEach((edge, i) => {
        const svgP = relativeToSvgCoords(edge);
        if (!svgP) return;
        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('cx', svgP.x);
        circle.setAttribute('cy', svgP.y);
        circle.setAttribute('r', 7);
        circle.setAttribute('class', 'fog-edge-handle');
        circle.dataset.edgeIndex = i;
        circle.style.cursor = edge.cursor;
        svgVertexHandlesLayer.appendChild(circle);
    });
}

function hideVertexHandles() {
    if (svgVertexHandlesLayer) svgVertexHandlesLayer.innerHTML = '';
}

function startVertexDrag(event, vertexIndex) {
    const polygonData = currentState?.fog_of_war?.hidden_polygons?.find(p => p.id === selectedPolygonId);
    if (!polygonData || vertexIndex < 0 || vertexIndex >= polygonData.vertices.length) return;

    editingVertexIndex = vertexIndex;
    editingVertexOriginalPos = { x: polygonData.vertices[vertexIndex].x, y: polygonData.vertices[vertexIndex].y };
    capturePendingUndo();
    setInteractionMode('editing_vertex');

    document.addEventListener('mousemove', handleDocumentMouseMoveVertex);
    document.addEventListener('mouseup', handleDocumentMouseUpVertex);
}

function handleDocumentMouseMoveVertex(event) {
    if (editingVertexIndex === null || !selectedPolygonId) return;
    const polygonData = currentState?.fog_of_war?.hidden_polygons?.find(p => p.id === selectedPolygonId);
    if (!polygonData) return;

    const svgRect = svgOverlay.getBoundingClientRect();
    const svgPoint = {
        x: event.clientX - svgRect.left,
        y: event.clientY - svgRect.top
    };
    const relPoint = svgToRelativeCoords(svgPoint);
    if (!relPoint) return;

    // Clamp to [0,1]
    relPoint.x = clampNorm(relPoint.x);
    relPoint.y = clampNorm(relPoint.y);

    // Update the vertex position
    polygonData.vertices[editingVertexIndex].x = relPoint.x;
    polygonData.vertices[editingVertexIndex].y = relPoint.y;

    // Update polygon SVG
    updatePolygonSvgPosition(polygonData);

    // Update just this vertex handle position
    const handle = svgVertexHandlesLayer?.querySelector(`.fog-vertex-handle[data-vertex-index="${editingVertexIndex}"]`);
    if (handle) {
        const svgP = relativeToSvgCoords(relPoint);
        if (svgP) {
            handle.setAttribute('cx', svgP.x);
            handle.setAttribute('cy', svgP.y);
        }
    }
}

function handleDocumentMouseUpVertex(event) {
    document.removeEventListener('mousemove', handleDocumentMouseMoveVertex);
    document.removeEventListener('mouseup', handleDocumentMouseUpVertex);

    if (editingVertexIndex !== null && selectedPolygonId) {
        // Finalize: clamp vertex
        const polygonData = currentState?.fog_of_war?.hidden_polygons?.find(p => p.id === selectedPolygonId);
        if (polygonData && editingVertexIndex < polygonData.vertices.length) {
            polygonData.vertices[editingVertexIndex].x = clampNorm(polygonData.vertices[editingVertexIndex].x);
            polygonData.vertices[editingVertexIndex].y = clampNorm(polygonData.vertices[editingVertexIndex].y);
            updatePolygonSvgPosition(polygonData);
        }

        commitPendingUndo();
        sendUpdate({ fog_of_war: currentState.fog_of_war });
        debouncedAutoSave();
        console.log("Vertex drag completed.");

        editingVertexIndex = null;
        editingVertexOriginalPos = null;

        setInteractionMode('polygon_selected');
        // Refresh all vertex handle positions
        if (polygonData) showVertexHandles(polygonData);
    } else {
        editingVertexIndex = null;
        editingVertexOriginalPos = null;
        setInteractionMode('polygon_selected');
    }

    dragJustCompleted = true;
}

function cancelVertexDrag() {
    if (editingVertexIndex === null || !selectedPolygonId || !editingVertexOriginalPos) {
        editingVertexIndex = null;
        editingVertexOriginalPos = null;
        return;
    }

    // Revert vertex to original position
    const polygonData = currentState?.fog_of_war?.hidden_polygons?.find(p => p.id === selectedPolygonId);
    if (polygonData && editingVertexIndex < polygonData.vertices.length) {
        polygonData.vertices[editingVertexIndex].x = editingVertexOriginalPos.x;
        polygonData.vertices[editingVertexIndex].y = editingVertexOriginalPos.y;
        updatePolygonSvgPosition(polygonData);
    }

    document.removeEventListener('mousemove', handleDocumentMouseMoveVertex);
    document.removeEventListener('mouseup', handleDocumentMouseUpVertex);

    editingVertexIndex = null;
    editingVertexOriginalPos = null;
    discardPendingUndo();

    setInteractionMode('polygon_selected');
    if (polygonData) showVertexHandles(polygonData);
    console.log("Vertex drag cancelled.");
}

// --- Resize Drag Handlers ---

function startResizeDrag(event, cornerIndex) {
    const polygonData = currentState?.fog_of_war?.hidden_polygons?.find(p => p.id === selectedPolygonId);
    if (!polygonData || !polygonData.shapeType) return;

    resizingCornerIndex = cornerIndex;
    resizeOriginalVertices = polygonData.vertices.map(v => ({ x: v.x, y: v.y }));
    resizeShapeType = polygonData.shapeType;
    capturePendingUndo();

    // Compute bounding box to find anchor (opposite corner)
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    polygonData.vertices.forEach(v => {
        if (v.x < minX) minX = v.x;
        if (v.y < minY) minY = v.y;
        if (v.x > maxX) maxX = v.x;
        if (v.y > maxY) maxY = v.y;
    });
    const corners = [
        { x: minX, y: minY },  // 0: top-left
        { x: maxX, y: minY },  // 1: top-right
        { x: maxX, y: maxY },  // 2: bottom-right
        { x: minX, y: maxY },  // 3: bottom-left
    ];
    // Opposite corner index: 0<->2, 1<->3
    const oppositeIndex = (cornerIndex + 2) % 4;
    resizeAnchorCorner = corners[oppositeIndex];

    setInteractionMode('editing_vertex');

    document.addEventListener('mousemove', handleDocumentMouseMoveResize);
    document.addEventListener('mouseup', handleDocumentMouseUpResize);
}

function handleDocumentMouseMoveResize(event) {
    if (resizingCornerIndex === null || !selectedPolygonId || !resizeAnchorCorner) return;
    const polygonData = currentState?.fog_of_war?.hidden_polygons?.find(p => p.id === selectedPolygonId);
    if (!polygonData) return;

    const svgRect = svgOverlay.getBoundingClientRect();
    const currentSvgPoint = {
        x: event.clientX - svgRect.left,
        y: event.clientY - svgRect.top
    };
    const currentNorm = svgToRelativeCoords(currentSvgPoint);
    if (!currentNorm) return;

    // Regenerate shape vertices using anchor and current mouse as two corners
    const newVertices = generateShapeVertices(resizeShapeType, resizeAnchorCorner, currentNorm);
    if (!newVertices || newVertices.length < 3) return;

    // Clamp and update
    newVertices.forEach(v => {
        v.x = clampNorm(v.x);
        v.y = clampNorm(v.y);
    });

    polygonData.vertices = newVertices;
    updatePolygonSvgPosition(polygonData);

    // Update resize handle positions
    hideVertexHandles();
    showResizeHandles(polygonData);
}

function handleDocumentMouseUpResize(event) {
    document.removeEventListener('mousemove', handleDocumentMouseMoveResize);
    document.removeEventListener('mouseup', handleDocumentMouseUpResize);

    if (resizingCornerIndex !== null && selectedPolygonId) {
        const polygonData = currentState?.fog_of_war?.hidden_polygons?.find(p => p.id === selectedPolygonId);
        if (polygonData) {
            polygonData.vertices.forEach(v => {
                v.x = clampNorm(v.x);
                v.y = clampNorm(v.y);
            });
            updatePolygonSvgPosition(polygonData);
        }

        commitPendingUndo();
        sendUpdate({ fog_of_war: currentState.fog_of_war });
        debouncedAutoSave();
        console.log("Resize drag completed.");

        resizingCornerIndex = null;
        resizeOriginalVertices = null;
        resizeAnchorCorner = null;
        resizeShapeType = null;

        setInteractionMode('polygon_selected');
        if (polygonData) showVertexHandles(polygonData);
    } else {
        resizingCornerIndex = null;
        resizeOriginalVertices = null;
        resizeAnchorCorner = null;
        resizeShapeType = null;
        setInteractionMode('polygon_selected');
    }

    dragJustCompleted = true;
}

function cancelResizeDrag() {
    if (resizingCornerIndex === null || !selectedPolygonId || !resizeOriginalVertices) {
        resizingCornerIndex = null;
        resizeOriginalVertices = null;
        resizeAnchorCorner = null;
        resizeShapeType = null;
        return;
    }

    // Revert vertices to original
    const polygonData = currentState?.fog_of_war?.hidden_polygons?.find(p => p.id === selectedPolygonId);
    if (polygonData) {
        polygonData.vertices = resizeOriginalVertices.map(v => ({ x: v.x, y: v.y }));
        updatePolygonSvgPosition(polygonData);
    }

    document.removeEventListener('mousemove', handleDocumentMouseMoveResize);
    document.removeEventListener('mouseup', handleDocumentMouseUpResize);

    resizingCornerIndex = null;
    resizeOriginalVertices = null;
    resizeAnchorCorner = null;
    resizeShapeType = null;
    discardPendingUndo();

    setInteractionMode('polygon_selected');
    if (polygonData) showVertexHandles(polygonData);
    console.log("Resize drag cancelled.");
}

// --- Edge Resize Drag Handlers ---

function startEdgeDrag(event, edgeIndex) {
    const polygonData = currentState?.fog_of_war?.hidden_polygons?.find(p => p.id === selectedPolygonId);
    if (!polygonData) return;

    resizingEdgeIndex = edgeIndex;
    resizeOriginalVertices = polygonData.vertices.map(v => ({ x: v.x, y: v.y }));

    // Compute bounding box
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    polygonData.vertices.forEach(v => {
        if (v.x < minX) minX = v.x;
        if (v.y < minY) minY = v.y;
        if (v.x > maxX) maxX = v.x;
        if (v.y > maxY) maxY = v.y;
    });
    edgeResizeBBox = { minX, minY, maxX, maxY };

    capturePendingUndo();
    setInteractionMode('editing_vertex');

    document.addEventListener('mousemove', handleDocumentMouseMoveEdge);
    document.addEventListener('mouseup', handleDocumentMouseUpEdge);
}

function handleDocumentMouseMoveEdge(event) {
    if (resizingEdgeIndex === null || !selectedPolygonId || !edgeResizeBBox) return;
    const polygonData = currentState?.fog_of_war?.hidden_polygons?.find(p => p.id === selectedPolygonId);
    if (!polygonData) return;

    const svgRect = svgOverlay.getBoundingClientRect();
    const currentSvgPoint = {
        x: event.clientX - svgRect.left,
        y: event.clientY - svgRect.top
    };
    const currentNorm = svgToRelativeCoords(currentSvgPoint);
    if (!currentNorm) return;

    // Adjust the appropriate edge of the bounding box
    let { minX, minY, maxX, maxY } = edgeResizeBBox;
    switch (resizingEdgeIndex) {
        case 0: minY = currentNorm.y; break;  // top
        case 1: maxX = currentNorm.x; break;  // right
        case 2: maxY = currentNorm.y; break;  // bottom
        case 3: minX = currentNorm.x; break;  // left
    }

    // Regenerate 4 vertices from adjusted bounding box, clamped to [0,1]
    const newVertices = [
        { x: clampNorm(minX), y: clampNorm(minY) },
        { x: clampNorm(maxX), y: clampNorm(minY) },
        { x: clampNorm(maxX), y: clampNorm(maxY) },
        { x: clampNorm(minX), y: clampNorm(maxY) },
    ];

    polygonData.vertices = newVertices;
    updatePolygonSvgPosition(polygonData);

    // Refresh edge handles
    hideVertexHandles();
    showEdgeHandles(polygonData);
}

function handleDocumentMouseUpEdge(event) {
    document.removeEventListener('mousemove', handleDocumentMouseMoveEdge);
    document.removeEventListener('mouseup', handleDocumentMouseUpEdge);

    if (resizingEdgeIndex !== null && selectedPolygonId) {
        const polygonData = currentState?.fog_of_war?.hidden_polygons?.find(p => p.id === selectedPolygonId);
        if (polygonData) {
            polygonData.vertices.forEach(v => {
                v.x = clampNorm(v.x);
                v.y = clampNorm(v.y);
            });
            updatePolygonSvgPosition(polygonData);
        }

        commitPendingUndo();
        sendUpdate({ fog_of_war: currentState.fog_of_war });
        debouncedAutoSave();
        console.log("Edge resize drag completed.");

        resizingEdgeIndex = null;
        resizeOriginalVertices = null;
        edgeResizeBBox = null;

        setInteractionMode('polygon_selected');
        if (polygonData) showVertexHandles(polygonData);
    } else {
        resizingEdgeIndex = null;
        resizeOriginalVertices = null;
        edgeResizeBBox = null;
        setInteractionMode('polygon_selected');
    }

    dragJustCompleted = true;
}

function cancelEdgeDrag() {
    if (resizingEdgeIndex === null || !selectedPolygonId || !resizeOriginalVertices) {
        resizingEdgeIndex = null;
        resizeOriginalVertices = null;
        edgeResizeBBox = null;
        return;
    }

    // Revert vertices to original
    const polygonData = currentState?.fog_of_war?.hidden_polygons?.find(p => p.id === selectedPolygonId);
    if (polygonData) {
        polygonData.vertices = resizeOriginalVertices.map(v => ({ x: v.x, y: v.y }));
        updatePolygonSvgPosition(polygonData);
    }

    document.removeEventListener('mousemove', handleDocumentMouseMoveEdge);
    document.removeEventListener('mouseup', handleDocumentMouseUpEdge);

    resizingEdgeIndex = null;
    resizeOriginalVertices = null;
    edgeResizeBBox = null;
    discardPendingUndo();

    setInteractionMode('polygon_selected');
    if (polygonData) showVertexHandles(polygonData);
    console.log("Edge resize drag cancelled.");
}

// --- Shape Tool Handlers ---

function handleShapeToolSelect(event) {
    const btn = event.target.closest('.shape-tool-btn');
    if (!btn) return;
    const shape = btn.dataset.shape;
    if (shape === 'free') {
        setActiveShapeTool(null);
    } else {
        setActiveShapeTool(shape);
    }
}

function setActiveShapeTool(tool) {
    currentShapeTool = tool;
    if (shapeToolsContainer) {
        shapeToolsContainer.querySelectorAll('.shape-tool-btn').forEach(b => {
            b.classList.toggle('shape-tool-active',
                (tool === null && b.dataset.shape === 'free') ||
                (b.dataset.shape === tool)
            );
        });
    }
}

function handleDocumentMouseMoveShape(event) {
    if (currentInteractionMode !== 'drawing_shape' || !shapeAnchorPoint || !shapePreviewElement) return;
    const svgRect = svgOverlay.getBoundingClientRect();
    const currentSvgPoint = {
        x: event.clientX - svgRect.left,
        y: event.clientY - svgRect.top
    };
    const currentNorm = svgToRelativeCoords(currentSvgPoint);
    if (!currentNorm) return;

    const vertices = generateShapeVertices(currentShapeTool, shapeAnchorPoint, currentNorm);
    if (!vertices || vertices.length < 3) return;

    const points = vertices.map(p => {
        const svgP = relativeToSvgCoords(p);
        return svgP ? `${svgP.x},${svgP.y}` : null;
    }).filter(p => p !== null).join(' ');
    shapePreviewElement.setAttribute('points', points);
}

function handleDocumentMouseUpShape(event) {
    document.removeEventListener('mousemove', handleDocumentMouseMoveShape);
    document.removeEventListener('mouseup', handleDocumentMouseUpShape);

    if (currentInteractionMode !== 'drawing_shape' || !shapeAnchorPoint) {
        cleanupShapePreview();
        return;
    }

    const svgRect = svgOverlay.getBoundingClientRect();
    const endSvgPoint = {
        x: event.clientX - svgRect.left,
        y: event.clientY - svgRect.top
    };
    const endNorm = svgToRelativeCoords(endSvgPoint);
    if (!endNorm) {
        cancelCurrentShape();
        return;
    }

    // Check minimum size (avoid accidental micro-shapes)
    const dxPx = (endNorm.x - shapeAnchorPoint.x) * (gmMapRect?.width || 1);
    const dyPx = (endNorm.y - shapeAnchorPoint.y) * (gmMapRect?.height || 1);
    if (Math.sqrt(dxPx * dxPx + dyPx * dyPx) < DRAG_THRESHOLD) {
        cancelCurrentShape();
        return;
    }

    const vertices = generateShapeVertices(currentShapeTool, shapeAnchorPoint, endNorm);
    if (!vertices || vertices.length < 3) {
        cancelCurrentShape();
        return;
    }

    // Clamp vertices
    vertices.forEach(v => {
        v.x = clampNorm(v.x);
        v.y = clampNorm(v.y);
    });

    // Create polygon
    const newPolygon = {
        id: generateUniqueId(),
        color: lastFogColor,
        vertices: vertices,
        ...(currentShapeTool !== 'free' && currentShapeTool && { shapeType: currentShapeTool })
    };
    console.log("Shape completed:", newPolygon);

    currentState.fog_of_war = currentState.fog_of_war || { hidden_polygons: [] };
    pushFogUndoSnapshot();
    currentState.fog_of_war.hidden_polygons.push(newPolygon);
    drawSingleCompletedPolygon(newPolygon);

    sendUpdate({ fog_of_war: currentState.fog_of_war });
    debouncedAutoSave();

    cleanupShapePreview();
    shapeAnchorPoint = null;
    setInteractionMode('drawing_enabled');
}

function cancelCurrentShape() {
    document.removeEventListener('mousemove', handleDocumentMouseMoveShape);
    document.removeEventListener('mouseup', handleDocumentMouseUpShape);
    cleanupShapePreview();
    shapeAnchorPoint = null;
    if (isDrawingFogEnabled) {
        setInteractionMode('drawing_enabled');
    } else {
        setInteractionMode('idle');
    }
    console.log("Shape drawing cancelled.");
}

function cleanupShapePreview() {
    if (shapePreviewElement) {
        shapePreviewElement.remove();
        shapePreviewElement = null;
    }
}

// --- Shape Vertex Generation ---
function generateShapeVertices(shapeType, anchor, current) {
    // anchor and current are normalized {x,y} in [0,1]
    // For correct aspect ratio, we compute in SVG pixel space then convert back
    const anchorSvg = relativeToSvgCoords(anchor);
    const currentSvg = relativeToSvgCoords(current);
    if (!anchorSvg || !currentSvg) return null;

    let pixelVertices = [];

    switch (shapeType) {
        case 'circle': {
            const cx = (anchorSvg.x + currentSvg.x) / 2;
            const cy = (anchorSvg.y + currentSvg.y) / 2;
            const dx = Math.abs(currentSvg.x - anchorSvg.x);
            const dy = Math.abs(currentSvg.y - anchorSvg.y);
            const r = Math.max(dx, dy) / 2;
            const N = 48;
            for (let i = 0; i < N; i++) {
                const angle = (2 * Math.PI * i) / N;
                pixelVertices.push({ x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) });
            }
            break;
        }
        case 'ellipse': {
            const cx = (anchorSvg.x + currentSvg.x) / 2;
            const cy = (anchorSvg.y + currentSvg.y) / 2;
            const rx = Math.abs(currentSvg.x - anchorSvg.x) / 2;
            const ry = Math.abs(currentSvg.y - anchorSvg.y) / 2;
            const N = 48;
            for (let i = 0; i < N; i++) {
                const angle = (2 * Math.PI * i) / N;
                pixelVertices.push({ x: cx + rx * Math.cos(angle), y: cy + ry * Math.sin(angle) });
            }
            break;
        }
        case 'square': {
            const dx = Math.abs(currentSvg.x - anchorSvg.x);
            const dy = Math.abs(currentSvg.y - anchorSvg.y);
            const side = Math.max(dx, dy);
            const signX = currentSvg.x >= anchorSvg.x ? 1 : -1;
            const signY = currentSvg.y >= anchorSvg.y ? 1 : -1;
            const x0 = anchorSvg.x;
            const y0 = anchorSvg.y;
            const x1 = anchorSvg.x + side * signX;
            const y1 = anchorSvg.y + side * signY;
            pixelVertices = [
                { x: x0, y: y0 },
                { x: x1, y: y0 },
                { x: x1, y: y1 },
                { x: x0, y: y1 }
            ];
            break;
        }
        case 'rectangle': {
            const x0 = anchorSvg.x;
            const y0 = anchorSvg.y;
            const x1 = currentSvg.x;
            const y1 = currentSvg.y;
            pixelVertices = [
                { x: x0, y: y0 },
                { x: x1, y: y0 },
                { x: x1, y: y1 },
                { x: x0, y: y1 }
            ];
            break;
        }
        case 'triangle': {
            // Isoceles triangle: apex at top-center of bounding box, base at bottom
            const x0 = anchorSvg.x;
            const y0 = anchorSvg.y;
            const x1 = currentSvg.x;
            const y1 = currentSvg.y;
            const topY = Math.min(y0, y1);
            const bottomY = Math.max(y0, y1);
            const leftX = Math.min(x0, x1);
            const rightX = Math.max(x0, x1);
            const apexX = (leftX + rightX) / 2;
            pixelVertices = [
                { x: apexX, y: topY },
                { x: rightX, y: bottomY },
                { x: leftX, y: bottomY }
            ];
            break;
        }
        default:
            return null;
    }

    // Convert pixel vertices back to normalized coords
    return pixelVertices.map(pv => {
        const norm = svgToRelativeCoords(pv);
        return norm ? { x: clampNorm(norm.x), y: clampNorm(norm.y) } : null;
    }).filter(v => v !== null);
}

function clampNorm(v) {
    return Math.max(0, Math.min(1, v));
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
    pushFogUndoSnapshot();
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
    // Show vertex handles for the selected polygon
    const polygonData = currentState?.fog_of_war?.hidden_polygons?.find(p => p.id === polygonId);
    if (polygonData) showVertexHandles(polygonData);
}
// Deselect Polygon (Unchanged)
function deselectPolygon(changeMode = true) {
    hideVertexHandles();
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
    pushFogUndoSnapshot();
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
// --- Fog Color Picker & Swatches ---
function setupFogColorSwatches() {
    TokenShared.setupColorSwatches(fogColorPresets, (color) => {
        lastFogColor = color;
    });
}
function setupFogColorPicker() {
    if (!fogColorButton || !fogColorInput) return;
    fogColorButton.addEventListener('click', () => {
        if (!selectedPolygonId) return;
        const polygon = currentState?.fog_of_war?.hidden_polygons?.find(p => p.id === selectedPolygonId);
        if (polygon) fogColorInput.value = polygon.color || '#000000';
        fogColorInput.click();
    });
    fogColorInput.addEventListener('input', () => {
        if (!selectedPolygonId) return;
        const newColor = fogColorInput.value;
        const polygon = currentState?.fog_of_war?.hidden_polygons?.find(p => p.id === selectedPolygonId);
        if (polygon && polygon.color !== newColor) {
            pushFogUndoSnapshot();
            polygon.color = newColor;
            lastFogColor = newColor;
            if (svgCompletedLayer) {
                const el = svgCompletedLayer.querySelector(`.fog-polygon-complete[data-polygon-id="${selectedPolygonId}"]`);
                if (el) el.setAttribute('fill', newColor);
            }
            sendUpdate({ fog_of_war: currentState.fog_of_war });
            debouncedAutoSave();
        }
    });
    fogColorInput.addEventListener('change', () => {
        deselectPolygon();
    });
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
    renderAllTokens();
    // Refresh vertex handles if a polygon is selected
    if (selectedPolygonId) {
        const selData = currentState?.fog_of_war?.hidden_polygons?.find(p => p.id === selectedPolygonId);
        if (selData) showVertexHandles(selData);
    }
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

// --- Undo/Redo ---

function deepCloneFog(fog) {
    return {
        hidden_polygons: (fog?.hidden_polygons || []).map(p => ({
            ...p,
            vertices: p.vertices.map(v => ({ x: v.x, y: v.y }))
        }))
    };
}

function pushFogUndoSnapshot() {
    fogUndoStack.push(deepCloneFog(currentState.fog_of_war));
    fogRedoStack.length = 0; // new action invalidates redo history
    if (fogUndoStack.length > FOG_UNDO_MAX) fogUndoStack.shift();
}

function capturePendingUndo() {
    pendingUndoSnapshot = deepCloneFog(currentState.fog_of_war);
}

function commitPendingUndo() {
    if (pendingUndoSnapshot) {
        fogUndoStack.push(pendingUndoSnapshot);
        fogRedoStack.length = 0;
        if (fogUndoStack.length > FOG_UNDO_MAX) fogUndoStack.shift();
        pendingUndoSnapshot = null;
    }
}

function discardPendingUndo() {
    pendingUndoSnapshot = null;
}

function fogUndo() {
    if (fogUndoStack.length === 0) return;
    fogRedoStack.push(deepCloneFog(currentState.fog_of_war));
    currentState.fog_of_war = fogUndoStack.pop();
    deselectPolygon();
    drawExistingFogPolygons();
    sendUpdate({ fog_of_war: currentState.fog_of_war });
    debouncedAutoSave();
    console.log("Fog undo applied.");
}

function fogRedo() {
    if (fogRedoStack.length === 0) return;
    fogUndoStack.push(deepCloneFog(currentState.fog_of_war));
    currentState.fog_of_war = fogRedoStack.pop();
    deselectPolygon();
    drawExistingFogPolygons();
    sendUpdate({ fog_of_war: currentState.fog_of_war });
    debouncedAutoSave();
    console.log("Fog redo applied.");
}

// --- State Updates & Saving (Unchanged) ---
function sendUpdate(updateData) {
    console.log("Sending update:", JSON.stringify(updateData));
    if (!socket || !socket.connected) {
        console.warn("WS disconnected.");
        return;
    }
    const payload = {
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
    // Also update current save file if one is loaded
    if (currentSaveId) {
        try {
            const saveState = Object.assign({}, currentState);
            delete saveState.original_map_path;
            const saveR = await fetch(`/api/saves/${encodeURIComponent(currentSaveId)}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ state: saveState, tokens: tokens }),
            });
            if (saveR.ok) console.log("Save file also updated.");
            else console.warn("Save file update failed.");
        } catch (e) {
            console.warn('Save file update error:', e);
        }
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

// --- Session/Player URL Display ---
function updatePlayerUrl() {
    if (lanPlayerUrlDisplay && lanIp) {
        lanPlayerUrlDisplay.value = `http://${lanIp}:${lanPort}/player`;
    }
    if (tunnelPlayerUrlDisplay && tunnelUrl) {
        tunnelPlayerUrlDisplay.value = `${tunnelUrl}/player`;
    }
}

function fetchLanInfo() {
    fetch('/api/lan-info')
        .then(r => r.json())
        .then(data => {
            if (data.ip) {
                lanIp = data.ip;
                lanPort = data.port || 5000;
                updatePlayerUrl();
            }
        })
        .catch(err => {
            console.warn("Could not fetch LAN info:", err);
            if (lanPlayerUrlDisplay) lanPlayerUrlDisplay.value = "Could not detect LAN IP";
        });
}

function startTunnelPolling() {
    updateTunnelStatusDisplay('connecting');
    let elapsed = 0;
    const interval = 2000;
    const timeout = 60000;
    const poll = setInterval(() => {
        elapsed += interval;
        fetch('/api/tunnel-info')
            .then(r => r.json())
            .then(data => {
                if (data.status === 'connected' && data.url) {
                    tunnelUrl = data.url;
                    updatePlayerUrl();
                    updateTunnelStatusDisplay('connected');
                    clearInterval(poll);
                    console.log("Tunnel connected:", tunnelUrl);
                } else if (data.status === 'error') {
                    updateTunnelStatusDisplay('error', data.error);
                    clearInterval(poll);
                    console.warn("Tunnel error:", data.error);
                } else if (elapsed >= timeout) {
                    updateTunnelStatusDisplay('error', 'Timed out');
                    clearInterval(poll);
                    console.warn("Tunnel polling timed out.");
                }
            })
            .catch(() => {
                if (elapsed >= timeout) {
                    updateTunnelStatusDisplay('error', 'Unavailable');
                    clearInterval(poll);
                }
            });
    }, interval);
}

function updateTunnelStatusDisplay(status, detail) {
    if (!tunnelStatusDisplay) return;
    tunnelStatusDisplay.className = '';
    if (status === 'connecting') {
        tunnelStatusDisplay.className = 'tunnel-connecting';
        tunnelStatusDisplay.textContent = '[ TUNNEL: CONNECTING... ]';
    } else if (status === 'connected') {
        tunnelStatusDisplay.className = 'tunnel-connected';
        tunnelStatusDisplay.textContent = '[ TUNNEL: ONLINE ]';
    } else if (status === 'error') {
        tunnelStatusDisplay.className = 'tunnel-error';
        tunnelStatusDisplay.textContent = `[ TUNNEL: ${(detail || 'UNAVAILABLE').toUpperCase()} ]`;
        if (tunnelPlayerUrlDisplay) tunnelPlayerUrlDisplay.value = 'Unavailable';
    }
}

function copyUrlToClipboard(inputEl) {
    if (!inputEl) return;
    const text = inputEl.value;
    if (!text || text === 'Unavailable' || text.startsWith('Detecting') || text.startsWith('Could not') || text.startsWith('Connecting')) return;
    inputEl.select();
    inputEl.setSelectionRange(0, 99999);
    if (navigator.clipboard) {
        navigator.clipboard.writeText(text).then(() => {
            if (lanCopyStatusDisplay) { lanCopyStatusDisplay.textContent = "Copied!"; setTimeout(() => { lanCopyStatusDisplay.textContent = ""; }, 2000); }
        }).catch(() => {
            document.execCommand('copy');
            if (lanCopyStatusDisplay) { lanCopyStatusDisplay.textContent = "Copied!"; setTimeout(() => { lanCopyStatusDisplay.textContent = ""; }, 2000); }
        });
    } else {
        document.execCommand('copy');
        if (lanCopyStatusDisplay) { lanCopyStatusDisplay.textContent = "Copied!"; setTimeout(() => { lanCopyStatusDisplay.textContent = ""; }, 2000); }
    }
}

function openQrModal(source) {
    if (!qrModal || !qrCodeContainer) return;
    let url;
    if (source === 'lan') {
        url = lanPlayerUrlDisplay ? lanPlayerUrlDisplay.value : null;
    } else {
        // Prefer tunnel URL, fall back to LAN
        url = (tunnelUrl && tunnelPlayerUrlDisplay) ? tunnelPlayerUrlDisplay.value
              : (lanPlayerUrlDisplay ? lanPlayerUrlDisplay.value : null);
    }
    if (!url || url === 'Unavailable' || url.startsWith('Detecting') || url.startsWith('Could not') || url.startsWith('Connecting')) return;

    // Clear previous QR code
    qrCodeContainer.innerHTML = '';
    if (qrModalUrl) qrModalUrl.textContent = url;

    // Generate QR code (qrcode.js loaded from CDN)
    new QRCode(qrCodeContainer, {
        text: url,
        width: 256,
        height: 256,
        colorDark: '#000000',
        colorLight: '#ffffff',
        correctLevel: QRCode.CorrectLevel.M
    });

    qrModal.style.display = 'flex';
}

function closeQrModal() {
    if (qrModal) qrModal.style.display = 'none';
}

// --- Save/Load System ---

function openSaveLoadModal() {
    const modal = document.getElementById('save-modal');
    if (!modal) return;
    modal.style.display = 'flex';
    renderSavesInModal();
}

function closeSaveLoadModal() {
    const modal = document.getElementById('save-modal');
    if (modal) modal.style.display = 'none';
}

async function renderSavesInModal() {
    const listEl = document.getElementById('save-list');
    const statusEl = document.getElementById('save-modal-status');
    if (!listEl) return;
    listEl.innerHTML = '<p style="color: var(--term-green-dim);">Loading saves...</p>';
    try {
        const r = await fetch('/api/saves');
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const saves = await r.json();
        listEl.innerHTML = '';
        if (saves.length === 0) {
            listEl.innerHTML = '<p style="color: var(--term-green-dim);">No saves found. Create one above.</p>';
            return;
        }
        saves.forEach(save => {
            const entry = document.createElement('div');
            entry.className = 'save-entry' + (save.id === currentSaveId ? ' save-entry-active' : '');
            const infoDiv = document.createElement('div');
            infoDiv.className = 'save-entry-info';
            const nameSpan = document.createElement('span');
            nameSpan.className = 'save-entry-name';
            nameSpan.textContent = save.name;
            const detailSpan = document.createElement('span');
            detailSpan.className = 'save-entry-detail';
            const dateStr = save.modified_at ? new Date(save.modified_at).toLocaleString() : '—';
            detailSpan.textContent = `${save.map_filename || 'No map'} — ${dateStr}`;
            infoDiv.appendChild(nameSpan);
            infoDiv.appendChild(detailSpan);
            entry.appendChild(infoDiv);

            const btnsDiv = document.createElement('div');
            btnsDiv.className = 'save-entry-buttons';

            const loadBtn = document.createElement('button');
            loadBtn.textContent = 'Load';
            loadBtn.addEventListener('click', () => loadSave(save.id));
            btnsDiv.appendChild(loadBtn);

            if (save.id === currentSaveId) {
                const saveBtn = document.createElement('button');
                saveBtn.textContent = 'Save';
                saveBtn.addEventListener('click', () => quickSave());
                btnsDiv.appendChild(saveBtn);
            }

            const renameBtn = document.createElement('button');
            renameBtn.textContent = 'Rename';
            renameBtn.addEventListener('click', () => {
                const newName = prompt('New name:', save.name);
                if (newName && newName.trim()) renameSave(save.id, newName.trim());
            });
            btnsDiv.appendChild(renameBtn);

            const deleteBtn = document.createElement('button');
            deleteBtn.textContent = 'Delete';
            deleteBtn.className = 'save-btn-delete';
            deleteBtn.addEventListener('click', () => {
                if (confirm(`Delete save "${save.name}"?`)) deleteSave(save.id);
            });
            btnsDiv.appendChild(deleteBtn);

            entry.appendChild(btnsDiv);
            listEl.appendChild(entry);
        });
    } catch (e) {
        console.error('Error loading saves:', e);
        listEl.innerHTML = '<p style="color: var(--term-red);">Error loading saves.</p>';
    }
}

async function createNewSave(name) {
    const statusEl = document.getElementById('save-modal-status');
    if (!name || !name.trim()) { if (statusEl) statusEl.textContent = 'Enter a name.'; return; }
    try {
        const r = await fetch('/api/saves', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: name.trim() }),
        });
        if (!r.ok) { const err = await r.json().catch(() => ({})); throw new Error(err.error || `HTTP ${r.status}`); }
        const save = await r.json();
        currentSaveId = save.id;
        currentSaveName = save.name;
        updateSaveDisplay();
        if (statusEl) statusEl.textContent = `Created: ${save.name}`;
        const nameInput = document.getElementById('save-name-input');
        if (nameInput) nameInput.value = '';
        renderSavesInModal();
    } catch (e) {
        console.error('Error creating save:', e);
        if (statusEl) statusEl.textContent = `Error: ${e.message}`;
    }
}

async function loadSave(id) {
    const statusEl = document.getElementById('save-modal-status');
    try {
        if (statusEl) statusEl.textContent = 'Loading...';
        const r = await fetch(`/api/saves/${encodeURIComponent(id)}/load`, { method: 'POST' });
        if (!r.ok) { const err = await r.json().catch(() => ({})); throw new Error(err.error || `HTTP ${r.status}`); }
        const result = await r.json();
        const save = result.save;
        currentSaveId = save.id;
        currentSaveName = save.name;
        updateSaveDisplay();
        // Restore GM UI from save
        const savedState = save.state || {};
        const savedTokens = save.tokens || [];
        const mapFilename = save.map_filename || '';
        // Update currentState
        currentState = Object.assign({}, savedState);
        currentMapFilename = mapFilename;
        tokens = savedTokens;
        // Update map selector
        if (mapSelect && mapFilename) {
            const mapOption = Array.from(mapSelect.options).find(opt => opt.value === mapFilename);
            if (mapOption) {
                mapSelect.value = mapFilename;
            }
        }
        // Reload GM map display
        if (mapFilename) {
            await loadMapDataForGM(mapFilename);
        }
        if (statusEl) statusEl.textContent = `Loaded: ${save.name}`;
        renderSavesInModal();
        closeSaveLoadModal();
    } catch (e) {
        console.error('Error loading save:', e);
        if (statusEl) statusEl.textContent = `Error: ${e.message}`;
    }
}

async function quickSave() {
    if (!currentSaveId) { openSaveLoadModal(); return; }
    try {
        const saveState = Object.assign({}, currentState);
        delete saveState.original_map_path;
        const r = await fetch(`/api/saves/${encodeURIComponent(currentSaveId)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ state: saveState, tokens: tokens }),
        });
        if (!r.ok) { const err = await r.json().catch(() => ({})); throw new Error(err.error || `HTTP ${r.status}`); }
        const save = await r.json();
        currentSaveName = save.name;
        updateSaveDisplay();
        console.log(`Quick-saved to: ${save.name}`);
        // Brief flash feedback
        const display = document.getElementById('current-save-display');
        if (display) {
            display.textContent = `SAVED: ${save.name}`;
            setTimeout(() => updateSaveDisplay(), 1500);
        }
    } catch (e) {
        console.error('Quick-save error:', e);
        alert(`Quick-save failed: ${e.message}`);
    }
}

async function renameSave(id, name) {
    try {
        const r = await fetch(`/api/saves/${encodeURIComponent(id)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: name }),
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        if (id === currentSaveId) {
            const save = await r.json();
            currentSaveName = save.name;
            updateSaveDisplay();
        }
        renderSavesInModal();
    } catch (e) {
        console.error('Error renaming save:', e);
    }
}

async function deleteSave(id) {
    try {
        const r = await fetch(`/api/saves/${encodeURIComponent(id)}`, { method: 'DELETE' });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        if (id === currentSaveId) {
            currentSaveId = null;
            currentSaveName = null;
            updateSaveDisplay();
        }
        renderSavesInModal();
    } catch (e) {
        console.error('Error deleting save:', e);
    }
}

function updateSaveDisplay() {
    const display = document.getElementById('current-save-display');
    if (!display) return;
    if (currentSaveId && currentSaveName) {
        display.textContent = `Active: ${currentSaveName}`;
        display.style.color = 'var(--term-cyan)';
    } else {
        display.textContent = 'No save loaded';
        display.style.color = 'var(--term-green-dim)';
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
    return TokenShared.rgbToHex(r, g, b);
}

// --- Token Functions ---

function getContrastColor(hexColor) {
    return TokenShared.getContrastColor(hexColor);
}

function handleToggleTokenMode() {
    isTokenModeEnabled = !isTokenModeEnabled;
    if (isTokenModeEnabled) {
        // Disable fog drawing if active (mutual exclusion)
        if (isDrawingFogEnabled) {
            handleToggleFogDrawing();
        }
        if (currentInteractionMode === 'polygon_selected') {
            deselectPolygon();
        }
        setInteractionMode('token_placing');
        if (toggleTokenModeButton) toggleTokenModeButton.textContent = 'Disable Token Mode';
        if (tokenSettings) tokenSettings.style.display = 'block';
    } else {
        setInteractionMode('idle');
        if (toggleTokenModeButton) toggleTokenModeButton.textContent = 'Enable Token Mode';
        if (tokenSettings) tokenSettings.style.display = 'none';
    }
}

function renderAllTokens() {
    if (!svgTokenLayer) return;
    svgTokenLayer.innerHTML = '';
    tokens.forEach(token => {
        const svgP = relativeToSvgCoords({ x: token.x, y: token.y });
        if (!svgP) return;
        const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        g.setAttribute('class', 'token-group');
        g.dataset.tokenId = token.id;
        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('cx', svgP.x);
        circle.setAttribute('cy', svgP.y);
        circle.setAttribute('r', 14);
        circle.setAttribute('fill', token.color || '#ff0000');
        circle.setAttribute('stroke', 'rgba(255,255,255,0.6)');
        circle.setAttribute('stroke-width', '1.5');
        g.appendChild(circle);
        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('x', svgP.x);
        text.setAttribute('y', svgP.y);
        text.setAttribute('fill', getContrastColor(token.color || '#ff0000'));
        text.textContent = token.label || '';
        g.appendChild(text);
        svgTokenLayer.appendChild(g);
    });
}

function handleDocumentMouseMoveToken(event) {
    if (!draggingTokenId || !svgTokenLayer) return;
    tokenDragOccurred = true;
    const svgRect = svgOverlay.getBoundingClientRect();
    const svgPoint = { x: event.clientX - svgRect.left, y: event.clientY - svgRect.top };
    // Update token SVG position locally for responsiveness
    const g = svgTokenLayer.querySelector(`.token-group[data-token-id="${draggingTokenId}"]`);
    if (g) {
        const circle = g.querySelector('circle');
        const text = g.querySelector('text');
        if (circle) { circle.setAttribute('cx', svgPoint.x); circle.setAttribute('cy', svgPoint.y); }
        if (text) { text.setAttribute('x', svgPoint.x); text.setAttribute('y', svgPoint.y); }
    }
}

function handleDocumentMouseUpToken(event) {
    document.removeEventListener('mousemove', handleDocumentMouseMoveToken);
    document.removeEventListener('mouseup', handleDocumentMouseUpToken);
    if (!draggingTokenId) return;
    const tokenId = draggingTokenId;
    if (tokenDragOccurred) {
        // Actual drag — emit move
        const svgRect = svgOverlay.getBoundingClientRect();
        const svgPoint = { x: event.clientX - svgRect.left, y: event.clientY - svgRect.top };
        const relPoint = svgToRelativeCoords(svgPoint);
        if (relPoint) {
            TokenShared.emitTokenMove(socket, tokenId, relPoint.x, relPoint.y);
        }
        draggingTokenId = null;
        draggingTokenStartSvg = null;
        dragJustCompleted = true;
        if (isTokenModeEnabled) {
            setInteractionMode('token_placing');
        } else {
            setInteractionMode('idle');
        }
    } else {
        // Simple click — open context popup
        draggingTokenId = null;
        draggingTokenStartSvg = null;
        dragJustCompleted = true;
        selectedTokenId = tokenId;
        setInteractionMode('token_selected');
        showTokenPopup(event);
    }
}

function showTokenPopup(event) {
    if (!tokenInteractionPopup || !svgOverlay || !mapViewPanel) return;
    const svgClickPos = getSvgCoordinates(event);
    if (!svgClickPos) return;
    const popupWidth = tokenInteractionPopup.offsetWidth;
    const popupHeight = tokenInteractionPopup.offsetHeight;
    let popupLeft = svgClickPos.x + 10;
    let popupTop = svgClickPos.y + 10;
    if (popupLeft + popupWidth > mapViewPanel.clientWidth) popupLeft = svgClickPos.x - popupWidth - 10;
    if (popupTop + popupHeight > mapViewPanel.clientHeight) popupTop = svgClickPos.y - popupHeight - 10;
    popupLeft = Math.max(5, popupLeft);
    popupTop = Math.max(5, popupTop);
    tokenInteractionPopup.style.left = `${popupLeft}px`;
    tokenInteractionPopup.style.top = `${popupTop}px`;
    tokenInteractionPopup.style.display = 'block';
}

function deselectToken() {
    selectedTokenId = null;
    if (tokenInteractionPopup) tokenInteractionPopup.style.display = 'none';
    if (isTokenModeEnabled) {
        setInteractionMode('token_placing');
    } else {
        setInteractionMode('idle');
    }
}

function handleDeleteToken() {
    if (!selectedTokenId) return;
    TokenShared.emitTokenRemove(socket, selectedTokenId);
    deselectToken();
}

function setupTokenContextPopupGM() {
    TokenShared.setupTokenContextPopup({
        popupEl: tokenInteractionPopup,
        deleteBtnEl: tokenDeleteButton,
        colorBtnEl: tokenColorButton,
        colorInputEl: tokenColorInput,
        getSocket: () => socket,
        getSelectedId: () => selectedTokenId,
        getTokens: () => tokens,
        onDismiss: () => deselectToken()
    });
}

function setupTokenColorSwatches() {
    TokenShared.setupColorSwatches(tokenColorPresets, (color) => {
        currentTokenColor = color;
    });
}

function setupTokenLabelInput() {
    TokenShared.setupLabelInput(tokenLabelInput, (label) => {
        currentTokenLabel = label;
    });
}