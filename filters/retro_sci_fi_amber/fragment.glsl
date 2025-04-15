// filters/retro_sci_fi_amber/fragment.glsl
// Version: 1.32_Amber (Based on Green v1.32)
#ifdef GL_ES
precision mediump float;
#endif

uniform sampler2D mapTexture;
// Filter uniforms
uniform float uScanlineIntensity;
uniform float uScanlineThickness;
uniform float uCrtWarp;
uniform float uBrightness;
uniform float uContrast;
uniform float uAmberTint; // Changed from uGreenTint
uniform float uGhostIntensity;
uniform float uGhostDistance;
uniform float uTearFrequency;
uniform float uNoiseBarWidth;
uniform float uNoiseBarSpeed;
// Removed: uniform float uNoiseBarSkewAmount;
uniform float uVignetteAmount;
uniform float uInvertColors;
uniform float uFlicker;
uniform float uPictureRoll;
uniform float uDistortion;
uniform float uInterference; // White Noise
uniform float uSkew; // General picture skew
uniform float uChromaticAberration;
uniform float uRoundedCorners;
// System uniforms
uniform vec2 resolution;
uniform float time;

varying vec2 vUv; // Original UV passed from vertex shader

#define PI 3.1415926

// Simple pseudo-random noise function
float random(vec2 st) {
    return fract(sin(dot(st.xy, vec2(12.9898, 78.233))) * 43758.5453123);
}

// --- Effect Functions --- (scanline, vignette, barrelDistortion, roundedCornerSDFMask - unchanged)
float scanline(vec2 screenCoord, float intensity, float thickness) { float cycleHeight = max(thickness, 1.0); float lineFactor = mod(screenCoord.y, cycleHeight); float lineCenter = cycleHeight * 0.5; float darkLineHalfWidth = cycleHeight * 0.25; float dist = abs(lineFactor - lineCenter); float lineValue = step(darkLineHalfWidth, dist); return mix(1.0 - intensity, 1.0, lineValue); }
float vignette(vec2 uv, float amount) { uv = uv - 0.5; float radius = 0.75 - amount * 0.4; float softness = 0.4; return smoothstep(radius + softness, radius - softness, length(uv)); }
vec2 barrelDistortion(vec2 uv, float amount) { vec2 centeredUv = uv * 2.0 - 1.0; float distSq = dot(centeredUv, centeredUv); vec2 warpedUv = centeredUv * (1.0 + amount * distSq); return (warpedUv + 1.0) / 2.0; }
float roundedCornerSDFMask(vec2 uv, float radius) { vec2 p = uv - 0.5; vec2 b = vec2(0.5 - radius); float d = length(max(abs(p) - b, 0.0)) - radius; return 1.0 - smoothstep(-0.005, 0.005, d); }


// --- Helper Function to Apply Effects ---
// Added flags for noise bar state
vec3 processColor(vec3 aberrColor, vec2 screenCoord, vec2 baseUv, bool isInsideNoiseBar, float posInBar) {
    vec3 processed = aberrColor;

    // Apply Invert (First)
    if (uInvertColors > 0.5) { processed = vec3(1.0) - processed; }

    // Apply Amber Tint (EARLY)
    if (uAmberTint > 0.0) {
        float t = uAmberTint;
        // Keep Red high, reduce Green slightly, reduce Blue significantly
        processed = vec3(
            processed.r, // Keep Red
            processed.g * (1.0 - t * 0.35), // Reduce Green moderately
            processed.b * (1.0 - t * 0.9)  // Reduce Blue significantly
        );
    }
    // --- Tint Applied ---

    // Apply Brightness/Contrast
    processed = (processed - 0.5) * uContrast + 0.5;
    processed = processed * uBrightness;

    // Apply Scanlines
    float scan = scanline(screenCoord, uScanlineIntensity, uScanlineThickness);
    processed *= scan;

    // Apply Interference (White Noise)
    float interferenceNoise = random(baseUv * 0.6 + time * 0.05);
    float interferenceFactor = smoothstep(0.75 - uInterference * 0.2, 0.75 + uInterference * 0.2, interferenceNoise);
    processed += interferenceFactor * uInterference * vec3(0.95);

    // --- Add Denser Black & White Staticky Streaks within Noise Bar ---
    if (isInsideNoiseBar) {
        float lineSeed = random(vec2(floor(baseUv.y * 200.0), floor(time*30.0)));
        float intensityX = random(vec2(lineSeed, 3.3)) * 1.5 + 0.3;
        float streakProbability = 0.25;
        float streakNoise = random(baseUv.xy * vec2(15.0, 5.0) + vec2(lineSeed, time * 25.0));
        if (streakNoise < streakProbability) {
             float blackOrWhite = random(vec2(lineSeed, 4.4));
             vec3 streakColor = (blackOrWhite > 0.5) ? vec3(1.0) : vec3(0.0); // White or Black
             float mixFactor = intensityX * (1.0 - posInBar * 0.5);
             mixFactor = clamp(mixFactor, 0.0, 1.0);
             processed = mix(processed, streakColor, mixFactor);
        }
    }
    // --- End Staticky Streaks ---

    // Apply Flicker
    float flickerAmount = (random(vec2(time * 8.0)) - 0.5) * uFlicker;
    processed += flickerAmount;

    // NOTE: No final Green boost needed/applied here

    // Clamp before returning (safety)
    processed = clamp(processed, 0.0, 1.0);

    return processed;
}


void main() {
      // --- 1. Calculate final UV coordinates (Main and Ghost) ---
      vec2 warpedUv = barrelDistortion(vUv, uCrtWarp); vec2 finalUv = warpedUv;
      finalUv.y = fract(finalUv.y + time * uPictureRoll); finalUv.x += (finalUv.y - 0.5) * uSkew; float distortionOffset = (random(vec2(finalUv.y * 15.0, time * 0.4)) - 0.5) * uDistortion; finalUv.x += distortionOffset;
      // Apply Intermittent Tearing
      bool tearActive = false; float basePeriod = uTearFrequency; if (basePeriod > 0.01) { float cycleNum = floor(time / basePeriod); float randomOffset = (random(vec2(cycleNum)) - 0.5) * basePeriod; float triggerTime = (cycleNum * basePeriod) + randomOffset + (basePeriod * 0.5); float effectDuration = 0.2; if (abs(time - triggerTime) < (effectDuration * 0.5)) { tearActive = true; } }
      if (tearActive) { float tearStrength = 0.08; float spatialFrequency = 15.0; float sharpness = 40.0; float scrollSpeed = 5.0; float scrollOffset = fract(time * scrollSpeed); float yPos = finalUv.y + scrollOffset; float v_wave = 0.5 - 0.5 * cos(2.0 * PI * yPos * spatialFrequency); float v_pow = pow(v_wave, sharpness); float v_sin = sin(2.0 * PI * yPos * spatialFrequency); float v = v_pow * v_sin; finalUv.x += v * tearStrength; }
      // Calculate Noise Bar State & Apply UV Skew
      bool isInsideNoiseBar = false; float posInBar = 0.0;
      if (uNoiseBarWidth > 0.0) {
            float barHeightUv = uNoiseBarWidth / 100.0; float effectY = finalUv.y + time * uNoiseBarSpeed * 0.5; float cyclePos = fract(effectY); float edgeNoise = (random(vec2(finalUv.x * 40.0, floor(time*3.0))) - 0.5) * 0.3; float effectiveBarHeight = max(barHeightUv + edgeNoise * barHeightUv, 0.0);
            if (cyclePos < effectiveBarHeight) {
                isInsideNoiseBar = true; posInBar = cyclePos / max(effectiveBarHeight, 0.01);
                float skewFactor = pow(1.0 - posInBar, 2.0); float randomShift = (random(vec2(finalUv.y * 5.0, floor(time*8.0))) - 0.5) * 2.0; float horizontalOffset = skewFactor * -0.3 * randomShift; finalUv.x += horizontalOffset; // Hardcoded skew -0.3
            }
      }
      // Calculate final UVs for sampling
      vec2 sampleUv = fract(finalUv); vec2 ghostOffset = vec2(uGhostDistance / resolution.x, 0.0); vec2 ghostSampleUv = fract(finalUv + ghostOffset);

      // --- 2. Sample Textures & EARLY GHOST BLEND ---
      vec2 centerOffs = vUv - 0.5; float aberrDist = length(centerOffs); vec2 aberrDir = (aberrDist > 0.0001) ? normalize(centerOffs) : vec2(0.0); vec2 aberrOffs = aberrDir * uChromaticAberration * aberrDist;
      float r_main = texture2D(mapTexture, fract(sampleUv + aberrOffs)).r; float g_main = texture2D(mapTexture, fract(sampleUv)).g; float b_main = texture2D(mapTexture, fract(sampleUv - aberrOffs)).b; vec3 mainAberrColor = vec3(r_main, g_main, b_main); float mainAlpha = texture2D(mapTexture, sampleUv).a;
      vec3 ghostAberrColor = vec3(0.0); if (uGhostIntensity > 0.0) { float r_ghost = texture2D(mapTexture, fract(ghostSampleUv + aberrOffs)).r; float g_ghost = texture2D(mapTexture, fract(ghostSampleUv)).g; float b_ghost = texture2D(mapTexture, fract(ghostSampleUv - aberrOffs)).b; ghostAberrColor = vec3(r_ghost, g_ghost, b_ghost); }
      if (mainAlpha < 0.01 && uGhostIntensity <= 0.0) discard;
      vec3 blendedAberrColor = mix(mainAberrColor, ghostAberrColor, uGhostIntensity);

      // --- 3. Process the SINGLE Blended Color ---
      // Uses Amber tint logic applied early inside processColor
      vec3 workingColor = processColor(blendedAberrColor, gl_FragCoord.xy, vUv, isInsideNoiseBar, posInBar);

      // --- 4. Final Masking & Output ---
      workingColor *= vignette(vUv, uVignetteAmount);
      float cornerMask = roundedCornerSDFMask(vUv, uRoundedCorners); workingColor *= cornerMask; float finalAlpha = mainAlpha * cornerMask;
      if (finalAlpha < 0.01) discard;
      // Final clamp removed from processColor, applied here instead
      workingColor = clamp(workingColor, 0.0, 1.0);
      gl_FragColor = vec4(workingColor, finalAlpha);
}