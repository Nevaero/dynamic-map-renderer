// static/js/player.js
// Version: 1.31 (Fog of War - Stage C: Use ImageLoader for Blobs)
// Logic for Player view - Verify Basic Shaders are present

// --- Global Variables ---
let scene, camera, renderer, planeMesh, material;
let socket = null;
let currentSessionId = null;
// *** Use ImageLoader instead of TextureLoader for blob loading ***
let imageLoader = new THREE.ImageLoader();
imageLoader.crossOrigin = 'anonymous'; // Set crossOrigin for ImageLoader
let textureLoader = new THREE.TextureLoader(); // Keep for fallback/other uses if needed? Or remove? Let's keep for now.
textureLoader.crossOrigin = 'anonymous';
let clock = new THREE.Clock();
let currentFilterId = 'none';
let isRenderingPaused = false;
let filterDefinitions = {};
let currentViewState = {};
let currentFilterParams = {};
let currentMapContentPath = null;
let currentObjectUrl = null; // Keep track of the blob URL

// --- DOM Elements ---
const canvas = document.getElementById('player-canvas');
const statusDiv = document.getElementById('status');


// --- Initialization ---
async function init() {
    console.log("Player View Initializing (v1.31 - Use ImageLoader)..."); // Version updated
    // textureLoader.setPath('/'); // Not needed if using absolute URLs or ImageLoader
    const urlParams = new URLSearchParams(window.location.search);
    currentSessionId = urlParams.get('session');
    if (!currentSessionId) {
        const errorMsg = "ERROR: No session ID found in URL (?session=... is required)";
        displayStatus(errorMsg); console.error(errorMsg);
        document.body.innerHTML = `<p style="color:red; font-size: 1.2em; padding: 20px;">${errorMsg}</p>`;
        return;
     }
    displayStatus(`Initializing Session: ${currentSessionId}...`);
    console.log(`Player joining session: ${currentSessionId}`);
    try { await loadAllFilterConfigs(); } catch (e) { console.error("Filter config load failed:", e); }
    // Scene, Camera, Renderer Setup... (condensed)
    scene = new THREE.Scene();
    const aspect = window.innerWidth / window.innerHeight; const frustumSize = 10;
    camera = new THREE.OrthographicCamera(frustumSize * aspect / -2, frustumSize * aspect / 2, frustumSize / 2, frustumSize / -2, 0.1, 100);
    camera.position.z = 10;
    try {
        renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true });
        renderer.setSize(window.innerWidth, window.innerHeight); renderer.setPixelRatio(window.devicePixelRatio); renderer.setClearColor(0x000000, 0);
    } catch (e) { console.error("WebGL Init failed:", e); displayStatus("ERROR: WebGL failed."); isRenderingPaused = true; return; }
    // Material Setup... (condensed)
    const commonUniforms = { resolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) }, time: { value: 0.0 } };
    const initialVertexShader = getBasicVertexShader();
    const initialFragmentShader = getBasicFragmentShader();
    // *** THIS CHECK IS FAILING ***
    if (!initialVertexShader || !initialFragmentShader) {
        console.error("CRITICAL: Basic shaders failed to define!"); // Ensure this exact message appears if it fails
        displayStatus("ERROR: Shaders failed."); // Keep simple message for user
        isRenderingPaused = true; return;
    }
    console.log("Basic shaders obtained."); // Should see this if functions are okay
    try {
        material = new THREE.ShaderMaterial({ uniforms: { ...commonUniforms, mapTexture: { value: null } }, vertexShader: initialVertexShader, fragmentShader: initialFragmentShader, transparent: true, depthWrite: false, side: THREE.DoubleSide });
        console.log("THREE.ShaderMaterial created.");
        material.addEventListener('error', (e) => {
             console.error(`SHADER ERROR for filter ${currentFilterId}:`, e.error);
             displayStatus(`ERROR: Shader failed for filter ${currentFilterId}. Reverting.`);
             const basicVert = getBasicVertexShader(); const basicFrag = getBasicFragmentShader();
             if (basicVert && basicFrag) { material.vertexShader = basicVert; material.fragmentShader = basicFrag; material.needsUpdate = true; }
             currentFilterId = 'none_fallback';
        });
    } catch (e) { console.error("ShaderMaterial creation error:", e); displayStatus("ERROR: Material failed."); isRenderingPaused = true; return; }
    console.log("Material setup complete.");
    // Geometry and Mesh... (condensed)
    const geometry = new THREE.PlaneGeometry(1, 1); planeMesh = new THREE.Mesh(geometry, material); planeMesh.position.z = 0; planeMesh.visible = false; scene.add(planeMesh);
    console.log("Geometry and Mesh setup complete.");
    // Event Listeners and Connection...
    window.addEventListener('resize', onWindowResize, false);
    connectWebSocket();
    animate();
    console.log("Initialization sequence complete.");
}

// --- Filter Definition Loading (Unchanged, condensed) ---
async function loadAllFilterConfigs() {
    console.log("[loadAllFilterConfigs] Fetching filter configurations...");
    try {
        const response = await fetch('/api/filters');
        console.log("[loadAllFilterConfigs] Fetch complete. Status:", response.status, "Ok:", response.ok);
        if (!response.ok) { throw new Error(`HTTP error! Status: ${response.status}`); }
        const jsonData = await response.json();
        console.log("[loadAllFilterConfigs] JSON parsed successfully.");
        filterDefinitions = jsonData || {};
        console.log("[loadAllFilterConfigs] Filter configurations assigned:", Object.keys(filterDefinitions));
    } catch (error) {
        console.error("[loadAllFilterConfigs] Error fetching or parsing filter configs:", error);
        displayStatus("ERROR: Could not load filter definitions.");
        filterDefinitions = {};
    }
    console.log("[loadAllFilterConfigs] Function finished.");
 }
async function loadFilterShaders(filterId) {
    if (!filterDefinitions[filterId]) { displayStatus(`ERROR: Config missing for filter ${filterId}.`); return false; }
    if (filterDefinitions[filterId].vertexShader && filterDefinitions[filterId].fragmentShader) { return true; }
    console.log(`Fetching shaders for filter: ${filterId}`);
    try {
        const vertPath = `/filters/${encodeURIComponent(filterId)}/vertex.glsl`; const fragPath = `/filters/${encodeURIComponent(filterId)}/fragment.glsl`;
        const [vertResponse, fragResponse] = await Promise.all([fetch(vertPath), fetch(fragPath)]);
        if (!vertResponse.ok) throw new Error(`Vert fetch failed (${vertResponse.status})`); if (!fragResponse.ok) throw new Error(`Frag fetch failed (${fragResponse.status})`);
        const [vertexShader, fragmentShader] = await Promise.all([vertResponse.text(), fragResponse.text()]);
        filterDefinitions[filterId].vertexShader = vertexShader; filterDefinitions[filterId].fragmentShader = fragmentShader;
        console.log(`Shaders loaded successfully for ${filterId}`); return true;
    } catch (error) {
        console.error(`Error loading shaders for ${filterId}:`, error); displayStatus(`ERROR loading shaders for ${filterId}.`);
        delete filterDefinitions[filterId].vertexShader; delete filterDefinitions[filterId].fragmentShader; return false;
    }
}

// --- WebSocket Handling (Unchanged, condensed) ---
function connectWebSocket() {
    console.log("--- connectWebSocket() called ---");
    if (!currentSessionId) { console.error("WS Error: No Session ID."); return; }
    if (typeof io === 'undefined') { console.error("WS Error: Socket.IO library not loaded!"); return; }
    console.log(`Attempting WebSocket connection for session: ${currentSessionId}...`);
    try { socket = io(); console.log("Socket.IO object created:", socket); }
    catch (error) { console.error("Error initializing Socket.IO connection:", error); return; }
    socket.on('connect', () => { console.log(`WebSocket connected: ${socket.id}`); displayStatus(`Connected.`); socket.emit('join_session', { session_id: currentSessionId }); });
    socket.on('disconnect', (reason) => { console.warn(`WebSocket disconnected: ${reason}`); displayStatus(`Disconnected.`); });
    socket.on('connect_error', (error) => { console.error('WebSocket connection error:', error); displayStatus(`Connection Error.`); });
    socket.on('state_update', handleStateUpdate);
    socket.on('error', (data) => { console.error('Server WS Error:', data.message || data); displayStatus(`SERVER ERROR.`); });
    console.log("WebSocket event handlers set up.");
}


// --- State Update Handler ---
async function handleStateUpdate(state) {
    console.log('[handleStateUpdate] Received state:', JSON.stringify(state));
    if (!state || typeof state !== 'object') { console.error("Invalid state received."); return; }
    displayStatus("Applying state..."); isRenderingPaused = false;
    currentViewState = state.view_state || { center_x: 0.5, center_y: 0.5, scale: 1.0 };
    const newFilterId = state.current_filter || 'none';
    const newContentPath = state.map_content_path || null; // Relative URL from backend
    console.log(`[handleStateUpdate] Processing: Path='${newContentPath}', Filter='${newFilterId}'`);
    // Update filter params... (condensed)
    if (state.filter_params && state.filter_params[newFilterId]) { currentFilterParams = state.filter_params[newFilterId]; } else { const filterConfig = filterDefinitions[newFilterId]; currentFilterParams = {}; if (filterConfig?.params) { for (const key in filterConfig.params) { if (filterConfig.params[key].value !== undefined) { currentFilterParams[key] = filterConfig.params[key].value; } } } } currentFilterParams = currentFilterParams || {};

    try {
        let shaderChanged = false; let shadersOk = true;
        // 1. Update Shaders if needed... (condensed)
        if (newFilterId !== currentFilterId || !filterDefinitions[newFilterId]?.vertexShader) {
            console.log(`Filter change/load: ${currentFilterId} -> ${newFilterId}`);
            shadersOk = await loadFilterShaders(newFilterId);
            if (!shadersOk) { /* Fallback */ material.vertexShader = getBasicVertexShader(); material.fragmentShader = getBasicFragmentShader(); currentFilterId = 'none_fallback'; shaderChanged = true; }
            else { /* Assign new */ const newVert = filterDefinitions[newFilterId].vertexShader; const newFrag = filterDefinitions[newFilterId].fragmentShader;
                if (material.vertexShader !== newVert) { material.vertexShader = newVert; shaderChanged = true; }
                if (material.fragmentShader !== newFrag) { material.fragmentShader = newFrag; shaderChanged = true; }
                currentFilterId = newFilterId;
            }
        }
        // 2. Update Uniforms... (condensed)
        const filterConfig = filterDefinitions[currentFilterId];
        if (shadersOk && filterConfig) { updateUniformsForMaterial(material, filterConfig, currentFilterParams); }
        else { cleanupUniforms(material, null); }
        if (shaderChanged) { material.needsUpdate = true; console.log("Shader material marked for update.");}

        // 3. Update Texture if path changed
        const pathChanged = newContentPath !== currentMapContentPath;
        if (pathChanged) {
            console.log(`Content path change: ${currentMapContentPath} -> ${newContentPath}`);
            // Clear cache for the OLD path before loading new one (using full URL)
            if (currentMapContentPath && typeof THREE !== 'undefined' && THREE.Cache?.enabled) {
                try {
                    const oldFullUrl = new URL(currentMapContentPath, window.location.origin).href;
                    console.log(`[Cache] Removing old texture URL from THREE.Cache: ${oldFullUrl}`);
                    THREE.Cache.remove(oldFullUrl);
                } catch(e) { console.warn("Could not construct URL for cache removal:", currentMapContentPath); }
            }
            // Use fetch + ImageLoader strategy
            await updateTextureViaFetchAndImageLoader(newContentPath, material, 'foreground'); // Use new function
            currentMapContentPath = newContentPath; // Update current path tracking
        } else {
             planeMesh.visible = material.uniforms.mapTexture.value !== null;
        }
        // 4. Update Camera
        updateCameraView(currentViewState);
        console.log("[handleStateUpdate] Update applied successfully."); displayStatus("");
    } catch (error) {
        console.error("[handleStateUpdate] Error applying state:", error);
        displayStatus(`ERROR applying state.`);
    }
}

// --- Uniform Handling (Unchanged, condensed) ---
function updateUniformsForMaterial(targetMaterial, filterConfig, paramsForFilter) {
    const expectedUniforms = new Set(['mapTexture', 'resolution', 'time']); const currentUniforms = targetMaterial.uniforms; let uniformsChanged = false;
    if (filterConfig?.params) {
        for (const paramKey in filterConfig.params) {
            const paramDef = filterConfig.params[paramKey]; if (paramKey === 'backgroundImageFilename') continue;
            const uniformName = `u${paramKey.charAt(0).toUpperCase() + paramKey.slice(1)}`; expectedUniforms.add(uniformName);
            const value = paramsForFilter?.[paramKey] ?? paramDef.value ?? null;
            if (typeof value === 'number' && isFinite(value)) {
                if (!currentUniforms[uniformName]) { currentUniforms[uniformName] = { value: value }; uniformsChanged = true; }
                else if (currentUniforms[uniformName].value !== value) { currentUniforms[uniformName].value = value; uniformsChanged = true; }
            } else { /* Handle non-numeric */ }
        }
    }
    if (cleanupUniforms(targetMaterial, expectedUniforms)) { uniformsChanged = true; }
 }
function cleanupUniforms(targetMaterial, expectedUniformSet) {
     const baseUniforms = ['mapTexture', 'resolution', 'time']; let removed = false;
     for (const uniformName in targetMaterial.uniforms) {
         if (baseUniforms.includes(uniformName)) continue;
         if (expectedUniformSet && !expectedUniformSet.has(uniformName)) { delete targetMaterial.uniforms[uniformName]; removed = true; }
         else if (!expectedUniformSet) { delete targetMaterial.uniforms[uniformName]; removed = true; }
     } return removed;
}


// --- Texture Handling via Fetch + ImageLoader ---
async function updateTextureViaFetchAndImageLoader(newTexturePath, targetMaterial, logPrefix = 'texture') {
    console.log(`[${logPrefix}] updateTextureViaFetchAndImageLoader called. Relative Path: ${newTexturePath}`);
    let aspectChanged = false;
    // Cleanup previous Object URL
    if (currentObjectUrl) { console.log(`[${logPrefix}] Revoking previous object URL: ${currentObjectUrl}`); URL.revokeObjectURL(currentObjectUrl); currentObjectUrl = null; }
    // Clear old texture from material
     if (targetMaterial?.uniforms?.mapTexture?.value) { console.log(`[${logPrefix}] Disposing previous texture.`); targetMaterial.uniforms.mapTexture.value.dispose(); targetMaterial.uniforms.mapTexture.value = null; }
    // Hide plane initially
    if(planeMesh) { planeMesh.visible = false; planeMesh.scale.set(1, 1, 1); }

    if (!newTexturePath) { console.log(`[${logPrefix}] Path is null, texture cleared.`); displayStatus(""); return Promise.resolve(false); }

    displayStatus(`Loading map...`);
    const absoluteUrl = new URL(newTexturePath, window.location.origin).href;
    console.log(`[${logPrefix}] Constructed absolute URL: ${absoluteUrl}`);

    try {
        console.log(`[${logPrefix}] Fetching image data from: ${absoluteUrl}`);
        const response = await fetch(absoluteUrl);
        console.log(`[${logPrefix}] Fetch response status: ${response.status}, ok: ${response.ok}`);
        if (!response.ok) {
            const errorText = await response.text().catch(() => 'Could not read error response body');
            console.error(`[${logPrefix}] Fetch failed! Status: ${response.status} ${response.statusText}. URL: ${absoluteUrl}. Body: ${errorText}`);
            throw new Error(`HTTP error ${response.status} fetching image`);
        }
        const imageBlob = await response.blob();
        console.log(`[${logPrefix}] Image data fetched as Blob. Size: ${imageBlob.size}, Type: ${imageBlob.type}`);
        currentObjectUrl = URL.createObjectURL(imageBlob);
        console.log(`[${logPrefix}] Created Object URL: ${currentObjectUrl}`);

        // Use ImageLoader to load the Object URL
        aspectChanged = await new Promise((resolve, reject) => {
            imageLoader.load( currentObjectUrl,
                (imageElement) => { // onLoad
                    try {
                        console.log(`[${logPrefix}] ImageLoader loaded successfully from Object URL. Image element:`, imageElement);
                        if (targetMaterial?.uniforms?.mapTexture) {
                            const texture = new THREE.Texture(imageElement); texture.needsUpdate = true;
                            targetMaterial.uniforms.mapTexture.value = texture;
                            let changed = false;
                            if (imageElement?.naturalWidth > 0 && imageElement?.naturalHeight > 0) {
                                const textureAspect = imageElement.naturalWidth / imageElement.naturalHeight;
                                if (planeMesh.scale.x !== textureAspect || planeMesh.scale.y !== 1.0) { planeMesh.scale.set(textureAspect, 1.0, 1.0); changed = true; console.log(`[${logPrefix}] Plane aspect updated: ${textureAspect.toFixed(3)}`); }
                                planeMesh.visible = true; console.log(`[${logPrefix}] Plane visible.`);
                            } else { console.warn(`[${logPrefix}] Invalid texture dimensions from ImageLoader.`); planeMesh.visible = false; }
                            resolve(changed);
                        } else { reject(new Error("Material missing")); }
                    } catch(e) { reject(e); }
                },
                undefined, // onProgress
                (errorEvent) => { // onError for ImageLoader
                    console.error(`[${logPrefix}] ImageLoader failed loading Object URL ${currentObjectUrl}`, errorEvent);
                    reject(new Error("ImageLoader failed for Object URL"));
                }
            );
        });
        displayStatus(""); return aspectChanged;
    } catch (error) {
        console.error(`[${logPrefix}] Error in updateTextureViaFetchAndImageLoader for path ${newTexturePath} (URL: ${absoluteUrl}):`, error);
        displayStatus(`ERROR loading map.`);
        if (targetMaterial?.uniforms?.mapTexture) { targetMaterial.uniforms.mapTexture.value = null; }
        if(planeMesh) { planeMesh.visible = false; }
        if (currentObjectUrl) { URL.revokeObjectURL(currentObjectUrl); currentObjectUrl = null; } // Revoke on error too
        throw error;
    }
}


// --- Camera Handling (Unchanged, condensed) ---
function updateCameraView(viewState) {
    if (!viewState || typeof viewState.scale !== 'number' || typeof viewState.center_x !== 'number' || typeof viewState.center_y !== 'number') { viewState = { scale: 1.0, center_x: 0.5, center_y: 0.5 }; }
    if (!planeMesh || !camera) { console.error("updateCameraView: planeMesh or camera missing."); return; }
    const planeWidth = planeMesh.scale.x; const planeHeight = planeMesh.scale.y; const effectiveScale = Math.max(0.01, viewState.scale);
    const viewHeight = planeHeight / effectiveScale; const viewWidth = viewHeight * (window.innerWidth / window.innerHeight);
    camera.left = -viewWidth / 2; camera.right = viewWidth / 2; camera.top = viewHeight / 2; camera.bottom = -viewHeight / 2;
    const offsetX = (viewState.center_x - 0.5) * planeWidth; const offsetY = -(viewState.center_y - 0.5) * planeHeight;
    camera.position.x = offsetX; camera.position.y = offsetY; camera.updateProjectionMatrix();
 }

// --- Event Listeners & Animation Loop (Unchanged, condensed) ---
function onWindowResize() {
    if (!camera || !renderer || !material) return;
    const width = window.innerWidth; const height = window.innerHeight; const aspect = width / height;
    const viewHeight = camera.top - camera.bottom; const viewWidth = viewHeight * aspect;
    camera.left = -viewWidth / 2; camera.right = viewWidth / 2; camera.updateProjectionMatrix(); renderer.setSize(width, height);
    if (material?.uniforms?.resolution) { material.uniforms.resolution.value.set(width, height); }
 }
function animate() {
    requestAnimationFrame(animate); if (isRenderingPaused || !renderer || !scene || !camera) return;
    const elapsedTime = clock.getElapsedTime(); if (material?.uniforms?.time) { material.uniforms.time.value = elapsedTime; }
    try { renderer.render(scene, camera); } catch (e) { console.error("Render loop error:", e); displayStatus(`ERROR rendering.`); isRenderingPaused = true; }
 }

// --- Utility & Fallbacks ---
function displayStatus(message) { if (statusDiv) { statusDiv.textContent = message; statusDiv.style.display = message ? 'block' : 'none'; } }

// *** ENSURE THESE FUNCTIONS ARE CORRECT AND PRESENT ***
function getBasicVertexShader() {
    // Returns the basic vertex shader string
    return `
        varying vec2 vUv;
        void main() {
            vUv = uv; // Pass UV coordinates to fragment shader
            // Calculate final position using model-view and projection matrices
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `;
}
function getBasicFragmentShader() {
    // Returns the basic pass-through fragment shader string
    return `
        #ifdef GL_ES
        precision mediump float; // Set precision for floats in OpenGL ES
        #endif
        uniform sampler2D mapTexture; // Texture uniform
        varying vec2 vUv; // Received UV coordinates from vertex shader
        void main() {
            // Sample the texture at the interpolated UV coordinate
            vec4 texColor = texture2D(mapTexture, vUv);
            // Discard fragment if texture alpha is very low (transparent)
            if (texColor.a < 0.01) { discard; }
            // Set the final fragment color
            gl_FragColor = texColor;
        }
    `;
}
// *** END ENSURE ***


// --- Start Application ---
document.addEventListener('DOMContentLoaded', init); // Initialize after DOM is loaded
