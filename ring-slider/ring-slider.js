/**
 * Ring Slider 3D — btools Ecosystem
 * Three.js + GSAP + Unified Radial Shader Effects (Threads, Pixel, Liquid)
 * + Interactive Ellipse Gizmo + Casemaker Media Pan/Zoom/Fit/Fill
 */

(function () {
  "use strict";

  /* ================================================================== *
   * 1. Configuration & State
   * ================================================================== */

  const CONFIG = {
    aspectRatioStr: "16/9",
    aspectRatio: 16 / 9,
    slideCount: 8,
    slideGap: 45,
    cardHeight: 360,
    cardRadius: 24,

    // Rotation & Motion
    isPlaying: true,
    mouseDisabled: false,  // Locks mouse interaction on canvas & in exported code
    rotationSpeed: 75,
    direction: -1,         // -1: CCW, 1: CW
    verticalSpin: false,   // Vertical axis animation toggle
    verticalSpeed: 35,     // Vertical spin speed
    tiltX: 10,             // Vertical tilt (-45 to +45 deg)
    rollZ: 0,              // Horizontal / Clockwise-CCW roll (-180 to +180 deg)

    // Effect Mode: 'none', 'threads', 'pixel', 'liquid'
    effectMode: "none",

    // Radial Ellipse & Shape Gizmo
    gizmoX: 0.5,
    gizmoY: 0.5,
    gizmoRx: 220,
    gizmoRy: 220,
    gizmoAngle: 0,         // deg (-180 to +180)
    gizmoShape: "ellipse", // 'ellipse' | 'circle' | 'rect' | 'square'
    gizmoInnerRatio: 0.25, // 0.05 .. 0.85 safe focus core ratio

    // Unified Shader Params (1:1 units with Slider Pixel Studio)
    pixelSize: 20.0,       // px
    pixelScatter: 45.0,    // %
    pixelWobble: 1.0,      // x (wave oscillations)
    pixelSeed: 42.1337,

    threads: 26,
    wobble: 1.0,

    liquidFreq: 6.0,
    liquidStrength: 1.2,
    liquidSpeed: 1.5,
    liquidSeed: 17.89,

    fadeEnable: true,
    fadeDepth: 65,

    // Screen-Edge Erase & Fade (1:1 with Slider Studio)
    fadeLeft: true,
    fadeRight: true,
    fadeTop: false,
    fadeBottom: false,
    fadeEdgeDepth: 0.22,
    tearZoneWidth: 380,

    // Interaction mode: false = orbit 3D ring, true = pan/zoom media inside selected slide
    panMediaMode: false
  };

  const DEFAULT_IMAGES = [
    "./img/motion_blur_portrait_01.jpg",
    "./img/motion_blur_portrait_02.jpg",
    "./img/motion_blur_portrait_03.jpg",
    "./img/motion_blur_portrait_04.jpg",
    "./img/motion_blur_portrait_05.jpg",
    "./img/motion_blur_portrait_06.jpg"
  ];

  const PALETTES = [
    { base: ["#1e1b4b", "#312e81"], accent: "#6366f1", text: "Slide 01" },
    { base: ["#064e3b", "#065f46"], accent: "#10b981", text: "Slide 02" },
    { base: ["#4c1d95", "#581c87"], accent: "#a855f7", text: "Slide 03" },
    { base: ["#701a75", "#86198f"], accent: "#ec4899", text: "Slide 04" },
    { base: ["#1c1917", "#292524"], accent: "#f59e0b", text: "Slide 05" },
    { base: ["#0c4a6e", "#075985"], accent: "#06b6d4", text: "Slide 06" }
  ];

  let slidesData = [];
  let slideMeshes = [];
  let activeSlideIndex = 0;      // Closest slide to camera
  let editingSlideIndex = null;  // Slide currently open in #cardHud
  let pendingUploadIndex = null;
  let ringRadius = 400;

  /* ================================================================== *
   * 2. Shaders (Curved 3D + Casemaker Fit/Fill + Unified Radial Effects)
   * ================================================================== */

  const VERTEX_SHADER = `
    varying vec2 vUv;

    void main() {
      vUv = uv;
      // Rigid 3D slide geometry: NEVER deform or warp the mesh with the hoop gizmo!
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `;

  const FRAGMENT_SHADER = `
    precision highp float;

    varying vec2 vUv;

    uniform sampler2D uMap;
    uniform float uImageAspect;
    uniform vec2 uCardSize;
    uniform float uRadius;
    uniform float uSeed;
    uniform float uTime;

    // Casemaker Media Transforms (Exact match with Slider Studio)
    uniform vec2  uMediaOffset;    // px
    uniform float uMediaScale;     // 1.0 = 100%
    uniform int   uFitMode;        // 0 = fill (cover), 1 = fit (contain)

    // Effect Mode: 0 = none, 1 = threads, 2 = pixel, 3 = liquid
    uniform int   uEffectMode;

    // Radial Ellipse / Shape Gizmo (Pure screen-space effect mask, no mesh deformation)
    uniform vec2  uGizmoCenter;    // WebGL px
    uniform vec2  uGizmoRadii;     // (rx, ry) WebGL px
    uniform float uGizmoAngle;     // radians
    uniform int   uGizmoShape;     // 0 = ellipse/circle, 1 = rect/square
    uniform float uInnerRatio;     // 0.05 .. 0.85 safe focus core

    // Unified Effect Params (1:1 units with Slider Studio)
    uniform float uPixelSize;
    uniform float uPixelScatter;
    uniform float uPixelWobble;
    uniform float uPixelSeed;

    uniform float uThreads;
    uniform float uWobble;

    uniform float uLiquidFreq;
    uniform float uLiquidStrength;
    uniform float uLiquidSpeed;
    uniform float uLiquidSeed;

    uniform float uFadeEnable;
    uniform float uFadeDepth;

    uniform vec2  uViewportSize;
    uniform float uDpr;

    // Entire Construction Screen-Edge Erase (Left, Right, Top, Bottom)
    uniform float uFadeLeft;
    uniform float uFadeRight;
    uniform float uFadeTop;
    uniform float uFadeBottom;
    uniform float uFadeEdgeDepth;
    uniform float uTearZone;

    float hash21(vec2 p) {
      p = fract(p * vec2(234.34, 435.345));
      p += dot(p, p + 34.23);
      return fract(p.x * p.y);
    }

    float roundedBoxSDF(vec2 centerPos, vec2 size, float radius) {
      return length(max(abs(centerPos) - size + radius, 0.0)) - radius;
    }

    void main() {
      // 1. Rounded Corners Mask
      vec2 cardPointPx = (vUv - 0.5) * uCardSize;
      float sdf = roundedBoxSDF(cardPointPx, uCardSize * 0.5, uRadius);
      float cardAlpha = 1.0 - smoothstep(-1.5, 0.5, sdf);
      if (cardAlpha <= 0.001) discard;

      // 2. Entire Construction Screen-Edge Erase (Left, Right, Top, Bottom)
      float stageFade = 1.0;
      float fadeZoneX = max(10.0, uFadeEdgeDepth * uViewportSize.x);
      float fadeZoneY = max(10.0, uFadeEdgeDepth * uViewportSize.y);

      if (uFadeLeft > 0.5) {
        stageFade *= smoothstep(0.0, fadeZoneX, gl_FragCoord.x);
      }
      if (uFadeRight > 0.5) {
        stageFade *= 1.0 - smoothstep(uViewportSize.x - fadeZoneX, uViewportSize.x, gl_FragCoord.x);
      }
      if (uFadeBottom > 0.5) {
        stageFade *= smoothstep(0.0, fadeZoneY, gl_FragCoord.y);
      }
      if (uFadeTop > 0.5) {
        stageFade *= 1.0 - smoothstep(uViewportSize.y - fadeZoneY, uViewportSize.y, gl_FragCoord.y);
      }

      // 3. Casemaker UV Mapping (Cover / Contain + Pan + Zoom)
      float cardAspect = uCardSize.x / max(1.0, uCardSize.y);
      vec2 renderSize;

      if (uFitMode == 0) {
        // FILL (Cover)
        if (cardAspect > uImageAspect) {
          renderSize.x = uCardSize.x;
          renderSize.y = uCardSize.x / max(0.001, uImageAspect);
        } else {
          renderSize.y = uCardSize.y;
          renderSize.x = uCardSize.y * uImageAspect;
        }
      } else {
        // FIT (Contain)
        if (cardAspect > uImageAspect) {
          renderSize.y = uCardSize.y;
          renderSize.x = uCardSize.y * uImageAspect;
        } else {
          renderSize.x = uCardSize.x;
          renderSize.y = uCardSize.x / max(0.001, uImageAspect);
        }
      }

      renderSize *= max(0.01, uMediaScale);
      vec2 imageOffsetGl = vec2(uMediaOffset.x, -uMediaOffset.y);
      vec2 posInImage = cardPointPx - imageOffsetGl;

      vec2 sampleUv = vec2(
        (posInImage.x / renderSize.x) + 0.5,
        (posInImage.y / renderSize.y) + 0.5
      );

      vec3 bgColor = vec3(0.06, 0.07, 0.10);
      vec3 finalColor = bgColor;
      float effectAlpha = 1.0;

      // 3. Compute Radial Falloff from Gizmo Hoop (Subpixel screen precision)
      float shapeDist = 0.0;
      float tear = 0.0;
      if (uEffectMode != 0) {
        vec2 d = gl_FragCoord.xy - uGizmoCenter;
        float ca = cos(-uGizmoAngle);
        float sa = sin(-uGizmoAngle);
        vec2 rotD = vec2(d.x * ca - d.y * sa, d.x * sa + d.y * ca);

        if (uGizmoShape == 0) {
          // Ellipse or Circle (Euclidean metric)
          shapeDist = length(rotD / max(vec2(1.0), uGizmoRadii));
        } else {
          // Rectangle or Square (Chebyshev box metric)
          vec2 b = abs(rotD) / max(vec2(1.0), uGizmoRadii);
          shapeDist = max(b.x, b.y);
        }

        // Inner focus safe zone (uInnerRatio) -> clean core (0.0 .. uInnerRatio)
        // Transition band determined by uTearZone (Ширина зоны)
        float maxR = max(uGizmoRadii.x, uGizmoRadii.y);
        float zoneNorm = clamp(uTearZone / max(maxR, 20.0), 0.05, 1.5);
        float tearEnd = clamp(uInnerRatio + zoneNorm, uInnerRatio + 0.05, 1.5);
        tear = smoothstep(uInnerRatio, tearEnd, shapeDist);
      }

      if (uEffectMode == 0 || tear <= 0.003) {
        // Clean sampling (No effect)
        if (sampleUv.x >= 0.0 && sampleUv.x <= 1.0 && sampleUv.y >= 0.0 && sampleUv.y <= 1.0) {
          finalColor = texture2D(uMap, sampleUv).rgb;
        }
      }
      else if (uEffectMode == 1) {
        // ===== MODE 1: THREADS / ВОЛОСЫ =====
        float tNorm = clamp(tear, 0.0, 1.0);
        float threadCoord = vUv.y * uThreads;
        float threadIdx = floor(threadCoord);
        float threadFrac = fract(threadCoord);
        float rim = abs(threadFrac - 0.5) * 2.0;

        float rnd = hash21(vec2(threadIdx, uSeed));
        float wave = sin(vUv.x * 12.0 + uTime * 2.5 + rnd * 6.28) * 0.02 * uWobble * tNorm;
        vec2 threadUv = sampleUv + vec2(0.0, wave);

        float coreWidth = mix(0.95, 0.18 + rnd * 0.14, smoothstep(0.0, 0.85, tNorm));
        float threadAlpha = 1.0 - smoothstep(coreWidth - 0.10, coreWidth + 0.06, rim);
        threadAlpha = mix(1.0, threadAlpha, smoothstep(0.03, 0.30, tNorm));

        if (threadUv.x >= 0.0 && threadUv.x <= 1.0 && threadUv.y >= 0.0 && threadUv.y <= 1.0) {
          finalColor = texture2D(uMap, threadUv).rgb;
        }

        finalColor *= 1.0 - tNorm * 0.40 * rim * rim;
        finalColor += tNorm * 0.18 * (1.0 - smoothstep(0.0, 0.45, rim));

        // Silk thread tip glints (only inside the active effect zone; vanish at fade edge so no white lines remain)
        float glint = smoothstep(0.55, 1.0, tNorm) * 0.80;
        if (uFadeEnable > 0.5) {
          glint *= (1.0 - smoothstep(0.80, 1.05, shapeDist));
        }
        finalColor = mix(finalColor, vec3(1.0), glint);

        // Erase cleanly to 0.0 when uFadeEnable is on, without leaving ghost lines
        float fade = 1.0 - smoothstep(0.75, 1.0, tNorm) * 0.65;
        if (uFadeEnable > 0.5) {
          float erase = 1.0 - smoothstep(1.0 - 0.25 * uFadeDepth, 1.05, shapeDist);
          fade *= mix(1.0, erase, uFadeDepth);
        }
        effectAlpha = threadAlpha * fade;
      }
      else if (uEffectMode == 2) {
        // ===== MODE 2: PIXELATION / ПИКСЕЛИ (Чистые пиксели с волновыми колебаниями) =====
        vec2 grid = uCardSize / max(2.0, uPixelSize);

        // Волновые колебания (Wobble) сетки пикселей
        vec2 gridUv = vUv;
        if (tear > 0.01 && uPixelWobble > 0.001) {
          float wave = sin(vUv.y * 10.0 + uTime * 2.2) * cos(vUv.x * 10.0 + uTime * 1.8);
          gridUv += vec2(wave, -wave * 0.5) * 0.02 * uPixelWobble * tear;
        }

        vec2 pCoord = floor(gridUv * grid);

        float rand1 = hash21(pCoord + vec2(uPixelSeed * 13.37, uPixelSeed * 71.19));
        float rand2 = hash21(pCoord * 1.618 + vec2(uPixelSeed * 91.13, uPixelSeed * 37.41));

        // A. Квантование UV к центру каждого пиксельного блока
        vec2 blockPointPx = ((pCoord + 0.5) / grid - 0.5) * uCardSize;
        vec2 blockPosInImage = blockPointPx - imageOffsetGl;
        vec2 quantSampleUv = vec2(
          blockPosInImage.x / renderSize.x + 0.5,
          blockPosInImage.y / renderSize.y + 0.5
        );

        // B. Плавное жидкое притягивание UV (meniscus warp)
        vec2 pixUv = mix(sampleUv, quantSampleUv, smoothstep(0.0, 0.5, tear));

        if (tear > 0.02) {
          // Разброс пикселей
          vec2 scatter = (vec2(rand1, rand2) - 0.5) * tear * (uPixelScatter / 100.0) * 0.4;

          // Волновые колебания пикселей (Wobble wave animation per block)
          vec2 blockWobble = vec2(
            sin(pCoord.y * 0.35 + uTime * (2.2 + rand1) + rand1 * 6.2831),
            cos(pCoord.x * 0.35 + uTime * (1.8 + rand2) + rand2 * 6.2831)
          ) * 0.04 * uPixelWobble * tear;

          pixUv += scatter + blockWobble;
        }

        // C. Чистое сэмплирование без тиснения, бликов и фасок стекла (Strictly clean pixels)
        if (pixUv.x >= 0.0 && pixUv.x <= 1.0 && pixUv.y >= 0.0 && pixUv.y <= 1.0) {
          finalColor = texture2D(uMap, pixUv).rgb;
        }

        // D. Дискретный распад блоков
        if (tear > 0.05) {
          float dropThreshold = smoothstep(0.05, 0.95, tear);
          if (rand2 < dropThreshold * 0.88) {
            discard;
          }
        }

        // E. Мягкий спад оставшихся блоков в фон
        float fade = 1.0 - smoothstep(0.70, 1.0, tear) * 0.7;
        if (uFadeEnable > 0.5) {
          float erase = 1.0 - smoothstep(1.0 - 0.25 * uFadeDepth, 1.05, shapeDist);
          fade *= mix(1.0, erase, uFadeDepth);
        }
        effectAlpha = fade;
      }
      else if (uEffectMode == 3) {
        // ===== MODE 3: LIQUID MELT / ЖИДКОСТЬ =====
        float lTime = uTime * uLiquidSpeed + uLiquidSeed * 10.0;
        vec2 fP = vUv * uLiquidFreq;

        float wave1 = sin(fP.y * 3.14 + lTime) * cos(fP.x * 2.2 - lTime * 0.8);
        float wave2 = cos(fP.x * 3.14 + lTime * 1.3) * sin(fP.y * 2.2 + lTime * 0.5);
        float wave3 = sin((fP.x + fP.y) * 2.0 - lTime * 1.5);

        float melt = pow(tear, 1.5) * uLiquidStrength;
        vec2 fluidDistort = vec2(wave1 * 0.04 + wave3 * 0.02, wave2 * 0.06 - melt * 0.25) * tear;
        vec2 liqUv = sampleUv + fluidDistort;

        if (liqUv.x >= 0.0 && liqUv.x <= 1.0 && liqUv.y >= 0.0 && liqUv.y <= 1.0) {
          float r = texture2D(uMap, liqUv + vec2(fluidDistort.x * 0.20, 0.0)).r;
          float g = texture2D(uMap, liqUv).g;
          float b = texture2D(uMap, liqUv - vec2(fluidDistort.x * 0.20, 0.0)).b;
          finalColor = vec3(r, g, b);
        }

        // Wave crest sheen highlight (1:1 with Slider Studio)
        float crestSheen = max(0.0, wave1 * wave2) * tear * 0.35;
        finalColor += vec3(crestSheen);

        float fade = 1.0 - smoothstep(0.60, 1.0, tear);
        if (uFadeEnable > 0.5) {
          float erase = 1.0 - smoothstep(1.0 - 0.25 * uFadeDepth, 1.05, shapeDist);
          fade *= mix(1.0, erase, uFadeDepth);
        }
        effectAlpha = fade;
      }

      float alpha = cardAlpha * effectAlpha * stageFade;
      if (alpha < 0.003) discard;

      gl_FragColor = vec4(finalColor, alpha);
    }
  `;

  /* ================================================================== *
   * 3. Three.js Scene & Renderer Setup
   * ================================================================== */

  const stage = document.getElementById("stage");
  const stageContainer = document.getElementById("stageContainer");
  const stageOverlays = document.getElementById("stageOverlays");
  const cardHud = document.getElementById("cardHud");

  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
    preserveDrawingBuffer: true
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  stage.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, 1, 10, 10000);
  const tiltGroup = new THREE.Group();
  const ringGroup = new THREE.Group();
  tiltGroup.add(ringGroup);
  scene.add(tiltGroup);

  const raycaster = new THREE.Raycaster();
  const pointerNdc = new THREE.Vector2();

  const sharedUniforms = {
    uTime:           { value: 0 },
    uEffectMode:     { value: 0 },
    uViewportSize:   { value: new THREE.Vector2(1280, 800) },
    uDpr:            { value: 1.0 },
    uGizmoCenter:    { value: new THREE.Vector2(500, 400) },
    uGizmoRadii:     { value: new THREE.Vector2(220, 220) },
    uGizmoAngle:     { value: 0.0 },
    uGizmoShape:     { value: 0 },
    uInnerRatio:     { value: 0.25 },
    uPixelSize:      { value: 20.0 },
    uPixelScatter:   { value: 45.0 },
    uPixelWobble:    { value: 1.0 },
    uPixelSeed:      { value: 42.1337 },
    uThreads:        { value: 26.0 },
    uWobble:         { value: 1.0 },
    uLiquidFreq:     { value: 6.0 },
    uLiquidStrength: { value: 1.2 },
    uLiquidSpeed:    { value: 1.5 },
    uLiquidSeed:     { value: 17.89 },
    uFadeEnable:     { value: 1.0 },
    uFadeDepth:      { value: 0.65 },
    uFadeLeft:       { value: 1.0 },
    uFadeRight:      { value: 1.0 },
    uFadeTop:        { value: 0.0 },
    uFadeBottom:     { value: 0.0 },
    uFadeEdgeDepth:  { value: 0.22 },
    uTearZone:       { value: 380.0 },
    uCardSize:       { value: new THREE.Vector2(640, 360) },
    uRadius:         { value: 24.0 }
  };

  /* ================================================================== *
   * 4. Texture & Geometry Helpers
   * ================================================================== */

  function drawPlaceholderCanvas(palette, index) {
    const w = 1024;
    const h = Math.round(w / CONFIG.aspectRatio);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");

    const grad = ctx.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0, palette.base[0]);
    grad.addColorStop(1, palette.base[1]);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = "rgba(255,255,255,0.06)";
    ctx.lineWidth = 2;
    for (let x = 0; x < w; x += 64) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    }
    for (let y = 0; y < h; y += 64) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }

    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.font = "bold 44px 'Space Grotesk', sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(`SLIDE ${(index + 1).toString().padStart(2, "0")}`, w / 2, h / 2 - 16);

    ctx.fillStyle = palette.accent;
    ctx.font = "600 20px 'JetBrains Mono', monospace";
    ctx.fillText("Нажмите [+] для загрузки фото", w / 2, h / 2 + 28);

    return canvas;
  }

  function createTexture(source) {
    const tex = new THREE.Texture(source);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    return tex;
  }

  function buildCurvedSlideGeometry(width, height, radius, segments = 32, rows = 32) {
    const arcAngle = width / radius;
    const positions = [];
    const uvs = [];
    const indices = [];

    for (let row = 0; row <= rows; row++) {
      const v = row / rows;
      const y = (v - 0.5) * height;
      for (let col = 0; col <= segments; col++) {
        const u = col / segments;
        const phi = (u - 0.5) * arcAngle;
        const x = radius * Math.sin(phi);
        const z = radius * Math.cos(phi);
        positions.push(x, y, z);
        uvs.push(u, v);
      }
    }

    const rowStride = segments + 1;
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < segments; col++) {
        const bl = row * rowStride + col;
        const br = row * rowStride + col + 1;
        const tl = (row + 1) * rowStride + col;
        const tr = (row + 1) * rowStride + col + 1;
        indices.push(bl, br, tl, br, tr, tl);
      }
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geom.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    geom.setIndex(indices);
    return geom;
  }

  /* ================================================================== *
   * 5. Ring Builder & Slide Management
   * ================================================================== */

  function ensureSlidesData(count) {
    while (slidesData.length < count) {
      const idx = slidesData.length;
      const palette = PALETTES[idx % PALETTES.length];
      const canvas = drawPlaceholderCanvas(palette, idx);
      const tex = createTexture(canvas);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.75);

      const slide = {
        index: idx,
        texture: tex,
        imageAspect: CONFIG.aspectRatio,
        thumbUrl: dataUrl,
        isCustom: false,
        name: `Слайд ${String(idx + 1).padStart(2, "0")}`,
        // Casemaker per-slide media transforms
        mediaOffset: { x: 0, y: 0 },
        mediaScale: 1.0,
        fitMode: 0 // 0 = fill (cover), 1 = fit (contain)
      };
      slidesData.push(slide);

      const defaultSrc = DEFAULT_IMAGES[idx % DEFAULT_IMAGES.length];
      loadDefaultImageIntoSlide(idx, defaultSrc);
    }
  }

  function loadDefaultImageIntoSlide(idx, src) {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const s = slidesData[idx];
      if (!s || s.isCustom) return;
      s.texture = createTexture(img);
      s.imageAspect = img.naturalWidth / Math.max(1, img.naturalHeight);
      s.thumbUrl = src;
      if (slideMeshes[idx]) {
        slideMeshes[idx].material.uniforms.uMap.value = s.texture;
        slideMeshes[idx].material.uniforms.uImageAspect.value = s.imageAspect;
      }
      renderSidebarLayers();
    };
    img.src = src;
  }

  function rebuildRing() {
    ensureSlidesData(CONFIG.slideCount);

    while (ringGroup.children.length > 0) {
      const child = ringGroup.children[0];
      if (child.geometry) child.geometry.dispose();
      if (child.material) child.material.dispose();
      ringGroup.remove(child);
    }
    slideMeshes = [];

    const count = CONFIG.slideCount;
    const slideH = CONFIG.cardHeight;
    const slideW = slideH * CONFIG.aspectRatio;
    const circumference = count * (slideW + CONFIG.slideGap);
    ringRadius = Math.max(200, circumference / (2 * Math.PI));

    sharedUniforms.uCardSize.value.set(slideW, slideH);
    sharedUniforms.uRadius.value = CONFIG.cardRadius;

    const geom = buildCurvedSlideGeometry(slideW, slideH, ringRadius, 32, 32);

    for (let i = 0; i < count; i++) {
      const s = slidesData[i];
      const mat = new THREE.ShaderMaterial({
        vertexShader: VERTEX_SHADER,
        fragmentShader: FRAGMENT_SHADER,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide,
        uniforms: {
          uMap:            { value: s.texture },
          uImageAspect:    { value: s.imageAspect },
          uSeed:           { value: (i + 1) * 1.137 },
          uMediaOffset:    { value: new THREE.Vector2(s.mediaOffset.x, s.mediaOffset.y) },
          uMediaScale:     { value: s.mediaScale },
          uFitMode:        { value: s.fitMode },
          uTime:           sharedUniforms.uTime,
          uCardSize:       sharedUniforms.uCardSize,
          uRadius:         sharedUniforms.uRadius,
          uEffectMode:     sharedUniforms.uEffectMode,
          uViewportSize:   sharedUniforms.uViewportSize,
          uDpr:            sharedUniforms.uDpr,
          uGizmoCenter:    sharedUniforms.uGizmoCenter,
          uGizmoRadii:     sharedUniforms.uGizmoRadii,
          uGizmoAngle:     sharedUniforms.uGizmoAngle,
          uGizmoShape:     sharedUniforms.uGizmoShape,
          uInnerRatio:     sharedUniforms.uInnerRatio,
          uPixelSize:      sharedUniforms.uPixelSize,
          uPixelScatter:   sharedUniforms.uPixelScatter,
          uPixelWobble:    sharedUniforms.uPixelWobble,
          uPixelSeed:      sharedUniforms.uPixelSeed,
          uThreads:        sharedUniforms.uThreads,
          uWobble:         sharedUniforms.uWobble,
          uLiquidFreq:     sharedUniforms.uLiquidFreq,
          uLiquidStrength: sharedUniforms.uLiquidStrength,
          uLiquidSpeed:    sharedUniforms.uLiquidSpeed,
          uLiquidSeed:     sharedUniforms.uLiquidSeed,
          uFadeEnable:     sharedUniforms.uFadeEnable,
          uFadeDepth:      sharedUniforms.uFadeDepth,
          uFadeLeft:       sharedUniforms.uFadeLeft,
          uFadeRight:      sharedUniforms.uFadeRight,
          uFadeTop:        sharedUniforms.uFadeTop,
          uFadeBottom:     sharedUniforms.uFadeBottom,
          uFadeEdgeDepth:  sharedUniforms.uFadeEdgeDepth,
          uTearZone:       sharedUniforms.uTearZone
        }
      });

      const mesh = new THREE.Mesh(geom, mat);
      const theta = (i / count) * Math.PI * 2;
      mesh.rotation.y = theta;
      mesh.userData = { index: i, theta: theta };

      ringGroup.add(mesh);
      slideMeshes.push(mesh);
    }

    const rect = stageContainer.getBoundingClientRect();
    const aspect = rect.width / Math.max(1, rect.height);
    camera.aspect = aspect;
    camera.updateProjectionMatrix();

    const fovRad = THREE.MathUtils.degToRad(camera.fov);
    const fitH = (slideH * 1.55) / (2 * Math.tan(fovRad / 2));
    const fitW = (ringRadius * 2.55) / (2 * Math.tan(fovRad / 2) * aspect);
    const camDist = Math.max(fitH, fitW);
    camera.position.set(0, 0, ringRadius + camDist);
    camera.lookAt(0, 0, 0);

    tiltGroup.rotation.x = THREE.MathUtils.degToRad(CONFIG.tiltX);
    tiltGroup.rotation.z = THREE.MathUtils.degToRad(CONFIG.rollZ);

    buildOverlayPlusButtons();
    renderSidebarLayers();
    document.getElementById("sidebarSlideTotal").textContent = count;
  }

  /* ================================================================== *
   * 6. Per-Slide 3D Projected Plus Buttons
   * ================================================================== */

  let overlayButtons = [];

  function buildOverlayPlusButtons() {
    stageOverlays.innerHTML = "";
    overlayButtons = [];

    for (let i = 0; i < CONFIG.slideCount; i++) {
      const btn = document.createElement("button");
      btn.className = "slide-3d-plus-btn";
      btn.title = `Загрузить изображение на Слайд ${i + 1}`;
      btn.innerHTML = `
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <line x1="12" y1="5" x2="12" y2="19"></line>
          <line x1="5" y1="12" x2="19" y2="12"></line>
        </svg>
        <span class="plus-num">${String(i + 1).padStart(2, "0")}</span>
      `;
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        triggerUploadForSlide(i);
      });
      stageOverlays.appendChild(btn);
      overlayButtons.push(btn);
    }
  }

  function updateOverlayPositions() {
    const rect = stageContainer.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;
    const tempVec = new THREE.Vector3();

    let frontMostIdx = 0;
    let maxZ = -Infinity;

    for (let i = 0; i < slideMeshes.length; i++) {
      const mesh = slideMeshes[i];
      tempVec.set(0, 0, ringRadius);
      mesh.localToWorld(tempVec);

      if (tempVec.z > maxZ) {
        maxZ = tempVec.z;
        frontMostIdx = i;
      }

      const btn = overlayButtons[i];
      if (!btn) continue;

      if (tempVec.z > -ringRadius * 0.1) {
        const projected = tempVec.clone().project(camera);
        const sx = (projected.x * 0.5 + 0.5) * w;
        const sy = (-projected.y * 0.5 + 0.5) * h;

        btn.style.display = "flex";
        btn.style.left = `${sx}px`;
        btn.style.top = `${sy}px`;
        const opacity = THREE.MathUtils.clamp((tempVec.z + ringRadius * 0.1) / (ringRadius * 0.6), 0.15, 0.9);
        btn.style.opacity = opacity.toFixed(2);
      } else {
        btn.style.display = "none";
      }
    }

    if (frontMostIdx !== activeSlideIndex) {
      activeSlideIndex = frontMostIdx;
      document.getElementById("indicatorTag").textContent = `Слайд ${String(activeSlideIndex + 1).padStart(2, "0")} (В фокусе)`;
      updateActiveSidebarTile();
    }
  }

  function updateActiveSidebarTile() {
    const tiles = document.querySelectorAll(".slide-layer-tile");
    tiles.forEach((tile, idx) => {
      tile.classList.toggle("active", idx === (editingSlideIndex !== null ? editingSlideIndex : activeSlideIndex));
    });
  }

  /* ================================================================== *
   * 7. Casemaker Floating Media Inspector HUD (Pan / Zoom / Fit / Fill)
   * ================================================================== */

  function openSlideHud(index) {
    editingSlideIndex = index;
    const s = slidesData[index];
    if (!s) return;

    cardHud.classList.remove("hidden");
    document.getElementById("hudCardNum").textContent = `#${index + 1}`;
    document.getElementById("hudFitFillText").textContent = s.fitMode === 0 ? "Fill (Cover)" : "Fit (Contain)";

    const zoomSlider = document.getElementById("hudZoomSlider");
    const zoomInput = document.getElementById("hudZoomInput");
    zoomSlider.value = s.mediaScale;
    zoomInput.value = Math.round(s.mediaScale * 100);

    updateActiveSidebarTile();
  }

  function closeSlideHud() {
    editingSlideIndex = null;
    cardHud.classList.add("hidden");
    updateActiveSidebarTile();
  }

  document.getElementById("hudCloseBtn").addEventListener("click", closeSlideHud);

  document.getElementById("hudFitFillToggle").addEventListener("click", () => {
    if (editingSlideIndex === null) return;
    const s = slidesData[editingSlideIndex];
    s.fitMode = s.fitMode === 0 ? 1 : 0;
    if (slideMeshes[editingSlideIndex]) {
      slideMeshes[editingSlideIndex].material.uniforms.uFitMode.value = s.fitMode;
    }
    document.getElementById("hudFitFillText").textContent = s.fitMode === 0 ? "Fill (Cover)" : "Fit (Contain)";
  });

  document.getElementById("hudResetTransform").addEventListener("click", () => {
    if (editingSlideIndex === null) return;
    const s = slidesData[editingSlideIndex];
    s.mediaOffset = { x: 0, y: 0 };
    s.mediaScale = 1.0;
    if (slideMeshes[editingSlideIndex]) {
      slideMeshes[editingSlideIndex].material.uniforms.uMediaOffset.value.set(0, 0);
      slideMeshes[editingSlideIndex].material.uniforms.uMediaScale.value = 1.0;
    }
    document.getElementById("hudZoomSlider").value = 1.0;
    document.getElementById("hudZoomInput").value = 100;
    showToast("Позиция и зум сброшены");
  });

  document.getElementById("hudUploadBtn").addEventListener("click", () => {
    if (editingSlideIndex !== null) triggerUploadForSlide(editingSlideIndex);
  });

  document.getElementById("hudZoomSlider").addEventListener("input", (e) => {
    if (editingSlideIndex === null) return;
    const val = Number(e.target.value);
    const s = slidesData[editingSlideIndex];
    s.mediaScale = val;
    if (slideMeshes[editingSlideIndex]) {
      slideMeshes[editingSlideIndex].material.uniforms.uMediaScale.value = val;
    }
    document.getElementById("hudZoomInput").value = Math.round(val * 100);
  });

  document.getElementById("hudZoomInput").addEventListener("input", (e) => {
    if (editingSlideIndex === null) return;
    const pct = THREE.MathUtils.clamp(Number(e.target.value) || 100, 20, 350);
    const val = pct / 100;
    const s = slidesData[editingSlideIndex];
    s.mediaScale = val;
    if (slideMeshes[editingSlideIndex]) {
      slideMeshes[editingSlideIndex].material.uniforms.uMediaScale.value = val;
    }
    document.getElementById("hudZoomSlider").value = val;
  });

  function anchorSlideMedia(posType) {
    if (editingSlideIndex === null) return;
    const s = slidesData[editingSlideIndex];
    const slideH = CONFIG.cardHeight;
    const slideW = slideH * CONFIG.aspectRatio;
    const cardAspect = slideW / slideH;

    let renderH = slideH;
    if (s.fitMode === 0 && cardAspect > s.imageAspect) {
      renderH = slideW / Math.max(0.001, s.imageAspect);
    } else if (s.fitMode === 1 && cardAspect <= s.imageAspect) {
      renderH = slideW / Math.max(0.001, s.imageAspect);
    }
    renderH *= s.mediaScale;

    const maxShift = Math.max(0, (renderH - slideH) * 0.5);
    if (posType === "top") s.mediaOffset.y = maxShift;
    else if (posType === "bottom") s.mediaOffset.y = -maxShift;
    else { s.mediaOffset.x = 0; s.mediaOffset.y = 0; }

    if (slideMeshes[editingSlideIndex]) {
      slideMeshes[editingSlideIndex].material.uniforms.uMediaOffset.value.set(s.mediaOffset.x, s.mediaOffset.y);
    }
  }

  document.getElementById("btnAnchorTop").addEventListener("click", () => anchorSlideMedia("top"));
  document.getElementById("btnAnchorCenter").addEventListener("click", () => anchorSlideMedia("center"));
  document.getElementById("btnAnchorBottom").addEventListener("click", () => anchorSlideMedia("bottom"));

  // Pan Mode toggle in topbar
  const btnTogglePanMode = document.getElementById("btnTogglePanMode");
  btnTogglePanMode.addEventListener("click", () => {
    CONFIG.panMediaMode = !CONFIG.panMediaMode;
    btnTogglePanMode.classList.toggle("active", CONFIG.panMediaMode);
    stageContainer.style.cursor = CONFIG.panMediaMode ? "crosshair" : "grab";
    showToast(CONFIG.panMediaMode ? "Режим: Двигать фото внутри слайда" : "Режим: Вращение 3D кольца");
  });

  /* ================================================================== *
   * 8. Sidebar Slide Layers & Focus Rotation (Pencil Click)
   * ================================================================== */

  function renderSidebarLayers() {
    const container = document.getElementById("slidesLayerList");
    container.innerHTML = "";

    for (let i = 0; i < CONFIG.slideCount; i++) {
      const s = slidesData[i];
      const tile = document.createElement("div");
      tile.className = "slide-layer-tile" + (i === (editingSlideIndex !== null ? editingSlideIndex : activeSlideIndex) ? " active" : "");

      tile.innerHTML = `
        <div class="layer-thumb-wrap">
          <img src="${s.thumbUrl}" class="layer-thumb" alt="${s.name}" />
        </div>
        <div class="layer-info">
          <div class="layer-title">${s.name}</div>
          <div class="layer-meta">${s.isCustom ? "Пользовательское фото" : "Демо-обложка"}</div>
        </div>
        <div class="layer-actions">
          <button class="layer-action-btn btn-focus" title="Развернуть кольцо и открыть настройки фото">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
              <path d="M12 20h9"></path>
              <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
            </svg>
          </button>
          <button class="layer-action-btn btn-upload" title="Заменить изображение [+]">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <line x1="12" y1="5" x2="12" y2="19"></line>
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
          </button>
        </div>
      `;

      tile.querySelector(".btn-focus").addEventListener("click", (e) => {
        e.stopPropagation();
        focusSlideIn3D(i);
      });

      tile.querySelector(".btn-upload").addEventListener("click", (e) => {
        e.stopPropagation();
        triggerUploadForSlide(i);
      });

      container.appendChild(tile);
    }
  }

  function focusSlideIn3D(index) {
    setPlaying(false);
    const mesh = slideMeshes[index];
    if (!mesh) return;

    const targetBase = -mesh.userData.theta;
    const current = ringGroup.rotation.y;
    const twoPi = Math.PI * 2;
    let delta = (targetBase - current) % twoPi;
    if (delta > Math.PI) delta -= twoPi;
    if (delta < -Math.PI) delta += twoPi;

    gsap.to(ringGroup.rotation, {
      y: current + delta,
      duration: 0.85,
      ease: "power3.out",
      onUpdate: () => {
        const deg = ((THREE.MathUtils.radToDeg(ringGroup.rotation.y) % 360) + 360) % 360;
        document.getElementById("inputYaw").value = Math.round(deg);
        document.getElementById("valYaw").textContent = `${Math.round(deg)}°`;
      }
    });

    activeSlideIndex = index;
    openSlideHud(index);
    document.getElementById("indicatorTag").textContent = `Слайд ${String(index + 1).padStart(2, "0")} (Редактирование)`;
    showToast(`Слайд ${index + 1} развернут к камере`);
  }

  /* ================================================================== *
   * 9. File Uploading
   * ================================================================== */

  const globalFileInput = document.getElementById("globalFileInput");

  function triggerUploadForSlide(index) {
    pendingUploadIndex = index;
    globalFileInput.value = "";
    globalFileInput.click();
  }

  globalFileInput.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file || pendingUploadIndex === null) return;

    const idx = pendingUploadIndex;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target.result;
      const img = new Image();
      img.onload = () => {
        const s = slidesData[idx];
        s.texture = createTexture(img);
        s.imageAspect = img.naturalWidth / Math.max(1, img.naturalHeight);
        s.thumbUrl = dataUrl;
        s.isCustom = true;

        if (slideMeshes[idx]) {
          slideMeshes[idx].material.uniforms.uMap.value = s.texture;
          slideMeshes[idx].material.uniforms.uImageAspect.value = s.imageAspect;
        }
        renderSidebarLayers();
        showToast(`Изображение загружено в Слайд ${idx + 1}`);
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  });

  document.getElementById("indicatorUploadBtn").addEventListener("click", () => {
    triggerUploadForSlide(editingSlideIndex !== null ? editingSlideIndex : activeSlideIndex);
  });

  /* ================================================================== *
   * 10. Interactive Radial Ellipse Gizmo (Shift = Circle, No Shift = Ellipse, Rotatable)
   * ================================================================== */

  const gizmoLayer = document.getElementById("gizmoLayer");
  const gizmoRotateGroup = document.getElementById("gizmoRotateGroup");
  const gizmoCircle = document.getElementById("gizmoCircle");
  const gizmoInnerSafe = document.getElementById("gizmoInnerSafe");
  const gizmoRect = document.getElementById("gizmoRect");
  const gizmoInnerRect = document.getElementById("gizmoInnerRect");
  const gizmoRotStem = document.getElementById("gizmoRotStem");
  const gizmoCenterHandle = document.getElementById("gizmoCenterHandle");
  const gizmoInnerHandle = document.getElementById("gizmoInnerHandle");
  const gizmoRadiusHandle = document.getElementById("gizmoRadiusHandle");
  const gizmoRotateHandle = document.getElementById("gizmoRotateHandle");
  const radiusTooltip = document.getElementById("radiusTooltip");
  const gizmoShapeAnchor = document.getElementById("gizmoShapeAnchor");
  const gizmoShapeBtn = document.getElementById("gizmoShapeBtn");
  const gizmoShapeDropdown = document.getElementById("gizmoShapeDropdown");
  const gizmoShapeCurrentIcon = document.getElementById("gizmoShapeCurrentIcon");

  const shapeIcons = {
    ellipse: '<ellipse cx="12" cy="12" rx="10" ry="6"></ellipse>',
    circle: '<circle cx="12" cy="12" r="8"></circle>',
    rect: '<rect x="3" y="6" width="18" height="12" rx="2"></rect>',
    square: '<rect x="4" y="4" width="16" height="16" rx="2"></rect>'
  };

  function setGizmoShape(shape) {
    CONFIG.gizmoShape = shape;
    if (shape === "circle" || shape === "square") {
      CONFIG.gizmoRy = CONFIG.gizmoRx;
    }
    if (gizmoShapeCurrentIcon && shapeIcons[shape]) {
      gizmoShapeCurrentIcon.innerHTML = shapeIcons[shape];
    }
    document.querySelectorAll(".shape-opt-btn").forEach(btn => {
      btn.classList.toggle("active", btn.dataset.shape === shape);
    });
    gizmoShapeDropdown?.classList.add("hidden");
    syncGizmoUIAndUniforms();
  }

  gizmoShapeBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    gizmoShapeDropdown?.classList.toggle("hidden");
  });

  document.querySelectorAll(".shape-opt-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      setGizmoShape(btn.dataset.shape);
    });
  });

  window.addEventListener("click", (e) => {
    if (gizmoShapeDropdown && !gizmoShapeDropdown.contains(e.target) && e.target !== gizmoShapeBtn) {
      gizmoShapeDropdown.classList.add("hidden");
    }
  });

  function syncGizmoUIAndUniforms() {
    const rect = stageContainer.getBoundingClientRect();
    const cx = CONFIG.gizmoX * rect.width;
    const cy = CONFIG.gizmoY * rect.height;
    const isRectangular = CONFIG.gizmoShape === "rect" || CONFIG.gizmoShape === "square";
    const isLocked1to1 = CONFIG.gizmoShape === "circle" || CONFIG.gizmoShape === "square";

    if (isLocked1to1) {
      CONFIG.gizmoRy = CONFIG.gizmoRx;
    }

    const rx = CONFIG.gizmoRx;
    const ry = CONFIG.gizmoRy;
    const innerRatio = CONFIG.gizmoInnerRatio !== undefined ? CONFIG.gizmoInnerRatio : 0.25;
    const radAngle = THREE.MathUtils.degToRad(CONFIG.gizmoAngle);
    const ca = Math.cos(radAngle);
    const sa = Math.sin(radAngle);

    gizmoRotateGroup.setAttribute("transform", `translate(${cx}, ${cy}) rotate(${CONFIG.gizmoAngle})`);

    if (isRectangular) {
      gizmoCircle.classList.add("hidden");
      gizmoInnerSafe.classList.add("hidden");
      gizmoRect.classList.remove("hidden");
      gizmoInnerRect.classList.remove("hidden");
      gizmoRect.setAttribute("x", -rx);
      gizmoRect.setAttribute("y", -ry);
      gizmoRect.setAttribute("width", rx * 2);
      gizmoRect.setAttribute("height", ry * 2);
      gizmoInnerRect.setAttribute("x", -rx * innerRatio);
      gizmoInnerRect.setAttribute("y", -ry * innerRatio);
      gizmoInnerRect.setAttribute("width", rx * 2 * innerRatio);
      gizmoInnerRect.setAttribute("height", ry * 2 * innerRatio);
    } else {
      gizmoCircle.classList.remove("hidden");
      gizmoInnerSafe.classList.remove("hidden");
      gizmoRect.classList.add("hidden");
      gizmoInnerRect.classList.add("hidden");
      gizmoCircle.setAttribute("rx", rx);
      gizmoCircle.setAttribute("ry", ry);
      gizmoInnerSafe.setAttribute("rx", rx * innerRatio);
      gizmoInnerSafe.setAttribute("ry", ry * innerRatio);
    }

    gizmoRotStem.setAttribute("y1", -ry);
    gizmoRotStem.setAttribute("y2", -ry - 34);

    gizmoCenterHandle.style.left = `${cx}px`;
    gizmoCenterHandle.style.top = `${cy}px`;

    // Shape Switcher Anchor
    if (gizmoShapeAnchor) {
      gizmoShapeAnchor.style.left = `${cx}px`;
      gizmoShapeAnchor.style.top = `${cy}px`;
    }

    // Inner safe focus handle positioned on inner boundary
    if (gizmoInnerHandle) {
      const inLocalX = rx * innerRatio;
      const inX = cx + inLocalX * ca;
      const inY = cy + inLocalX * sa;
      gizmoInnerHandle.style.left = `${inX}px`;
      gizmoInnerHandle.style.top = `${inY}px`;
    }

    // Diagonal corner handle on rotated shape (cos45 = sin45 = 0.7071)
    const localHx = rx * 0.7071;
    const localHy = ry * 0.7071;
    const hx = cx + (localHx * ca - localHy * sa);
    const hy = cy + (localHx * sa + localHy * ca);

    gizmoRadiusHandle.style.left = `${hx}px`;
    gizmoRadiusHandle.style.top = `${hy}px`;
    radiusTooltip.textContent = `${Math.round(rx)}×${Math.round(ry)}px`;

    // Rotation handle at top stem (0, -ry - 34) rotated
    const localRotY = -ry - 34;
    const rtx = cx + (-localRotY * sa);
    const rty = cy + (localRotY * ca);
    gizmoRotateHandle.style.left = `${rtx}px`;
    gizmoRotateHandle.style.top = `${rty}px`;

    // Uniforms (1:1 CSS pixel units for uPixelSize; gl_FragCoord uses dpr)
    const dpr = renderer.getPixelRatio();
    sharedUniforms.uDpr.value = dpr;
    sharedUniforms.uViewportSize.value.set(rect.width * dpr, rect.height * dpr);
    sharedUniforms.uGizmoCenter.value.set(cx * dpr, (rect.height - cy) * dpr);
    sharedUniforms.uGizmoRadii.value.set(rx * dpr, ry * dpr);
    // Notice WebGL Y is inverted relative to DOM Y, so shader angle is -radAngle
    sharedUniforms.uGizmoAngle.value = -radAngle;
    sharedUniforms.uGizmoShape.value = isRectangular ? 1 : 0;
    sharedUniforms.uInnerRatio.value = innerRatio;

    sharedUniforms.uPixelSize.value = CONFIG.pixelSize;
    sharedUniforms.uPixelScatter.value = CONFIG.pixelScatter;
    sharedUniforms.uPixelWobble.value = CONFIG.pixelWobble !== undefined ? CONFIG.pixelWobble : 1.0;
    sharedUniforms.uThreads.value = CONFIG.threads;
    sharedUniforms.uWobble.value = CONFIG.wobble;
    sharedUniforms.uLiquidFreq.value = CONFIG.liquidFreq;
    sharedUniforms.uLiquidStrength.value = CONFIG.liquidStrength;
    sharedUniforms.uLiquidSpeed.value = CONFIG.liquidSpeed;
    sharedUniforms.uFadeEnable.value = CONFIG.fadeEnable ? 1.0 : 0.0;
    sharedUniforms.uFadeDepth.value = CONFIG.fadeDepth / 100.0;
    sharedUniforms.uFadeLeft.value = CONFIG.fadeLeft ? 1.0 : 0.0;
    sharedUniforms.uFadeRight.value = CONFIG.fadeRight ? 1.0 : 0.0;
    sharedUniforms.uFadeTop.value = CONFIG.fadeTop ? 1.0 : 0.0;
    sharedUniforms.uFadeBottom.value = CONFIG.fadeBottom ? 1.0 : 0.0;
    sharedUniforms.uFadeEdgeDepth.value = CONFIG.fadeEdgeDepth;
    sharedUniforms.uTearZone.value = CONFIG.tearZoneWidth;
  }

  let gizmoDragMode = null; // 'center' | 'radius' | 'rotate' | 'inner'

  gizmoCenterHandle.addEventListener("mousedown", (e) => {
    e.stopPropagation();
    gizmoDragMode = "center";
  });

  gizmoInnerHandle?.addEventListener("mousedown", (e) => {
    e.stopPropagation();
    gizmoDragMode = "inner";
  });

  gizmoRadiusHandle.addEventListener("mousedown", (e) => {
    e.stopPropagation();
    gizmoDragMode = "radius";
  });

  gizmoRotateHandle.addEventListener("mousedown", (e) => {
    e.stopPropagation();
    gizmoDragMode = "rotate";
  });

  window.addEventListener("mousemove", (e) => {
    if (!gizmoDragMode) return;
    const rect = stageContainer.getBoundingClientRect();
    const cx = CONFIG.gizmoX * rect.width;
    const cy = CONFIG.gizmoY * rect.height;
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    if (gizmoDragMode === "center") {
      CONFIG.gizmoX = THREE.MathUtils.clamp(mx / rect.width, 0.05, 0.95);
      CONFIG.gizmoY = THREE.MathUtils.clamp(my / rect.height, 0.05, 0.95);
      syncGizmoUIAndUniforms();
    } else if (gizmoDragMode === "inner") {
      const dx = mx - cx;
      const dy = my - cy;
      const dist = Math.hypot(dx, dy);
      const maxR = Math.max(CONFIG.gizmoRx, 40);
      CONFIG.gizmoInnerRatio = THREE.MathUtils.clamp(dist / maxR, 0.05, 0.85);
      const ptInnerRatio = document.getElementById("ptInnerRatio");
      if (ptInnerRatio) ptInnerRatio.value = Math.round(CONFIG.gizmoInnerRatio * 100);
      const ptInnerRatioVal = document.getElementById("ptInnerRatioVal");
      if (ptInnerRatioVal) ptInnerRatioVal.textContent = `${Math.round(CONFIG.gizmoInnerRatio * 100)}%`;
      syncGizmoUIAndUniforms();
    } else if (gizmoDragMode === "radius") {
      const dx = mx - cx;
      const dy = my - cy;
      const isLocked1to1 = CONFIG.gizmoShape === "circle" || CONFIG.gizmoShape === "square";

      if (isLocked1to1 || e.shiftKey) {
        // Shift held or locked 1:1 shape -> Uniform circle or square
        const r = THREE.MathUtils.clamp(Math.hypot(dx, dy), 50, 850);
        CONFIG.gizmoRx = r;
        CONFIG.gizmoRy = r;
      } else {
        // Free shape stretching in rotated local space
        const radAngle = THREE.MathUtils.degToRad(-CONFIG.gizmoAngle);
        const ca = Math.cos(radAngle);
        const sa = Math.sin(radAngle);
        const localX = Math.abs(dx * ca - dy * sa) / 0.7071;
        const localY = Math.abs(dx * sa + dy * ca) / 0.7071;
        CONFIG.gizmoRx = THREE.MathUtils.clamp(localX, 40, 850);
        CONFIG.gizmoRy = THREE.MathUtils.clamp(localY, 40, 850);
      }
      syncGizmoUIAndUniforms();
    } else if (gizmoDragMode === "rotate") {
      const dx = mx - cx;
      const dy = my - cy;
      // Top stem is at -90 deg in standard atan2, so add +90 deg
      let deg = THREE.MathUtils.radToDeg(Math.atan2(dy, dx)) + 90;
      if (deg > 180) deg -= 360;
      if (deg < -180) deg += 360;
      CONFIG.gizmoAngle = Math.round(deg);
      document.getElementById("ptGizmoAngle").value = CONFIG.gizmoAngle;
      document.getElementById("ptGizmoAngleVal").textContent = `${CONFIG.gizmoAngle}°`;
      syncGizmoUIAndUniforms();
    }
  });

  window.addEventListener("mouseup", () => {
    gizmoDragMode = null;
  });

  /* ================================================================== *
   * 11. Canvas Interaction (Mouse Lock, Orbit/Roll, Click-to-Edit Slide)
   * ================================================================== */

  let isDraggingCanvas = false;
  let dragMoved = false;
  let dragMode = "orbit"; // 'orbit' | 'pan_media'
  let lastPointer = { x: 0, y: 0 };

  stageContainer.addEventListener("mousedown", (e) => {
    if (e.target !== renderer.domElement) return;
    if (CONFIG.mouseDisabled) return;

    isDraggingCanvas = true;
    dragMoved = false;
    lastPointer.x = e.clientX;
    lastPointer.y = e.clientY;

    // Determine if we are panning media inside a selected slide
    if (CONFIG.panMediaMode && editingSlideIndex !== null) {
      dragMode = "pan_media";
    } else {
      dragMode = "orbit";
    }
  });

  window.addEventListener("mousemove", (e) => {
    if (!isDraggingCanvas || CONFIG.mouseDisabled) return;
    const dx = e.clientX - lastPointer.x;
    const dy = e.clientY - lastPointer.y;
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) dragMoved = true;

    lastPointer.x = e.clientX;
    lastPointer.y = e.clientY;

    if (dragMode === "pan_media" && editingSlideIndex !== null) {
      const s = slidesData[editingSlideIndex];
      s.mediaOffset.x += dx;
      s.mediaOffset.y += dy;
      if (slideMeshes[editingSlideIndex]) {
        slideMeshes[editingSlideIndex].material.uniforms.uMediaOffset.value.set(s.mediaOffset.x, s.mediaOffset.y);
      }
      return;
    }

    // Orbit 3D Ring (or Shift+Drag = Roll Z clockwise/counter-clockwise)
    if (e.shiftKey) {
      CONFIG.rollZ = THREE.MathUtils.clamp(CONFIG.rollZ + dx * 0.35, -180, 180);
      tiltGroup.rotation.z = THREE.MathUtils.degToRad(CONFIG.rollZ);
      document.getElementById("inputRoll").value = Math.round(CONFIG.rollZ);
      document.getElementById("valRoll").textContent = `${Math.round(CONFIG.rollZ)}°`;
    } else {
      ringGroup.rotation.y += dx * 0.006;
      CONFIG.tiltX = THREE.MathUtils.clamp(CONFIG.tiltX + dy * 0.25, -45, 45);
      tiltGroup.rotation.x = THREE.MathUtils.degToRad(CONFIG.tiltX);
      document.getElementById("inputTilt").value = Math.round(CONFIG.tiltX);
      document.getElementById("valTilt").textContent = `${Math.round(CONFIG.tiltX)}°`;
    }
  });

  window.addEventListener("mouseup", (e) => {
    if (isDraggingCanvas && !dragMoved && !CONFIG.mouseDisabled && e.target === renderer.domElement) {
      // Raycast click on 3D slide to open Casemaker Media HUD!
      const rect = stageContainer.getBoundingClientRect();
      pointerNdc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointerNdc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointerNdc, camera);
      const hits = raycaster.intersectObjects(slideMeshes);
      if (hits.length > 0) {
        const hitIdx = hits[0].object.userData.index;
        openSlideHud(hitIdx);
      } else {
        closeSlideHud();
      }
    }
    isDraggingCanvas = false;
  });

  // Wheel Zoom: if editingSlideIndex is open (or panMediaMode), zoom media inside slide!
  stageContainer.addEventListener("wheel", (e) => {
    if (CONFIG.mouseDisabled) return;
    if (editingSlideIndex !== null) {
      e.preventDefault();
      const s = slidesData[editingSlideIndex];
      const delta = -e.deltaY * 0.0012;
      s.mediaScale = THREE.MathUtils.clamp(s.mediaScale + delta, 0.2, 3.5);
      if (slideMeshes[editingSlideIndex]) {
        slideMeshes[editingSlideIndex].material.uniforms.uMediaScale.value = s.mediaScale;
      }
      document.getElementById("hudZoomSlider").value = s.mediaScale;
      document.getElementById("hudZoomInput").value = Math.round(s.mediaScale * 100);
    }
  }, { passive: false });

  /* ================================================================== *
   * 12. Animation Loop & Resize
   * ================================================================== */

  function onResize() {
    const rect = stageContainer.getBoundingClientRect();
    const w = Math.max(1, rect.width);
    const h = Math.max(1, rect.height);
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    syncGizmoUIAndUniforms();
  }

  window.addEventListener("resize", onResize);

  let lastTime = performance.now();

  function animate(now) {
    requestAnimationFrame(animate);

    const dt = Math.min((now - lastTime) / 1000, 0.1);
    lastTime = now;
    sharedUniforms.uTime.value += dt;

    if (CONFIG.isPlaying && !isDraggingCanvas) {
      const angularSpeed = THREE.MathUtils.degToRad(CONFIG.rotationSpeed * 0.45);
      ringGroup.rotation.y += angularSpeed * dt * CONFIG.direction;

      if (CONFIG.verticalSpin) {
        const vSpeed = THREE.MathUtils.degToRad(CONFIG.verticalSpeed * 0.45);
        tiltGroup.rotation.x += vSpeed * dt;
      }
    }

    // Dynamic back-to-front renderOrder sorting for smooth alpha dissolve in 3D
    const tempZVec = new THREE.Vector3();
    for (let i = 0; i < slideMeshes.length; i++) {
      const mesh = slideMeshes[i];
      tempZVec.set(0, 0, ringRadius);
      mesh.localToWorld(tempZVec);
      mesh.renderOrder = Math.round((tempZVec.z + ringRadius * 2) * 10);
    }

    renderer.render(scene, camera);
    updateOverlayPositions();
  }

  /* ================================================================== *
   * 13. UI Controls & Event Bindings
   * ================================================================== */

  function setPlaying(play) {
    CONFIG.isPlaying = play;
    document.getElementById("iconPause").classList.toggle("hidden", !play);
    document.getElementById("iconPlay").classList.toggle("hidden", play);

    const canvasPauseBtn = document.getElementById("canvasPauseBtn");
    canvasPauseBtn.classList.toggle("paused", !play);
    document.getElementById("canvasPauseIcon").classList.toggle("hidden", !play);
    document.getElementById("canvasPlayIcon").classList.toggle("hidden", play);
  }

  document.getElementById("btnPlayPause").addEventListener("click", () => setPlaying(!CONFIG.isPlaying));
  document.getElementById("canvasPauseBtn").addEventListener("click", () => setPlaying(!CONFIG.isPlaying));

  // Mouse Lock Toggle
  const canvasMouseLockBtn = document.getElementById("canvasMouseLockBtn");
  function setMouseDisabled(disabled) {
    CONFIG.mouseDisabled = disabled;
    canvasMouseLockBtn.classList.toggle("locked", disabled);
    document.getElementById("iconMouseOn").classList.toggle("hidden", disabled);
    document.getElementById("iconMouseOff").classList.toggle("hidden", !disabled);
    stageContainer.style.cursor = disabled ? "default" : (CONFIG.panMediaMode ? "crosshair" : "grab");
    showToast(disabled ? "Управление мышью отключено (зафиксировано)" : "Управление мышью включено");
  }
  canvasMouseLockBtn.addEventListener("click", () => setMouseDisabled(!CONFIG.mouseDisabled));

  window.addEventListener("keydown", (e) => {
    if (e.code === "Space" && e.target.tagName !== "INPUT" && e.target.tagName !== "TEXTAREA") {
      e.preventDefault();
      setPlaying(!CONFIG.isPlaying);
    }
  });

  function setDirection(dir) {
    CONFIG.direction = dir;
    document.getElementById("btnRotCCW")?.classList.toggle("active", dir === -1);
    document.getElementById("btnRotCW")?.classList.toggle("active", dir === 1);
  }

  document.getElementById("btnDirLeft").addEventListener("click", () => {
    setDirection(-1);
    setPlaying(true);
  });

  document.getElementById("btnDirRight").addEventListener("click", () => {
    setDirection(1);
    setPlaying(true);
  });

  document.getElementById("btnRotCCW")?.addEventListener("click", () => {
    setDirection(-1);
    setPlaying(true);
  });

  document.getElementById("btnRotCW")?.addEventListener("click", () => {
    setDirection(1);
    setPlaying(true);
  });

  const chkVerticalSpin = document.getElementById("chkVerticalSpin");
  const verticalSpeedRow = document.getElementById("verticalSpeedRow");
  chkVerticalSpin?.addEventListener("change", (e) => {
    CONFIG.verticalSpin = e.target.checked;
    if (verticalSpeedRow) {
      verticalSpeedRow.style.opacity = CONFIG.verticalSpin ? "1" : "0.45";
      verticalSpeedRow.style.pointerEvents = CONFIG.verticalSpin ? "auto" : "none";
    }
    if (!CONFIG.verticalSpin) {
      gsap.to(tiltGroup.rotation, { x: THREE.MathUtils.degToRad(CONFIG.tiltX), duration: 0.4 });
    }
  });

  document.getElementById("inputVerticalSpeed")?.addEventListener("input", (e) => {
    CONFIG.verticalSpeed = Number(e.target.value);
    document.getElementById("valVerticalSpeed").textContent = CONFIG.verticalSpeed;
  });

  // Effect Mode Pills ('none' | 'threads' | 'pixel' | 'liquid') & Sidebar Selector
  const pixelToolbar = document.getElementById("pixelToolbar");
  const gizmoLayerEl = document.getElementById("gizmoLayer");
  const selectShaderMode = document.getElementById("selectShaderMode");
  const paramsThreads = document.getElementById("paramsThreads");
  const paramsPixel = document.getElementById("paramsPixel");
  const paramsLiquid = document.getElementById("paramsLiquid");

  function setEffectMode(mode) {
    CONFIG.effectMode = mode;
    const modeMap = { none: 0, threads: 1, pixel: 2, liquid: 3 };
    sharedUniforms.uEffectMode.value = modeMap[mode] || 0;

    slideMeshes.forEach(m => {
      if (m.material) {
        m.material.depthTest = false;
        m.material.depthWrite = false;
        m.material.needsUpdate = true;
      }
    });

    document.querySelectorAll("#modeSelector .pill").forEach(p => {
      p.classList.toggle("active", p.dataset.effectMode === mode);
    });

    if (selectShaderMode) {
      selectShaderMode.value = mode;
    }

    const isActive = mode !== "none";
    pixelToolbar.classList.toggle("hidden", !isActive);
    gizmoLayerEl.classList.toggle("hidden", !isActive);

    document.getElementById("ptGroupPixel").classList.toggle("hidden", mode !== "pixel");
    document.getElementById("ptGroupThreads").classList.toggle("hidden", mode !== "threads");
    document.getElementById("ptGroupLiquid").classList.toggle("hidden", mode !== "liquid");

    if (paramsThreads) paramsThreads.classList.toggle("hidden", mode !== "threads");
    if (paramsPixel) paramsPixel.classList.toggle("hidden", mode !== "pixel");
    if (paramsLiquid) paramsLiquid.classList.toggle("hidden", mode !== "liquid");

    const labelMap = {
      threads: "Шелковые нити:",
      pixel: "Радиальная пикселизация:",
      liquid: "Жидкое плавление:"
    };
    if (labelMap[mode]) document.getElementById("ptModeLabel").textContent = labelMap[mode];

    syncGizmoUIAndUniforms();
  }

  document.querySelectorAll("#modeSelector .pill").forEach(btn => {
    btn.addEventListener("click", () => setEffectMode(btn.dataset.effectMode));
  });

  if (selectShaderMode) {
    selectShaderMode.addEventListener("change", (e) => setEffectMode(e.target.value));
  }

  // --- Tear Zone Width (Synced between Sidebar & Topbar) ---
  const inputTearZone = document.getElementById("inputTearZone");
  const valTearZone = document.getElementById("valTearZone");
  const ptTearZone = document.getElementById("ptTearZone");
  const ptTearZoneVal = document.getElementById("ptTearZoneVal");

  function syncTearZone(val) {
    CONFIG.tearZoneWidth = val;
    sharedUniforms.uTearZone.value = val;
    if (inputTearZone) inputTearZone.value = val;
    if (valTearZone) valTearZone.textContent = `${val}px`;
    if (ptTearZone) ptTearZone.value = val;
    if (ptTearZoneVal) ptTearZoneVal.textContent = `${val}px`;
  }

  inputTearZone?.addEventListener("input", (e) => syncTearZone(Number(e.target.value)));
  ptTearZone?.addEventListener("input", (e) => syncTearZone(Number(e.target.value)));

  // --- Pixel Params (Synced between Sidebar & Topbar) ---
  const inputPixelSize = document.getElementById("inputPixelSize");
  const valPixelSize = document.getElementById("valPixelSize");
  const ptPixelSize = document.getElementById("ptPixelSize");
  const ptPixelSizeVal = document.getElementById("ptPixelSizeVal");

  function syncPixelSize(val) {
    CONFIG.pixelSize = val;
    sharedUniforms.uPixelSize.value = val;
    if (inputPixelSize) inputPixelSize.value = val;
    if (valPixelSize) valPixelSize.textContent = `${val}px`;
    if (ptPixelSize) ptPixelSize.value = val;
    if (ptPixelSizeVal) ptPixelSizeVal.textContent = `${val}px`;
  }
  inputPixelSize?.addEventListener("input", (e) => syncPixelSize(Number(e.target.value)));
  ptPixelSize?.addEventListener("input", (e) => syncPixelSize(Number(e.target.value)));

  const inputPixelScatter = document.getElementById("inputPixelScatter");
  const valPixelScatter = document.getElementById("valPixelScatter");
  const ptPixelScatter = document.getElementById("ptPixelScatter");
  const ptPixelScatterVal = document.getElementById("ptPixelScatterVal");

  function syncPixelScatter(val) {
    CONFIG.pixelScatter = val;
    sharedUniforms.uPixelScatter.value = val;
    if (inputPixelScatter) inputPixelScatter.value = val;
    if (valPixelScatter) valPixelScatter.textContent = `${val}%`;
    if (ptPixelScatter) ptPixelScatter.value = val;
    if (ptPixelScatterVal) ptPixelScatterVal.textContent = `${val}%`;
  }
  inputPixelScatter?.addEventListener("input", (e) => syncPixelScatter(Number(e.target.value)));
  ptPixelScatter?.addEventListener("input", (e) => syncPixelScatter(Number(e.target.value)));

  const inputPixelWobble = document.getElementById("inputPixelWobble");
  const valPixelWobble = document.getElementById("valPixelWobble");
  const ptPixelWobble = document.getElementById("ptPixelWobble");
  const ptPixelWobbleVal = document.getElementById("ptPixelWobbleVal");

  function syncPixelWobble(val) {
    CONFIG.pixelWobble = val;
    sharedUniforms.uPixelWobble.value = val;
    if (inputPixelWobble) inputPixelWobble.value = val;
    if (valPixelWobble) valPixelWobble.textContent = `${val.toFixed(1)}×`;
    if (ptPixelWobble) ptPixelWobble.value = val;
    if (ptPixelWobbleVal) ptPixelWobbleVal.textContent = `${val.toFixed(1)}×`;
  }
  inputPixelWobble?.addEventListener("input", (e) => syncPixelWobble(Number(e.target.value)));
  ptPixelWobble?.addEventListener("input", (e) => syncPixelWobble(Number(e.target.value)));

  function randomizePixelSeed() {
    CONFIG.pixelSeed = Math.random() * 1000.0;
    sharedUniforms.uPixelSeed.value = CONFIG.pixelSeed;
    showToast("🎲 Новое распределение пикселей");
  }
  document.getElementById("btnRandomPixel")?.addEventListener("click", randomizePixelSeed);
  document.getElementById("btnRandomPixelTop")?.addEventListener("click", randomizePixelSeed);

  // --- Threads Params (Synced between Sidebar & Topbar) ---
  const inputThreadCount = document.getElementById("inputThreadCount");
  const valThreadCount = document.getElementById("valThreadCount");
  const ptThreadsCount = document.getElementById("ptThreadsCount");
  const ptThreadsCountVal = document.getElementById("ptThreadsCountVal");

  function syncThreads(val) {
    CONFIG.threads = val;
    sharedUniforms.uThreads.value = val;
    if (inputThreadCount) inputThreadCount.value = val;
    if (valThreadCount) valThreadCount.textContent = val;
    if (ptThreadsCount) ptThreadsCount.value = val;
    if (ptThreadsCountVal) ptThreadsCountVal.textContent = val;
  }
  inputThreadCount?.addEventListener("input", (e) => syncThreads(Number(e.target.value)));
  ptThreadsCount?.addEventListener("input", (e) => syncThreads(Number(e.target.value)));

  const inputWobble = document.getElementById("inputWobble");
  const valWobble = document.getElementById("valWobble");
  const ptWobble = document.getElementById("ptWobble");
  const ptWobbleVal = document.getElementById("ptWobbleVal");

  function syncWobble(val) {
    CONFIG.wobble = val;
    sharedUniforms.uWobble.value = val;
    if (inputWobble) inputWobble.value = val;
    if (valWobble) valWobble.textContent = `${val.toFixed(1)}×`;
    if (ptWobble) ptWobble.value = val;
    if (ptWobbleVal) ptWobbleVal.textContent = val.toFixed(1);
  }
  inputWobble?.addEventListener("input", (e) => syncWobble(Number(e.target.value)));
  ptWobble?.addEventListener("input", (e) => syncWobble(Number(e.target.value)));

  // --- Liquid Params (Synced between Sidebar & Topbar) ---
  const inputLiquidFreq = document.getElementById("inputLiquidFreq");
  const valLiquidFreq = document.getElementById("valLiquidFreq");
  const ptLiquidFreq = document.getElementById("ptLiquidFreq");
  const ptLiquidFreqVal = document.getElementById("ptLiquidFreqVal");

  function syncLiquidFreq(val) {
    CONFIG.liquidFreq = val;
    sharedUniforms.uLiquidFreq.value = val;
    if (inputLiquidFreq) inputLiquidFreq.value = val;
    if (valLiquidFreq) valLiquidFreq.textContent = val.toFixed(1);
    if (ptLiquidFreq) ptLiquidFreq.value = val;
    if (ptLiquidFreqVal) ptLiquidFreqVal.textContent = val.toFixed(1);
  }
  inputLiquidFreq?.addEventListener("input", (e) => syncLiquidFreq(Number(e.target.value)));
  ptLiquidFreq?.addEventListener("input", (e) => syncLiquidFreq(Number(e.target.value)));

  const inputLiquidStrength = document.getElementById("inputLiquidStrength");
  const valLiquidStrength = document.getElementById("valLiquidStrength");
  const ptLiquidStrength = document.getElementById("ptLiquidStrength");
  const ptLiquidStrengthVal = document.getElementById("ptLiquidStrengthVal");

  function syncLiquidStrength(val) {
    CONFIG.liquidStrength = val;
    sharedUniforms.uLiquidStrength.value = val;
    if (inputLiquidStrength) inputLiquidStrength.value = val;
    if (valLiquidStrength) valLiquidStrength.textContent = `${val.toFixed(1)}×`;
    if (ptLiquidStrength) ptLiquidStrength.value = val;
    if (ptLiquidStrengthVal) ptLiquidStrengthVal.textContent = val.toFixed(1);
  }
  inputLiquidStrength?.addEventListener("input", (e) => syncLiquidStrength(Number(e.target.value)));
  ptLiquidStrength?.addEventListener("input", (e) => syncLiquidStrength(Number(e.target.value)));

  const inputLiquidSpeed = document.getElementById("inputLiquidSpeed");
  const valLiquidSpeed = document.getElementById("valLiquidSpeed");
  const ptLiquidSpeed = document.getElementById("ptLiquidSpeed");
  const ptLiquidSpeedVal = document.getElementById("ptLiquidSpeedVal");

  function syncLiquidSpeed(val) {
    CONFIG.liquidSpeed = val;
    sharedUniforms.uLiquidSpeed.value = val;
    if (inputLiquidSpeed) inputLiquidSpeed.value = val;
    if (valLiquidSpeed) valLiquidSpeed.textContent = `${val.toFixed(1)}×`;
    if (ptLiquidSpeed) ptLiquidSpeed.value = val;
    if (ptLiquidSpeedVal) ptLiquidSpeedVal.textContent = val.toFixed(1);
  }
  inputLiquidSpeed?.addEventListener("input", (e) => syncLiquidSpeed(Number(e.target.value)));
  ptLiquidSpeed?.addEventListener("input", (e) => syncLiquidSpeed(Number(e.target.value)));

  function randomizeLiquidSeed() {
    CONFIG.liquidSeed = Math.random() * 1000.0;
    sharedUniforms.uLiquidSeed.value = CONFIG.liquidSeed;
    showToast("🎲 Новая случайная фаза жидкости");
  }
  document.getElementById("btnRandomLiquid")?.addEventListener("click", randomizeLiquidSeed);
  document.getElementById("btnRandomLiquidTop")?.addEventListener("click", randomizeLiquidSeed);

  // --- Screen-Edge Erase Controls ---
  const chkFadeLeft = document.getElementById("chkFadeLeft");
  const chkFadeRight = document.getElementById("chkFadeRight");
  const chkFadeTop = document.getElementById("chkFadeTop");
  const chkFadeBottom = document.getElementById("chkFadeBottom");
  const inputFadeDepth = document.getElementById("inputFadeDepth");
  const valFadeDepth = document.getElementById("valFadeDepth");
  const edgePreviewBox = document.getElementById("edgePreviewBox");

  function updateEdgeFadeUniforms() {
    if (chkFadeLeft) CONFIG.fadeLeft = chkFadeLeft.checked;
    if (chkFadeRight) CONFIG.fadeRight = chkFadeRight.checked;
    if (chkFadeTop) CONFIG.fadeTop = chkFadeTop.checked;
    if (chkFadeBottom) CONFIG.fadeBottom = chkFadeBottom.checked;

    sharedUniforms.uFadeLeft.value = CONFIG.fadeLeft ? 1.0 : 0.0;
    sharedUniforms.uFadeRight.value = CONFIG.fadeRight ? 1.0 : 0.0;
    sharedUniforms.uFadeTop.value = CONFIG.fadeTop ? 1.0 : 0.0;
    sharedUniforms.uFadeBottom.value = CONFIG.fadeBottom ? 1.0 : 0.0;

    if (edgePreviewBox) {
      edgePreviewBox.classList.toggle("fade-left", CONFIG.fadeLeft);
      edgePreviewBox.classList.toggle("fade-right", CONFIG.fadeRight);
      edgePreviewBox.classList.toggle("fade-top", CONFIG.fadeTop);
      edgePreviewBox.classList.toggle("fade-bottom", CONFIG.fadeBottom);
    }
  }

  chkFadeLeft?.addEventListener("change", updateEdgeFadeUniforms);
  chkFadeRight?.addEventListener("change", updateEdgeFadeUniforms);
  chkFadeTop?.addEventListener("change", updateEdgeFadeUniforms);
  chkFadeBottom?.addEventListener("change", updateEdgeFadeUniforms);
  updateEdgeFadeUniforms();

  inputFadeDepth?.addEventListener("input", (e) => {
    const depth = parseFloat(e.target.value);
    CONFIG.fadeEdgeDepth = depth;
    sharedUniforms.uFadeEdgeDepth.value = depth;
    if (valFadeDepth) valFadeDepth.textContent = `${Math.round(depth * 100)}%`;
  });

  // Gizmo & Shape / Ellipse Controls
  const ptInnerRatioEl = document.getElementById("ptInnerRatio");
  const ptInnerRatioValEl = document.getElementById("ptInnerRatioVal");
  ptInnerRatioEl?.addEventListener("input", (e) => {
    CONFIG.gizmoInnerRatio = Number(e.target.value) / 100.0;
    if (ptInnerRatioValEl) ptInnerRatioValEl.textContent = `${e.target.value}%`;
    syncGizmoUIAndUniforms();
  });

  document.getElementById("ptGizmoAngle").addEventListener("input", (e) => {
    CONFIG.gizmoAngle = Number(e.target.value);
    document.getElementById("ptGizmoAngleVal").textContent = `${CONFIG.gizmoAngle}°`;
    syncGizmoUIAndUniforms();
  });

  document.getElementById("ptFadeEnable").addEventListener("change", (e) => {
    CONFIG.fadeEnable = e.target.checked;
    syncGizmoUIAndUniforms();
  });

  document.getElementById("ptFadeDepth").addEventListener("input", (e) => {
    CONFIG.fadeDepth = Number(e.target.value);
    document.getElementById("ptFadeDepthVal").textContent = `${CONFIG.fadeDepth}%`;
    syncGizmoUIAndUniforms();
  });

  document.getElementById("btnCenterGizmo").addEventListener("click", () => {
    CONFIG.gizmoX = 0.5;
    CONFIG.gizmoY = 0.5;
    CONFIG.gizmoRx = 220;
    CONFIG.gizmoRy = 220;
    CONFIG.gizmoAngle = 0;
    document.getElementById("ptGizmoAngle").value = 0;
    document.getElementById("ptGizmoAngleVal").textContent = "0°";
    syncGizmoUIAndUniforms();
  });

  // Aspect Ratio Selector
  document.querySelectorAll(".aspect-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".aspect-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      const str = btn.dataset.aspect;
      CONFIG.aspectRatioStr = str;
      const [w, h] = str.split("/").map(Number);
      CONFIG.aspectRatio = w / h;
      document.getElementById("currentAspectBadge").textContent = str.replace("/", ":");
      rebuildRing();
    });
  });

  // Ring Geometry Sliders
  document.getElementById("inputSlideCount").addEventListener("input", (e) => {
    CONFIG.slideCount = Number(e.target.value);
    document.getElementById("valSlideCount").textContent = CONFIG.slideCount;
    rebuildRing();
  });

  document.getElementById("inputSlideGap").addEventListener("input", (e) => {
    CONFIG.slideGap = Number(e.target.value);
    document.getElementById("valSlideGap").textContent = `${CONFIG.slideGap}px`;
    rebuildRing();
  });

  document.getElementById("inputCardHeight").addEventListener("input", (e) => {
    CONFIG.cardHeight = Number(e.target.value);
    document.getElementById("valCardHeight").textContent = `${CONFIG.cardHeight}px`;
    rebuildRing();
  });

  document.getElementById("inputCardRadius").addEventListener("input", (e) => {
    CONFIG.cardRadius = Number(e.target.value);
    document.getElementById("valCardRadius").textContent = `${CONFIG.cardRadius}px`;
    sharedUniforms.uRadius.value = CONFIG.cardRadius;
  });

  // Rotation, Tilt X & Roll Z Sliders
  document.getElementById("inputRotationSpeed").addEventListener("input", (e) => {
    CONFIG.rotationSpeed = Number(e.target.value);
    document.getElementById("valRotationSpeed").textContent = CONFIG.rotationSpeed;
  });

  document.getElementById("inputTilt").addEventListener("input", (e) => {
    CONFIG.tiltX = Number(e.target.value);
    document.getElementById("valTilt").textContent = `${CONFIG.tiltX}°`;
    tiltGroup.rotation.x = THREE.MathUtils.degToRad(CONFIG.tiltX);
  });

  document.getElementById("inputRoll").addEventListener("input", (e) => {
    CONFIG.rollZ = Number(e.target.value);
    document.getElementById("valRoll").textContent = `${CONFIG.rollZ}°`;
    tiltGroup.rotation.z = THREE.MathUtils.degToRad(CONFIG.rollZ);
  });

  document.getElementById("inputYaw").addEventListener("input", (e) => {
    setPlaying(false);
    const deg = Number(e.target.value);
    document.getElementById("valYaw").textContent = `${deg}°`;
    ringGroup.rotation.y = THREE.MathUtils.degToRad(deg);
  });

  document.getElementById("btnResetRingView").addEventListener("click", () => {
    CONFIG.tiltX = 10;
    CONFIG.rollZ = 0;
    document.getElementById("inputTilt").value = 10;
    document.getElementById("valTilt").textContent = "10°";
    document.getElementById("inputRoll").value = 0;
    document.getElementById("valRoll").textContent = "0°";
    gsap.to(tiltGroup.rotation, { x: THREE.MathUtils.degToRad(10), z: 0, duration: 0.5 });
    setPlaying(true);
  });

  document.getElementById("btnToggleSidebar").addEventListener("click", () => {
    document.getElementById("sidebar").classList.toggle("collapsed");
    setTimeout(onResize, 260);
  });

  /* ================================================================== *
   * 14. Export (PNG & WebM Video)
   * ================================================================== */

  const figmaDropdownMenu = document.getElementById("figmaDropdownMenu");
  document.getElementById("btnFigmaExport").addEventListener("click", (e) => {
    e.stopPropagation();
    figmaDropdownMenu.classList.toggle("hidden");
  });
  window.addEventListener("click", () => figmaDropdownMenu.classList.add("hidden"));

  function exportPng(scale = 1, withBg = false) {
    const rect = stageContainer.getBoundingClientRect();
    const w = Math.round(rect.width * scale);
    const h = Math.round(rect.height * scale);
    const oldRatio = renderer.getPixelRatio();

    renderer.setPixelRatio(1);
    renderer.setSize(w, h, false);
    scene.background = withBg ? new THREE.Color(0x090b10) : null;

    const oldCenter = sharedUniforms.uGizmoCenter.value.clone();
    const oldRadii = sharedUniforms.uGizmoRadii.value.clone();
    const oldVp = sharedUniforms.uViewportSize.value.clone();
    const oldDpr = sharedUniforms.uDpr.value;

    sharedUniforms.uViewportSize.value.set(w, h);
    sharedUniforms.uDpr.value = scale;
    sharedUniforms.uGizmoCenter.value.set(CONFIG.gizmoX * w, (1.0 - CONFIG.gizmoY) * h);
    sharedUniforms.uGizmoRadii.value.set(CONFIG.gizmoRx * scale, CONFIG.gizmoRy * scale);

    renderer.render(scene, camera);
    const dataUrl = renderer.domElement.toDataURL("image/png");

    scene.background = null;
    renderer.setPixelRatio(oldRatio);
    renderer.setSize(rect.width, rect.height);
    sharedUniforms.uViewportSize.value.copy(oldVp);
    sharedUniforms.uDpr.value = oldDpr;
    sharedUniforms.uGizmoCenter.value.copy(oldCenter);
    sharedUniforms.uGizmoRadii.value.copy(oldRadii);

    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = `ring-slider-${CONFIG.aspectRatioStr.replace("/", "x")}-${scale}x${withBg ? "-bg" : "-alpha"}.png`;
    a.click();
    showToast(`PNG (${scale}x) экспортирован!`);
  }

  document.getElementById("btnExportPng1x")?.addEventListener("click", () => exportPng(1, false));
  document.getElementById("btnExportPng2x")?.addEventListener("click", () => exportPng(2, false));
  document.getElementById("btnExportPngBg")?.addEventListener("click", () => exportPng(2, true));

  const webmModal = document.getElementById("webmModal");
  document.getElementById("btnOpenWebmModal").addEventListener("click", () => webmModal.classList.remove("hidden"));
  document.getElementById("btnCloseWebmModal").addEventListener("click", () => webmModal.classList.add("hidden"));
  document.getElementById("btnCancelWebm").addEventListener("click", () => webmModal.classList.add("hidden"));

  document.getElementById("btnStartWebmRender").addEventListener("click", () => {
    const duration = Number(document.getElementById("webmDurationSelect").value);
    const fps = Number(document.getElementById("webmFpsSelect").value);
    const bgMode = document.getElementById("webmBgSelect").value;

    const progressWrap = document.getElementById("webmProgressWrap");
    const progressBar = document.getElementById("webmProgressBar");
    const progressPct = document.getElementById("webmProgressPercent");
    progressWrap.classList.remove("hidden");

    const wasPlaying = CONFIG.isPlaying;
    setPlaying(false);

    scene.background = bgMode === "dark" ? new THREE.Color(0x090b10) : null;

    const canvas = renderer.domElement;
    const stream = canvas.captureStream(fps);
    const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
      ? "video/webm;codecs=vp9"
      : "video/webm";

    const recorder = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: 12_000_000
    });

    const chunks = [];
    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };

    recorder.onstop = () => {
      scene.background = null;
      const blob = new Blob(chunks, { type: "video/webm" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `ring-slider-360-${duration}s.webm`;
      a.click();
      progressWrap.classList.add("hidden");
      webmModal.classList.add("hidden");
      setPlaying(wasPlaying);
      showToast("WebM видео 360° готово!");
    };

    recorder.start();
    const totalFrames = duration * fps;
    let currentFrame = 0;
    const startRotY = ringGroup.rotation.y;

    function stepFrame() {
      if (currentFrame >= totalFrames) {
        recorder.stop();
        return;
      }
      const progress = currentFrame / totalFrames;
      ringGroup.rotation.y = startRotY + progress * Math.PI * 2 * CONFIG.direction;
      sharedUniforms.uTime.value += 1 / fps;
      renderer.render(scene, camera);

      const pct = Math.round(progress * 100);
      progressBar.style.width = `${pct}%`;
      progressPct.textContent = `${pct}%`;

      currentFrame++;
      setTimeout(stepFrame, 1000 / fps);
    }

    stepFrame();
  });

  /* ================================================================== *
   * 15. Presets API Database
   * ================================================================== */

  const presetsModal = document.getElementById("presetsModal");
  document.getElementById("btnOpenPresets").addEventListener("click", () => {
    presetsModal.classList.remove("hidden");
    loadPresetsList();
  });
  document.getElementById("btnClosePresetsModal").addEventListener("click", () => presetsModal.classList.add("hidden"));

  async function loadPresetsList() {
    const listEl = document.getElementById("presetsList");
    listEl.innerHTML = "<div style='color:#94a3b8; font-size:12px;'>Загрузка пресетов...</div>";
    try {
      const res = await fetch("/api/ring-slider/presets");
      const presets = await res.json();
      listEl.innerHTML = "";
      presets.forEach(p => {
        const item = document.createElement("div");
        item.className = "preset-item";
        const modeText = p.config.effectMode || (p.config.pixelEnabled ? "pixel" : "none");
        item.innerHTML = `
          <div class="preset-info">
            <h4>${p.name}</h4>
            <span>Слайдов: ${p.config.slideCount} • Формат: ${p.config.aspectRatioStr} • Эффект: ${modeText}</span>
          </div>
          <div class="preset-actions">
            <button class="btn btn-primary btn-sm btn-apply-preset">Применить</button>
            <button class="btn btn-secondary btn-sm btn-del-preset">✕</button>
          </div>
        `;
        item.querySelector(".btn-apply-preset").addEventListener("click", () => {
          applyPresetConfig(p.config);
          presetsModal.classList.add("hidden");
          showToast(`Пресет «${p.name}» применён!`);
        });
        item.querySelector(".btn-del-preset").addEventListener("click", async () => {
          await fetch(`/api/ring-slider/presets?id=${encodeURIComponent(p.id)}`, { method: "DELETE" });
          loadPresetsList();
        });
        listEl.appendChild(item);
      });
    } catch (e) {
      listEl.innerHTML = "<div style='color:#ef4444; font-size:12px;'>Ошибка загрузки базы пресетов</div>";
    }
  }

  function applyPresetConfig(cfg) {
    Object.assign(CONFIG, cfg);
    if (!CONFIG.effectMode && cfg.pixelEnabled !== undefined) {
      CONFIG.effectMode = cfg.pixelEnabled ? "pixel" : "none";
    }
    document.getElementById("inputSlideCount").value = CONFIG.slideCount;
    document.getElementById("valSlideCount").textContent = CONFIG.slideCount;
    document.getElementById("inputSlideGap").value = CONFIG.slideGap;
    document.getElementById("valSlideGap").textContent = `${CONFIG.slideGap}px`;
    document.getElementById("inputCardHeight").value = CONFIG.cardHeight;
    document.getElementById("valCardHeight").textContent = `${CONFIG.cardHeight}px`;
    document.getElementById("inputCardRadius").value = CONFIG.cardRadius;
    document.getElementById("valCardRadius").textContent = `${CONFIG.cardRadius}px`;
    document.getElementById("inputRotationSpeed").value = CONFIG.rotationSpeed;
    document.getElementById("valRotationSpeed").textContent = CONFIG.rotationSpeed;
    document.getElementById("inputTilt").value = CONFIG.tiltX;
    document.getElementById("valTilt").textContent = `${CONFIG.tiltX}°`;
    document.getElementById("inputRoll").value = CONFIG.rollZ || 0;
    document.getElementById("valRoll").textContent = `${CONFIG.rollZ || 0}°`;
    if (chkVerticalSpin) chkVerticalSpin.checked = !!CONFIG.verticalSpin;
    if (verticalSpeedRow) {
      verticalSpeedRow.style.opacity = CONFIG.verticalSpin ? "1" : "0.45";
      verticalSpeedRow.style.pointerEvents = CONFIG.verticalSpin ? "auto" : "none";
    }
    if (document.getElementById("inputVerticalSpeed")) {
      document.getElementById("inputVerticalSpeed").value = CONFIG.verticalSpeed || 35;
      document.getElementById("valVerticalSpeed").textContent = CONFIG.verticalSpeed || 35;
    }
    setDirection(CONFIG.direction || -1);

    document.querySelectorAll(".aspect-btn").forEach(b => {
      b.classList.toggle("active", b.dataset.aspect === CONFIG.aspectRatioStr);
    });
    document.getElementById("currentAspectBadge").textContent = CONFIG.aspectRatioStr.replace("/", ":");

    syncTearZone(CONFIG.tearZoneWidth || 380);
    syncPixelSize(CONFIG.pixelSize !== undefined ? CONFIG.pixelSize : 20);
    syncPixelScatter(CONFIG.pixelScatter !== undefined ? CONFIG.pixelScatter : 45);
    syncPixelWobble(CONFIG.pixelWobble !== undefined ? CONFIG.pixelWobble : 1.0);
    syncThreads(CONFIG.threads || 26);
    syncWobble(CONFIG.wobble !== undefined ? CONFIG.wobble : 1.0);
    syncLiquidFreq(CONFIG.liquidFreq !== undefined ? CONFIG.liquidFreq : 6.0);
    syncLiquidStrength(CONFIG.liquidStrength !== undefined ? CONFIG.liquidStrength : 1.2);
    syncLiquidSpeed(CONFIG.liquidSpeed !== undefined ? CONFIG.liquidSpeed : 1.5);

    CONFIG.gizmoShape = cfg.gizmoShape || "ellipse";
    setGizmoShape(CONFIG.gizmoShape);
    CONFIG.gizmoInnerRatio = cfg.gizmoInnerRatio !== undefined ? cfg.gizmoInnerRatio : 0.25;
    const ptInnerRatio = document.getElementById("ptInnerRatio");
    if (ptInnerRatio) ptInnerRatio.value = Math.round(CONFIG.gizmoInnerRatio * 100);
    const ptInnerRatioVal = document.getElementById("ptInnerRatioVal");
    if (ptInnerRatioVal) ptInnerRatioVal.textContent = `${Math.round(CONFIG.gizmoInnerRatio * 100)}%`;

    document.getElementById("ptGizmoAngle").value = CONFIG.gizmoAngle || 0;
    document.getElementById("ptGizmoAngleVal").textContent = `${CONFIG.gizmoAngle || 0}°`;
    document.getElementById("ptFadeEnable").checked = CONFIG.fadeEnable;
    document.getElementById("ptFadeDepth").value = CONFIG.fadeDepth;
    document.getElementById("ptFadeDepthVal").textContent = `${CONFIG.fadeDepth}%`;

    if (chkFadeLeft) chkFadeLeft.checked = CONFIG.fadeLeft !== false;
    if (chkFadeRight) chkFadeRight.checked = CONFIG.fadeRight !== false;
    if (chkFadeTop) chkFadeTop.checked = !!CONFIG.fadeTop;
    if (chkFadeBottom) chkFadeBottom.checked = !!CONFIG.fadeBottom;
    if (inputFadeDepth) inputFadeDepth.value = CONFIG.fadeEdgeDepth || 0.22;
    if (valFadeDepth) valFadeDepth.textContent = `${Math.round((CONFIG.fadeEdgeDepth || 0.22) * 100)}%`;
    updateEdgeFadeUniforms();

    setMouseDisabled(!!CONFIG.mouseDisabled);
    setEffectMode(CONFIG.effectMode || "none");
    rebuildRing();
  }

  document.getElementById("btnSavePreset").addEventListener("click", async () => {
    const nameInput = document.getElementById("newPresetName");
    const name = nameInput.value.trim() || `Ring Preset (${CONFIG.aspectRatioStr})`;
    await fetch("/api/ring-slider/presets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        config: { ...CONFIG }
      })
    });
    nameInput.value = "";
    loadPresetsList();
    showToast("Пресет сохранен в базу!");
  });

  /* ================================================================== *
   * 16. Code & AI Prompt Generator
   * ================================================================== */

  const codeModal = document.getElementById("codeModal");
  const codeOutput = document.getElementById("codeOutput");
  let activeCodeTab = "code";

  function updateCodeOutput() {
    if (activeCodeTab === "code") {
      codeOutput.value = `<!-- Ring Slider 3D Standalone Config (Three.js) -->
<script>
const RING_SLIDER_CONFIG = ${JSON.stringify({
  aspectRatio: CONFIG.aspectRatioStr,
  slideCount: CONFIG.slideCount,
  slideGap: CONFIG.slideGap,
  cardHeight: CONFIG.cardHeight,
  cardRadius: CONFIG.cardRadius,
  rotationSpeed: CONFIG.rotationSpeed,
  tiltX: CONFIG.tiltX,
  rollZ: CONFIG.rollZ,
  mouseDisabled: CONFIG.mouseDisabled,
  effectMode: CONFIG.effectMode,
  tearZoneWidth: CONFIG.tearZoneWidth,
  screenEdgeFade: {
    left: CONFIG.fadeLeft,
    right: CONFIG.fadeRight,
    top: CONFIG.fadeTop,
    bottom: CONFIG.fadeBottom,
    depth: CONFIG.fadeEdgeDepth
  },
  radialEllipse: {
    rx: Math.round(CONFIG.gizmoRx),
    ry: Math.round(CONFIG.gizmoRy),
    angleDeg: CONFIG.gizmoAngle,
    fadeErase: CONFIG.fadeEnable,
    fadeDepth: CONFIG.fadeDepth
  },
  effectParams: {
    pixelSize: CONFIG.pixelSize,
    pixelScatter: CONFIG.pixelScatter,
    pixelWobble: CONFIG.pixelWobble,
    threads: CONFIG.threads,
    wobble: CONFIG.wobble,
    liquidFreq: CONFIG.liquidFreq,
    liquidStrength: CONFIG.liquidStrength,
    liquidSpeed: CONFIG.liquidSpeed
  }
}, null, 2)};
</script>`;
    } else {
      codeOutput.value = `Создай 3D Ring Carousel на Three.js со следующими параметрами:
- Формат слайдов: ${CONFIG.aspectRatioStr}, количество: ${CONFIG.slideCount}, интервал: ${CONFIG.slideGap}px, высота: ${CONFIG.cardHeight}px.
- Вращение: скорость ${CONFIG.rotationSpeed}, наклон по вертикали (Tilt X): ${CONFIG.tiltX}°, поворот по горизонтали (Roll Z): ${CONFIG.rollZ}°.
- Управление мышью: ${CONFIG.mouseDisabled ? "ОТКЛЮЧЕНО (canvas pointer-events / orbit заблокированы)" : "Включено"}.
- Эффект: ${CONFIG.effectMode} (эллиптическая область ${Math.round(CONFIG.gizmoRx)}x${Math.round(CONFIG.gizmoRy)}px, угол ${CONFIG.gizmoAngle}°, фейд-стирание ${CONFIG.fadeDepth}%).`;
    }
  }

  document.getElementById("btnOpenCode").addEventListener("click", () => {
    codeModal.classList.remove("hidden");
    updateCodeOutput();
  });
  document.getElementById("btnCloseCodeModal").addEventListener("click", () => codeModal.classList.add("hidden"));

  document.querySelectorAll(".code-tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".code-tab-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      activeCodeTab = btn.dataset.tab;
      updateCodeOutput();
    });
  });

  document.getElementById("btnCopyCode").addEventListener("click", () => {
    navigator.clipboard.writeText(codeOutput.value);
    showToast("Скопировано в буфер!");
  });

  /* ================================================================== *
   * 17. Toast Notification Helper
   * ================================================================== */

  let toastTimer = null;
  function showToast(msg) {
    const toast = document.getElementById("toastNotification");
    document.getElementById("toastMessage").textContent = msg;
    toast.classList.remove("hidden");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.add("hidden"), 2500);
  }

  /* ================================================================== *
   * 18. Initialization
   * ================================================================== */

  rebuildRing();
  onResize();
  requestAnimationFrame(animate);

})();
