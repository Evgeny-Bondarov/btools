/**
 * Mockup Slider Studio — Unwoven 16:9
 * Three.js + GSAP + Custom WebGL Shaders
 */

(function () {
  "use strict";

  /* ================================================================== *
   * 1. Configuration & Initial State
   * ================================================================== */

  const CONFIG = {
    // 16:9 Aspect Ratio
    aspectRatio: 16 / 9,     // 1.7777778
    cardHeight: 400,         // px
    cardRadius: 24,          // px corner radius
    cardGap: 40,             // px gap between cards
    
    // Geometry & Ribbons
    threads: 26,             // ribbons per card (threads)
    segments: 24,            // horizontal subdivisions
    
    // Animation & Motion
    scrollSpeed: 95,         // px per second
    direction: -1,           // -1: left, 1: right
    isPlaying: true,
    pauseOnHover: true,
    flingMax: 4200,          // max fling speed
    
    // Tear Zone (Viewport Edge unravelling)
    tearZoneWidth: 380,      // px depth from viewport edge
    
    // Shader Mode: 'threads' (0), 'pixel' (1), 'liquid' (2)
    shaderMode: 'threads',
    
    // Entire Construction Screen-Edge Erase (Left, Right, Top, Bottom)
    fadeLeft: true,
    fadeRight: true,
    fadeTop: false,
    fadeBottom: false,
    fadeDepth: 0.22,         // fraction of screen half-dimension
    
    // Threads params
    wobble: 1.0,
    
    // Pixelation params
    pixelSize: 20.0,
    pixelScatter: 45.0,
    pixelSeed: 42.1337,
    
    // Liquid params
    liquidFreq: 6.0,
    liquidStrength: 1.2,
    liquidSpeed: 1.5,
    liquidSeed: 17.89,
    
    // Interaction mode: 'pan_media' (Casemaker pan/zoom) vs 'scroll_slider'
    panMediaMode: false,
  };

  // Default images from unwoven
  const DEFAULT_IMAGES = [
    "./img/motion_blur_portrait_01.jpg",
    "./img/motion_blur_portrait_02.jpg",
    "./img/motion_blur_portrait_03.jpg",
    "./img/motion_blur_portrait_04.jpg",
    "./img/motion_blur_portrait_05.jpg",
    "./img/motion_blur_portrait_06.jpg",
  ];

  // Procedural gradient palettes for generated fallback cards
  const PALETTES = [
    { base: ["#1e1b4b", "#312e81"], accent: "#6366f1", text: "Portfolio Project 01" },
    { base: ["#064e3b", "#065f46"], accent: "#10b981", text: "Creative Case 02" },
    { base: ["#4c1d95", "#581c87"], accent: "#a855f7", text: "Design Concept 03" },
    { base: ["#701a75", "#86198f"], accent: "#ec4899", text: "Interactive Art 04" },
    { base: ["#1c1917", "#292524"], accent: "#f59e0b", text: "Mockup Studio 05" },
    { base: ["#0c4a6e", "#075985"], accent: "#0284c7", text: "Digital Space 06" },
  ];

  // State of all slides
  let slidesData = [];
  let activeSlideIndex = null;
  let activeUploadingIndex = null;

  /* ================================================================== *
   * 2. Procedural Placeholder Canvas Generator
   * ================================================================== */

  function drawPlaceholder16_9(palette, index) {
    const w = 1280;
    const h = 720; // 16:9 exactly
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");

    // Background gradient
    const grad = ctx.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0, palette.base[0]);
    grad.addColorStop(1, palette.base[1]);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // Subtle modern grid
    ctx.strokeStyle = "rgba(255, 255, 255, 0.05)";
    ctx.lineWidth = 1;
    for (let x = 0; x < w; x += 80) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    for (let y = 0; y < h; y += 80) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    // Glowing organic circle
    const glow = ctx.createRadialGradient(w * 0.7, h * 0.4, 20, w * 0.7, h * 0.4, 380);
    glow.addColorStop(0, palette.accent + "88");
    glow.addColorStop(1, "transparent");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, h);

    // Card frame mockup mock
    ctx.fillStyle = "rgba(255, 255, 255, 0.06)";
    ctx.roundRect ? ctx.roundRect(80, 80, w - 160, h - 160, 24) : ctx.rect(80, 80, w - 160, h - 160);
    ctx.fill();

    // Typography
    ctx.fillStyle = "#ffffff";
    ctx.font = "700 48px 'Plus Jakarta Sans', sans-serif";
    ctx.fillText(palette.text, 140, 240);

    ctx.fillStyle = "rgba(255, 255, 255, 0.6)";
    ctx.font = "500 24px 'JetBrains Mono', monospace";
    ctx.fillText("MOCKUP 16:9 • SLIDE #" + (index + 1), 140, 300);

    ctx.fillStyle = palette.accent;
    ctx.fillRect(140, 340, 80, 6);

    return canvas;
  }

  /* ================================================================== *
   * 3. GLSL Shaders
   * ================================================================== */

  const VERTEX_SHADER = /* glsl */ `
    attribute float aThread;   // ribbon index, 0 .. threads-1
    attribute float aRim;      // -1 at top edge, +1 at bottom

    uniform float uTime;
    uniform float uHalfWidth;
    uniform float uHalfHeight;
    uniform float uZone;
    uniform float uStrength;
    uniform float uWobble;
    uniform float uSeed;
    uniform int   uShaderMode; // 0 = threads, 1 = pixel, 2 = liquid
    uniform float uLiquidSpeed;
    uniform float uLiquidFreq;
    uniform float uLiquidStrength;
    uniform float uLiquidSeed;

    varying vec2  vUv;
    varying float vTear;
    varying float vRim;
    varying float vRandom;
    varying vec3  vWorldPos;

    float hash(float n) {
      return fract(sin(n * 127.1 + 311.7) * 43758.5453);
    }

    void main() {
      vUv = uv;
      vRim = aRim;

      vec4 world = modelMatrix * vec4(position, 1.0);
      float x = world.x;

      // Tear zone interpolation (left and right edges)
      float left  = 1.0 - smoothstep(-uHalfWidth, -uHalfWidth + uZone, x);
      float right = smoothstep(uHalfWidth - uZone, uHalfWidth, x);
      float tear  = max(left, right) * uStrength;

      float direction = x < 0.0 ? -1.0 : 1.0;
      float randomA = hash(aThread + uSeed * 57.0);
      float randomB = hash(aThread * 3.7 + uSeed * 91.0);
      vRandom = randomA;

      float t = pow(tear, 1.4);

      if (uShaderMode == 0) {
        // --- MODE 0: THREADS / ВОЛОСЫ ---
        float run = t * (60.0 + randomA * 420.0);
        run *= 0.85 + 0.15 * sin(uTime * (1.0 + randomB * 2.0) + randomA * 6.2831);
        world.x += direction * run;

        world.y += (randomA - 0.5) * 170.0 * t * t;
        world.y += sin(world.x * 0.02 + uTime * (1.6 + randomA * 2.2) + randomA * 6.2831)
                   * (5.0 + 13.0 * randomA) * t * uWobble;
      } 
      else if (uShaderMode == 1) {
        // --- MODE 1: PIXELATION / ПИКСЕЛИ ---
        world.x += direction * t * 140.0;
      }
      else if (uShaderMode == 2) {
        // --- MODE 2: LIQUID MELT / ЖИДКОСТЬ ---
        float lTime = uTime * uLiquidSpeed + uLiquidSeed * 8.0;
        float fluidWave = sin(world.y * 0.02 * uLiquidFreq + lTime) * cos(world.x * 0.02 + lTime * 0.7);
        world.x += (direction * t * 180.0) + fluidWave * 25.0 * t * uLiquidStrength;
        world.y -= t * t * 90.0 * uLiquidStrength;
      }

      vTear = tear;
      vWorldPos = world.xyz;
      gl_Position = projectionMatrix * viewMatrix * world;
    }
  `;

  const FRAGMENT_SHADER = /* glsl */ `
    precision highp float;

    uniform sampler2D uMap;
    uniform vec2  uCardSize;       // in pixels (width, height)
    uniform float uRadius;         // corner radius in px
    uniform float uImageAspect;    // width / height of source image
    
    // Per-card Media Transforms (Casemaker Pan & Zoom & Fit/Fill)
    uniform vec2  uMediaOffset;    // in px (x, y)
    uniform float uMediaScale;     // zoom scale (1.0 = 100%)
    uniform int   uFitMode;        // 0 = fill (cover), 1 = fit (contain)

    // Entire Construction Screen-Edge Erase (Left, Right, Top, Bottom)
    uniform float uFadeLeft;
    uniform float uFadeRight;
    uniform float uFadeTop;
    uniform float uFadeBottom;
    uniform float uFadeDepth;
    uniform float uHalfWidth;
    uniform float uHalfHeight;

    // Shader Effects Mode
    uniform int   uShaderMode;     // 0 = threads, 1 = pixel, 2 = liquid
    uniform float uPixelSize;      // block size in px
    uniform float uPixelScatter;   // scatter amount 0..100
    uniform float uPixelSeed;
    
    uniform float uLiquidSpeed;
    uniform float uLiquidFreq;
    uniform float uLiquidStrength;
    uniform float uLiquidSeed;
    uniform float uTime;

    varying vec2  vUv;
    varying float vTear;
    varying float vRim;
    varying float vRandom;
    varying vec3  vWorldPos;

    float hash21(vec2 p) {
      p = fract(p * vec2(234.34, 435.345));
      p += dot(p, p + 34.23);
      return fract(p.x * p.y);
    }

    float sdRoundBox(vec2 p, vec2 b, float r) {
      vec2 q = abs(p) - b + r;
      return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
    }

    void main() {
      float tear = vTear;
      float rim  = abs(vRim);

      // --- 1. Card Silhouette (16:9 Rounded Box) ---
      vec2 p = (vUv - 0.5) * uCardSize;
      float cardDist = sdRoundBox(p, uCardSize * 0.5, uRadius);
      float cardAlpha = 1.0 - smoothstep(-1.5, 0.5, cardDist);
      if (cardAlpha <= 0.001) discard;

      // --- 2. Entire Construction Screen-Edge Erase (Where hair/threads end at screen boundary) ---
      // vWorldPos.x in [-uHalfWidth, +uHalfWidth], vWorldPos.y in [-uHalfHeight, +uHalfHeight]
      float stageFade = 1.0;
      float fadeZoneX = max(10.0, uFadeDepth * uHalfWidth);
      float fadeZoneY = max(10.0, uFadeDepth * uHalfHeight);

      if (uFadeLeft > 0.5) {
        stageFade *= smoothstep(-uHalfWidth, -uHalfWidth + fadeZoneX, vWorldPos.x);
      }
      if (uFadeRight > 0.5) {
        stageFade *= 1.0 - smoothstep(uHalfWidth - fadeZoneX, uHalfWidth, vWorldPos.x);
      }
      if (uFadeBottom > 0.5) {
        stageFade *= smoothstep(-uHalfHeight, -uHalfHeight + fadeZoneY, vWorldPos.y);
      }
      if (uFadeTop > 0.5) {
        stageFade *= 1.0 - smoothstep(uHalfHeight - fadeZoneY, uHalfHeight, vWorldPos.y);
      }

      // --- 3. UV Texture Sampling (Pan & Zoom for long landing pages and images) ---
      float cardAspect = uCardSize.x / uCardSize.y;
      vec2 renderSize;

      if (uFitMode == 0) {
        // FILL (Cover 16:9)
        if (cardAspect > uImageAspect) {
          // Tall / Long image -> width fits card, height extends vertically
          renderSize.x = uCardSize.x;
          renderSize.y = uCardSize.x / max(0.001, uImageAspect);
        } else {
          // Wide image -> height fits card, width extends horizontally
          renderSize.y = uCardSize.y;
          renderSize.x = uCardSize.y * uImageAspect;
        }
      } else {
        // FIT (Contain inside 16:9)
        if (cardAspect > uImageAspect) {
          renderSize.y = uCardSize.y;
          renderSize.x = uCardSize.y * uImageAspect;
        } else {
          renderSize.x = uCardSize.x;
          renderSize.y = uCardSize.x / max(0.001, uImageAspect);
        }
      }

      // Zoom scale factor
      renderSize *= max(0.01, uMediaScale);

      // Card pixel coordinates relative to card center
      vec2 cardPointPx = (vUv - 0.5) * uCardSize;

      // In Three.js OpenGL +Y is up, in DOM drag moving mouse down is +Y.
      // So OpenGL image offset is (uMediaOffset.x, -uMediaOffset.y).
      vec2 imageOffsetGl = vec2(uMediaOffset.x, -uMediaOffset.y);
      vec2 posInImage = cardPointPx - imageOffsetGl;

      // Normalized texture coordinate [0..1]
      vec2 sampleUv;
      sampleUv.x = (posInImage.x / renderSize.x) + 0.5;
      sampleUv.y = (posInImage.y / renderSize.y) + 0.5;

      vec3 bgColor = vec3(0.06, 0.07, 0.10);

      // --- 4. Shader Dissolve Modes ---
      float effectAlpha = 1.0;
      vec3 finalColor = bgColor;

      if (uShaderMode == 0) {
        // ===== MODE 0: THREADS / ВОЛОСЫ (Unwoven Default) =====
        float coreWidth = mix(0.8, 0.16 + vRandom * 0.12, smoothstep(0.0, 0.85, tear));
        float threadAlpha = 1.0 - smoothstep(coreWidth - 0.10, coreWidth + 0.06, rim);
        threadAlpha = mix(1.0, threadAlpha, smoothstep(0.03, 0.30, tear));

        float fade = 1.0 - smoothstep(0.75, 1.0, tear) * 0.65;
        effectAlpha = threadAlpha * fade;

        // Sample texture within image bounds
        if (sampleUv.x >= 0.0 && sampleUv.x <= 1.0 && sampleUv.y >= 0.0 && sampleUv.y <= 1.0) {
          finalColor = texture2D(uMap, sampleUv).rgb;
        }

        // Thread physical sheen
        finalColor *= 1.0 - tear * 0.4 * rim * rim;
        finalColor += tear * 0.18 * (1.0 - smoothstep(0.0, 0.45, rim));
        finalColor = mix(finalColor, vec3(1.0), smoothstep(0.55, 1.0, tear) * 0.8);
      }
      else if (uShaderMode == 1) {
        // ===== MODE 1: PIXELATION / ПИКСЕЛИ =====
        vec2 grid = uCardSize / max(2.0, uPixelSize);
        vec2 pCoord = floor(vUv * grid);
        
        float rand1 = hash21(pCoord + vec2(uPixelSeed * 13.37, uPixelSeed * 71.19));
        float rand2 = hash21(pCoord * 1.618 + vec2(uPixelSeed * 91.13, uPixelSeed * 37.41));

        // Block UV quantization
        vec2 blockPointPx = ((pCoord + 0.5) / grid - 0.5) * uCardSize;
        vec2 blockPosInImage = blockPointPx - imageOffsetGl;
        vec2 quantSampleUv = vec2(blockPosInImage.x / renderSize.x + 0.5, blockPosInImage.y / renderSize.y + 0.5);

        vec2 pixUv = mix(sampleUv, quantSampleUv, smoothstep(0.0, 0.5, tear));
        
        if (tear > 0.02) {
          vec2 scatter = (vec2(rand1, rand2) - 0.5) * tear * (uPixelScatter / 100.0) * 0.4;
          pixUv += scatter;
        }

        if (pixUv.x >= 0.0 && pixUv.x <= 1.0 && pixUv.y >= 0.0 && pixUv.y <= 1.0) {
          finalColor = texture2D(uMap, pixUv).rgb;
        }

        if (tear > 0.05) {
          float dropThreshold = smoothstep(0.05, 0.95, tear);
          if (rand2 < dropThreshold * 0.88) {
            discard;
          }
        }

        float fade = 1.0 - smoothstep(0.70, 1.0, tear) * 0.7;
        effectAlpha = fade;
      }
      else if (uShaderMode == 2) {
        // ===== MODE 2: LIQUID MELT / ЖИДКОСТЬ =====
        float lTime = uTime * uLiquidSpeed + uLiquidSeed * 10.0;
        vec2 fP = vUv * uLiquidFreq;
        
        float wave1 = sin(fP.y * 3.14 + lTime) * cos(fP.x * 2.2 - lTime * 0.8);
        float wave2 = cos(fP.x * 3.14 + lTime * 1.3) * sin(fP.y * 2.2 + lTime * 0.5);
        float wave3 = sin((fP.x + fP.y) * 2.0 - lTime * 1.5);
        
        float melt = pow(tear, 1.5) * uLiquidStrength;
        vec2 fluidDistort = vec2(wave1 * 0.04 + wave3 * 0.02, wave2 * 0.06 - melt * 0.25) * tear;
        vec2 liqUv = sampleUv + fluidDistort;

        if (liqUv.x >= 0.0 && liqUv.x <= 1.0 && liqUv.y >= 0.0 && liqUv.y <= 1.0) {
          float r = texture2D(uMap, liqUv + vec2(fluidDistort.x * 0.2, 0.0)).r;
          float g = texture2D(uMap, liqUv).g;
          float b = texture2D(uMap, liqUv - vec2(fluidDistort.x * 0.2, 0.0)).b;
          finalColor = vec3(r, g, b);
        }

        float fade = 1.0 - smoothstep(0.60, 1.0, tear);
        effectAlpha = fade;
      }

      float alpha = cardAlpha * effectAlpha * stageFade;
      if (alpha < 0.003) discard;

      gl_FragColor = vec4(finalColor, alpha);
    }
  `;

  /* ================================================================== *
   * 4. Three.js Scene Setup & Geometry Builder
   * ================================================================== */

  const stage = document.getElementById("stage");
  const stageContainer = document.getElementById("stageContainer");
  const stageOverlays = document.getElementById("stageOverlays");
  const cardHud = document.getElementById("cardHud");

  let renderer = null;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    stage.appendChild(renderer.domElement);
  } catch (err) {
    console.error("WebGL initialization failed:", err);
  }

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -100, 100);

  // Global shared uniforms across all cards
  const shared = {
    uTime:           { value: 0 },
    uHalfWidth:      { value: 1 },
    uHalfHeight:     { value: 1 },
    uZone:           { value: CONFIG.tearZoneWidth },
    uStrength:       { value: 1.0 },
    uWobble:         { value: CONFIG.wobble },
    uCardSize:       { value: new THREE.Vector2(1, 1) },
    uRadius:         { value: CONFIG.cardRadius },
    
    // Shader Mode
    uShaderMode:     { value: 0 },
    
    // Entire Construction Edge Erase (Where threads reach screen edges)
    uFadeLeft:       { value: CONFIG.fadeLeft ? 1.0 : 0.0 },
    uFadeRight:      { value: CONFIG.fadeRight ? 1.0 : 0.0 },
    uFadeTop:        { value: CONFIG.fadeTop ? 1.0 : 0.0 },
    uFadeBottom:     { value: CONFIG.fadeBottom ? 1.0 : 0.0 },
    uFadeDepth:      { value: CONFIG.fadeDepth },
    
    // Pixel params
    uPixelSize:      { value: CONFIG.pixelSize },
    uPixelScatter:   { value: CONFIG.pixelScatter },
    uPixelSeed:      { value: CONFIG.pixelSeed },
    
    // Liquid params
    uLiquidSpeed:    { value: CONFIG.liquidSpeed },
    uLiquidFreq:     { value: CONFIG.liquidFreq },
    uLiquidStrength: { value: CONFIG.liquidStrength },
    uLiquidSeed:     { value: CONFIG.liquidSeed },
  };

  /**
   * Ribbon Geometry with horizontal ribbon threads (from Unwoven)
   */
  function buildRibbonGeometry(width, height, threads, segments) {
    const columns = segments + 1;
    const perThread = columns * 2;
    const total = threads * perThread;

    const positions = new Float32Array(total * 3);
    const uvs = new Float32Array(total * 2);
    const rims = new Float32Array(total);
    const threadIds = new Float32Array(total);
    const indices = [];

    let v = 0;
    for (let t = 0; t < threads; t++) {
      for (let row = 0; row < 2; row++) {
        const vy = (t + row) / threads;
        for (let c = 0; c < columns; c++) {
          const ux = c / segments;
          positions[v * 3 + 0] = (ux - 0.5) * width;
          positions[v * 3 + 1] = (vy - 0.5) * height;
          positions[v * 3 + 2] = 0;
          uvs[v * 2 + 0] = ux;
          uvs[v * 2 + 1] = vy;
          rims[v] = row === 0 ? -1 : 1;
          threadIds[v] = t;
          v++;
        }
      }

      const base = t * perThread;
      for (let c = 0; c < segments; c++) {
        const bl = base + c;
        const br = base + c + 1;
        const tl = base + columns + c;
        const tr = base + columns + c + 1;
        indices.push(bl, br, tl, br, tr, tl);
      }
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geom.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
    geom.setAttribute("aRim", new THREE.BufferAttribute(rims, 1));
    geom.setAttribute("aThread", new THREE.BufferAttribute(threadIds, 1));
    geom.setIndex(indices);
    return geom;
  }

  function createTextureFromSource(source) {
    const texture = new THREE.Texture(source);
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;
    return texture;
  }

  /* ================================================================== *
   * 5. Slides State & Strip Management
   * ================================================================== */

  let cards = [];
  let geometry = null;
  let cardWidth = 0, cardHeight = 0, pitch = 0, stripSpan = 0;
  let viewportWidth = 0, viewportHeight = 0;

  // Initialize Slides Data
  function initSlidesData(count) {
    slidesData = [];
    for (let i = 0; i < count; i++) {
      const palette = PALETTES[i % PALETTES.length];
      const placeholderCanvas = drawPlaceholder16_9(palette, i);
      const texture = createTextureFromSource(placeholderCanvas);

      const slide = {
        id: "slide_" + i,
        index: i,
        texture: texture,
        imageAspect: 16 / 9,
        isCustomImage: false,
        
        // Casemaker Pan & Zoom Controls
        mediaOffset: { x: 0, y: 0 },
        mediaScale: 1.0,
        fitMode: 0, // 0 = fill (cover), 1 = fit (contain)
        
        // Per-slide Shader Material
        material: null,
      };

      slide.material = new THREE.ShaderMaterial({
        vertexShader: VERTEX_SHADER,
        fragmentShader: FRAGMENT_SHADER,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        uniforms: {
          uMap: { value: slide.texture },
          uSeed: { value: (i + 1) * 0.731 },
          uImageAspect: { value: slide.imageAspect },
          
          // Per-card Media Transforms
          uMediaOffset: { value: new THREE.Vector2(0, 0) },
          uMediaScale: { value: 1.0 },
          uFitMode: { value: 0 },
          
          // Shared Uniforms
          uTime: shared.uTime,
          uHalfWidth: shared.uHalfWidth,
          uHalfHeight: shared.uHalfHeight,
          uZone: shared.uZone,
          uStrength: shared.uStrength,
          uWobble: shared.uWobble,
          uCardSize: shared.uCardSize,
          uRadius: shared.uRadius,
          uShaderMode: shared.uShaderMode,
          
          uFadeLeft: shared.uFadeLeft,
          uFadeRight: shared.uFadeRight,
          uFadeTop: shared.uFadeTop,
          uFadeBottom: shared.uFadeBottom,
          uFadeDepth: shared.uFadeDepth,
          
          uPixelSize: shared.uPixelSize,
          uPixelScatter: shared.uPixelScatter,
          uPixelSeed: shared.uPixelSeed,
          
          uLiquidSpeed: shared.uLiquidSpeed,
          uLiquidFreq: shared.uLiquidFreq,
          uLiquidStrength: shared.uLiquidStrength,
          uLiquidSeed: shared.uLiquidSeed,
        },
      });

      slidesData.push(slide);

      // Load sample image if within default images range
      if (i < DEFAULT_IMAGES.length) {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => {
          slide.texture.image = img;
          slide.texture.needsUpdate = true;
          slide.imageAspect = img.naturalWidth / img.naturalHeight;
          slide.material.uniforms.uImageAspect.value = slide.imageAspect;
          slide.isCustomImage = true;
          slide.imageSrc = DEFAULT_IMAGES[i];
          renderMiniSlidesList();
        };
        img.src = DEFAULT_IMAGES[i];
      }
    }

    renderMiniSlidesList();
  }

  function rebuildStrip() {
    cards.forEach(card => {
      scene.remove(card.mesh);
      if (card.domSlot && card.domSlot.parentNode) {
        card.domSlot.parentNode.removeChild(card.domSlot);
      }
    });
    cards.length = 0;
    stageOverlays.innerHTML = "";

    if (geometry) geometry.dispose();
    geometry = buildRibbonGeometry(cardWidth, cardHeight, CONFIG.threads, CONFIG.segments);

    const count = slidesData.length;
    stripSpan = count * pitch;

    for (let i = 0; i < count; i++) {
      const slide = slidesData[i];
      const mesh = new THREE.Mesh(geometry, slide.material);
      mesh.frustumCulled = false;
      scene.add(mesh);

      // Create DOM overlay slot with "+" upload button
      const domSlot = document.createElement("div");
      domSlot.className = "card-overlay-slot";
      domSlot.dataset.slideIndex = i;

      domSlot.innerHTML = `
        <span class="card-badge">#${i + 1}</span>
        <button class="card-upload-btn" title="Загрузить / Заменить изображение на слайде #${i + 1}">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <line x1="12" y1="5" x2="12" y2="19"></line>
            <line x1="5" y1="12" x2="19" y2="12"></line>
          </svg>
        </button>
      `;

      // Upload button click
      const uploadBtn = domSlot.querySelector(".card-upload-btn");
      uploadBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        triggerUploadForSlide(i);
      });

      stageOverlays.appendChild(domSlot);

      cards.push({
        mesh,
        slide,
        baseX: i * pitch,
        domSlot,
      });
    }

    updateHudPosition();
  }

  function resize() {
    if (!renderer) return;

    viewportWidth = stage.clientWidth;
    viewportHeight = stage.clientHeight;

    renderer.setSize(viewportWidth, viewportHeight);
    camera.left = -viewportWidth / 2;
    camera.right = viewportWidth / 2;
    camera.top = viewportHeight / 2;
    camera.bottom = -viewportHeight / 2;
    camera.updateProjectionMatrix();

    // 16:9 Sizing
    cardHeight = Math.min(CONFIG.cardHeight, viewportHeight * 0.65);
    cardWidth = cardHeight * CONFIG.aspectRatio; // 16:9
    pitch = cardWidth + Math.max(0, CONFIG.cardGap);

    shared.uHalfWidth.value = viewportWidth / 2;
    shared.uHalfHeight.value = viewportHeight / 2;
    shared.uZone.value = Math.min(viewportWidth * 0.35, CONFIG.tearZoneWidth);
    shared.uCardSize.value.set(cardWidth, cardHeight);

    const dimLabel = document.getElementById("labelDimensions");
    if (dimLabel) {
      dimLabel.textContent = `${Math.round(cardWidth)} × ${Math.round(cardHeight)} px`;
    }

    rebuildStrip();
  }

  /* ================================================================== *
   * 6. Motion & Interactive Slider Physics (Direct Pan & Scroll)
   * ================================================================== */

  const motion = { velocity: CONFIG.scrollSpeed * CONFIG.direction };
  let offset = 0;
  let isDraggingStage = false;
  let lastX = 0, lastTime = 0, dragVelocity = 0;

  // Casemaker interactive Pan inside slide
  let isPanningMedia = false;
  let panSlideIndex = null;
  let panStartX = 0, panStartY = 0;
  let initialMediaOffset = { x: 0, y: 0 };

  function updateVelocityTarget() {
    if (!CONFIG.isPlaying) {
      gsap.to(motion, { velocity: 0, duration: 0.6, ease: "power2.out" });
    } else {
      const targetV = CONFIG.scrollSpeed * CONFIG.direction;
      gsap.to(motion, { velocity: targetV, duration: 1.2, ease: "power2.out" });
    }
  }

  // Pointer Down on Stage Container
  stageContainer.addEventListener("pointerdown", (event) => {
    // If clicking upload button or inside HUD, let those elements handle their own events
    if (event.target.closest(".card-upload-btn") || event.target.closest("#cardHud")) {
      return;
    }

    // Determine if clicked over a card
    const targetSlot = event.target.closest(".card-overlay-slot");
    let clickedSlideIdx = targetSlot ? parseInt(targetSlot.dataset.slideIndex, 10) : null;

    // Fallback: check position relative to visible cards on canvas
    if (clickedSlideIdx === null) {
      const rect = stageContainer.getBoundingClientRect();
      const mouseX = event.clientX - rect.left - viewportWidth / 2;
      for (let i = 0; i < cards.length; i++) {
        if (Math.abs(mouseX - cards[i].mesh.position.x) <= cardWidth / 2) {
          clickedSlideIdx = cards[i].slide.index;
          break;
        }
      }
    }

    if (clickedSlideIdx !== null) {
      selectSlide(clickedSlideIdx);

      // Start image pan inside the slide
      isPanningMedia = true;
      panSlideIndex = clickedSlideIdx;
      panStartX = event.clientX;
      panStartY = event.clientY;
      const slide = slidesData[clickedSlideIdx];
      initialMediaOffset = { ...slide.mediaOffset };
      stageContainer.classList.add("is-panning-media");
      stageContainer.setPointerCapture(event.pointerId);
      event.preventDefault();
      return;
    }

    // Clicking anywhere on canvas outside slides -> DESELECT SLIDE!
    deselectSlide();

    // Otherwise drag the entire carousel strip
    isDraggingStage = true;
    lastX = event.clientX;
    lastTime = performance.now();
    dragVelocity = 0;
    stageContainer.classList.add("is-dragging");
    stageContainer.setPointerCapture(event.pointerId);
    gsap.killTweensOf(motion);
  });

  // Pointer Move on Stage Container
  stageContainer.addEventListener("pointermove", (event) => {
    if (isPanningMedia && panSlideIndex !== null) {
      // 1:1 Direct Pan for long landing pages and images
      const dx = event.clientX - panStartX;
      const dy = event.clientY - panStartY;
      const slide = slidesData[panSlideIndex];
      slide.mediaOffset.x = initialMediaOffset.x + dx;
      slide.mediaOffset.y = initialMediaOffset.y + dy;
      slide.material.uniforms.uMediaOffset.value.set(slide.mediaOffset.x, slide.mediaOffset.y);
      return;
    }

    if (!isDraggingStage) return;
    const now = performance.now();
    const dx = event.clientX - lastX;
    const dt = Math.max(1, now - lastTime) / 1000;
    offset -= dx;
    dragVelocity += (-dx / dt - dragVelocity) * 0.35;
    lastX = event.clientX;
    lastTime = now;
  });

  // End Drag / Pan
  function endInteraction() {
    if (isPanningMedia) {
      isPanningMedia = false;
      panSlideIndex = null;
      stageContainer.classList.remove("is-panning-media");
    }

    if (isDraggingStage) {
      isDraggingStage = false;
      stageContainer.classList.remove("is-dragging");
      motion.velocity = gsap.utils.clamp(-CONFIG.flingMax, CONFIG.flingMax, dragVelocity);
      updateVelocityTarget();
    }
  }

  stageContainer.addEventListener("pointerup", endInteraction);
  stageContainer.addEventListener("pointercancel", endInteraction);
  stageContainer.addEventListener("lostpointercapture", endInteraction);

  // Wheel Zoom (Casemaker Style: zoom active or hovered slide)
  stageContainer.addEventListener("wheel", (event) => {
    const targetSlot = event.target.closest(".card-overlay-slot");
    let targetIdx = targetSlot ? parseInt(targetSlot.dataset.slideIndex, 10) : activeSlideIndex;

    if (targetIdx !== null && slidesData[targetIdx]) {
      event.preventDefault();
      const slide = slidesData[targetIdx];
      const delta = event.deltaY < 0 ? 0.08 : -0.08;
      const nextScale = Math.max(0.2, Math.min(3.5, Number((slide.mediaScale + delta).toFixed(2))));
      setSlideScale(targetIdx, nextScale);
    }
  }, { passive: false });

  // Pause on hover
  stageContainer.addEventListener("mouseenter", () => {
    if (CONFIG.pauseOnHover && CONFIG.isPlaying && !isDraggingStage && !isPanningMedia) {
      gsap.to(motion, { velocity: 0, duration: 0.5 });
    }
  });

  stageContainer.addEventListener("mouseleave", () => {
    if (CONFIG.pauseOnHover && CONFIG.isPlaying && !isDraggingStage && !isPanningMedia) {
      updateVelocityTarget();
    }
  });

  /* ================================================================== *
   * 7. Frame Render Loop & DOM Overlay Synchronization
   * ================================================================== */

  gsap.ticker.add((time, deltaMS) => {
    if (!isDraggingStage && !isPanningMedia) {
      offset += motion.velocity * (deltaMS / 1000);
    }
    shared.uTime.value = time;

    const half = stripSpan / 2;
    const vpCenterX = viewportWidth / 2;
    const vpCenterY = viewportHeight / 2;

    for (let i = 0; i < cards.length; i++) {
      const card = cards[i];
      const x = ((card.baseX - offset) % stripSpan + stripSpan) % stripSpan;
      const meshX = x - half;
      card.mesh.position.x = meshX;

      // Position DOM overlay directly over 16:9 card
      if (card.domSlot) {
        const screenX = vpCenterX + meshX;
        const screenY = vpCenterY;
        card.domSlot.style.width = `${cardWidth}px`;
        card.domSlot.style.height = `${cardHeight}px`;
        card.domSlot.style.left = `${screenX}px`;
        card.domSlot.style.top = `${screenY}px`;
        card.domSlot.style.borderRadius = `${CONFIG.cardRadius}px`;

        if (activeSlideIndex === card.slide.index) {
          card.domSlot.classList.add("active");
        } else {
          card.domSlot.classList.remove("active");
        }
      }
    }

    updateHudPosition();

    if (renderer) {
      renderer.render(scene, camera);
    }
  });

  /* ================================================================== *
   * 8. Casemaker Active Card HUD & Slide Transform Controls
   * ================================================================== */

  function selectSlide(index) {
    activeSlideIndex = index;
    const slide = slidesData[index];
    if (!slide) return;

    cardHud.classList.remove("hidden");
    document.getElementById("hudCardNum").textContent = `#${index + 1}`;
    
    // Fit / Fill Button state
    const fitFillBtn = document.getElementById("hudFitFillText");
    fitFillBtn.textContent = slide.fitMode === 0 ? "Fill (Cover)" : "Fit (Contain)";

    // Zoom slider & input state
    const zoomSlider = document.getElementById("hudZoomSlider");
    zoomSlider.value = slide.mediaScale;
    const zoomInput = document.getElementById("hudZoomInput");
    if (zoomInput) zoomInput.value = Math.round(slide.mediaScale * 100);

    updateHudPosition();
    renderMiniSlidesList();
  }

  function deselectSlide() {
    activeSlideIndex = null;
    cardHud.classList.add("hidden");
    document.querySelectorAll(".card-overlay-slot.active").forEach(el => el.classList.remove("active"));
    document.querySelectorAll(".mini-slide-item.active").forEach(el => el.classList.remove("active"));
  }

  function updateHudPosition() {
    if (activeSlideIndex === null || cardHud.classList.contains("hidden")) return;
    const activeCard = cards.find(c => c.slide.index === activeSlideIndex);
    if (!activeCard) return;

    const vpCenterX = viewportWidth / 2;
    const vpCenterY = viewportHeight / 2;
    const screenX = vpCenterX + activeCard.mesh.position.x;
    const screenY = vpCenterY - (cardHeight / 2);

    cardHud.style.left = `${screenX}px`;
    cardHud.style.top = `${screenY}px`;
  }

  function setSlideScale(index, scale) {
    const slide = slidesData[index];
    if (!slide) return;
    slide.mediaScale = scale;
    slide.material.uniforms.uMediaScale.value = scale;
    if (activeSlideIndex === index) {
      document.getElementById("hudZoomSlider").value = scale;
      const zoomInput = document.getElementById("hudZoomInput");
      if (zoomInput) zoomInput.value = Math.round(scale * 100);
    }
  }

  function toggleSlideFitMode(index) {
    const slide = slidesData[index];
    if (!slide) return;
    slide.fitMode = slide.fitMode === 0 ? 1 : 0;
    slide.material.uniforms.uFitMode.value = slide.fitMode;
    const fitFillBtn = document.getElementById("hudFitFillText");
    if (fitFillBtn) {
      fitFillBtn.textContent = slide.fitMode === 0 ? "Fill (Cover)" : "Fit (Contain)";
    }
  }

  function resetSlideTransform(index) {
    const slide = slidesData[index];
    if (!slide) return;
    slide.mediaOffset = { x: 0, y: 0 };
    slide.mediaScale = 1.0;
    slide.material.uniforms.uMediaOffset.value.set(0, 0);
    slide.material.uniforms.uMediaScale.value = 1.0;
    if (activeSlideIndex === index) {
      document.getElementById("hudZoomSlider").value = 1.0;
      document.getElementById("hudZoomVal").textContent = "100%";
    }
  }

  /**
   * Quick Anchor for long pages / screenshots (Top Header, Center, Bottom Footer)
   */
  function anchorSlideMedia(index, position) {
    const slide = slidesData[index];
    if (!slide) return;

    const cardAspect = cardWidth / cardHeight;
    let renderHeight = 0;
    if (slide.fitMode === 0) {
      if (cardAspect > slide.imageAspect) {
        renderHeight = (cardWidth / Math.max(0.001, slide.imageAspect)) * slide.mediaScale;
      } else {
        renderHeight = cardHeight * slide.mediaScale;
      }
    } else {
      if (cardAspect > slide.imageAspect) {
        renderHeight = cardHeight * slide.mediaScale;
      } else {
        renderHeight = (cardWidth / Math.max(0.001, slide.imageAspect)) * slide.mediaScale;
      }
    }

    const overflowY = renderHeight - cardHeight;
    slide.mediaOffset.x = 0;

    if (position === "top") {
      slide.mediaOffset.y = overflowY > 0 ? (overflowY / 2) : 0;
    } else if (position === "bottom") {
      slide.mediaOffset.y = overflowY > 0 ? -(overflowY / 2) : 0;
    } else {
      slide.mediaOffset.y = 0;
    }

    slide.material.uniforms.uMediaOffset.value.set(slide.mediaOffset.x, slide.mediaOffset.y);
  }

  function deleteSlide(index) {
    if (slidesData.length <= 2) {
      alert("Минимальное количество слайдов — 2.");
      return;
    }
    slidesData.splice(index, 1);
    slidesData.forEach((s, idx) => { s.index = idx; });
    activeSlideIndex = null;
    cardHud.classList.add("hidden");
    document.getElementById("inputSlideCount").value = slidesData.length;
    rebuildStrip();
    renderMiniSlidesList();
  }

  function addSlide() {
    const newIdx = slidesData.length;
    const palette = PALETTES[newIdx % PALETTES.length];
    const placeholderCanvas = drawPlaceholder16_9(palette, newIdx);
    const texture = createTextureFromSource(placeholderCanvas);

    const slide = {
      id: "slide_" + newIdx,
      index: newIdx,
      texture: texture,
      imageAspect: 16 / 9,
      isCustomImage: false,
      mediaOffset: { x: 0, y: 0 },
      mediaScale: 1.0,
      fitMode: 0,
      material: null,
    };

    slide.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uMap: { value: slide.texture },
        uSeed: { value: (newIdx + 1) * 0.731 },
        uImageAspect: { value: slide.imageAspect },
        uMediaOffset: { value: new THREE.Vector2(0, 0) },
        uMediaScale: { value: 1.0 },
        uFitMode: { value: 0 },
        uTime: shared.uTime,
        uHalfWidth: shared.uHalfWidth,
        uHalfHeight: shared.uHalfHeight,
        uZone: shared.uZone,
        uStrength: shared.uStrength,
        uWobble: shared.uWobble,
        uCardSize: shared.uCardSize,
        uRadius: shared.uRadius,
        uShaderMode: shared.uShaderMode,
        uFadeLeft: shared.uFadeLeft,
        uFadeRight: shared.uFadeRight,
        uFadeTop: shared.uFadeTop,
        uFadeBottom: shared.uFadeBottom,
        uFadeDepth: shared.uFadeDepth,
        uPixelSize: shared.uPixelSize,
        uPixelScatter: shared.uPixelScatter,
        uPixelSeed: shared.uPixelSeed,
        uLiquidSpeed: shared.uLiquidSpeed,
        uLiquidFreq: shared.uLiquidFreq,
        uLiquidStrength: shared.uLiquidStrength,
        uLiquidSeed: shared.uLiquidSeed,
      },
    });

    slidesData.push(slide);
    document.getElementById("inputSlideCount").value = slidesData.length;
    rebuildStrip();
    renderMiniSlidesList();
    selectSlide(newIdx);
  }

  /* ================================================================== *
   * 9. Image Upload Handlers (Click + & Drag/Drop)
   * ================================================================== */

  const globalFileInput = document.getElementById("globalFileInput");
  const dropOverlay = document.getElementById("dropOverlay");

  function triggerUploadForSlide(index) {
    activeUploadingIndex = index;
    globalFileInput.value = "";
    globalFileInput.click();
  }

  globalFileInput.addEventListener("change", (e) => {
    const file = e.target.files && e.target.files[0];
    if (file && activeUploadingIndex !== null) {
      applyImageFileToSlide(file, activeUploadingIndex);
    }
  });

  function applyImageFileToSlide(file, slideIndex) {
    const slide = slidesData[slideIndex];
    if (!slide) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      const img = new Image();
      img.onload = () => {
        slide.texture.image = img;
        slide.texture.needsUpdate = true;
        slide.imageAspect = img.naturalWidth / img.naturalHeight;
        slide.material.uniforms.uImageAspect.value = slide.imageAspect;
        slide.isCustomImage = true;
        slide.imageSrc = evt.target.result;
        
        // If image is vertical / long landing page, anchor to top!
        const cardAspect = cardWidth / cardHeight;
        if (slide.imageAspect < cardAspect) {
          anchorSlideMedia(slideIndex, "top");
        } else {
          resetSlideTransform(slideIndex);
        }
        
        renderMiniSlidesList();
        selectSlide(slideIndex);
      };
      img.src = evt.target.result;
    };
    reader.readAsDataURL(file);
  }

  // Drag and Drop files onto Canvas
  window.addEventListener("dragenter", (e) => {
    e.preventDefault();
    dropOverlay.classList.remove("hidden");
  });

  window.addEventListener("dragover", (e) => {
    e.preventDefault();
  });

  window.addEventListener("dragleave", (e) => {
    if (e.relatedTarget === null) {
      dropOverlay.classList.add("hidden");
    }
  });

  window.addEventListener("drop", (e) => {
    e.preventDefault();
    dropOverlay.classList.add("hidden");
    const file = e.dataTransfer && e.dataTransfer.files[0];
    if (file && file.type.startsWith("image/")) {
      const targetIdx = activeSlideIndex !== null ? activeSlideIndex : 0;
      applyImageFileToSlide(file, targetIdx);
    }
  });

  /* ================================================================== *
   * 10. Sidebar Mini Slides List
   * ================================================================== */

  function renderMiniSlidesList() {
    const list = document.getElementById("slidesMiniList");
    if (!list) return;
    list.innerHTML = "";

    slidesData.forEach((slide, idx) => {
      const item = document.createElement("div");
      item.className = "mini-slide-item" + (activeSlideIndex === idx ? " active" : "");
      item.title = `Слайд #${idx + 1} (клик для настройки)`;

      let thumbSrc = "";
      if (slide.texture && slide.texture.image) {
        if (slide.texture.image instanceof HTMLCanvasElement) {
          thumbSrc = slide.texture.image.toDataURL();
        } else if (slide.texture.image.src) {
          thumbSrc = slide.texture.image.src;
        }
      }

      item.innerHTML = `
        <img class="mini-slide-thumb" src="${thumbSrc}" alt="Slide ${idx + 1}" />
        <span class="mini-slide-idx">#${idx + 1}</span>
      `;

      item.addEventListener("click", () => {
        selectSlide(idx);
      });

      list.appendChild(item);
    });
  }

  /* ================================================================== *
   * 11. UI Controls Wiring & Event Listeners
   * ================================================================== */

  function setupUIEvents() {
    // Play / Pause
    const btnPlayPause = document.getElementById("btnPlayPause");
    const iconPause = document.getElementById("iconPause");
    const iconPlay = document.getElementById("iconPlay");

    btnPlayPause.addEventListener("click", () => {
      CONFIG.isPlaying = !CONFIG.isPlaying;
      iconPause.classList.toggle("hidden", !CONFIG.isPlaying);
      iconPlay.classList.toggle("hidden", CONFIG.isPlaying);
      updateVelocityTarget();
    });

    // Direction Left / Right
    const btnDirLeft = document.getElementById("btnDirLeft");
    const btnDirRight = document.getElementById("btnDirRight");
    const btnDirLeftToggle = document.getElementById("btnDirLeftToggle");
    const btnDirRightToggle = document.getElementById("btnDirRightToggle");

    function setDirection(dir) {
      CONFIG.direction = dir;
      btnDirLeftToggle.classList.toggle("active", dir === -1);
      btnDirRightToggle.classList.toggle("active", dir === 1);
      updateVelocityTarget();
    }

    btnDirLeft.addEventListener("click", () => setDirection(-1));
    btnDirRight.addEventListener("click", () => setDirection(1));
    btnDirLeftToggle.addEventListener("click", () => setDirection(-1));
    btnDirRightToggle.addEventListener("click", () => setDirection(1));

    // Pan Media Mode Toggle in Topbar
    const btnTogglePanMode = document.getElementById("btnTogglePanMode");
    const panModeLabel = document.getElementById("panModeLabel");
    btnTogglePanMode.addEventListener("click", () => {
      CONFIG.panMediaMode = !CONFIG.panMediaMode;
      btnTogglePanMode.classList.toggle("btn-primary", CONFIG.panMediaMode);
      btnTogglePanMode.classList.toggle("btn-secondary", !CONFIG.panMediaMode);
      panModeLabel.textContent = CONFIG.panMediaMode ? "Режим: Двигать фото" : "Режим: Двигать ленту";
    });

    // Toggle Sidebar
    const btnToggleSidebar = document.getElementById("btnToggleSidebar");
    const sidebar = document.getElementById("sidebar");
    btnToggleSidebar.addEventListener("click", () => {
      sidebar.classList.toggle("collapsed");
      setTimeout(resize, 260);
    });

    // Shader Mode Selector (Top Pills & Sidebar Select)
    const modeSelector = document.getElementById("modeSelector");
    const selectShaderMode = document.getElementById("selectShaderMode");
    const paramsThreads = document.getElementById("paramsThreads");
    const paramsPixel = document.getElementById("paramsPixel");
    const paramsLiquid = document.getElementById("paramsLiquid");

    function setShaderMode(mode) {
      CONFIG.shaderMode = mode;
      const modeInt = mode === "threads" ? 0 : (mode === "pixel" ? 1 : 2);
      shared.uShaderMode.value = modeInt;

      modeSelector.querySelectorAll(".pill").forEach(p => {
        p.classList.toggle("active", p.dataset.shaderMode === mode);
      });

      selectShaderMode.value = mode;

      paramsThreads.classList.toggle("hidden", mode !== "threads");
      paramsPixel.classList.toggle("hidden", mode !== "pixel");
      paramsLiquid.classList.toggle("hidden", mode !== "liquid");
    }

    modeSelector.addEventListener("click", (e) => {
      const pill = e.target.closest(".pill");
      if (pill) setShaderMode(pill.dataset.shaderMode);
    });

    selectShaderMode.addEventListener("change", (e) => {
      setShaderMode(e.target.value);
    });

    // Slide Count Controls
    const inputSlideCount = document.getElementById("inputSlideCount");
    const btnIncSlides = document.getElementById("btnIncSlides");
    const btnDecSlides = document.getElementById("btnDecSlides");
    const btnAddSlide = document.getElementById("btnAddSlide");

    btnIncSlides.addEventListener("click", addSlide);
    btnAddSlide.addEventListener("click", addSlide);
    btnDecSlides.addEventListener("click", () => {
      if (slidesData.length > 2) deleteSlide(slidesData.length - 1);
    });

    inputSlideCount.addEventListener("change", (e) => {
      const val = Math.max(2, Math.min(24, parseInt(e.target.value, 10) || 6));
      while (slidesData.length < val) addSlide();
      while (slidesData.length > val) deleteSlide(slidesData.length - 1);
    });

    // Card Radius Slider
    const inputCardRadius = document.getElementById("inputCardRadius");
    const valCardRadius = document.getElementById("valCardRadius");
    inputCardRadius.addEventListener("input", (e) => {
      const r = parseFloat(e.target.value);
      CONFIG.cardRadius = r;
      shared.uRadius.value = r;
      valCardRadius.textContent = `${r}px`;
    });

    // Card Gap Slider (in Pixels!)
    const inputCardGap = document.getElementById("inputCardGap");
    const valCardGap = document.getElementById("valCardGap");
    inputCardGap.addEventListener("input", (e) => {
      CONFIG.cardGap = parseInt(e.target.value, 10);
      valCardGap.textContent = `${CONFIG.cardGap}px`;
      resize();
    });

    // Card Height Slider
    const inputCardHeight = document.getElementById("inputCardHeight");
    const valCardHeight = document.getElementById("valCardHeight");
    inputCardHeight.addEventListener("input", (e) => {
      CONFIG.cardHeight = parseFloat(e.target.value);
      valCardHeight.textContent = `${CONFIG.cardHeight}px`;
      resize();
    });

    // Speed Slider
    const inputSpeed = document.getElementById("inputSpeed");
    const valSpeed = document.getElementById("valSpeed");
    inputSpeed.addEventListener("input", (e) => {
      CONFIG.scrollSpeed = parseFloat(e.target.value);
      valSpeed.textContent = `${CONFIG.scrollSpeed} px/s`;
      updateVelocityTarget();
    });

    // Pause on Hover Toggle
    const chkPauseOnHover = document.getElementById("chkPauseOnHover");
    chkPauseOnHover.addEventListener("change", (e) => {
      CONFIG.pauseOnHover = e.target.checked;
    });

    // Entire Construction Screen-Edge Erase / Fade (Left, Right, Top, Bottom)
    const chkFadeLeft = document.getElementById("chkFadeLeft");
    const chkFadeRight = document.getElementById("chkFadeRight");
    const chkFadeTop = document.getElementById("chkFadeTop");
    const chkFadeBottom = document.getElementById("chkFadeBottom");
    const inputFadeDepth = document.getElementById("inputFadeDepth");
    const valFadeDepth = document.getElementById("valFadeDepth");
    const edgePreviewBox = document.getElementById("edgePreviewBox");

    function updateEdgeFadeUniforms() {
      CONFIG.fadeLeft = chkFadeLeft.checked;
      CONFIG.fadeRight = chkFadeRight.checked;
      CONFIG.fadeTop = chkFadeTop.checked;
      CONFIG.fadeBottom = chkFadeBottom.checked;

      shared.uFadeLeft.value = chkFadeLeft.checked ? 1.0 : 0.0;
      shared.uFadeRight.value = chkFadeRight.checked ? 1.0 : 0.0;
      shared.uFadeTop.value = chkFadeTop.checked ? 1.0 : 0.0;
      shared.uFadeBottom.value = chkFadeBottom.checked ? 1.0 : 0.0;

      edgePreviewBox.classList.toggle("fade-left", chkFadeLeft.checked);
      edgePreviewBox.classList.toggle("fade-right", chkFadeRight.checked);
      edgePreviewBox.classList.toggle("fade-top", chkFadeTop.checked);
      edgePreviewBox.classList.toggle("fade-bottom", chkFadeBottom.checked);
      const allActive = chkFadeLeft.checked && chkFadeRight.checked && chkFadeTop.checked && chkFadeBottom.checked;
      edgePreviewBox.classList.toggle("all-active", allActive);
    }

    edgePreviewBox?.addEventListener("click", () => {
      const allActive = chkFadeLeft.checked && chkFadeRight.checked && chkFadeTop.checked && chkFadeBottom.checked;
      const targetState = !allActive;
      chkFadeLeft.checked = targetState;
      chkFadeRight.checked = targetState;
      chkFadeTop.checked = targetState;
      chkFadeBottom.checked = targetState;
      updateEdgeFadeUniforms();
    });

    chkFadeLeft.addEventListener("change", updateEdgeFadeUniforms);
    chkFadeRight.addEventListener("change", updateEdgeFadeUniforms);
    chkFadeTop.addEventListener("change", updateEdgeFadeUniforms);
    chkFadeBottom.addEventListener("change", updateEdgeFadeUniforms);
    updateEdgeFadeUniforms();

    inputFadeDepth.addEventListener("input", (e) => {
      const depth = parseFloat(e.target.value);
      CONFIG.fadeDepth = depth;
      shared.uFadeDepth.value = depth;
      valFadeDepth.textContent = `${Math.round(depth * 100)}%`;
    });

    // Tear Zone Width
    const inputTearZone = document.getElementById("inputTearZone");
    const valTearZone = document.getElementById("valTearZone");
    inputTearZone.addEventListener("input", (e) => {
      CONFIG.tearZoneWidth = parseFloat(e.target.value);
      shared.uZone.value = CONFIG.tearZoneWidth;
      valTearZone.textContent = `${CONFIG.tearZoneWidth}px`;
    });

    // Threads Params
    const inputThreadCount = document.getElementById("inputThreadCount");
    const valThreadCount = document.getElementById("valThreadCount");
    inputThreadCount.addEventListener("change", (e) => {
      CONFIG.threads = parseInt(e.target.value, 10);
      valThreadCount.textContent = CONFIG.threads;
      rebuildStrip();
    });

    const inputWobble = document.getElementById("inputWobble");
    const valWobble = document.getElementById("valWobble");
    inputWobble.addEventListener("input", (e) => {
      CONFIG.wobble = parseFloat(e.target.value);
      shared.uWobble.value = CONFIG.wobble;
      valWobble.textContent = `${CONFIG.wobble.toFixed(1)}×`;
    });

    const btnRandomThreads = document.getElementById("btnRandomThreads");
    btnRandomThreads?.addEventListener("click", () => {
      const counts = [14, 18, 22, 26, 30, 36, 42, 48];
      CONFIG.threads = counts[Math.floor(Math.random() * counts.length)];
      CONFIG.wobble = Math.round((0.6 + Math.random() * 4.4) * 10) / 10;
      inputThreadCount.value = CONFIG.threads;
      valThreadCount.textContent = CONFIG.threads;
      inputWobble.value = CONFIG.wobble;
      valWobble.textContent = `${CONFIG.wobble.toFixed(1)}×`;
      shared.uWobble.value = CONFIG.wobble;
      rebuildStrip();
    });

    // Pixel Params
    const inputPixelSize = document.getElementById("inputPixelSize");
    const valPixelSize = document.getElementById("valPixelSize");
    inputPixelSize.addEventListener("input", (e) => {
      CONFIG.pixelSize = parseFloat(e.target.value);
      shared.uPixelSize.value = CONFIG.pixelSize;
      valPixelSize.textContent = `${CONFIG.pixelSize}px`;
    });

    const inputPixelScatter = document.getElementById("inputPixelScatter");
    const valPixelScatter = document.getElementById("valPixelScatter");
    inputPixelScatter.addEventListener("input", (e) => {
      CONFIG.pixelScatter = parseFloat(e.target.value);
      shared.uPixelScatter.value = CONFIG.pixelScatter;
      valPixelScatter.textContent = `${CONFIG.pixelScatter}%`;
    });

    const btnRandomPixel = document.getElementById("btnRandomPixel");
    btnRandomPixel?.addEventListener("click", () => {
      const sizes = [8, 12, 16, 20, 24, 28, 32, 40];
      CONFIG.pixelSize = sizes[Math.floor(Math.random() * sizes.length)];
      CONFIG.pixelScatter = Math.round((20 + Math.random() * 65) / 5) * 5;
      CONFIG.pixelSeed = Math.round(Math.random() * 1000.0 * 100) / 100;

      inputPixelSize.value = CONFIG.pixelSize;
      valPixelSize.textContent = `${CONFIG.pixelSize}px`;
      inputPixelScatter.value = CONFIG.pixelScatter;
      valPixelScatter.textContent = `${CONFIG.pixelScatter}%`;

      shared.uPixelSize.value = CONFIG.pixelSize;
      shared.uPixelScatter.value = CONFIG.pixelScatter;
      shared.uPixelSeed.value = CONFIG.pixelSeed;
    });

    // Liquid Params
    const inputLiquidFreq = document.getElementById("inputLiquidFreq");
    const valLiquidFreq = document.getElementById("valLiquidFreq");
    inputLiquidFreq.addEventListener("input", (e) => {
      CONFIG.liquidFreq = parseFloat(e.target.value);
      shared.uLiquidFreq.value = CONFIG.liquidFreq;
      valLiquidFreq.textContent = CONFIG.liquidFreq.toFixed(1);
    });

    const inputLiquidStrength = document.getElementById("inputLiquidStrength");
    const valLiquidStrength = document.getElementById("valLiquidStrength");
    inputLiquidStrength.addEventListener("input", (e) => {
      CONFIG.liquidStrength = parseFloat(e.target.value);
      shared.uLiquidStrength.value = CONFIG.liquidStrength;
      valLiquidStrength.textContent = `${CONFIG.liquidStrength.toFixed(1)}×`;
    });

    const inputLiquidSpeed = document.getElementById("inputLiquidSpeed");
    const valLiquidSpeed = document.getElementById("valLiquidSpeed");
    inputLiquidSpeed.addEventListener("input", (e) => {
      CONFIG.liquidSpeed = parseFloat(e.target.value);
      shared.uLiquidSpeed.value = CONFIG.liquidSpeed;
      valLiquidSpeed.textContent = `${CONFIG.liquidSpeed.toFixed(1)}×`;
    });

    const btnRandomLiquid = document.getElementById("btnRandomLiquid");
    btnRandomLiquid?.addEventListener("click", () => {
      CONFIG.liquidFreq = Math.round((2.0 + Math.random() * 8.0) * 2) / 2;
      CONFIG.liquidStrength = Math.round((0.6 + Math.random() * 1.8) * 10) / 10;
      CONFIG.liquidSpeed = Math.round((0.8 + Math.random() * 1.6) * 10) / 10;
      CONFIG.liquidSeed = Math.round(Math.random() * 1000.0 * 100) / 100;

      inputLiquidFreq.value = CONFIG.liquidFreq;
      valLiquidFreq.textContent = CONFIG.liquidFreq.toFixed(1);
      inputLiquidStrength.value = CONFIG.liquidStrength;
      valLiquidStrength.textContent = `${CONFIG.liquidStrength.toFixed(1)}×`;
      inputLiquidSpeed.value = CONFIG.liquidSpeed;
      valLiquidSpeed.textContent = `${CONFIG.liquidSpeed.toFixed(1)}×`;

      shared.uLiquidFreq.value = CONFIG.liquidFreq;
      shared.uLiquidStrength.value = CONFIG.liquidStrength;
      shared.uLiquidSpeed.value = CONFIG.liquidSpeed;
      shared.uLiquidSeed.value = CONFIG.liquidSeed;
    });

    // HUD Actions
    const hudFitFillToggle = document.getElementById("hudFitFillToggle");
    hudFitFillToggle.addEventListener("click", () => {
      if (activeSlideIndex !== null) toggleSlideFitMode(activeSlideIndex);
    });

    const hudResetTransform = document.getElementById("hudResetTransform");
    hudResetTransform.addEventListener("click", () => {
      if (activeSlideIndex !== null) resetSlideTransform(activeSlideIndex);
    });

    const hudUploadBtn = document.getElementById("hudUploadBtn");
    hudUploadBtn.addEventListener("click", () => {
      if (activeSlideIndex !== null) triggerUploadForSlide(activeSlideIndex);
    });

    const hudDeleteBtn = document.getElementById("hudDeleteBtn");
    hudDeleteBtn.addEventListener("click", () => {
      if (activeSlideIndex !== null) deleteSlide(activeSlideIndex);
    });

    const hudZoomSlider = document.getElementById("hudZoomSlider");
    const hudZoomInput = document.getElementById("hudZoomInput");

    hudZoomSlider.addEventListener("input", (e) => {
      if (activeSlideIndex !== null) {
        setSlideScale(activeSlideIndex, parseFloat(e.target.value));
      }
    });

    if (hudZoomInput) {
      const handleZoomManual = (e) => {
        if (activeSlideIndex === null) return;
        let pct = parseInt(e.target.value, 10);
        if (isNaN(pct)) return;
        pct = Math.max(20, Math.min(400, pct));
        setSlideScale(activeSlideIndex, pct / 100);
      };
      hudZoomInput.addEventListener("input", handleZoomManual);
      hudZoomInput.addEventListener("change", handleZoomManual);
    }

    // Quick Anchors for Landing Pages
    const btnAnchorTop = document.getElementById("btnAnchorTop");
    const btnAnchorCenter = document.getElementById("btnAnchorCenter");
    const btnAnchorBottom = document.getElementById("btnAnchorBottom");

    if (btnAnchorTop) {
      btnAnchorTop.addEventListener("click", () => {
        if (activeSlideIndex !== null) anchorSlideMedia(activeSlideIndex, "top");
      });
    }
    if (btnAnchorCenter) {
      btnAnchorCenter.addEventListener("click", () => {
        if (activeSlideIndex !== null) anchorSlideMedia(activeSlideIndex, "center");
      });
    }
    if (btnAnchorBottom) {
      btnAnchorBottom.addEventListener("click", () => {
        if (activeSlideIndex !== null) anchorSlideMedia(activeSlideIndex, "bottom");
      });
    }

    // Database Presets Events
    setupPresetsEvents();

    // Code & AI Export Modal Events
    setupCodeModalEvents();

    // Figma Export Events (PNG 1x/2x & WebM without background)
    setupFigmaExportEvents();
  }

  /* ================================================================== *
   * 13. Persistent Database Presets (API: /api/slider/presets)
   * ================================================================== */

  let savedPresets = [];

  async function fetchPresetsFromDB() {
    try {
      const res = await fetch("/api/slider/presets");
      if (res.ok) {
        savedPresets = await res.json();
        renderPresetsUI();
      }
    } catch (e) {
      console.warn("Could not load presets from server API, using local fallback:", e);
    }
  }

  async function savePresetToDB(name) {
    const trimmed = (name || "").trim() || "Слайдер " + new Date().toLocaleDateString();
    
    // Extract current slide settings and images
    const slidesConfig = slidesData.map(s => {
      let src = s.imageSrc || null;
      if (!src && s.texture && s.texture.image) {
        if (s.texture.image.src) {
          src = s.texture.image.src;
        } else if (s.texture.image instanceof HTMLCanvasElement && s.isCustomImage) {
          src = s.texture.image.toDataURL('image/jpeg', 0.85);
        }
      }
      return {
        index: s.index,
        mediaOffset: { ...s.mediaOffset },
        mediaScale: s.mediaScale,
        fitMode: s.fitMode,
        imageSrc: src,
        isCustomImage: s.isCustomImage
      };
    });

    const presetData = {
      id: "preset_" + Date.now(),
      name: trimmed,
      createdAt: new Date().toISOString(),
      config: {
        aspectRatio: CONFIG.aspectRatio,
        cardHeight: CONFIG.cardHeight,
        cardRadius: CONFIG.cardRadius,
        cardGap: CONFIG.cardGap,
        threads: CONFIG.threads,
        scrollSpeed: CONFIG.scrollSpeed,
        direction: CONFIG.direction,
        tearZoneWidth: CONFIG.tearZoneWidth,
        shaderMode: CONFIG.shaderMode,
        fadeLeft: CONFIG.fadeLeft,
        fadeRight: CONFIG.fadeRight,
        fadeTop: CONFIG.fadeTop,
        fadeBottom: CONFIG.fadeBottom,
        fadeDepth: CONFIG.fadeDepth,
        wobble: CONFIG.wobble,
        pixelSize: CONFIG.pixelSize,
        pixelScatter: CONFIG.pixelScatter,
        pixelSeed: CONFIG.pixelSeed,
        liquidFreq: CONFIG.liquidFreq,
        liquidStrength: CONFIG.liquidStrength,
        liquidSpeed: CONFIG.liquidSpeed,
        liquidSeed: CONFIG.liquidSeed,
        slideCount: slidesData.length
      },
      slides: slidesConfig
    };

    try {
      const res = await fetch("/api/slider/presets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(presetData)
      });
      if (res.ok) {
        showToast("Пресет и изображения сохранены в базу данных!");
        fetchPresetsFromDB();
      }
    } catch (err) {
      console.error("Save preset error:", err);
      showToast("Ошибка сохранения пресета");
    }
  }

  async function deletePresetFromDB(id) {
    try {
      const res = await fetch(`/api/slider/presets?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (res.ok) {
        showToast("Пресет удален из базы данных");
        fetchPresetsFromDB();
      }
    } catch (e) {
      console.error("Delete preset error:", e);
    }
  }

  function applyPreset(preset) {
    if (!preset || !preset.config) return;
    const cfg = preset.config;

    CONFIG.cardHeight = cfg.cardHeight || 400;
    CONFIG.cardRadius = cfg.cardRadius !== undefined ? cfg.cardRadius : 24;
    CONFIG.cardGap = cfg.cardGap !== undefined ? cfg.cardGap : (cfg.cardGapRatio ? Math.round(cfg.cardGapRatio * 400) : 40);
    CONFIG.threads = cfg.threads || 26;
    CONFIG.scrollSpeed = cfg.scrollSpeed !== undefined ? cfg.scrollSpeed : 95;
    CONFIG.direction = cfg.direction || -1;
    CONFIG.tearZoneWidth = cfg.tearZoneWidth || 380;
    CONFIG.shaderMode = cfg.shaderMode || "threads";
    CONFIG.fadeLeft = !!cfg.fadeLeft;
    CONFIG.fadeRight = !!cfg.fadeRight;
    CONFIG.fadeTop = !!cfg.fadeTop;
    CONFIG.fadeBottom = !!cfg.fadeBottom;
    CONFIG.fadeDepth = cfg.fadeDepth !== undefined ? cfg.fadeDepth : 0.22;
    CONFIG.wobble = cfg.wobble || 1.0;
    CONFIG.pixelSize = cfg.pixelSize || 20.0;
    CONFIG.pixelScatter = cfg.pixelScatter || 45.0;
    CONFIG.liquidFreq = cfg.liquidFreq || 6.0;
    CONFIG.liquidStrength = cfg.liquidStrength || 1.2;
    CONFIG.liquidSpeed = cfg.liquidSpeed || 1.5;

    // Apply uniforms
    shared.uRadius.value = CONFIG.cardRadius;
    shared.uWobble.value = CONFIG.wobble;
    shared.uZone.value = CONFIG.tearZoneWidth;
    shared.uFadeLeft.value = CONFIG.fadeLeft ? 1.0 : 0.0;
    shared.uFadeRight.value = CONFIG.fadeRight ? 1.0 : 0.0;
    shared.uFadeTop.value = CONFIG.fadeTop ? 1.0 : 0.0;
    shared.uFadeBottom.value = CONFIG.fadeBottom ? 1.0 : 0.0;
    shared.uFadeDepth.value = CONFIG.fadeDepth;
    shared.uPixelSize.value = CONFIG.pixelSize;
    shared.uPixelScatter.value = CONFIG.pixelScatter;
    shared.uLiquidFreq.value = CONFIG.liquidFreq;
    shared.uLiquidStrength.value = CONFIG.liquidStrength;
    shared.uLiquidSpeed.value = CONFIG.liquidSpeed;

    // Sync UI controls
    document.getElementById("inputCardRadius").value = CONFIG.cardRadius;
    document.getElementById("valCardRadius").textContent = `${CONFIG.cardRadius}px`;
    document.getElementById("inputCardHeight").value = CONFIG.cardHeight;
    document.getElementById("valCardHeight").textContent = `${CONFIG.cardHeight}px`;
    document.getElementById("inputCardGap").value = CONFIG.cardGap;
    document.getElementById("valCardGap").textContent = `${CONFIG.cardGap}px`;
    document.getElementById("inputSpeed").value = CONFIG.scrollSpeed;
    document.getElementById("valSpeed").textContent = `${CONFIG.scrollSpeed} px/s`;
    
    document.getElementById("chkFadeLeft").checked = CONFIG.fadeLeft;
    document.getElementById("chkFadeRight").checked = CONFIG.fadeRight;
    document.getElementById("chkFadeTop").checked = CONFIG.fadeTop;
    document.getElementById("chkFadeBottom").checked = CONFIG.fadeBottom;
    document.getElementById("inputFadeDepth").value = CONFIG.fadeDepth;
    document.getElementById("valFadeDepth").textContent = `${Math.round(CONFIG.fadeDepth * 100)}%`;
    
    document.getElementById("edgePreviewBox").classList.toggle("fade-left", CONFIG.fadeLeft);
    document.getElementById("edgePreviewBox").classList.toggle("fade-right", CONFIG.fadeRight);
    document.getElementById("edgePreviewBox").classList.toggle("fade-top", CONFIG.fadeTop);
    document.getElementById("edgePreviewBox").classList.toggle("fade-bottom", CONFIG.fadeBottom);

    // Shader mode switch
    const modeInt = CONFIG.shaderMode === "threads" ? 0 : (CONFIG.shaderMode === "pixel" ? 1 : 2);
    shared.uShaderMode.value = modeInt;
    document.querySelectorAll("#modeSelector .pill").forEach(p => {
      p.classList.toggle("active", p.dataset.shaderMode === CONFIG.shaderMode);
    });
    document.getElementById("selectShaderMode").value = CONFIG.shaderMode;
    document.getElementById("paramsThreads").classList.toggle("hidden", CONFIG.shaderMode !== "threads");
    document.getElementById("paramsPixel").classList.toggle("hidden", CONFIG.shaderMode !== "pixel");
    document.getElementById("paramsLiquid").classList.toggle("hidden", CONFIG.shaderMode !== "liquid");

    // Adjust slide count if specified in preset
    if (cfg.slideCount && cfg.slideCount !== slidesData.length) {
      while (slidesData.length < cfg.slideCount) addSlide();
      while (slidesData.length > cfg.slideCount) deleteSlide(slidesData.length - 1);
    }

    // Apply per-slide transforms and RESTORE IMAGES!
    if (preset.slides && Array.isArray(preset.slides)) {
      preset.slides.forEach((sl, idx) => {
        if (slidesData[idx]) {
          slidesData[idx].mediaOffset = { ...(sl.mediaOffset || { x: 0, y: 0 }) };
          slidesData[idx].mediaScale = sl.mediaScale || 1.0;
          slidesData[idx].fitMode = sl.fitMode !== undefined ? sl.fitMode : 0;
          slidesData[idx].material.uniforms.uMediaOffset.value.set(slidesData[idx].mediaOffset.x, slidesData[idx].mediaOffset.y);
          slidesData[idx].material.uniforms.uMediaScale.value = slidesData[idx].mediaScale;
          slidesData[idx].material.uniforms.uFitMode.value = slidesData[idx].fitMode;

          // Restore image!
          if (sl.imageSrc) {
            const img = new Image();
            img.crossOrigin = "anonymous";
            img.onload = () => {
              if (slidesData[idx]) {
                slidesData[idx].texture.image = img;
                slidesData[idx].texture.needsUpdate = true;
                slidesData[idx].imageAspect = img.naturalWidth / img.naturalHeight;
                slidesData[idx].material.uniforms.uImageAspect.value = slidesData[idx].imageAspect;
                slidesData[idx].isCustomImage = true;
                slidesData[idx].imageSrc = sl.imageSrc;
                renderMiniSlidesList();
              }
            };
            img.src = sl.imageSrc;
          }
        }
      });
    }

    resize();
    updateVelocityTarget();
    showToast(`Загружен пресет: «${preset.name}»`);
  }

  function renderPresetsUI() {
    // 1. Sidebar quick list
    const quickList = document.getElementById("presetsQuickList");
    if (quickList) {
      quickList.innerHTML = "";
      if (savedPresets.length === 0) {
        quickList.innerHTML = `<div class="preset-card-desc">Нет сохраненных пресетов</div>`;
      } else {
        savedPresets.forEach(preset => {
          const item = document.createElement("div");
          item.className = "preset-item";
          const modeLabel = preset.config?.shaderMode === "pixel" ? "Пиксели" : (preset.config?.shaderMode === "liquid" ? "Жидкость" : "Волосы");
          item.innerHTML = `
            <div class="preset-item-info">
              <span class="preset-item-name" title="${preset.name}">${preset.name}</span>
              <span class="preset-item-meta">${modeLabel} &bull; ${preset.config?.cardHeight || 400}px</span>
            </div>
            <div class="preset-item-actions">
              <button class="btn btn-xs btn-primary btn-load-preset" title="Применить пресет">Применить</button>
              <button class="btn-icon-subtle text-danger btn-del-preset" title="Удалить из БД">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            </div>
          `;

          item.querySelector(".btn-load-preset").addEventListener("click", () => applyPreset(preset));
          item.querySelector(".btn-del-preset").addEventListener("click", () => deletePresetFromDB(preset.id));
          quickList.appendChild(item);
        });
      }
    }

    // 2. Modal grid
    const modalGrid = document.getElementById("presetsModalGrid");
    if (modalGrid) {
      modalGrid.innerHTML = "";
      savedPresets.forEach(preset => {
        const card = document.createElement("div");
        card.className = "preset-card";
        const dateStr = preset.createdAt ? new Date(preset.createdAt).toLocaleDateString() : "";
        const modeLabel = preset.config?.shaderMode === "pixel" ? "Пикселизация" : (preset.config?.shaderMode === "liquid" ? "Жидкость" : "Волосы/Нити");

        card.innerHTML = `
          <div class="preset-card-header">
            <span class="preset-card-title">${preset.name}</span>
            <span class="preset-card-desc">${dateStr}</span>
          </div>
          <div class="preset-card-badges">
            <span class="badge aspect-badge">16:9</span>
            <span class="badge">${modeLabel}</span>
            <span class="badge">${preset.config?.scrollSpeed || 95} px/s</span>
            <span class="badge">Радиус ${preset.config?.cardRadius || 24}px</span>
          </div>
          <div class="preset-card-actions">
            <button class="btn btn-primary btn-sm w-full btn-load-modal">Применить пресет</button>
            <button class="btn-icon-subtle text-danger btn-del-modal" title="Удалить">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="3 6 5 6 21 6"></polyline>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
              </svg>
            </button>
          </div>
        `;

        card.querySelector(".btn-load-modal").addEventListener("click", () => {
          applyPreset(preset);
          document.getElementById("presetsModal").classList.add("hidden");
        });
        card.querySelector(".btn-del-modal").addEventListener("click", () => deletePresetFromDB(preset.id));

        modalGrid.appendChild(card);
      });
    }
  }

  function setupPresetsEvents() {
    const btnSavePreset = document.getElementById("btnSavePreset");
    const inputPresetName = document.getElementById("inputPresetName");
    const btnOpenPresets = document.getElementById("btnOpenPresets");
    const presetsModal = document.getElementById("presetsModal");
    const btnClosePresetsModal = document.getElementById("btnClosePresetsModal");
    const btnModalSavePreset = document.getElementById("btnModalSavePreset");
    const inputModalPresetName = document.getElementById("inputModalPresetName");
    const btnExportPresetsFile = document.getElementById("btnExportPresetsFile");
    const btnImportPresetsFile = document.getElementById("btnImportPresetsFile");
    const inputImportPresetsFile = document.getElementById("inputImportPresetsFile");

    btnSavePreset.addEventListener("click", () => {
      savePresetToDB(inputPresetName.value);
      inputPresetName.value = "";
    });

    btnOpenPresets.addEventListener("click", () => {
      presetsModal.classList.remove("hidden");
      renderPresetsUI();
    });

    btnClosePresetsModal.addEventListener("click", () => {
      presetsModal.classList.add("hidden");
    });

    presetsModal.addEventListener("click", (e) => {
      if (e.target === presetsModal) presetsModal.classList.add("hidden");
    });

    btnModalSavePreset.addEventListener("click", () => {
      savePresetToDB(inputModalPresetName.value);
      inputModalPresetName.value = "";
    });

    // Export JSON File
    btnExportPresetsFile.addEventListener("click", () => {
      const blob = new Blob([JSON.stringify(savedPresets, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `slider_presets_${Date.now()}.json`;
      a.click();
    });

    // Import JSON File
    btnImportPresetsFile.addEventListener("click", () => {
      inputImportPresetsFile.click();
    });

    inputImportPresetsFile.addEventListener("change", (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async (evt) => {
        try {
          const imported = JSON.parse(evt.target.result);
          if (Array.isArray(imported)) {
            for (const p of imported) {
              await fetch("/api/slider/presets", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(p)
              });
            }
            showToast("Пресеты успешно импортированы!");
            fetchPresetsFromDB();
          }
        } catch (err) {
          alert("Неверный формат JSON файла");
        }
      };
      reader.readAsText(file);
    });

    fetchPresetsFromDB();
  }

  /* ================================================================== *
   * 14. Code Generator & AI Prompt Modal
   * ================================================================== */

  let currentCodeTab = "prompt";

  function setupCodeModalEvents() {
    const btnOpenCode = document.getElementById("btnOpenCode");
    const codeModal = document.getElementById("codeModal");
    const btnCloseCodeModal = document.getElementById("btnCloseCodeModal");
    const btnCopyCode = document.getElementById("btnCopyCode");
    const codeTabs = document.querySelectorAll(".code-tab");

    btnOpenCode.addEventListener("click", () => {
      codeModal.classList.remove("hidden");
      renderActiveCodeTab();
    });

    btnCloseCodeModal.addEventListener("click", () => {
      codeModal.classList.add("hidden");
    });

    codeModal.addEventListener("click", (e) => {
      if (e.target === codeModal) codeModal.classList.add("hidden");
    });

    codeTabs.forEach(tab => {
      tab.addEventListener("click", () => {
        codeTabs.forEach(t => t.classList.remove("active"));
        tab.classList.add("active");
        currentCodeTab = tab.dataset.tab;
        renderActiveCodeTab();
      });
    });

    btnCopyCode.addEventListener("click", () => {
      const codeText = document.getElementById("codeViewerContent").textContent;
      navigator.clipboard.writeText(codeText).then(() => {
        showToast("Код скопирован в буфер обмена!");
        const btnText = document.getElementById("btnCopyText");
        btnText.textContent = "✓ Скопировано!";
        setTimeout(() => { btnText.textContent = "Скопировать код"; }, 2000);
      });
    });
  }

  function renderActiveCodeTab() {
    const viewer = document.getElementById("codeViewerContent");
    const tip = document.getElementById("codeModalTip");

    if (currentCodeTab === "prompt") {
      viewer.textContent = generateAIPrompt();
      tip.textContent = "Передайте этот готовый промпт ИИ-агенту (Claude / Cursor / ChatGPT / Antigravity), чтобы он встроил слайдер на сайт.";
    } else if (currentCodeTab === "html") {
      viewer.textContent = generateHTMLEmbed();
      tip.textContent = "Готовый автономный HTML + CSS + JS код. Можно вставить на любой сайт или в Webflow/WordPress без сборщиков.";
    } else if (currentCodeTab === "react") {
      viewer.textContent = generateReactComponent();
      tip.textContent = "Готовый компонент React / Next.js (Tailwind / CSS Modules compatible) с рефом и хуком жизненного цикла.";
    } else if (currentCodeTab === "json") {
      viewer.textContent = generateJSONConfig();
      tip.textContent = "JSON-объект текущих настроек, шейдерных параметров и мокапов.";
    }
  }

  function generateAIPrompt() {
    const jsonCfg = JSON.stringify(getCurrentConfigObject(), null, 2);
    return `### Задача для ИИ-агента: Интеграция 16:9 WebGL 3D Слайдера с шейдером увода

Встрой интерактивный бесконечный слайдер мокапов в проект портфолио.
Компонент реализован на Three.js и GSAP с кастомными WebGL шейдерами (эффект увода по краям).

#### Характеристики и спецификация:
1. Пропорции мокапов: строго 16:9 (${Math.round(cardWidth)} × ${Math.round(cardHeight)} px)
2. Скругление углов: ${CONFIG.cardRadius}px (SDF antialiased)
3. Эффект увода по краям: ${CONFIG.shaderMode === "pixel" ? "Пикселизация (Pixel Dissolve & Scatter)" : (CONFIG.shaderMode === "liquid" ? "Жидкость (Liquid Melt)" : "Волосы / Нити (Silk Threads)")}
4. Стирание всей конструкции по краям экрана: Лево (${CONFIG.fadeLeft}), Право (${CONFIG.fadeRight}), Верх (${CONFIG.fadeTop}), Низ (${CONFIG.fadeBottom}) с глубиной ${Math.round(CONFIG.fadeDepth * 100)}%
5. Управление изображениями: Casemaker Pan & Zoom (поддержка длинных лендингов и шотов с возможностью прокрутки 1:1 до шапки или подвала)
6. Анимация: скорость ${CONFIG.scrollSpeed} px/s, направление ${CONFIG.direction === -1 ? "влево" : "вправо"}, инерция при свайпе/драге.

#### Конфигурация в JSON:
\`\`\`json
${jsonCfg}
\`\`\`

#### Инструкция по установке:
1. Подключи Three.js (\`https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js\`) и GSAP (\`https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js\`).
2. Вставь предоставленный готовый HTML/JS блок на нужную страницу или используй готовый React-компонент из вкладки "React".
3. Замени URL изображений на нужные скриншоты проектов портфолио.`;
  }

  function generateHTMLEmbed() {
    const cfg = getCurrentConfigObject();
    return `<!-- 16:9 WebGL Mockup Slider with Edge Unravelling Shaders -->
<div id="unwoven-slider-container" style="position: relative; width: 100%; height: 560px; overflow: hidden; background: #0c0d12;">
  <div id="unwoven-stage" style="width: 100%; height: 100%; cursor: grab;"></div>
</div>

<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"><\/script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js"><\/script>
<script>
(function() {
  const SLIDER_CONFIG = ${JSON.stringify(cfg, null, 4)};

  // Инициализация WebGL контейнера и трехмерной сцены
  const stage = document.getElementById("unwoven-stage");
  if (!stage || !window.THREE || !window.gsap) return;

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  stage.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -100, 100);

  // См. полный код шейдеров и RibbonGeometry в репозитории slider/slider.js
})();
<\/script>`;
  }

  function generateReactComponent() {
    const cfg = getCurrentConfigObject();
    return `import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import gsap from 'gsap';

export const SLIDER_PRESET = ${JSON.stringify(cfg, null, 2)};

export default function MockupSlider({
  images = [],
  speed = ${CONFIG.scrollSpeed},
  shaderMode = '${CONFIG.shaderMode}',
  className = ''
}) {
  const containerRef = useRef(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let renderer, scene, camera, animId;
    let width = container.clientWidth;
    let height = container.clientHeight;

    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setSize(width, height);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      container.appendChild(renderer.domElement);
    } catch (e) {
      console.warn("WebGL unavailable:", e);
      return;
    }

    scene = new THREE.Scene();
    camera = new THREE.OrthographicCamera(-width / 2, width / 2, height / 2, -height / 2, -100, 100);

    // Загрузка текстур и создание 16:9 мокап-ленты
    // Полнофункциональная реализация доступна в bondarovich/slider/slider.js

    const handleResize = () => {
      if (!container) return;
      width = container.clientWidth;
      height = container.clientHeight;
      renderer.setSize(width, height);
      camera.left = -width / 2;
      camera.right = width / 2;
      camera.top = height / 2;
      camera.bottom = -height / 2;
      camera.updateProjectionMatrix();
    };

    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      if (renderer?.domElement?.parentNode) {
        renderer.domElement.parentNode.removeChild(renderer.domElement);
      }
    };
  }, [images, speed, shaderMode]);

  return (
    <div
      ref={containerRef}
      className={\`w-full h-[520px] relative overflow-hidden bg-[#0c0d12] \${className}\`}
      style={{ touchAction: 'none' }}
    />
  );
}`;
  }

  function generateJSONConfig() {
    return JSON.stringify(getCurrentConfigObject(), null, 2);
  }

  function getCurrentConfigObject() {
    return {
      aspectRatio: "16:9",
      aspectRatioValue: CONFIG.aspectRatio,
      cardHeight: CONFIG.cardHeight,
      cardWidth: Math.round(cardWidth),
      cardRadius: CONFIG.cardRadius,
      cardGap: CONFIG.cardGap,
      slideCount: slidesData.length,
      animation: {
        speed: CONFIG.scrollSpeed,
        direction: CONFIG.direction,
        pauseOnHover: CONFIG.pauseOnHover,
        flingMax: CONFIG.flingMax
      },
      edgeEraseScreen: {
        fadeLeft: CONFIG.fadeLeft,
        fadeRight: CONFIG.fadeRight,
        fadeTop: CONFIG.fadeTop,
        fadeBottom: CONFIG.fadeBottom,
        fadeDepth: CONFIG.fadeDepth
      },
      shaders: {
        mode: CONFIG.shaderMode,
        tearZoneWidth: CONFIG.tearZoneWidth,
        threads: { count: CONFIG.threads, wobble: CONFIG.wobble },
        pixelation: { size: CONFIG.pixelSize, scatter: CONFIG.pixelScatter, seed: CONFIG.pixelSeed },
        liquid: { freq: CONFIG.liquidFreq, strength: CONFIG.liquidStrength, speed: CONFIG.liquidSpeed, seed: CONFIG.liquidSeed }
      },
      slides: slidesData.map(s => ({
        index: s.index,
        mediaOffset: s.mediaOffset,
        mediaScale: s.mediaScale,
        fitMode: s.fitMode === 0 ? "fill" : "fit",
        imageAspect: Number(s.imageAspect.toFixed(3))
      }))
    };
  }

  function showToast(msg) {
    const toast = document.getElementById("toastNotification");
    const toastMsg = document.getElementById("toastMessage");
    if (!toast || !toastMsg) return;
    toastMsg.textContent = msg;
    toast.classList.remove("hidden");
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => {
      toast.classList.add("hidden");
    }, 2800);
  }

  /* ================================================================== *
   * 15. Figma Export: Transparent PNG (1x, 2x) & Seamless WebM
   * ================================================================== */

  function setupFigmaExportEvents() {
    const btnFigmaExport = document.getElementById("btnFigmaExport");
    const figmaDropdownMenu = document.getElementById("figmaDropdownMenu");
    const btnExportPng1x = document.getElementById("btnExportPng1x");
    const btnExportPng2x = document.getElementById("btnExportPng2x");
    const btnOpenWebmModal = document.getElementById("btnOpenWebmModal");
    const webmModal = document.getElementById("webmModal");
    const btnCloseWebmModal = document.getElementById("btnCloseWebmModal");
    const btnCancelWebm = document.getElementById("btnCancelWebm");
    const btnStartWebmRender = document.getElementById("btnStartWebmRender");
    const groupWebmFps = document.getElementById("groupWebmFps");

    if (!btnFigmaExport || !figmaDropdownMenu) return;

    // Toggle Dropdown
    btnFigmaExport.addEventListener("click", (e) => {
      e.stopPropagation();
      figmaDropdownMenu.classList.toggle("hidden");
    });

    document.addEventListener("click", (e) => {
      if (!figmaDropdownMenu.contains(e.target) && e.target !== btnFigmaExport) {
        figmaDropdownMenu.classList.add("hidden");
      }
    });

    // PNG 1x
    btnExportPng1x.addEventListener("click", () => {
      figmaDropdownMenu.classList.add("hidden");
      exportPNG(1);
    });

    // PNG 2x Retina
    btnExportPng2x.addEventListener("click", () => {
      figmaDropdownMenu.classList.add("hidden");
      exportPNG(2);
    });

    // Open WebM Modal
    btnOpenWebmModal.addEventListener("click", () => {
      figmaDropdownMenu.classList.add("hidden");
      webmModal.classList.remove("hidden");
    });

    btnCloseWebmModal.addEventListener("click", () => webmModal.classList.add("hidden"));
    btnCancelWebm.addEventListener("click", () => webmModal.classList.add("hidden"));

    webmModal.addEventListener("click", (e) => {
      if (e.target === webmModal) webmModal.classList.add("hidden");
    });

    // FPS toggle
    let chosenFps = 30;
    groupWebmFps.querySelectorAll(".btn-toggle").forEach(btn => {
      btn.addEventListener("click", () => {
        groupWebmFps.querySelectorAll(".btn-toggle").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        chosenFps = parseInt(btn.dataset.fps, 10);
      });
    });

    // Start WebM Render
    btnStartWebmRender.addEventListener("click", () => {
      const loopType = document.getElementById("selectWebmLoopType").value;
      const bitrate = parseInt(document.getElementById("selectWebmBitrate").value, 10);
      startWebmRender(loopType, chosenFps, bitrate);
    });
  }

  function exportPNG(scale = 1) {
    if (!renderer) return;

    const originalRatio = renderer.getPixelRatio();
    const originalWidth = viewportWidth;
    const originalHeight = viewportHeight;

    // Render cleanly without background (alpha: true)
    renderer.setPixelRatio(scale);
    renderer.setSize(originalWidth, originalHeight, false);
    renderer.render(scene, camera);

    const dataUrl = renderer.domElement.toDataURL("image/png");

    // Restore viewport scale
    renderer.setPixelRatio(originalRatio);
    renderer.setSize(originalWidth, originalHeight);

    // Download file
    const link = document.createElement("a");
    link.href = dataUrl;
    link.download = `slider-mockup-${scale}x-transparent.png`;
    link.click();

    showToast(`✓ Скачан PNG (${scale}x) без фона для Figma!`);
  }

  let isRecordingWebm = false;

  function startWebmRender(loopType, fps = 30, bitrate = 12000000) {
    if (isRecordingWebm || !renderer) return;

    const speed = Math.max(20, Math.abs(CONFIG.scrollSpeed));
    let durationSeconds = 4.0;

    if (loopType === "one_card") {
      durationSeconds = Math.max(1.5, pitch / speed);
    } else if (loopType === "full_cycle") {
      durationSeconds = Math.max(3.0, stripSpan / speed);
    } else if (loopType === "fixed_5s") {
      durationSeconds = 5.0;
    } else if (loopType === "fixed_10s") {
      durationSeconds = 10.0;
    }

    durationSeconds = Math.min(30, durationSeconds);

    const canvas = renderer.domElement;
    let stream;
    try {
      stream = canvas.captureStream(fps);
    } catch (e) {
      alert("captureStream не поддерживается вашим браузером. Используйте Google Chrome или Edge.");
      return;
    }

    let mimeType = 'video/webm;codecs=vp9';
    if (!MediaRecorder.isTypeSupported(mimeType)) {
      mimeType = 'video/webm;codecs=vp8';
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = 'video/webm';
      }
    }

    let recorder;
    try {
      recorder = new MediaRecorder(stream, {
        mimeType,
        videoBitsPerSecond: bitrate
      });
    } catch (err) {
      console.warn("Fallback MediaRecorder:", err);
      recorder = new MediaRecorder(stream);
    }

    const chunks = [];
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };

    const progressWrap = document.getElementById("webmProgressWrap");
    const progressBar = document.getElementById("webmProgressBar");
    const progressPercent = document.getElementById("webmProgressPercent");
    const btnStartText = document.getElementById("btnStartWebmText");
    const btnStart = document.getElementById("btnStartWebmRender");

    progressWrap.classList.remove("hidden");
    progressBar.style.width = "0%";
    progressPercent.textContent = "0%";
    btnStart.disabled = true;
    btnStartText.textContent = "Идет запись...";
    isRecordingWebm = true;

    const wasPlaying = CONFIG.isPlaying;
    CONFIG.isPlaying = true;
    updateVelocityTarget();

    recorder.start(100);

    const startTime = performance.now();
    const totalMs = durationSeconds * 1000;

    const intervalId = setInterval(() => {
      const elapsed = performance.now() - startTime;
      const pct = Math.min(100, Math.round((elapsed / totalMs) * 100));
      progressBar.style.width = `${pct}%`;
      progressPercent.textContent = `${pct}%`;

      if (elapsed >= totalMs) {
        clearInterval(intervalId);
        recorder.stop();
      }
    }, 100);

    recorder.onstop = () => {
      isRecordingWebm = false;
      btnStart.disabled = false;
      btnStartText.textContent = "Начать рендеринг WebM";
      progressWrap.classList.add("hidden");
      document.getElementById("webmModal").classList.add("hidden");

      if (!wasPlaying) {
        CONFIG.isPlaying = false;
        updateVelocityTarget();
      }

      const blob = new Blob(chunks, { type: mimeType });
      const videoUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = videoUrl;
      a.download = `slider-seamless-transparent-${Math.round(durationSeconds)}s.webm`;
      a.click();

      showToast("✓ Бесшовное WebM видео без фона скачано! Перетащите в Figma.");
    };
  }

  /* ================================================================== *
   * 12. App Initialization
   * ================================================================== */

  function init() {
    initSlidesData(6);
    setupUIEvents();
    window.addEventListener("resize", resize);
    resize();
    updateVelocityTarget();
    setTimeout(() => { selectSlide(0); }, 300);
  }

  init();

})();
