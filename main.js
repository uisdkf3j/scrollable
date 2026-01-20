const canvas = document.getElementById("renderCanvas");
const engine = new BABYLON.Engine(canvas, true, { 
    preserveDrawingBuffer: true, 
    stencil: true,
    adaptToDeviceRatio: true,
    useHighPrecisionFloats: true
});

// State
let camera = null;
let scene = null;
const wallMeshes = { north: [], south: [], east: [], west: [] };
let entranceNodeHigh = null;  // Transform node for entrance marker (high position)
let entranceNodeLow = null;   // Transform node for entrance marker (low position)
let entranceImage = null;     // GUI image for entrance marker

// Idle rotation state
let lastInteractionTime = Date.now();
let isIdleRotating = false;
const IDLE_TIMEOUT = 10000; // 10 seconds in milliseconds
const IDLE_ROTATION_SPEED = 0.0005; // Radians per frame

// Toggle mode state
let isToggleMode = false;
let accentMaterial = null;  // The material named "Accent"
let accent2Material = null;  // The material named "Accent_2"
let originalAccentEmissive = null;  // Store original emissive color
let originalAccent2Emissive = null;  // Store original emissive color for Accent_2
const ACCENT_EMISSION_COLOR = new BABYLON.Color3(0.608, 0.733, 0.675);  // #9BBBAC
const ACCENT_2_EMISSION_COLOR = new BABYLON.Color3(0.851, 0.902, 0.871);  // #D9E6DE

// Sun path state
let whiteMaterial = null;
let originalWhiteEmissive = null;
let sunTextures = [];  // Array of all 40 sun textures
let currentSunTextureIndex = 0;  // Current texture index (0-39)
let blendedTextureWhite = null;   // Procedural texture blending from white
let blendedTextureAccent = null;  // Procedural texture blending from #9BBBAC
let blendedTextureAccent2 = null; // Procedural texture blending from #D9E6DE
let sunBlendFactor = 0;     // 0 = base color, 1 = sun texture

// Furniture meshes (shown only in toggle mode, one set at a time)
const furnitureSets = {
    furniture1: [],
    furniture2: [],
    furniture3: []
};
let currentFurnitureIndex = 0;  // 0=furniture1, 1=furniture2, 2=furniture3, 3=none
const FURNITURE_OPTIONS = ['furniture1', 'furniture2', 'furniture3', null];  // null = no furniture

// Camera angles, FOV, and radius
const BETA_TOP_DOWN = 0.000015;       // Near top-down (slight angle to avoid gimbal issues)
const BETA_ANGLED = Math.PI / 4;  // 45 degrees
const FOV_ORTHO = 0.05;           // Very small FOV simulates orthographic
const FOV_PERSPECTIVE = 0.34;     // Normal FOV (~70mm equivalent)
const RADIUS_PERSPECTIVE = 30;    // Normal radius for perspective view
// Constant for maintaining apparent size: radius * tan(fov/2) = k
const APPARENT_SIZE_CONSTANT = RADIUS_PERSPECTIVE * Math.tan(FOV_PERSPECTIVE / 2);

// Snap angles for camera rotation
const STRAIGHT_ANGLES = [0, Math.PI / 2, Math.PI, 3 * Math.PI / 2]; // 0°, 90°, 180°, 270°
const QUADRANT_CENTERS = [Math.PI / 4, 3 * Math.PI / 4, 5 * Math.PI / 4, 7 * Math.PI / 4]; // 45°, 135°, 225°, 315°

// Transition state
let transitionTargetAlpha = null;  // Target alpha when transitioning to perspective
let lastTransitionProgress = 0;    // Track transition progress changes

// Utility functions
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, min, max) => Math.min(Math.max(v, min), max);

// Normalize alpha to 0-2π range
const normalizeAlpha = (alpha) => {
    let a = alpha % (2 * Math.PI);
    if (a < 0) a += 2 * Math.PI;
    return a;
};

// Find the nearest angle from an array of angles
const snapToNearest = (alpha, angles) => {
    const normalized = normalizeAlpha(alpha);
    let nearestAngle = angles[0];
    let minDiff = Infinity;
    
    for (const angle of angles) {
        // Calculate angular difference (handling wrap-around)
        let diff = Math.abs(normalized - angle);
        if (diff > Math.PI) diff = 2 * Math.PI - diff;
        
        if (diff < minDiff) {
            minDiff = diff;
            nearestAngle = angle;
        }
    }
    
    return nearestAngle;
};

// Find the nearest quadrant center from a straight angle
const straightToQuadrantCenter = (straightAngle) => {
    // Each straight angle maps to two adjacent quadrant centers
    // We choose the one in the "forward" direction (counterclockwise)
    const mapping = {
        0: Math.PI / 4,           // 0° → 45°
        [Math.PI / 2]: Math.PI / 4,     // 90° → 45° (or 135°, we pick lower)
        [Math.PI]: 5 * Math.PI / 4,     // 180° → 225°
        [3 * Math.PI / 2]: 5 * Math.PI / 4  // 270° → 225° (or 315°)
    };
    
    // Find closest match in mapping
    for (const [key, value] of Object.entries(mapping)) {
        if (Math.abs(parseFloat(key) - straightAngle) < 0.01) {
            return value;
        }
    }
    
    // Fallback: find nearest quadrant center
    return snapToNearest(straightAngle, QUADRANT_CENTERS);
};

const getQuadrant = (alpha) => {
    let a = alpha % (2 * Math.PI);
    if (a < 0) a += 2 * Math.PI;
    
    if (a < Math.PI / 2) return 1;
    if (a < Math.PI) return 2;
    if (a < 3 * Math.PI / 2) return 3;
    return 4;
};

// Hide all Wall_Top meshes (for ortho view)
const hideAllWalls = () => {
    ['north', 'south', 'east', 'west'].forEach(dir => {
        wallMeshes[dir].forEach(mesh => mesh.setEnabled(false));
    });
};

// Show all Wall_Top meshes (for 3D view with toggle OFF)
const showAllWalls = () => {
    ['north', 'south', 'east', 'west'].forEach(dir => {
        wallMeshes[dir].forEach(mesh => mesh.setEnabled(true));
    });
};

// Update accent materials emission colors
const updateAccentEmission = (enabled) => {
    // Update "Accent" material
    if (accentMaterial) {
        if (enabled) {
            accentMaterial.emissiveColor = ACCENT_EMISSION_COLOR;
        } else if (originalAccentEmissive) {
            accentMaterial.emissiveColor = originalAccentEmissive.clone();
        }
    }
    
    // Update "Accent_2" material
    if (accent2Material) {
        if (enabled) {
            accent2Material.emissiveColor = ACCENT_2_EMISSION_COLOR;
        } else if (originalAccent2Emissive) {
            accent2Material.emissiveColor = originalAccent2Emissive.clone();
        }
    }
};

// Hide all furniture sets
const hideAllFurniture = () => {
    Object.values(furnitureSets).forEach(meshes => {
        meshes.forEach(mesh => {
            mesh.setEnabled(false);
            mesh.visibility = 0;
        });
    });
};

// Update furniture visibility based on toggle mode and current selection
const updateFurnitureVisibility = () => {
    if (!isToggleMode) {
        // Toggle OFF: hide all furniture
        hideAllFurniture();
        return;
    }
    
    // Toggle ON: show only the currently selected furniture set
    const currentOption = FURNITURE_OPTIONS[currentFurnitureIndex];
    
    Object.entries(furnitureSets).forEach(([key, meshes]) => {
        const shouldShow = key === currentOption;
        meshes.forEach(mesh => {
            mesh.setEnabled(shouldShow);
            mesh.visibility = shouldShow ? 1 : 0;
            // Restore original scaling when showing furniture
            if (shouldShow && mesh._originalScaling) {
                mesh.scaling = mesh._originalScaling.clone();
            }
        });
    });
};

// Cycle to next furniture option
const cycleFurniture = () => {
    currentFurnitureIndex = (currentFurnitureIndex + 1) % FURNITURE_OPTIONS.length;
    const currentOption = FURNITURE_OPTIONS[currentFurnitureIndex];
    console.log(`Furniture: ${currentOption || 'none'}`);
    updateFurnitureVisibility();
};

// Update wall visibility based on current mode and toggle state
const updateWallVisibilityForMode = () => {
    if (isOrthoView) {
        // Ortho view: always hide all walls regardless of toggle
        hideAllWalls();
    } else {
        // 3D view: depends on toggle state
        if (isToggleMode) {
            // Toggle ON: apply quadrant-based hiding
            updateMeshVisibility(getQuadrant(camera.alpha));
        } else {
            // Toggle OFF: show all walls
            showAllWalls();
        }
    }
};

// Toggle the mode and update visuals
const toggleMode = () => {
    isToggleMode = !isToggleMode;
    console.log(`Toggle mode: ${isToggleMode ? 'ON' : 'OFF'}`);
    
    // Update accent emission
    updateAccentEmission(isToggleMode);
    
    // Update wall visibility
    updateWallVisibilityForMode();
    
    // Update furniture visibility
    updateFurnitureVisibility();
};

// Update sun path effect based on scroll progress (section 4 transition)
// Crossfade: base color → sun texture using custom shader blend
// Base color depends on toggle mode: white (OFF) or accent colors (ON)
const updateSunPathTransition = (progress) => {
    // Section 4 starts at ~66% of scroll progress
    const section4Start = 0.66;
    const fadeSpeed = 0.1; // Fade over 10% of scroll
    
    // Calculate blend factor: 0 = base color, 1 = full texture
    let t = 0;
    if (progress >= section4Start) {
        t = clamp((progress - section4Start) / fadeSpeed, 0, 1);
    }
    
    // Update blend factor on all procedural textures
    if (blendedTextureWhite) blendedTextureWhite.setFloat("blendFactor", t);
    if (blendedTextureAccent) blendedTextureAccent.setFloat("blendFactor", t);
    if (blendedTextureAccent2) blendedTextureAccent2.setFloat("blendFactor", t);
    
    if (t === 0) {
        // Before section 4: emissive color based on toggle mode, no texture
        if (accentMaterial) {
            accentMaterial.emissiveTexture = null;
            accentMaterial.emissiveColor = isToggleMode ? ACCENT_EMISSION_COLOR : new BABYLON.Color3(1, 1, 1);
            if (accentMaterial.emissiveIntensity !== undefined) {
                accentMaterial.emissiveIntensity = 1;
            }
        }
        if (whiteMaterial) {
            whiteMaterial.emissiveTexture = null;
            whiteMaterial.emissiveColor = new BABYLON.Color3(1, 1, 1);
            if (whiteMaterial.emissiveIntensity !== undefined) {
                whiteMaterial.emissiveIntensity = 1;
            }
        }
        if (accent2Material) {
            accent2Material.emissiveTexture = null;
            accent2Material.emissiveColor = isToggleMode ? ACCENT_2_EMISSION_COLOR : new BABYLON.Color3(1, 1, 1);
            if (accent2Material.emissiveIntensity !== undefined) {
                accent2Material.emissiveIntensity = 1;
            }
        }
    } else {
        // Apply blended textures - use accent textures if toggle mode is ON
        if (blendedTextureWhite) blendedTextureWhite.coordinatesIndex = 0;
        if (blendedTextureAccent) blendedTextureAccent.coordinatesIndex = 0;
        if (blendedTextureAccent2) blendedTextureAccent2.coordinatesIndex = 0;
        
        if (accentMaterial) {
            accentMaterial.emissiveTexture = isToggleMode ? blendedTextureAccent : blendedTextureWhite;
            accentMaterial.emissiveColor = new BABYLON.Color3(1, 1, 1);
            if (accentMaterial.emissiveIntensity !== undefined) {
                accentMaterial.emissiveIntensity = 1;
            }
        }
        if (whiteMaterial) {
            whiteMaterial.emissiveTexture = blendedTextureWhite;
            whiteMaterial.emissiveColor = new BABYLON.Color3(1, 1, 1);
            if (whiteMaterial.emissiveIntensity !== undefined) {
                whiteMaterial.emissiveIntensity = 1;
            }
        }
        if (accent2Material) {
            accent2Material.emissiveTexture = isToggleMode ? blendedTextureAccent2 : blendedTextureWhite;
            accent2Material.emissiveColor = new BABYLON.Color3(1, 1, 1);
            if (accent2Material.emissiveIntensity !== undefined) {
                accent2Material.emissiveIntensity = 1;
            }
        }
    }
};

// Update furniture transition based on scroll progress (shrink then hide in section 4)
const updateFurnitureFade = (progress) => {
    // Only apply when toggle mode is on and furniture is visible
    if (!isToggleMode) return;
    
    // Section 4 starts at ~66%
    const section4Start = 0.66;
    const shrinkSpeed = 0.05; // Shrink over 5% of scroll
    
    // Calculate shrink progress: 0 = no shrink, 1 = fully shrunk
    let shrinkProgress = 0;
    if (progress >= section4Start) {
        shrinkProgress = clamp((progress - section4Start) / shrinkSpeed, 0, 1);
    }
    
    // Scale: 1.0 → 0.9 (shrink to 90%)
    const minScale = 0.9;
    const scale = lerp(1, minScale, shrinkProgress);
    
    // Hide when fully shrunk
    const shouldShow = shrinkProgress < 1;
    
    // Only apply to the currently selected furniture set
    const currentOption = FURNITURE_OPTIONS[currentFurnitureIndex];
    if (currentOption && furnitureSets[currentOption]) {
        furnitureSets[currentOption].forEach(mesh => {
            if (mesh.isEnabled() || shrinkProgress < 1) {
                // Multiply original scaling by shrink factor to preserve axis orientation
                if (mesh._originalScaling) {
                    mesh.scaling = mesh._originalScaling.scale(scale);
                } else {
                    // Fallback if original scaling wasn't stored (shouldn't happen)
                    mesh.scaling = new BABYLON.Vector3(scale, scale, scale);
                }
                mesh.visibility = shouldShow ? 1 : 0;
            }
        });
    }
};

// Show walls based on quadrant (for perspective view with toggle ON)
const updateMeshVisibility = (quadrant) => {
    const hideMap = {
        1: ['west', 'south'],
        2: ['south', 'east'],
        3: ['east', 'north'],
        4: ['north', 'west']
    };
    
    const toHide = hideMap[quadrant] || [];
    
    ['north', 'south', 'east', 'west'].forEach(dir => {
        const hide = toHide.includes(dir);
        wallMeshes[dir].forEach(mesh => mesh.setEnabled(!hide));
    });
};

// Track current view mode
let isOrthoView = true;

// Track last entrance quadrant to avoid unnecessary updates
let lastEntranceQuadrant = null;

// Update entrance marker parent based on alpha quadrant
const updateEntranceParent = () => {
    if (!camera || !entranceImage) return;
    
    // Get current alpha quadrant
    const quadrant = getQuadrant(camera.alpha);
    
    // Only update if quadrant changed
    if (quadrant === lastEntranceQuadrant) return;
    lastEntranceQuadrant = quadrant;
    
    // Determine which node to use based on quadrant
    // Quadrants 4 and 1: Entrance_High
    // Quadrants 3 and 2: Entrance_Low
    let targetNode = null;
    if (quadrant === 1 || quadrant === 4) {
        targetNode = entranceNodeHigh;
    } else if (quadrant === 2 || quadrant === 3) {
        targetNode = entranceNodeLow;
    }
    
    // Update parent if we have a valid target node
    if (targetNode) {
        entranceImage.linkWithMesh(targetNode);
        entranceImage.linkOffsetY = -25;
        entranceImage.linkOffsetX = 65;
    }
};

// Scroll-based camera update
const updateCameraFromScroll = () => {
    if (!camera) return;
    
    const wrapper = document.querySelector('.model-section-wrapper');
    if (!wrapper) return;
    
    const rect = wrapper.getBoundingClientRect();
    const wrapperHeight = wrapper.offsetHeight;
    const viewportHeight = window.innerHeight;
    
    // Calculate scroll progress through the wrapper (0 to 1)
    // 0 = top of wrapper at top of viewport
    // 1 = bottom of wrapper at bottom of viewport
    const scrollableDistance = wrapperHeight - viewportHeight;
    const scrolledAmount = -rect.top;
    const progress = clamp(scrolledAmount / scrollableDistance, 0, 1);
    
    // Transition happens in first third of scroll (sections 2→3)
    const transitionEnd = 0.33;
    const transitionProgress = clamp(progress / transitionEnd, 0, 1);
    
    // Calculate target values for beta and FOV
    const targetBeta = lerp(BETA_TOP_DOWN, BETA_ANGLED, transitionProgress);
    const targetFov = lerp(FOV_ORTHO, FOV_PERSPECTIVE, transitionProgress);
    
    // Smooth the transitions for beta and FOV
    const newBeta = lerp(camera.beta, targetBeta, 0.08);
    const newFov = lerp(camera.fov, targetFov, 0.08);
    // Calculate radius from current FOV to maintain constant apparent size
    const newRadius = APPARENT_SIZE_CONSTANT / Math.tan(newFov / 2);
    
    // Update camera beta (locked)
    camera.lowerBetaLimit = newBeta;
    camera.upperBetaLimit = newBeta;
    camera.beta = newBeta;
    
    // Smart alpha handling based on view mode
    const ORTHO_THRESHOLD = 0.1;      // 0-10% = ortho mode
    const TRANSITION_THRESHOLD = 1.0;  // 10-100% = transition, 100% = perspective
    
    if (transitionProgress < ORTHO_THRESHOLD) {
        // ORTHO MODE: Snap to nearest straight angle (0°, 90°, 180°, 270°)
        const targetStraightAngle = snapToNearest(camera.alpha, STRAIGHT_ANGLES);
        const newAlpha = lerp(camera.alpha, targetStraightAngle, 0.08);
        camera.alpha = newAlpha;
        
        // Reset transition target when in ortho
        transitionTargetAlpha = null;
        
    } else if (transitionProgress < TRANSITION_THRESHOLD) {
        // TRANSITION MODE: Animate to nearest quadrant center
        
        // On entering transition, calculate the target quadrant center
        if (lastTransitionProgress < ORTHO_THRESHOLD && transitionTargetAlpha === null) {
            // Just left ortho - calculate target from current snapped position
            const currentStraight = snapToNearest(camera.alpha, STRAIGHT_ANGLES);
            transitionTargetAlpha = snapToNearest(currentStraight, QUADRANT_CENTERS);
        }
        
        // Lerp toward the transition target
        if (transitionTargetAlpha !== null) {
            const newAlpha = lerp(camera.alpha, transitionTargetAlpha, 0.08);
            camera.alpha = newAlpha;
        }
        
    } else {
        // PERSPECTIVE MODE: Free rotation - do not modify alpha
        // User has full control, no snapping or lerping
        transitionTargetAlpha = null;
    }
    
    // Track transition progress for detecting mode changes
    lastTransitionProgress = transitionProgress;
    
    // Update FOV
    camera.fov = newFov;
    
    // Update radius (locked)
    camera.lowerRadiusLimit = newRadius;
    camera.upperRadiusLimit = newRadius;
    camera.radius = newRadius;
    
    // Adjust minZ based on radius to improve depth buffer precision
    camera.minZ = Math.max(0.1, newRadius * 0.01);
    
    // Update wall visibility based on view mode
    const wasOrthoView = isOrthoView;
    isOrthoView = transitionProgress < 0.1; // Consider ortho if less than 10% through transition
    
    if (isOrthoView !== wasOrthoView) {
        // View mode changed - update wall visibility
        updateWallVisibilityForMode();
    }
    
    // Update entrance parent based on current alpha
    updateEntranceParent();
    
    // Section 4 transitions
    updateSunPathTransition(progress);
    updateFurnitureFade(progress);
    
    // Apply idle rotation in sections 3 and 4 (progress >= 0.33)
    if (progress >= 0.33) {
        const timeSinceInteraction = Date.now() - lastInteractionTime;
        
        if (timeSinceInteraction > IDLE_TIMEOUT) {
            // Start idle rotation
            if (!isIdleRotating) {
                isIdleRotating = true;
            }
            camera.alpha += IDLE_ROTATION_SPEED;
        } else {
            isIdleRotating = false;
        }
    } else {
        // Reset idle rotation in sections 1-2
        isIdleRotating = false;
    }
};

const createScene = async () => {
    scene = new BABYLON.Scene(engine);
    scene.clearColor = new BABYLON.Color4(1, 1, 1, 1);
    
    // Enable logarithmic depth buffer to fix Z-fighting at large distances
    scene.useLogarithmicDepth = true;
    
    // Load all sun textures for sun path mode (invertY = false to match GLB texture orientation)
    sunTextures = [];
    for (let i = 1; i <= 40; i++) {
        sunTextures.push(new BABYLON.Texture(`./assets/sun/Sun_${i}.jpg`, scene, false, false));
    }
    currentSunTextureIndex = 0;  // Start with first texture (Sun_1.jpg)
    
    // Register custom shader for base-color-to-texture blend
    BABYLON.Effect.ShadersStore["sunBlendFragmentShader"] = `
        precision highp float;
        varying vec2 vUV;
        uniform sampler2D sunSampler;
        uniform float blendFactor;
        uniform vec3 baseColor;
        
        void main(void) {
            vec4 texColor = texture2D(sunSampler, vUV);
            vec4 base = vec4(baseColor, 1.0);
            gl_FragColor = mix(base, texColor, blendFactor);
        }
    `;
    
    // Create procedural texture for white base color
    blendedTextureWhite = new BABYLON.CustomProceduralTexture(
        "sunBlendTextureWhite",
        "sunBlend",
        512,
        scene
    );
    blendedTextureWhite.setTexture("sunSampler", sunTextures[13]);  // Initialize with texture 14 (11AM)
    blendedTextureWhite.setFloat("blendFactor", 0.0);
    blendedTextureWhite.setVector3("baseColor", new BABYLON.Vector3(1.0, 1.0, 1.0));
    
    // Create procedural texture for Accent base color (#9BBBAC)
    blendedTextureAccent = new BABYLON.CustomProceduralTexture(
        "sunBlendTextureAccent",
        "sunBlend",
        512,
        scene
    );
    blendedTextureAccent.setTexture("sunSampler", sunTextures[13]);
    blendedTextureAccent.setFloat("blendFactor", 0.0);
    blendedTextureAccent.setVector3("baseColor", new BABYLON.Vector3(0.608, 0.733, 0.675));
    
    // Create procedural texture for Accent_2 base color (#D9E6DE)
    blendedTextureAccent2 = new BABYLON.CustomProceduralTexture(
        "sunBlendTextureAccent2",
        "sunBlend",
        512,
        scene
    );
    blendedTextureAccent2.setTexture("sunSampler", sunTextures[13]);
    blendedTextureAccent2.setFloat("blendFactor", 0.0);
    blendedTextureAccent2.setVector3("baseColor", new BABYLON.Vector3(0.851, 0.902, 0.871));

    // Calculate initial radius from ortho FOV
    const initialRadius = APPARENT_SIZE_CONSTANT / Math.tan(FOV_ORTHO / 2);
    
    camera = new BABYLON.ArcRotateCamera(
        "camera",
        Math.PI / 2,      // alpha - start at 90° (straight angle)
        BETA_TOP_DOWN,    // beta - start top-down
        initialRadius,    // radius - calculated to maintain apparent size
        BABYLON.Vector3.Zero(),
        scene
    );

    camera.attachControl(canvas, true);
    camera.lowerBetaLimit = BETA_TOP_DOWN;
    camera.upperBetaLimit = BETA_TOP_DOWN;
    camera.lowerRadiusLimit = initialRadius;
    camera.upperRadiusLimit = initialRadius;
    camera.fov = FOV_ORTHO;  // Start with ortho-like FOV
    camera.minZ = 0.1;

    // Track quadrant changes (only apply when toggle is ON and not in ortho view)
    let lastQuadrant = getQuadrant(camera.alpha);
    camera.onAfterCheckInputsObservable.add(() => {
        const q = getQuadrant(camera.alpha);
        if (q !== lastQuadrant) {
            lastQuadrant = q;
            // Only apply quadrant-based visibility if toggle is ON and not in ortho view
            if (isToggleMode && !isOrthoView) {
                updateMeshVisibility(q);
            }
        }
        // Update entrance parent whenever alpha changes
        updateEntranceParent();
    });

    // Load model
    try {
        const result = await BABYLON.SceneLoader.ImportMeshAsync(
            "", "./assets/", "Model.glb", scene
        );

        // Find bounding box center
        let min = new BABYLON.Vector3(Infinity, Infinity, Infinity);
        let max = new BABYLON.Vector3(-Infinity, -Infinity, -Infinity);

        result.meshes.forEach(mesh => {
            if (mesh.getBoundingInfo) {
                const info = mesh.getBoundingInfo();
                min = BABYLON.Vector3.Minimize(min, info.boundingBox.minimumWorld);
                max = BABYLON.Vector3.Maximize(max, info.boundingBox.maximumWorld);
            }
        });

        camera.target = BABYLON.Vector3.Center(min, max);

        // Categorize meshes and setup click handlers
        result.meshes.forEach(mesh => {
            // Categorize wall meshes
            if (mesh.name?.includes('Wall_Top')) {
                const name = mesh.name.toLowerCase();
                if (name.includes('north')) wallMeshes.north.push(mesh);
                else if (name.includes('south')) wallMeshes.south.push(mesh);
                else if (name.includes('east')) wallMeshes.east.push(mesh);
                else if (name.includes('west')) wallMeshes.west.push(mesh);
            }
            
            // Find the "Accent" material and store its original emissive color
            if (mesh.material && mesh.material.name === 'Accent' && !accentMaterial) {
                accentMaterial = mesh.material;
                originalAccentEmissive = mesh.material.emissiveColor 
                    ? mesh.material.emissiveColor.clone() 
                    : new BABYLON.Color3(0, 0, 0);
                console.log('Found Accent material:', accentMaterial.name);
            }
            
            // Find the "Accent_2" material and store its original emissive color
            if (mesh.material && mesh.material.name === 'Accent_2' && !accent2Material) {
                accent2Material = mesh.material;
                originalAccent2Emissive = mesh.material.emissiveColor 
                    ? mesh.material.emissiveColor.clone() 
                    : new BABYLON.Color3(0, 0, 0);
                console.log('Found Accent_2 material:', accent2Material.name);
            }
            
            // Find the "White" material and store its original emissive color
            if (mesh.material && mesh.material.name === 'White' && !whiteMaterial) {
                whiteMaterial = mesh.material;
                originalWhiteEmissive = mesh.material.emissiveColor 
                    ? mesh.material.emissiveColor.clone() 
                    : new BABYLON.Color3(1, 1, 1);
                console.log('Found White material:', whiteMaterial.name);
            }
            
            // Add click handler to all meshes except 'Base'
            if (mesh.name && !mesh.name.includes('Base')) {
                mesh.actionManager = new BABYLON.ActionManager(scene);
                mesh.actionManager.registerAction(
                    new BABYLON.ExecuteCodeAction(
                        BABYLON.ActionManager.OnPickTrigger,
                        () => toggleMode()
                    )
                );
            }
        });

        // Initially hide all walls (ortho view)
        hideAllWalls();
        
        // Find the Entrance_High transform node
        entranceNodeHigh = result.meshes.find(mesh => mesh.name === 'Entrance_High');
        if (!entranceNodeHigh) {
            // Also check transform nodes
            entranceNodeHigh = result.transformNodes?.find(node => node.name === 'Entrance_High');
        }
        
        // Find the Entrance_Low transform node
        entranceNodeLow = result.meshes.find(mesh => mesh.name === 'Entrance_Low');
        if (!entranceNodeLow) {
            // Also check transform nodes
            entranceNodeLow = result.transformNodes?.find(node => node.name === 'Entrance_Low');
        }
        
        // Create GUI and attach entrance marker
        if (entranceNodeHigh || entranceNodeLow) {
            const initialNode = entranceNodeHigh || entranceNodeLow;
            console.log('Found entrance nodes - High:', entranceNodeHigh?.name, 'Low:', entranceNodeLow?.name);
            
            // Create fullscreen GUI
            const advancedTexture = BABYLON.GUI.AdvancedDynamicTexture.CreateFullscreenUI("EntranceUI");
            
            // Create image from SVG
            entranceImage = new BABYLON.GUI.Image("entranceMarker", "./assets/Entrance.svg");
            entranceImage.width = "200px";
            entranceImage.height = "200px";
            entranceImage.stretch = BABYLON.GUI.Image.STRETCH_UNIFORM;
            
            // MUST add control to texture BEFORE linking to mesh
            advancedTexture.addControl(entranceImage);
            
            // Now link image to the initial transform node position
            entranceImage.linkWithMesh(initialNode);
            entranceImage.linkOffsetY = 0; // Offset slightly above the node
            entranceImage.linkOffsetX = 65; // Offset slightly to the right
            
            // Update parent based on initial alpha quadrant
            updateEntranceParent();
        } else {
            console.warn('Neither Entrance_High nor Entrance_Low node found in model');
        }

    } catch (err) {
        console.error("Error loading model:", err);
    }

    // Load all furniture models (hidden by default)
    const furnitureFiles = [
        { file: 'Furniture_1.glb', key: 'furniture1' },
        { file: 'Furniture_2.glb', key: 'furniture2' },
        { file: 'Furniture_3.glb', key: 'furniture3' }
    ];

    for (const { file, key } of furnitureFiles) {
        try {
            const furnitureResult = await BABYLON.SceneLoader.ImportMeshAsync(
                "", "./assets/", file, scene
            );

            // Store furniture meshes and hide them
            // Filter out transform nodes (like __root__) - only include actual geometry meshes
            furnitureResult.meshes.forEach(mesh => {
                // Skip root transform nodes and empty transform nodes (only actual meshes have vertices)
                if (mesh.name === '__root__' || (mesh.getTotalVertices && mesh.getTotalVertices() === 0)) {
                    return;
                }
                
                // Store original scaling to preserve any negative scales or non-uniform scales
                if (!mesh._originalScaling) {
                    mesh._originalScaling = mesh.scaling.clone();
                }
                
                furnitureSets[key].push(mesh);
                mesh.setEnabled(false);  // Hidden by default
                mesh.visibility = 0;     // Also set visibility to 0 to prevent any render flash
                
                // Add click handler to furniture meshes too (except 'Base')
                if (mesh.name && !mesh.name.includes('Base')) {
                    mesh.actionManager = new BABYLON.ActionManager(scene);
                    mesh.actionManager.registerAction(
                        new BABYLON.ExecuteCodeAction(
                            BABYLON.ActionManager.OnPickTrigger,
                            () => toggleMode()
                        )
                    );
                }
            });

            console.log(`Loaded ${furnitureSets[key].length} meshes from ${file} (hidden)`);

        } catch (err) {
            console.error(`Error loading ${file}:`, err);
        }
    }

    return scene;
};

// Update sun texture based on slider value
const updateSunTexture = (index) => {
    if (index < 0 || index >= sunTextures.length) return;
    
    currentSunTextureIndex = index;
    const texture = sunTextures[index];
    if (texture) {
        if (blendedTextureWhite) blendedTextureWhite.setTexture("sunSampler", texture);
        if (blendedTextureAccent) blendedTextureAccent.setTexture("sunSampler", texture);
        if (blendedTextureAccent2) blendedTextureAccent2.setTexture("sunSampler", texture);
    }
};

// Update sun path title based on slider value (maps to time of day)
const updateSunPathTitle = (sliderValue) => {
    const title = document.getElementById('sunPathTitle');
    if (!title) return;
    
    const startHour = 6; // 6AM
    const totalHours = 15; // 6AM to 9PM (15 hours)
    const hourIncrement = totalHours / 39; // 39 intervals between 40 positions
    const hour = startHour + (sliderValue - 1) * hourIncrement;
    
    // Format as 12-hour time (whole hours only)
    const h = Math.round(hour);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h > 12 ? h - 12 : h === 0 ? 12 : h;
    
    title.textContent = `Sun path - ${h12}${ampm}`;
};

// Initialize
createScene().then(() => {
    engine.runRenderLoop(() => {
        updateCameraFromScroll();
        scene.render();
    });
    
    // Track user interactions to reset idle timer
    const resetIdleTimer = () => {
        lastInteractionTime = Date.now();
    };
    
    // Reset idle timer on pointer/scroll interactions
    // Use pointer events (not mouse) and capture phase to catch before Babylon.js
    canvas.addEventListener('pointerdown', resetIdleTimer, { capture: true });
    canvas.addEventListener('pointermove', resetIdleTimer, { capture: true });
    canvas.addEventListener('wheel', resetIdleTimer, { capture: true });
    window.addEventListener('scroll', resetIdleTimer);
    
    // Also hook into Babylon's pointer observable as a backup
    scene.onPointerObservable.add(() => {
        resetIdleTimer();
    });
    
    // Log beta angle every 500ms
    setInterval(() => {
        if (camera) {
            const betaDegrees = (camera.beta * 180 / Math.PI).toFixed(2);
            console.log(`Camera beta: ${camera.beta.toFixed(4)} rad (${betaDegrees}°)`);
        }
    }, 500);
    
    // Setup furniture cycle button
    const cycleFurnitureBtn = document.getElementById('cycleFurnitureBtn');
    if (cycleFurnitureBtn) {
        cycleFurnitureBtn.addEventListener('click', cycleFurniture);
    }
    
    // Setup sun texture slider
    const sunTextureSlider = document.getElementById('sunTextureSlider');
    if (sunTextureSlider) {
        sunTextureSlider.addEventListener('input', (e) => {
            const value = parseInt(e.target.value);
            updateSunTexture(value - 1);  // Convert 1-40 to 0-39 index
            updateSunPathTitle(value);     // Update title with time
        });
        // Set initial values (slider value 14 = 11AM)
        updateSunTexture(13);  // Index 13 (0-based) corresponds to slider value 14
        updateSunPathTitle(14);
    }
});

window.addEventListener("resize", () => engine.resize());
