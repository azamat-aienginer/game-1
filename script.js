(() => {
  'use strict';

  /* =====================================================
     XATOLIKNI EKRANDA KO'RSATISH (nosozlikni topish uchun)
  ===================================================== */
  function showError(err) {
    try { console.error(err); } catch (e) { /* e'tiborsiz */ }
    let box = document.getElementById('errorBox');
    if (!box) {
      box = document.createElement('pre');
      box.id = 'errorBox';
      box.style.cssText =
        'position:fixed;left:8px;right:8px;bottom:8px;z-index:99;max-height:40vh;overflow:auto;' +
        'margin:0;padding:10px 12px;background:rgba(120,0,20,.93);color:#fff;' +
        'font:12px/1.4 monospace;white-space:pre-wrap;border-radius:6px;user-select:text';
      document.body.appendChild(box);
    }
    box.textContent = 'XATOLIK: ' + (err && err.stack ? err.stack : String(err));
  }
  window.addEventListener('error', (e) => showError(e.error || e.message));

  if (typeof THREE === 'undefined') {
    document.body.innerHTML =
      '<p style="color:#fff;font:18px sans-serif;padding:30px;text-align:center">' +
      'Three.js kutubxonasi yuklanmadi. Internet aloqasini tekshirib, sahifani qayta oching.</p>';
    return;
  }

  /* =====================================================
     SOZLAMALAR
  ===================================================== */
  const W = 900;
  const H = 500;
  const GROUND = 430;          // yer chizig'i (o'yin mantig'i pikselda)
  const UNIT = 50;             // 1 dunyo birligi = 50 piksel
  const GRAVITY = 1800;
  const MOVE_SPEED = 290;
  const JUMP_V = 700;
  const PLAYER_MAX_HP = 5;
  const KILLS_PER_LEVEL = 10;
  const MAX_RECORDS = 10;
  const INTRO_LEN = 13.4;
  const TAU = Math.PI * 2;

  const STORAGE_KEY = 'stickman_records_v1';
  const NAME_KEY = 'stickman_player_name';

  const ENEMY_TYPES = {
    normal: { hp: 1, speed: 90,  scale: 1.0, points: 10, color: 0xd7263d, head: 0xffd9cf },
    fast:   { hp: 1, speed: 165, scale: 0.9, points: 20, color: 0xff8c1a, head: 0xffe3b8 },
    tank:   { hp: 3, speed: 60,  scale: 1.3, points: 40, color: 0x8e44ad, head: 0xe3c8f2 }
  };

  /* ===== HUJUM KOMBOSI: 3 xil zarba =====
     0 — tepadan pastga kesuvchi zarba
     1 — pastdan yuqoriga ko'taruvchi zarba
     2 — aylanma zarba (ikki tomonga, kuchli)            */
  const ATTACKS = [
    { dur: 0.34, cd: 0.29, range: 82,  dmg: 1, lunge: 280, from: 0.24, to: 0.72, knock: 420, both: false, heavy: false, color: 0xffd9a8, css: '#ffd9a8' },
    { dur: 0.36, cd: 0.30, range: 88,  dmg: 1, lunge: 300, from: 0.22, to: 0.68, knock: 480, both: false, heavy: false, color: 0x9ae8ff, css: '#9ae8ff' },
    { dur: 0.60, cd: 0.60, range: 108, dmg: 2, lunge: 520, from: 0.30, to: 0.78, knock: 760, both: true,  heavy: true,  color: 0xff5fa2, css: '#ff5fa2' }
  ];
  const CHAIN_WINDOW = 0.55;   // keyingi zarbani kombo qilish uchun vaqt (soniya)

  const wx = (x) => (x - W / 2) / UNIT;
  const wy = (y) => (GROUND - y) / UNIT;

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rand = (a, b) => a + Math.random() * (b - a);
  const lerp = (a, b, t) => a + (b - a) * t;
  const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);
  const seg = (p, a, b) => clamp((p - a) / (b - a), 0, 1);

  /* =====================================================
     DOM ELEMENTLAR
  ===================================================== */
  const $ = (id) => document.getElementById(id);
  const show = (el) => el.classList.remove('hidden');
  const hide = (el) => el.classList.add('hidden');

  const canvas = $('gameCanvas');
  const fxCanvas = $('fxCanvas');
  const fx = fxCanvas.getContext('2d');
  const stage = $('stage');

  const hudScore = $('hudScore');
  const hudHp = $('hudHp');
  const hudLevel = $('hudLevel');
  const hudBest = $('hudBest');

  const menuScreen = $('menuScreen');
  const pauseScreen = $('pauseScreen');
  const overScreen = $('overScreen');
  const recordsScreen = $('recordsScreen');
  const introScreen = $('introScreen');
  const introFade = $('introFade');
  const introFlash = $('introFlash');
  const introCaption = $('introCaption');
  const introTitle = $('introTitle');
  const recTime = $('recTime');

  const nameInput = $('nameInput');
  const recordsBody = $('recordsBody');
  const emptyRecords = $('emptyRecords');
  const finalScore = $('finalScore');
  const finalKills = $('finalKills');
  const finalLevel = $('finalLevel');
  const rankMessage = $('rankMessage');

  /* =====================================================
     LOCALSTORAGE — REKORDLAR TIZIMI
  ===================================================== */
  function loadRecords() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const data = raw ? JSON.parse(raw) : [];
      return Array.isArray(data) ? data : [];
    } catch (e) {
      return [];
    }
  }

  function saveRecords(list) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    } catch (e) { /* localStorage mavjud emas yoki to'lgan */ }
  }

  function formatDate(d) {
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    return dd + '.' + mm + '.' + d.getFullYear();
  }

  function addRecord(name, scoreValue, levelValue, killsValue) {
    const entry = {
      name: name,
      score: scoreValue,
      level: levelValue,
      kills: killsValue,
      date: formatDate(new Date())
    };
    const list = loadRecords();
    list.push(entry);
    list.sort((a, b) => b.score - a.score);
    const index = list.indexOf(entry);
    saveRecords(list.slice(0, MAX_RECORDS));
    return index < MAX_RECORDS ? index : -1;
  }

  function getBest() {
    const list = loadRecords();
    return list.length ? list[0].score : 0;
  }

  function renderRecords() {
    const list = loadRecords();
    recordsBody.innerHTML = '';
    if (!list.length) {
      show(emptyRecords);
      return;
    }
    hide(emptyRecords);
    list.forEach((r, i) => {
      const tr = document.createElement('tr');
      const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : String(i + 1);
      [medal, r.name, r.score, r.level, r.date].forEach((val) => {
        const td = document.createElement('td');
        td.textContent = val;
        tr.appendChild(td);
      });
      recordsBody.appendChild(tr);
    });
  }

  function sanitizeName(v) {
    v = (v || '').trim().slice(0, 12);
    return v || 'Stickman';
  }

  /* =====================================================
     THREE.JS — SAHNA, KAMERA, YORUG'LIK
  ===================================================== */
  const PR = Math.min(window.devicePixelRatio || 1, 1.5);
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
  } catch (err) {
    document.body.innerHTML =
      '<p style="color:#fff;font:18px sans-serif;padding:30px;text-align:center">' +
      "Brauzeringiz WebGL ni qo'llab-quvvatlamayapti yoki u o'chirilgan. " +
      "Brauzer sozlamalarida apparat tezlashtirishni yoqing yoki boshqa brauzerda oching.</p>";
    return;
  }
  renderer.setPixelRatio(PR);
  renderer.setSize(W, H, false);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xff9a52, 25, 150);

  const camera = new THREE.PerspectiveCamera(40, W / H, 0.1, 700);

  // Yorug'liklar: pushti osmon + iliq "quyosh" + orqadan neon kontur nuri
  scene.add(new THREE.HemisphereLight(0xffb0d8, 0x40206e, 0.95));

  const keyLight = new THREE.DirectionalLight(0xffc27a, 1.15);
  keyLight.position.set(-8, 12, 9);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(1024, 1024);
  keyLight.shadow.camera.left = -14;
  keyLight.shadow.camera.right = 14;
  keyLight.shadow.camera.top = 10;
  keyLight.shadow.camera.bottom = -6;
  keyLight.shadow.camera.near = 1;
  keyLight.shadow.camera.far = 45;
  keyLight.shadow.bias = -0.0006;
  scene.add(keyLight);
  scene.add(keyLight.target);

  const rimLight = new THREE.DirectionalLight(0xff4fa0, 1.3);
  rimLight.position.set(5, 6, -14);
  scene.add(rimLight);

  // Neon porlashi (bloom) — yuklanmasa oddiy render ishlatiladi
  let composer = null;
  let bloomPass = null;
  try {
    if (THREE.EffectComposer && THREE.RenderPass && THREE.UnrealBloomPass && window.innerWidth > 640) {
      const pw = Math.floor(W * PR);
      const ph = Math.floor(H * PR);
      let target;
      if (renderer.capabilities.isWebGL2 && THREE.WebGLMultisampleRenderTarget) {
        target = new THREE.WebGLMultisampleRenderTarget(pw, ph);
      } else {
        target = new THREE.WebGLRenderTarget(pw, ph);
      }
      composer = new THREE.EffectComposer(renderer, target);
      composer.addPass(new THREE.RenderPass(scene, camera));
      bloomPass = new THREE.UnrealBloomPass(new THREE.Vector2(W, H), 0.7, 0.55, 0.62);
      composer.addPass(bloomPass);
    }
  } catch (err) {
    composer = null;
    bloomPass = null;
  }

  /* =====================================================
     3D DUNYO (shahar, quyosh, dengiz, palmalar)
  ===================================================== */
  function makeGlowTexture() {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.25, 'rgba(255,255,255,0.55)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  }
  const glowTex = makeGlowTexture();

  function makeGlowSprite(color, size, opacity) {
    const m = new THREE.SpriteMaterial({
      map: glowTex, color: color, transparent: true, opacity: opacity,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false
    });
    const s = new THREE.Sprite(m);
    s.scale.set(size, size, 1);
    return s;
  }

  const world = { palms: [], lampGlows: [], stars: null, seaGlow: null, sunGlow: null, dust: null };

  // --- Osmon (gradient shader) ---
  (function buildSky() {
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        cTop: { value: new THREE.Color(0x140a3a) },
        cMid: { value: new THREE.Color(0x7a2a9e) },
        cLow: { value: new THREE.Color(0xff4f7b) },
        cGlow: { value: new THREE.Color(0xff9a52) }
      },
      vertexShader:
        'varying vec3 vP;' +
        'void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader:
        'uniform vec3 cTop; uniform vec3 cMid; uniform vec3 cLow; uniform vec3 cGlow; varying vec3 vP;' +
        'void main(){' +
        '  float h = clamp(vP.y, 0.0, 1.0);' +
        '  vec3 c = mix(cGlow, cLow, smoothstep(0.0, 0.05, h));' +
        '  c = mix(c, cMid, smoothstep(0.04, 0.18, h));' +
        '  c = mix(c, cTop, smoothstep(0.12, 0.4, h));' +
        '  gl_FragColor = vec4(c, 1.0);' +
        '}'
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(400, 32, 16), skyMat);
    sky.renderOrder = -10;
    sky.frustumCulled = false;
    scene.add(sky);

    // Yulduzlar
    const n = 220;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const a = Math.PI + Math.random() * Math.PI;
      const el = 0.12 + Math.random() * 0.7;
      const r = 380;
      pos[i * 3] = Math.cos(a) * Math.cos(el) * r;
      pos[i * 3 + 1] = Math.sin(el) * r;
      pos[i * 3 + 2] = Math.sin(a) * Math.cos(el) * r;
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    world.stars = new THREE.Points(sg, new THREE.PointsMaterial({
      color: 0xffffff, size: 2, sizeAttenuation: false, transparent: true,
      opacity: 0.7, fog: false, depthWrite: false
    }));
    world.stars.frustumCulled = false;
    scene.add(world.stars);
  })();

  // --- Quyosh (retro chiziqli) ---
  (function buildSun() {
    const sunMat = new THREE.ShaderMaterial({
      fog: false,
      vertexShader:
        'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader:
        'varying vec2 vUv;' +
        'void main(){' +
        '  float y = vUv.y;' +
        '  if (y < 0.5 && fract(y * 16.0) < (0.5 - y) * 1.5) discard;' +
        '  vec3 top = vec3(1.0, 0.86, 0.28);' +
        '  vec3 bot = vec3(1.0, 0.2, 0.5);' +
        '  gl_FragColor = vec4(mix(bot, top, smoothstep(0.05, 0.95, y)), 1.0);' +
        '}'
    });
    const sun = new THREE.Mesh(new THREE.CircleGeometry(12, 64), sunMat);
    sun.position.set(0, 11, -125);
    scene.add(sun);

    world.sunGlow = makeGlowSprite(0xff7a5c, 90, 0.7);
    world.sunGlow.position.set(0, 11, -126);
    scene.add(world.sunGlow);
  })();

  // --- Dengiz va quyosh aksi ---
  (function buildSea() {
    const sea = new THREE.Mesh(
      new THREE.PlaneGeometry(1400, 1400),
      new THREE.MeshStandardMaterial({ color: 0x2b1260, roughness: 0.25, metalness: 0.55, emissive: 0x14052e })
    );
    sea.rotation.x = -Math.PI / 2;
    sea.position.set(0, -0.6, -300);
    scene.add(sea);

    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 512;
    const g = c.getContext('2d');
    for (let y = 0; y < 512; y += 6) {
      const far = 1 - y / 512;
      const w = 20 + far * 210 * Math.random();
      const a = 0.25 + far * 0.6 * Math.random();
      g.fillStyle = 'rgba(255,' + (140 + Math.floor(80 * far)) + ',90,' + a.toFixed(2) + ')';
      g.fillRect(128 - w / 2, y, w, 3);
    }
    const mat = new THREE.MeshBasicMaterial({
      map: new THREE.CanvasTexture(c), transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false
    });
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(40, 120), mat);
    glow.rotation.x = -Math.PI / 2;
    glow.position.set(0, -0.55, -75);
    scene.add(glow);
    world.seaGlow = mat;
  })();

  // --- Yo'l (o'yin maydoni) ---
  (function buildRoad() {
    const road = new THREE.Mesh(
      new THREE.BoxGeometry(220, 2, 17),
      new THREE.MeshStandardMaterial({ color: 0x2a2038, roughness: 0.85, metalness: 0.1 })
    );
    road.position.set(0, -1, 4.5);
    road.receiveShadow = true;
    scene.add(road);

    const pinkLine = new THREE.Mesh(
      new THREE.BoxGeometry(220, 0.03, 0.14),
      new THREE.MeshBasicMaterial({ color: 0xff5fd0 })
    );
    pinkLine.position.set(0, 0.02, -3.85);
    scene.add(pinkLine);

    const dashMat = new THREE.MeshBasicMaterial({ color: 0xffd8a0 });
    const dashGeo = new THREE.BoxGeometry(1.6, 0.02, 0.14);
    for (let x = -30; x <= 30; x += 3.2) {
      const d = new THREE.Mesh(dashGeo, dashMat);
      d.position.set(x, 0.015, 5.2);
      scene.add(d);
    }
  })();

  // --- Shahar silueti (derazalar yonib turadi) ---
  (function buildSkyline() {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    g.fillStyle = '#170a2e';
    g.fillRect(0, 0, 128, 128);
    const colors = ['#ffd36e', '#ff7ab8', '#7ef0ff', '#ffb347'];
    for (let r = 0; r < 8; r++) {
      for (let k = 0; k < 8; k++) {
        g.fillStyle = Math.random() < 0.28 ? colors[Math.floor(Math.random() * colors.length)] : '#2b1450';
        g.fillRect(k * 16 + 3, r * 16 + 3, 10, 10);
      }
    }
    const baseTex = new THREE.CanvasTexture(c);

    const signColors = [0xff5fd0, 0x5ff6ff, 0xffb347];
    let x = -130;
    while (x < 130) {
      const w = 3 + Math.random() * 5;
      const h = 4 + Math.pow(Math.random(), 1.8) * 20;
      const d = 4 + Math.random() * 3;
      const z = -52 - Math.random() * 22;

      const tex = baseTex.clone();
      tex.needsUpdate = true;
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(Math.max(1, w / 6), Math.max(1, h / 6));

      const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial({ map: tex }));
      b.position.set(x + w / 2, -0.6 + h / 2, z);
      scene.add(b);

      if (Math.random() < 0.22) {
        const sign = new THREE.Mesh(
          new THREE.PlaneGeometry(0.7, Math.min(h * 0.5, 5)),
          new THREE.MeshBasicMaterial({ color: signColors[Math.floor(Math.random() * signColors.length)] })
        );
        sign.position.set(b.position.x + w * 0.2, b.position.y + h * 0.1, z + d / 2 + 0.06);
        scene.add(sign);
      }
      x += w + Math.random() * 1.2;
    }
  })();

  // --- Palmalar ---
  (function buildPalms() {
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x24102e, roughness: 1 });
    const frondMat = new THREE.MeshStandardMaterial({
      color: 0x0e3b43, emissive: 0x04161a, roughness: 0.8, side: THREE.DoubleSide
    });
    const frondGeo = new THREE.ConeGeometry(0.3, 3.4, 4);
    frondGeo.translate(0, 1.7, 0);
    frondGeo.scale(1, 1, 0.2);

    const list = [
      { x: -9.8, z: -3.2, h: 6.2, lean: -0.5 },
      { x: -4.4, z: -3.6, h: 5.2, lean: 0.4 },
      { x: 4.8, z: -3.4, h: 5.6, lean: -0.35 },
      { x: 10.2, z: -3.1, h: 6.6, lean: 0.5 },
      { x: -15.5, z: -3.4, h: 6.0, lean: 0.3 },
      { x: 16.0, z: -3.5, h: 5.8, lean: -0.4 }
    ];

    list.forEach((p, idx) => {
      const g = new THREE.Group();
      const pts = [];
      for (let i = 0; i <= 5; i++) {
        const t = i / 5;
        pts.push(new THREE.Vector3(p.lean * t * t * p.h * 0.35, t * p.h, 0));
      }
      const trunk = new THREE.Mesh(
        new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 14, 0.16, 6, false), trunkMat
      );
      trunk.castShadow = true;
      g.add(trunk);

      const crown = new THREE.Group();
      crown.position.copy(pts[pts.length - 1]);
      g.add(crown);
      const n = 9;
      for (let i = 0; i < n; i++) {
        const pivot = new THREE.Group();
        pivot.rotation.y = (i / n) * Math.PI * 2 + Math.random() * 0.3;
        const frond = new THREE.Mesh(frondGeo, frondMat);
        frond.rotation.z = -(0.9 + Math.random() * 0.5);
        pivot.add(frond);
        crown.add(pivot);
      }
      g.position.set(p.x, 0, p.z);
      g.userData = { ph: idx * 1.3 };
      scene.add(g);
      world.palms.push(g);
    });
  })();

  // --- Ko'cha chiroqlari ---
  (function buildLamps() {
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x1a1030, roughness: 0.6, metalness: 0.4 });
    const bulbMat = new THREE.MeshBasicMaterial({ color: 0xfff0c0 });
    [-12, -6.5, 6.5, 12].forEach((x) => {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 4.4, 8), poleMat);
      pole.position.set(x, 2.2, -3.3);
      pole.castShadow = true;
      scene.add(pole);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.06, 0.06), poleMat);
      arm.position.set(x + 0.28, 4.4, -3.3);
      scene.add(arm);
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 8), bulbMat);
      bulb.position.set(x + 0.55, 4.34, -3.3);
      scene.add(bulb);
      const glow = makeGlowSprite(0xffc27a, 2.6, 0.8);
      glow.position.copy(bulb.position);
      scene.add(glow);
      world.lampGlows.push(glow);
    });
  })();

  // --- Havodagi yorug' changlar ---
  (function buildDust() {
    const n = 70;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = rand(-14, 14);
      pos[i * 3 + 1] = rand(0, 8);
      pos[i * 3 + 2] = rand(-5, 10);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    world.dust = new THREE.Points(geo, new THREE.PointsMaterial({
      map: glowTex, color: 0xffb0d8, size: 0.35, transparent: true, opacity: 0.55,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false
    }));
    world.dust.frustumCulled = false;
    scene.add(world.dust);
  })();

  function animateWorld(dt) {
    world.palms.forEach((p) => {
      p.rotation.z = Math.sin(clock * 0.8 + p.userData.ph) * 0.025;
    });
    world.lampGlows.forEach((s, i) => {
      s.material.opacity = 0.7 + Math.sin(clock * 3 + i * 2) * 0.08;
    });
    if (world.stars) world.stars.material.opacity = 0.55 + Math.sin(clock * 1.7) * 0.15;
    if (world.seaGlow) world.seaGlow.opacity = 0.7 + Math.sin(clock * 2.3) * 0.15;
    if (world.sunGlow) world.sunGlow.material.opacity = 0.65 + Math.sin(clock * 0.9) * 0.08;
    if (world.dust) {
      const arr = world.dust.geometry.attributes.position.array;
      for (let i = 0; i < arr.length; i += 3) {
        arr[i + 1] += dt * (0.1 + (i % 5) * 0.03);
        arr[i] += Math.sin(clock + i) * dt * 0.1;
        if (arr[i + 1] > 8) arr[i + 1] = 0;
      }
      world.dust.geometry.attributes.position.needsUpdate = true;
    }
  }

  /* =====================================================
     3D STICKMAN MODELLARI
  ===================================================== */
  const geoCache = {};
  function cylGeo(r, len) {
    const k = r + '_' + len;
    if (!geoCache[k]) geoCache[k] = new THREE.CylinderGeometry(r, r, len, 8);
    return geoCache[k];
  }
  const sphereGeo = new THREE.SphereGeometry(1, 20, 14);
  const outlineMat = new THREE.MeshBasicMaterial({ color: 0x07030d, side: THREE.BackSide });

  function addOutline(mesh, sx, sy, sz) {
    const o = new THREE.Mesh(mesh.geometry, outlineMat);
    o.scale.set(sx, sy === undefined ? sx : sy, sz === undefined ? sx : sz);
    mesh.add(o);
  }

  function makeLimb(upLen, lowLen, r, mat, outline) {
    const pivot = new THREE.Group();
    const up = new THREE.Mesh(cylGeo(r, upLen), mat);
    up.position.y = -upLen / 2;
    up.castShadow = true;
    pivot.add(up);

    const joint = new THREE.Group();
    joint.position.y = -upLen;
    const low = new THREE.Mesh(cylGeo(r * 0.92, lowLen), mat);
    low.position.y = -lowLen / 2;
    low.castShadow = true;
    joint.add(low);
    pivot.add(joint);

    if (outline) {
      addOutline(up, 1.45, 1.0, 1.45);
      addOutline(low, 1.45, 1.0, 1.45);
    }

    [[pivot, 0, 1.2], [joint, 0, 1.25], [joint, -lowLen, 1.15]].forEach((b) => {
      const ball = new THREE.Mesh(sphereGeo, mat);
      ball.scale.setScalar(r * b[2]);
      ball.position.y = b[1];
      b[0].add(ball);
    });

    const hand = new THREE.Group();
    hand.position.y = -lowLen;
    joint.add(hand);
    pivot.userData = { joint: joint, hand: hand };
    return pivot;
  }

  // Qilich modeli (metall pichoq + tutqich)
  function makeSword() {
    const g = new THREE.Group();
    const bladeMat = new THREE.MeshStandardMaterial({ color: 0xe8f0ff, metalness: 0.9, roughness: 0.18, emissive: 0x2a4a7a });
    g.userData.blade = bladeMat;
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.86, 0.018), bladeMat);
    blade.position.y = -0.55;
    blade.castShadow = true;
    g.add(blade);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.1, 4), bladeMat);
    tip.rotation.z = Math.PI;
    tip.position.y = -1.03;
    tip.scale.set(1, 1, 0.26);
    g.add(tip);
    const guard = new THREE.Mesh(
      new THREE.BoxGeometry(0.11, 0.03, 0.13),
      new THREE.MeshStandardMaterial({ color: 0xffc247, metalness: 0.8, roughness: 0.3, emissive: 0x5a3a00 })
    );
    guard.position.y = -0.12;
    g.add(guard);
    const grip = new THREE.Mesh(cylGeo(0.028, 0.2), new THREE.MeshStandardMaterial({ color: 0xc0392b, roughness: 0.6 }));
    grip.position.y = -0.02;
    g.add(grip);
    return g;
  }

  function createStickman(o) {
    const bodyMat = new THREE.MeshStandardMaterial(
      o.hero
        ? { color: o.color, roughness: 0.35, metalness: 0.3, emissive: 0x1d0716 }
        : { color: o.color, roughness: 0.55, metalness: 0.1 }
    );
    const headMat = new THREE.MeshStandardMaterial({ color: o.headColor, roughness: 0.6 });
    const eyeMat = new THREE.MeshBasicMaterial({ color: o.eyeColor });
    const mats = [bodyMat, headMat, eyeMat];
    const outline = !o.hero;

    const group = new THREE.Group();
    const body = new THREE.Group();
    group.add(body);

    // Tana
    const torso = new THREE.Mesh(cylGeo(0.058, 0.56), bodyMat);
    torso.position.y = 0.86;
    torso.castShadow = true;
    body.add(torso);
    if (outline) addOutline(torso, 1.45, 1.0, 1.45);
    [0.58, 1.12].forEach((yy) => {
      const b = new THREE.Mesh(sphereGeo, bodyMat);
      b.scale.setScalar(0.075);
      b.position.y = yy;
      body.add(b);
    });

    // Oyoq va qo'llar (2 bo'g'inli)
    const legF = makeLimb(0.3, 0.28, 0.055, bodyMat, outline);
    legF.position.set(0, 0.58, 0.065);
    const legB = makeLimb(0.3, 0.28, 0.055, bodyMat, outline);
    legB.position.set(0, 0.58, -0.065);
    const armF = makeLimb(0.24, 0.22, 0.05, bodyMat, outline);
    armF.position.set(0, 1.1, 0.1);
    const armB = makeLimb(0.24, 0.22, 0.05, bodyMat, outline);
    armB.position.set(0, 1.1, -0.1);
    body.add(legF, legB, armF, armB);

    // Bosh
    const head = new THREE.Group();
    head.position.y = 1.36;
    body.add(head);
    const skull = new THREE.Mesh(sphereGeo, headMat);
    skull.scale.setScalar(0.2);
    skull.castShadow = true;
    head.add(skull);
    addOutline(skull, 1.13);

    [-1, 1].forEach((s) => {
      const eye = new THREE.Mesh(sphereGeo, eyeMat);
      eye.scale.setScalar(0.036);
      eye.position.set(0.172, 0.03, s * 0.075);
      head.add(eye);
    });

    const fig = {
      group: group, body: body, head: head,
      legF: legF, legB: legB, armF: armF, armB: armB,
      tails: null, sword: null, slash: null, slashH: null, bladeMat: null,
      spinning: false,
      mats: mats, bodyMat: bodyMat, headMat: headMat
    };

    if (o.hero) {
      // Qizil bosh bog'ich (uchlari shamolda tebranadi)
      const bandMat = new THREE.MeshStandardMaterial({ color: 0xe74c3c, emissive: 0x551010, roughness: 0.5 });
      mats.push(bandMat);
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.205, 0.024, 8, 24), bandMat);
      band.rotation.x = Math.PI / 2;
      band.position.y = 0.05;
      head.add(band);
      fig.tails = [];
      [0, 1].forEach((i) => {
        const pivot = new THREE.Group();
        pivot.position.set(-0.2, 0.05, 0);
        const tail = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.035, 0.012), bandMat);
        tail.position.x = -0.17;
        pivot.add(tail);
        head.add(pivot);
        fig.tails.push(pivot);
      });

      // Qilich
      fig.sword = makeSword();
      armF.userData.hand.add(fig.sword);
      fig.bladeMat = fig.sword.userData.blade;
      mats.push(fig.bladeMat);

      // Zarba izi: vertikal kesish yoyi (1- va 2-zarba)
      const slashMat = new THREE.MeshBasicMaterial({
        color: 0xffd9a8, transparent: true, opacity: 0.8, side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending, depthWrite: false, fog: false
      });
      mats.push(slashMat);
      fig.slash = new THREE.Mesh(new THREE.RingGeometry(0.85, 1.45, 2, 1, 0, 0.1), slashMat);
      fig.slash.position.set(0, 1.1, 0.12);
      fig.slash.visible = false;
      body.add(fig.slash);

      // Zarba izi: gorizontal aylanma halqa (3-zarba)
      const slashMat2 = new THREE.MeshBasicMaterial({
        color: 0xff5fa2, transparent: true, opacity: 0.7, side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending, depthWrite: false, fog: false
      });
      mats.push(slashMat2);
      fig.slashH = new THREE.Mesh(new THREE.RingGeometry(0.62, 1.45, 2, 1, 0, 0.1), slashMat2);
      fig.slashH.rotation.x = -Math.PI / 2;
      fig.slashH.position.y = 1.1;
      fig.slashH.visible = false;
      body.add(fig.slashH);
    } else if (o.kind === 'tank') {
      // Dubulg'a va shoxlar
      const helmMat = new THREE.MeshStandardMaterial({ color: 0x3b3b4f, metalness: 0.7, roughness: 0.35 });
      const hornMat = new THREE.MeshStandardMaterial({ color: 0xe8e0c8, roughness: 0.5 });
      mats.push(helmMat, hornMat);
      const helm = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), helmMat);
      helm.scale.setScalar(0.235);
      helm.position.y = 0.03;
      helm.castShadow = true;
      head.add(helm);
      [1, -1].forEach((s) => {
        const horn = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.22, 8), hornMat);
        horn.position.set(0, 0.22, s * 0.14);
        horn.rotation.x = s * 0.55;
        head.add(horn);
      });
    } else if (o.kind === 'fast') {
      // Sochi tikka (mohawk)
      const spikeMat = new THREE.MeshStandardMaterial({ color: 0xffd24a, emissive: 0x553300, roughness: 0.5 });
      mats.push(spikeMat);
      for (let i = 0; i < 3; i++) {
        const spike = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.2, 6), spikeMat);
        spike.position.set(-0.06 + i * 0.06, 0.2, 0);
        spike.rotation.z = 0.5;
        head.add(spike);
      }
    }

    return fig;
  }

  function disposeFig(fig) {
    if (!fig) return;
    scene.remove(fig.group);
    fig.mats.forEach((m) => m.dispose());
    if (fig.slash) fig.slash.geometry.dispose();
    if (fig.slashH) fig.slashH.geometry.dispose();
  }

  function createEnemyFig(key) {
    const t = ENEMY_TYPES[key];
    const fig = createStickman({ color: t.color, headColor: t.head, eyeColor: 0xffe14a, kind: key });
    fig.group.scale.setScalar(t.scale);
    return fig;
  }

  const YAW_R = -0.42;
  const YAW_L = -(Math.PI - 0.42);

  /* =====================================================
     QAHRAMON HUJUM ANIMATSIYALARI
     Burchak: 0 = pastga, musbat = oldinga, PI = tepaga
     p — zarba jarayoni (0..1): tayyorlanish -> zarba -> tiklanish
  ===================================================== */
  const _ap = {};
  function attackPose(step, p) {
    const o = _ap;
    o.arm = 0.7; o.elbow = 0.9; o.armB = -0.1; o.swordRel = 0.8;
    o.lean = 0; o.spin = 0; o.bodyY = 0; o.glow = 0;
    o.trail = false; o.trailA0 = 0; o.trailA1 = 0; o.trailAlpha = 0;
    o.trailH = 0; o.trailHAlpha = 0;
    let k = 0; // oyoqlar turishi (0..1)

    if (step === 0) {
      // ----- 1-zarba: tepadan pastga kesish -----
      const w = seg(p, 0, 0.22), sw = seg(p, 0.22, 0.66), r = seg(p, 0.66, 1);
      k = p < 0.66 ? w : 1 - r;
      if (p < 0.22) {
        const e = easeOut(w);
        o.arm = lerp(0.7, 3.1, e); o.elbow = lerp(0.9, 0.2, e); o.swordRel = lerp(0.8, 0, e);
        o.lean = lerp(0, 0.16, e); o.armB = lerp(-0.1, 0.6, e); o.glow = 0.4 * w;
      } else if (p < 0.66) {
        const e = easeOut(sw);
        o.arm = lerp(3.1, 0.25, e); o.elbow = 0; o.swordRel = 0;
        o.lean = lerp(0.16, -0.32, e); o.armB = lerp(0.6, -1.0, e);
        o.trail = true; o.trailA0 = 3.1; o.trailA1 = o.arm; o.trailAlpha = 1; o.glow = 1;
      } else {
        const e = easeInOut(r);
        o.arm = lerp(0.25, 0.7, e); o.elbow = lerp(0, 0.9, e); o.swordRel = lerp(0, 0.8, e);
        o.lean = lerp(-0.32, 0, e); o.armB = lerp(-1.0, -0.1, e);
        o.trail = true; o.trailA0 = 3.1; o.trailA1 = 0.25;
        o.trailAlpha = Math.max(0, 1 - r * 3); o.glow = 1 - r;
      }
    } else if (step === 1) {
      // ----- 2-zarba: pastdan yuqoriga ko'tarib kesish -----
      const w = seg(p, 0, 0.2), sw = seg(p, 0.2, 0.62), r = seg(p, 0.62, 1);
      k = p < 0.62 ? w : 1 - r;
      if (p < 0.2) {
        const e = easeOut(w);
        o.arm = lerp(0.7, -0.8, e); o.elbow = lerp(0.9, 0.1, e); o.swordRel = lerp(0.8, 0, e);
        o.lean = lerp(0, -0.18, e); o.bodyY = -0.09 * e; o.armB = lerp(-0.1, 0.9, e); o.glow = 0.4 * w;
      } else if (p < 0.62) {
        const e = easeOut(sw);
        o.arm = lerp(-0.8, 2.75, e); o.elbow = 0; o.swordRel = 0;
        o.lean = lerp(-0.18, 0.12, e); o.bodyY = lerp(-0.09, 0.05, e); o.armB = lerp(0.9, -0.9, e);
        o.trail = true; o.trailA0 = -0.8; o.trailA1 = o.arm; o.trailAlpha = 1; o.glow = 1;
      } else {
        const e = easeInOut(r);
        o.arm = lerp(2.75, 0.7, e); o.elbow = lerp(0, 0.9, e); o.swordRel = lerp(0, 0.8, e);
        o.lean = lerp(0.12, 0, e); o.bodyY = lerp(0.05, 0, e); o.armB = lerp(-0.9, -0.1, e);
        o.trail = true; o.trailA0 = -0.8; o.trailA1 = 2.75;
        o.trailAlpha = Math.max(0, 1 - r * 3); o.glow = 1 - r;
      }
    } else {
      // ----- 3-zarba: aylanma kuchli zarba (360°) -----
      const w = seg(p, 0, 0.25), sw = seg(p, 0.25, 0.78), r = seg(p, 0.78, 1);
      k = p < 0.25 ? w : (p < 0.78 ? 1 : 1 - r);
      if (p < 0.25) {
        const e = easeOut(w);
        o.arm = lerp(0.7, 1.6, e); o.elbow = lerp(0.9, 0, e); o.swordRel = lerp(0.8, 0, e);
        o.spin = -0.8 * e; o.bodyY = -0.1 * e; o.armB = lerp(-0.1, 1.3, e);
        o.lean = lerp(0, -0.1, e); o.glow = 0.5 * w;
      } else if (p < 0.78) {
        const e = easeInOut(sw);
        o.arm = 1.6; o.elbow = 0; o.swordRel = 0;
        o.spin = lerp(-0.8, TAU, e);
        o.bodyY = -0.1 + 0.22 * Math.sin(sw * Math.PI);
        o.armB = 1.3; o.lean = -0.08; o.glow = 1;
        o.trailH = clamp(o.spin + 0.8, 0, 3.6);
        o.trailHAlpha = 1 - seg(sw, 0.85, 1);
      } else {
        const e = easeInOut(r);
        o.arm = lerp(1.6, 0.7, e); o.elbow = lerp(0, 0.9, e); o.swordRel = lerp(0, 0.8, e);
        o.spin = TAU; o.bodyY = lerp(-0.1, 0, e); o.armB = lerp(1.3, -0.1, e);
        o.lean = lerp(-0.08, 0, e); o.glow = 1 - r;
      }
    }

    o.legF = 0.55 * k;
    o.kneeF = -0.55 * k;
    o.legB = -0.45 * k;
    o.kneeB = -0.2 * k;
    return o;
  }

  // Pozani qo'llash. Burchak: 0 = pastga, musbat = oldinga
  function applyFigure(fig, s, dt) {
    fig.group.position.set(s.x, s.y, s.z);

    const air = !!s.air;
    const step = s.atkStep || 0;
    let legF, legB, kneeF = 0, kneeB = 0, armB;
    let elbowB = 0.2;

    if (air) {
      legF = 0.8; legB = -0.5; kneeF = -0.7; kneeB = -0.9; armB = -1.2;
    } else {
      const sw = s.moving ? Math.sin(s.phase) * 0.75 : 0;
      legF = sw;
      legB = -sw;
      if (s.moving) {
        kneeF = -Math.max(0, Math.cos(s.phase)) * 0.9;
        kneeB = -Math.max(0, -Math.cos(s.phase)) * 0.9;
      }
      armB = -sw * 0.9 - 0.1;
    }

    let armA, elbowA, swordRel = 0;
    let ap = null;
    if (fig.sword) {
      if (s.attack !== null && s.attack !== undefined) {
        ap = attackPose(step, s.attack);
        armA = ap.arm;
        elbowA = ap.elbow;
        armB = ap.armB;
        elbowB = 0.3;
        swordRel = ap.swordRel;
        if (!air) {
          legF = ap.legF; legB = ap.legB; kneeF = ap.kneeF; kneeB = ap.kneeB;
        }
      } else {
        armA = air ? 1.4 : 0.7;
        elbowA = 0.9;
        swordRel = 0.8;
      }
    } else {
      armA = air ? 2.4 : 1.45;
      elbowA = 0.1;
      armB = air ? 2.0 : 1.25 + Math.sin(s.phase) * 0.15;
      elbowB = 0.1;
    }

    fig.legF.rotation.z = legF;
    fig.legF.userData.joint.rotation.z = kneeF;
    fig.legB.rotation.z = legB;
    fig.legB.userData.joint.rotation.z = kneeB;
    fig.armF.rotation.z = armA;
    fig.armF.userData.joint.rotation.z = elbowA;
    fig.armB.rotation.z = armB;
    fig.armB.userData.joint.rotation.z = elbowB;
    if (fig.sword) fig.sword.rotation.z = swordRel;

    // Vertikal zarba izi
    if (fig.slash) {
      if (ap && ap.trail && ap.trailAlpha > 0.02 && Math.abs(ap.trailA0 - ap.trailA1) > 0.05) {
        const lo = Math.min(ap.trailA0, ap.trailA1);
        const len = Math.abs(ap.trailA0 - ap.trailA1);
        fig.slash.geometry.dispose();
        fig.slash.geometry = new THREE.RingGeometry(0.85, 1.45, 28, 1, lo - Math.PI / 2, len);
        fig.slash.material.opacity = 0.8 * ap.trailAlpha;
        fig.slash.material.color.setHex(ATTACKS[step].color);
        fig.slash.visible = true;
      } else {
        fig.slash.visible = false;
      }
    }

    // Gorizontal (aylanma) zarba izi
    if (fig.slashH) {
      if (ap && ap.trailH > 0.05 && ap.trailHAlpha > 0.02) {
        fig.slashH.geometry.dispose();
        fig.slashH.geometry = new THREE.RingGeometry(0.62, 1.45, 36, 1, -ap.trailH, ap.trailH);
        fig.slashH.material.opacity = 0.75 * ap.trailHAlpha;
        fig.slashH.visible = true;
      } else {
        fig.slashH.visible = false;
      }
    }

    // Qilich zarba paytida yonadi
    if (fig.bladeMat) {
      const gl = ap ? ap.glow : 0;
      if (gl > 0.02) {
        fig.bladeMat.emissive.setHex(ATTACKS[step].color);
        fig.bladeMat.emissiveIntensity = 0.5 + gl * 2.2;
      } else {
        fig.bladeMat.emissive.setHex(0x2a4a7a);
        fig.bladeMat.emissiveIntensity = 1;
      }
    }

    // Burilish (aylanma zarbada tana to'liq aylanadi)
    const yawT = s.yaw !== undefined ? s.yaw : (s.facing > 0 ? YAW_R : YAW_L);
    if (ap && step === 2) {
      fig.body.rotation.y = yawT + ap.spin;
      fig.spinning = true;
    } else if (fig.spinning) {
      fig.body.rotation.y = yawT;
      fig.spinning = false;
    } else {
      fig.body.rotation.y += (yawT - fig.body.rotation.y) * Math.min(1, 14 * dt);
    }

    // Engashish
    let leanT = s.lean !== undefined ? s.lean : (s.moving ? -0.1 : (air ? -0.05 : 0));
    if (s.dead) leanT = Math.PI / 2;
    if (ap) {
      fig.body.rotation.z += (ap.lean - fig.body.rotation.z) * Math.min(1, 30 * dt);
    } else {
      fig.body.rotation.z += (leanT - fig.body.rotation.z) * Math.min(1, (s.dead ? 6 : 10) * dt);
    }

    if (s.dead) fig.body.position.y = 0.07;
    else if (ap) fig.body.position.y = ap.bodyY;
    else if (s.moving && !air) fig.body.position.y = Math.abs(Math.sin(s.phase)) * 0.04;
    else fig.body.position.y = Math.sin(clock * 2.2) * 0.012;

    // Bosh bog'ich uchlari
    if (fig.tails) {
      const base = s.moving || ap ? -0.05 : 0.35;
      fig.tails.forEach((tp, i) => {
        tp.rotation.z = base + Math.sin(clock * 9 + i * 1.7) * 0.18;
        tp.rotation.y = (i ? 1 : -1) * 0.3;
      });
    }
  }

  /* =====================================================
     3D EFFEKTLAR (zarrachalar, to'lqin, uchib ketish)
  ===================================================== */
  const MAX_P = 700;
  const pPos = new Float32Array(MAX_P * 3);
  const pCol = new Float32Array(MAX_P * 3);
  const pGeo = new THREE.BufferGeometry();
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
  pGeo.setAttribute('color', new THREE.BufferAttribute(pCol, 3));
  pGeo.setDrawRange(0, 0);
  const pPoints = new THREE.Points(pGeo, new THREE.PointsMaterial({
    size: 0.3, map: glowTex, vertexColors: true, transparent: true,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false
  }));
  pPoints.frustumCulled = false;
  scene.add(pPoints);

  let particles = [];
  const tmpColor = new THREE.Color();

  function burst(x, y, z, hex, n, power) {
    tmpColor.setHex(hex);
    for (let i = 0; i < n && particles.length < MAX_P; i++) {
      const a = Math.random() * Math.PI * 2;
      const b = Math.random() * Math.PI;
      const sp = power * (0.3 + Math.random() * 0.7);
      const life = 0.35 + Math.random() * 0.55;
      particles.push({
        x: x, y: y, z: z,
        vx: Math.cos(a) * Math.cos(b) * sp,
        vy: Math.sin(b) * sp + power * 0.2,
        vz: Math.sin(a) * Math.cos(b) * sp * 0.6,
        life: life, max: life,
        r: tmpColor.r, g: tmpColor.g, b: tmpColor.b
      });
    }
  }

  const ringGeo = new THREE.RingGeometry(0.85, 1, 48);
  let waves = [];
  function shockwave(x, z, hex, size, dur) {
    const mat = new THREE.MeshBasicMaterial({
      color: hex, transparent: true, opacity: 0.9, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false
    });
    const mesh = new THREE.Mesh(ringGeo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, 0.04, z);
    mesh.scale.set(0.3, 0.3, 0.3);
    scene.add(mesh);
    waves.push({ mesh: mesh, t: 0, dur: dur || 0.55, size: size });
  }

  // Mag'lub dushman uchib ketadi va aylanadi
  let ragdolls = [];
  function launchRagdoll(fig, x, y, z, dir, scale) {
    if (!fig) return;
    applyFigure(fig, { x: x, y: y, z: z, facing: dir, air: true, moving: false, phase: 0, attack: null }, 1);
    ragdolls.push({
      fig: fig, x: x, y: y, z: z,
      vx: dir * rand(5.5, 8), vy: rand(6, 8.5), vz: rand(-1.5, 2.5),
      spin: dir * rand(8, 13), t: 0, scale: scale
    });
  }

  function updateFx(dt) {
    // Zarrachalar
    let w = 0;
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      p.life -= dt;
      if (p.life <= 0) continue;
      p.vy -= 14 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      if (p.y < 0.03) {
        p.y = 0.03;
        p.vy *= -0.35;
        p.vx *= 0.8;
        p.vz *= 0.8;
      }
      particles[w++] = p;
    }
    particles.length = w;
    for (let i = 0; i < w; i++) {
      const p = particles[i];
      const k = p.life / p.max;
      pPos[i * 3] = p.x;
      pPos[i * 3 + 1] = p.y;
      pPos[i * 3 + 2] = p.z;
      pCol[i * 3] = p.r * k;
      pCol[i * 3 + 1] = p.g * k;
      pCol[i * 3 + 2] = p.b * k;
    }
    pGeo.setDrawRange(0, w);
    pGeo.attributes.position.needsUpdate = true;
    pGeo.attributes.color.needsUpdate = true;

    // To'lqinlar
    waves = waves.filter((wv) => {
      wv.t += dt;
      const k = wv.t / wv.dur;
      if (k >= 1) {
        scene.remove(wv.mesh);
        wv.mesh.material.dispose();
        return false;
      }
      const s = 0.3 + wv.size * easeOut(k);
      wv.mesh.scale.set(s, s, s);
      wv.mesh.material.opacity = (1 - k) * 0.9;
      return true;
    });

    // Uchib ketayotgan dushmanlar
    ragdolls = ragdolls.filter((r) => {
      r.t += dt;
      r.vy -= 24 * dt;
      r.x += r.vx * dt;
      r.y += r.vy * dt;
      r.z += r.vz * dt;
      if (r.y < 0) {
        r.y = 0;
        r.vy = Math.abs(r.vy) * 0.3;
        r.vx *= 0.6;
        r.vz *= 0.6;
        r.spin *= 0.6;
      }
      r.fig.group.position.set(r.x, r.y, r.z);
      r.fig.group.rotation.z -= r.spin * dt;
      const sc = r.t > 0.9 ? Math.max(0.001, 1 - (r.t - 0.9) / 0.3) : 1;
      r.fig.group.scale.setScalar(r.scale * sc);
      if (r.t > 1.2) {
        disposeFig(r.fig);
        return false;
      }
      return true;
    });

    // Uchuvchi yozuvlar
    for (const f of floaters) {
      f.y -= 40 * dt;
      f.life -= dt;
    }
    floaters = floaters.filter((f) => f.life > 0);

    // Silkinish va bloom
    if (shake > 0) shake = Math.max(0, shake - 30 * dt);
    bloomBoost *= Math.exp(-5 * dt);
    if (bloomPass) bloomPass.strength = 0.7 + bloomBoost;
  }

  /* =====================================================
     O'YIN HOLATI
  ===================================================== */
  let state = 'intro'; // intro | menu | playing | paused | over
  let score, level, kills, combo, comboTimer, best;
  let shake = 0, spawnTimer, hitStop = 0, bloomBoost = 0;
  let enemies = [];
  let floaters = [];
  let pickups = [];
  const banner = { text: '', t: 0 };
  let clock = 0;
  let playerName = 'Stickman';

  const player = {};
  const input = { left: false, right: false, jump: false, attackBuf: 0, attackHeld: false, aimMouse: false };
  const mouse = { x: W / 2, y: H / 2, inside: false };

  let heroFig = null;
  const heroPose = {
    x: 0, y: 0, z: 0, facing: 1, moving: false, phase: 0, air: false, dead: false,
    attack: null, atkStep: 0, yaw: undefined
  };

  function resetGame() {
    for (const e of enemies) if (e.fig) disposeFig(e.fig);
    for (const pk of pickups) scene.remove(pk.mesh);
    score = 0;
    level = 1;
    kills = 0;
    combo = 0;
    comboTimer = 0;
    shake = 0;
    spawnTimer = 1;
    hitStop = 0;
    banner.t = 0;
    enemies = [];
    floaters = [];
    pickups = [];
    Object.assign(player, {
      x: W / 2, y: GROUND, vx: 0, vy: 0, facing: 1,
      hp: PLAYER_MAX_HP, onGround: true,
      attackTime: 0, attackCd: 0, atkStep: 0, chainT: 0, hitSet: new Set(),
      invincible: 0, phase: 0, moving: false, dustT: 0
    });
    best = getBest();
    updateHud();
  }

  function updateHud() {
    hudScore.textContent = score;
    hudLevel.textContent = level;
    hudBest.textContent = Math.max(best, score);
    const hp = Math.max(0, player.hp);
    hudHp.textContent = '♥'.repeat(hp) + '♡'.repeat(PLAYER_MAX_HP - hp);
  }

  function addFloater(x, y, text, color) {
    floaters.push({ x: x, y: y, text: text, color: color, life: 1 });
  }

  function hurtFlash() {
    stage.classList.remove('hurt');
    void stage.offsetWidth;
    stage.classList.add('hurt');
  }

  /* ===== Yurak (3D model) ===== */
  let heartGeo = null;
  const heartMat = new THREE.MeshStandardMaterial({ color: 0xff2d5a, emissive: 0x80102c, roughness: 0.3, metalness: 0.2 });
  const heartGlowMat = new THREE.SpriteMaterial({
    map: glowTex, color: 0xff4d7a, transparent: true, opacity: 0.8,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false
  });

  function createHeart() {
    if (!heartGeo) {
      const s = new THREE.Shape();
      s.moveTo(0, -0.5);
      s.bezierCurveTo(-0.1, -0.35, -0.6, -0.1, -0.6, 0.25);
      s.bezierCurveTo(-0.6, 0.6, -0.15, 0.7, 0, 0.4);
      s.bezierCurveTo(0.15, 0.7, 0.6, 0.6, 0.6, 0.25);
      s.bezierCurveTo(0.6, -0.1, 0.1, -0.35, 0, -0.5);
      heartGeo = new THREE.ExtrudeGeometry(s, {
        depth: 0.25, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.06,
        bevelSegments: 3, curveSegments: 16
      });
      heartGeo.center();
    }
    const g = new THREE.Group();
    const m = new THREE.Mesh(heartGeo, heartMat);
    m.scale.setScalar(0.55);
    m.castShadow = true;
    g.add(m);
    const glow = new THREE.Sprite(heartGlowMat);
    glow.scale.set(1.6, 1.6, 1);
    g.add(glow);
    scene.add(g);
    return g;
  }

  /* =====================================================
     DUSHMANLAR
  ===================================================== */
  function spawnEnemy() {
    const side = Math.random() < 0.5 ? -1 : 1;
    const r = Math.random();
    let key = 'normal';
    if (level >= 3 && r < 0.2) key = 'tank';
    else if (level >= 2 && r < 0.5) key = 'fast';

    const t = ENEMY_TYPES[key];
    const facing = side < 0 ? 1 : -1;
    const fig = createEnemyFig(key);
    fig.body.rotation.y = facing > 0 ? YAW_R : YAW_L;
    scene.add(fig.group);

    enemies.push({
      type: key,
      x: side < 0 ? -30 : W + 30,
      y: GROUND,
      z: rand(-0.5, 0.5),
      hp: t.hp,
      maxHp: t.hp,
      speed: t.speed * (1 + Math.min(level, 10) * 0.06),
      scale: t.scale,
      points: t.points,
      color: t.color,
      facing: facing,
      phase: rand(0, 6),
      kx: 0,
      flash: 0,
      dead: false,
      fig: fig
    });
  }

  function hitEnemy(e, a) {
    player.hitSet.add(e);
    const dirK = e.x >= player.x ? 1 : -1;
    e.hp -= a.dmg;
    e.flash = 0.14;
    e.kx = dirK * a.knock;
    const ex = wx(e.x);
    burst(ex, 1.0 * e.scale, e.z, 0xffe9a0, 10, 5);
    burst(ex, 1.0 * e.scale, e.z, a.color, 8, 6);
    shake = Math.max(shake, a.heavy ? 8 : 4);
    hitStop = Math.max(hitStop, a.heavy ? 0.07 : 0.03);
    if (e.hp <= 0) killEnemy(e, dirK);
  }

  function killEnemy(e, dir) {
    e.dead = true;
    kills += 1;
    combo += 1;
    comboTimer = 3;

    const mult = Math.min(5, 1 + Math.floor(combo / 5));
    const pts = e.points * mult;
    score += pts;

    addFloater(e.x, e.y - 90 * e.scale, '+' + pts, '#ffd24a');

    const ex = wx(e.x);
    burst(ex, 0.9 * e.scale, e.z, 0xffe9a0, 14, 7);
    burst(ex, 0.9 * e.scale, e.z, e.color, 22, 8);
    shockwave(ex, e.z, e.color, 3.4 * e.scale, 0.5);
    if (e.fig) {
      launchRagdoll(e.fig, ex, 0, e.z, dir, e.scale);
      e.fig = null;
    }
    shake = Math.max(shake, 7);
    hitStop = Math.max(hitStop, 0.05);
    fovKick = -2.2;
    bloomBoost = Math.min(1, bloomBoost + 0.5);

    if (Math.random() < 0.12) {
      pickups.push({ x: e.x, life: 9, mesh: createHeart() });
    }

    const newLevel = 1 + Math.floor(kills / KILLS_PER_LEVEL);
    if (newLevel > level) {
      level = newLevel;
      banner.text = 'DARAJA ' + level + '!';
      banner.t = 2;
    }
    if (score > best) best = score;
    updateHud();
  }

  function damagePlayer(e) {
    player.hp -= 1;
    player.invincible = 1.2;
    player.attackTime = 0;   // zarba olganda hujum bekor bo'ladi
    player.chainT = 0;
    combo = 0;
    comboTimer = 0;
    shake = 12;
    roll = rand(-0.07, 0.07);
    fovKick = 2.5;
    player.vx = (player.x >= e.x ? 1 : -1) * 450;
    player.vy = -420;
    player.onGround = false;
    e.kx = (e.x > player.x ? 1 : -1) * 300;
    burst(wx(player.x), 1.0, 0, 0xff3b5c, 22, 6);
    hurtFlash();
    updateHud();
    if (player.hp <= 0) gameOver();
  }

  /* =====================================================
     HUJUM BOSHLASH (kombo tizimi + sichqoncha nishoni)
  ===================================================== */
  // Kursor qahramonning chap yoki o'ng tomonida ekanini aniqlaydi
  function faceMouse() {
    if (!mouse.inside) return;
    const hx = project(wx(player.x), 1.1, 0).x;
    if (mouse.x < hx - 8) player.facing = -1;
    else if (mouse.x > hx + 8) player.facing = 1;
  }

  function queueAttack(byMouse) {
    if (state !== 'playing') return;
    input.attackBuf = 0.2;          // qisqa vaqt "eslab qolinadi"
    input.aimMouse = !!byMouse;
  }

  function startAttack(dir) {
    const step = player.chainT > 0 ? (player.atkStep + 1) % 3 : 0;
    const a = ATTACKS[step];

    if (input.aimMouse || input.attackHeld) faceMouse();
    else if (dir !== 0) player.facing = dir;

    player.atkStep = step;
    player.attackTime = a.dur;
    player.attackCd = a.cd;
    player.chainT = a.dur + CHAIN_WINDOW;
    player.hitSet = new Set();
    input.attackBuf = 0;

    // Zarba bilan oldinga siltanish
    player.vx = player.facing * a.lunge;

    const px = wx(player.x);
    burst(px, 0.05, 0, 0xffb98a, a.heavy ? 14 : 6, a.heavy ? 3.4 : 2.2);
    if (a.heavy) {
      shockwave(px, 0, a.color, 4.4, 0.55);
      fovKick = -3;
      bloomBoost = Math.min(1, bloomBoost + 0.4);
    } else {
      fovKick = -1.2;
    }
  }

  /* =====================================================
     YANGILASH (UPDATE)
  ===================================================== */
  function update(dt) {
    if (hitStop > 0) {
      hitStop -= dt;
      return;
    }

    // ----- Taymerlar -----
    if (input.attackBuf > 0) input.attackBuf -= dt;
    player.attackCd -= dt;
    player.invincible -= dt;
    player.chainT -= dt;
    if (player.attackTime > 0) player.attackTime -= dt;

    // ----- Yo'nalish -----
    const dir = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    player.moving = dir !== 0;
    if (dir !== 0 && player.attackTime <= 0) player.facing = dir;

    // ----- Hujumni boshlash -----
    if ((input.attackBuf > 0 || input.attackHeld) && player.attackCd <= 0) {
      startAttack(dir);
    }

    // ----- Harakat -----
    const target = dir * MOVE_SPEED;
    player.vx += (target - player.vx) * Math.min(1, 12 * dt);

    const wasGround = player.onGround;
    if (input.jump && player.onGround) {
      player.vy = -JUMP_V;
      player.onGround = false;
      burst(wx(player.x), 0.05, 0, 0xffb98a, 8, 2.6);
    }

    player.vy += GRAVITY * dt;
    const impact = player.vy;
    player.x += player.vx * dt;
    player.y += player.vy * dt;

    if (player.y >= GROUND) {
      player.y = GROUND;
      player.vy = 0;
      player.onGround = true;
      if (!wasGround && impact > 350) {
        burst(wx(player.x), 0.05, 0, 0xffb98a, 10, 3.2);
        shockwave(wx(player.x), 0, 0xffa060, 1.8, 0.35);
        shake = Math.max(shake, 3);
      }
    } else {
      player.onGround = false;
    }
    player.x = clamp(player.x, 20, W - 20);

    if (player.moving && player.onGround) {
      player.phase += dt * 14;
      player.dustT -= dt;
      if (player.dustT <= 0) {
        burst(wx(player.x - player.facing * 10), 0.05, 0, 0xffb98a, 2, 1.6);
        player.dustT = 0.1;
      }
    }

    // ----- Zarba urilishini tekshirish -----
    if (player.attackTime > 0) {
      const a = ATTACKS[player.atkStep];
      const p = 1 - player.attackTime / a.dur;
      if (p >= a.from && p <= a.to) {
        let x1, x2;
        if (a.both) {
          x1 = player.x - a.range;
          x2 = player.x + a.range;
        } else if (player.facing > 0) {
          x1 = player.x - 10;
          x2 = player.x + a.range;
        } else {
          x1 = player.x - a.range;
          x2 = player.x + 10;
        }
        for (const e of enemies) {
          if (e.dead || player.hitSet.has(e)) continue;
          const half = 14 * e.scale;
          const overlapX = e.x + half > x1 && e.x - half < x2;
          const overlapY = player.y > e.y - 76 * e.scale && player.y - 90 < e.y;
          if (overlapX && overlapY) hitEnemy(e, a);
        }
      }
    }

    // ----- Dushmanlarni yaratish -----
    spawnTimer -= dt;
    if (spawnTimer <= 0 && enemies.length < 4 + level) {
      spawnEnemy();
      spawnTimer = Math.max(0.5, 1.8 - level * 0.12) * rand(0.7, 1.3);
    }

    // ----- Dushmanlar harakati -----
    for (const e of enemies) {
      e.flash -= dt;
      e.kx -= e.kx * Math.min(1, 8 * dt);
      const dx = player.x - e.x;
      e.facing = dx >= 0 ? 1 : -1;
      const move = Math.abs(dx) > 6 ? e.facing : 0;
      e.x += (move * e.speed + e.kx) * dt;
      e.phase += dt * e.speed / 10;

      if (!e.dead && player.invincible <= 0 &&
          Math.abs(player.x - e.x) < 22 * e.scale + 6 &&
          player.y > GROUND - 40) {
        damagePlayer(e);
        if (state !== 'playing') return;
      }
    }
    const keep = [];
    for (const e of enemies) {
      if (e.dead || e.x < -120 || e.x > W + 120) {
        if (e.fig) {
          disposeFig(e.fig);
          e.fig = null;
        }
      } else {
        keep.push(e);
      }
    }
    enemies = keep;

    // ----- Yurak (pickup) -----
    const livePickups = [];
    for (const pk of pickups) {
      pk.life -= dt;
      if (Math.abs(player.x - pk.x) < 28 && player.y > GROUND - 50 && player.hp < PLAYER_MAX_HP) {
        player.hp += 1;
        pk.life = 0;
        addFloater(pk.x, GROUND - 70, '+1 ♥', '#ff6b8f');
        burst(wx(pk.x), 0.8, 0, 0xff4d7a, 18, 5);
        shockwave(wx(pk.x), 0, 0xff4d7a, 2.4, 0.45);
        updateHud();
      }
      if (pk.life > 0) livePickups.push(pk);
      else scene.remove(pk.mesh);
    }
    pickups = livePickups;

    // ----- Kombo, banner -----
    if (comboTimer > 0) {
      comboTimer -= dt;
      if (comboTimer <= 0) combo = 0;
    }
    if (banner.t > 0) banner.t -= dt;
  }

  /* =====================================================
     3D SAHNANI YANGILASH (sinxronlash)
  ===================================================== */
  const enemyPose = { x: 0, y: 0, z: 0, facing: 1, moving: true, phase: 0, air: false, dead: false, attack: null, lean: -0.12 };
  const _tip = new THREE.Vector3();

  function syncScene(dt) {
    if (state === 'intro') {
      applyFigure(heroFig, introHero, dt);
      if (introEnemy) applyFigure(introEnemy, introEnemyPose, dt);
    } else {
      const s = heroPose;
      s.x = wx(player.x);
      s.y = wy(player.y);
      s.z = 0;
      s.facing = player.facing;
      s.moving = player.moving && player.onGround;
      s.phase = player.phase;
      s.air = !player.onGround;
      s.dead = state === 'over';
      s.yaw = undefined;
      s.atkStep = player.atkStep;
      s.attack = (!s.dead && player.attackTime > 0)
        ? 1 - player.attackTime / ATTACKS[player.atkStep].dur
        : null;
      if (state === 'menu') {
        // Menyuda qahramon navbat bilan 3 xil zarbani ko'rsatadi
        s.atkStep = Math.floor(clock / 4.2) % 3;
        const c = clock % 4.2;
        s.attack = c < 0.6 ? c / 0.6 : null;
        s.facing = 1;
      }
      applyFigure(heroFig, s, dt);
      heroFig.group.visible = !(state === 'playing' && player.invincible > 0 &&
        Math.floor(player.invincible * 14) % 2 === 0);

      // Qilich uchidan uchqunlar
      if (s.attack !== null && state !== 'paused' && hitStop <= 0) {
        heroFig.group.updateMatrixWorld(true);
        heroFig.sword.localToWorld(_tip.set(0, -1.0, 0));
        burst(_tip.x, _tip.y, _tip.z, ATTACKS[s.atkStep].color, 1, 1.4);
      }

      for (const e of enemies) {
        if (!e.fig) continue;
        e.fig.group.scale.setScalar(e.scale);
        enemyPose.x = wx(e.x);
        enemyPose.z = e.z;
        enemyPose.facing = e.facing;
        enemyPose.phase = e.phase;
        applyFigure(e.fig, enemyPose, dt);
        const hex = e.flash > 0 ? 0xffc83a : 0x000000;
        e.fig.bodyMat.emissive.setHex(hex);
        e.fig.headMat.emissive.setHex(hex);
      }

      for (const pk of pickups) {
        pk.mesh.position.set(wx(pk.x), 0.8 + Math.sin(clock * 5) * 0.1, 0);
        pk.mesh.rotation.y = clock * 2.5;
        pk.mesh.visible = !(pk.life < 2 && Math.floor(pk.life * 8) % 2 === 0);
      }
    }
  }

  /* =====================================================
     KAMERA
  ===================================================== */
  const camPos = new THREE.Vector3(0, 3, 15);
  const camLook = new THREE.Vector3(0, 2.4, 0);
  const tPos = new THREE.Vector3();
  const tLook = new THREE.Vector3();
  let camFov = 40;
  let fovKick = 0;
  let roll = 0;

  function updateCamera(dt) {
    if (state !== 'intro') {
      let fov = 40;
      const px = wx(player.x);
      if (state === 'menu') {
        tPos.set(-4 + Math.sin(clock * 0.25) * 0.9, 2.5 + Math.sin(clock * 0.4) * 0.15, 12.5 + Math.cos(clock * 0.25) * 0.8);
        tLook.set(-3.4, 2.0, 0);
      } else if (state === 'over') {
        tPos.set(px * 0.8, 1.6, 7.5);
        tLook.set(px, 1.0, 0);
        fov = 34;
      } else {
        tPos.set(px * 0.3, 3.2, 15);
        tLook.set(px * 0.42, 2.4, 0);
      }
      const k = 1 - Math.exp(-3.2 * dt);
      camPos.lerp(tPos, k);
      camLook.lerp(tLook, k);
      camFov += (fov - camFov) * k;
    }

    camera.position.copy(camPos);
    if (shake > 0) {
      camera.position.x += (Math.random() - 0.5) * shake * 0.03;
      camera.position.y += (Math.random() - 0.5) * shake * 0.03;
    }
    camera.lookAt(camLook);
    camera.rotateZ(roll);
    const f = camFov + fovKick;
    if (Math.abs(camera.fov - f) > 0.001) {
      camera.fov = f;
      camera.updateProjectionMatrix();
    }
    camera.updateMatrixWorld();
    fovKick *= Math.exp(-6 * dt);
    roll *= Math.exp(-6 * dt);
  }

  /* =====================================================
     USTKI QATLAM (2D): ball, kombo, jon chiziqlari
  ===================================================== */
  const _v = new THREE.Vector3();
  function project(x, y, z) {
    _v.set(x, y, z).project(camera);
    return { x: (_v.x * 0.5 + 0.5) * W, y: (-_v.y * 0.5 + 0.5) * H };
  }

  function drawFx() {
    fx.clearRect(0, 0, W, H);
    if (state === 'intro') return;

    fx.textAlign = 'center';
    fx.lineJoin = 'round';

    // Uchuvchi yozuvlar
    fx.font = 'bold 24px Impact, "Arial Black", sans-serif';
    for (const f of floaters) {
      const p = project(wx(f.x), wy(f.y), 0.6);
      fx.globalAlpha = clamp(f.life, 0, 1);
      fx.lineWidth = 5;
      fx.strokeStyle = '#14061f';
      fx.strokeText(f.text, p.x, p.y);
      fx.fillStyle = f.color;
      fx.fillText(f.text, p.x, p.y);
    }
    fx.globalAlpha = 1;

    // Kuchli dushmanlar jon chizig'i
    if (state === 'playing' || state === 'paused') {
      for (const e of enemies) {
        if (e.maxHp > 1 && !e.dead) {
          const p = project(wx(e.x), 1.75 * e.scale + 0.3, e.z);
          const bw = 40;
          fx.fillStyle = '#14061f';
          fx.fillRect(p.x - bw / 2 - 2, p.y - 2, bw + 4, 9);
          fx.fillStyle = '#ff3b5c';
          fx.fillRect(p.x - bw / 2, p.y, bw * (e.hp / e.maxHp), 5);
        }
      }
    }

    // Hujum kombosi ko'rsatkichi (3 ta romb)
    if (state === 'playing' && player.chainT > 0) {
      const alpha = clamp(player.chainT * 2, 0, 1);
      for (let i = 0; i < 3; i++) {
        const on = i <= player.atkStep;
        fx.save();
        fx.globalAlpha = alpha;
        fx.translate(W / 2 + (i - 1) * 28, H - 24);
        fx.rotate(Math.PI / 4);
        fx.fillStyle = on ? ATTACKS[i].css : 'rgba(255,255,255,0.18)';
        fx.strokeStyle = '#14061f';
        fx.lineWidth = 3;
        fx.strokeRect(-7, -7, 14, 14);
        fx.fillRect(-7, -7, 14, 14);
        fx.restore();
      }
    }

    // Kombo
    if (state === 'playing' && combo >= 2) {
      const mult = Math.min(5, 1 + Math.floor(combo / 5));
      fx.textAlign = 'right';
      fx.font = 'bold 30px Impact, "Arial Black", sans-serif';
      fx.lineWidth = 6;
      fx.strokeStyle = '#14061f';
      fx.strokeText('KOMBO x' + combo, W - 20, 50);
      fx.fillStyle = '#ff7ab8';
      fx.fillText('KOMBO x' + combo, W - 20, 50);
      fx.font = 'bold 16px Arial';
      fx.lineWidth = 4;
      fx.strokeText("Ball ko'paytirgich: x" + mult, W - 20, 74);
      fx.fillStyle = '#ffd24a';
      fx.fillText("Ball ko'paytirgich: x" + mult, W - 20, 74);
    }

    // Banner (daraja / boshlanish)
    if (banner.t > 0) {
      fx.globalAlpha = clamp(banner.t, 0, 1);
      fx.textAlign = 'center';
      fx.font = 'bold 64px Impact, "Arial Black", sans-serif';
      fx.lineWidth = 9;
      fx.strokeStyle = '#14061f';
      fx.strokeText(banner.text, W / 2, 170);
      const gr = fx.createLinearGradient(0, 120, 0, 175);
      gr.addColorStop(0, '#ffd24a');
      gr.addColorStop(1, '#ff2d95');
      fx.fillStyle = gr;
      fx.fillText(banner.text, W / 2, 170);
      fx.globalAlpha = 1;
    }
  }

  function render() {
    if (composer) {
      try {
        composer.render();
        return;
      } catch (err) {
        composer = null;
      }
    }
    renderer.render(scene, camera);
  }

  /* =====================================================
     INTRO — "GTA 6" uslubidagi kino kirish
     1) Quyosh botishida qahramon yurib keladi
     2) Kamera uning atrofida aylanadi (orqadan -> old tomonga)
     3) Sekinlashtirilgan zarba, flesh va portlash
     4) Kamera orqaga tortiladi va sarlavha chiqadi
  ===================================================== */
  const INTRO_CAPTIONS = [
    { t: 0.9, d: 2.5, text: "Bu shahar hech qachon uxlamaydi." },
    { t: 4.0, d: 2.9, text: "Har bir soya — yashirin dushman." }
  ];

  const introHero = { x: -5.6, y: 0, z: 0, facing: 1, moving: false, phase: 0, air: false, dead: false, attack: null, atkStep: 0, yaw: undefined };
  const introEnemyPose = { x: 1.1, y: 0, z: 0.05, facing: -1, moving: false, phase: 0, air: false, dead: false, attack: null };
  let introEnemy = null;
  let introT = 0;
  let introReal = 0;
  let introFlags = {};

  function flashScreen(a) {
    introFlash.style.transition = 'none';
    introFlash.style.opacity = String(a);
    void introFlash.offsetWidth;
    introFlash.style.transition = 'opacity 0.5s ease-out';
    introFlash.style.opacity = '0';
  }

  function startIntro() {
    hide(menuScreen);
    hide(pauseScreen);
    hide(overScreen);
    hide(recordsScreen);
    resetGame();
    state = 'intro';
    introT = 0;
    introReal = 0;
    introFlags = {};
    heroFig.group.visible = true;
    heroFig.body.rotation.z = 0;

    introHero.x = -5.6;
    introHero.attack = null;
    introHero.moving = false;
    introHero.phase = 0;

    if (introEnemy) disposeFig(introEnemy);
    introEnemy = createEnemyFig('normal');
    introEnemy.body.rotation.y = YAW_L;
    scene.add(introEnemy.group);

    camPos.set(-2.6, 0.5, 6.2);
    camLook.set(-5.3, 1.15, 0);
    camFov = 38;

    document.body.classList.add('is-intro');
    introTitle.classList.remove('show');
    introCaption.classList.remove('show');
    introFade.style.opacity = '1';
    show(introScreen);
    void introScreen.offsetWidth;
    introScreen.classList.add('on');
  }

  function finishIntro() {
    if (state !== 'intro') return;
    state = 'menu';
    document.body.classList.remove('is-intro');
    introScreen.classList.remove('on');
    setTimeout(() => {
      if (state !== 'intro') hide(introScreen);
    }, 900);
    if (introEnemy) {
      disposeFig(introEnemy);
      introEnemy = null;
    }
    resetGame();
    heroFig.group.visible = true;
    show(menuScreen);
  }

  function updateIntro(rawDt) {
    // Zarba paytida sekinlashtirish (slow-motion)
    const slow = introT > 7.65 && introT < 8.55 ? 0.35 : 1;
    const dt = rawDt * slow;
    introT += dt;
    introReal += rawDt;
    const t = introT;
    const hs = introHero;

    introFade.style.opacity = t < 1 ? String(1 - t) : '0';
    recTime.textContent = '00:' + String(Math.floor(introReal)).padStart(2, '0');

    // Subtitrlar
    let cap = null;
    for (const c of INTRO_CAPTIONS) if (t >= c.t && t < c.t + c.d) cap = c;
    if (cap) {
      if (introCaption.textContent !== cap.text) introCaption.textContent = cap.text;
      introCaption.classList.add('show');
    } else {
      introCaption.classList.remove('show');
    }

    if (t >= 3.6 && !introFlags.cut1) { introFlags.cut1 = true; flashScreen(0.5); }
    if (t >= 7.2 && !introFlags.cut2) { introFlags.cut2 = true; flashScreen(0.5); }
    if (t >= 9.9 && !introFlags.title) { introFlags.title = true; introTitle.classList.add('show'); }

    hs.attack = null;
    hs.atkStep = 0;
    hs.moving = false;

    if (t < 3.6) {
      // --- 1-kadr: qahramon yurib keladi, kamera past burchakdan kuzatadi ---
      const p = t / 3.6;
      hs.x = -5.6 + p * 4.0;
      hs.moving = true;
      hs.phase += dt * 3.4;
      camPos.set(hs.x + 3.0, lerp(0.5, 0.9, p), lerp(6.2, 5.0, p));
      camLook.set(hs.x + 0.3, 1.15, 0);
      camFov = 38;
    } else if (t < 7.2) {
      // --- 2-kadr: kamera orqadan old tomonga aylanadi ---
      const p = (t - 3.6) / 3.6;
      hs.x = -1.6;
      const a = lerp(-1.2, 1.0, easeInOut(p));
      const R = lerp(4.8, 3.6, p);
      const cx = -0.25;
      camPos.set(cx + Math.sin(a) * R, lerp(0.5, 1.7, p), Math.cos(a) * R);
      camLook.set(cx, 1.2, 0);
      camFov = 34;
    } else if (t < 9.2) {
      // --- 3-kadr: zarba ---
      const p = (t - 7.2) / 2.0;
      const ap = clamp((t - 7.7) / 0.6, 0, 1);
      if (ap > 0 && ap < 1) hs.attack = ap;
      hs.x = lerp(-1.6, -0.2, easeOut(clamp((t - 7.6) / 0.55, 0, 1)));

      if (ap >= 0.45 && !introFlags.hit) {
        introFlags.hit = true;
        const ex = introEnemyPose.x;
        flashScreen(0.9);
        burst(ex, 1.0, 0, 0xffe9a0, 30, 8);
        burst(ex, 1.0, 0, 0xff4d6d, 24, 7);
        shockwave(ex, 0, 0xff5fa2, 5, 0.6);
        launchRagdoll(introEnemy, ex, 0, 0.05, 1, 1);
        introEnemy = null;
        shake = 10;
        fovKick = -3;
        bloomBoost = 0.8;
      }
      camPos.set(lerp(-1.0, -0.1, p), lerp(1.5, 1.55, p), lerp(5.0, 4.0, p));
      camLook.set(hs.x + 0.9, 1.25, 0);
      camFov = lerp(32, 28, p);
    } else {
      // --- 4-kadr: kamera orqaga tortiladi, sarlavha ---
      const p = clamp((t - 9.2) / 4.0, 0, 1);
      const q = easeInOut(p);
      hs.x = lerp(-0.2, 0, q);
      hs.moving = p < 0.45;
      hs.phase += dt * 5;
      camPos.set(lerp(-0.1, 0, q), lerp(1.55, 2.8, q), lerp(4.0, 13, q));
      camLook.set(lerp(hs.x + 0.9, 0, q), lerp(1.25, 2.0, q), 0);
      camFov = lerp(28, 40, q);
    }

    // Qo'lda tutilgan kamera titrashi
    const amp = t < 9.2 ? 1 : Math.max(0, 1 - (t - 9.2) / 2);
    camPos.x += (Math.sin(t * 9.1) + Math.sin(t * 5.3)) * 0.012 * amp;
    camPos.y += (Math.sin(t * 7.7) + Math.sin(t * 3.9)) * 0.01 * amp;

    if (t >= INTRO_LEN) finishIntro();
    return dt;
  }

  /* =====================================================
     O'YIN BOSHQARUVI (start, pauza, tugash)
  ===================================================== */
  function startGame() {
    playerName = sanitizeName(nameInput.value);
    nameInput.value = playerName;
    try { localStorage.setItem(NAME_KEY, playerName); } catch (e) { /* e'tiborsiz */ }

    // Fokusni olib tashlash (aks holda klaviatura boshqaruvi ishlamaydi)
    nameInput.blur();
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();

    resetGame();
    heroFig.body.rotation.z = 0;
    input.attackBuf = 0;
    input.attackHeld = false;
    hide(menuScreen);
    hide(pauseScreen);
    hide(overScreen);
    hide(recordsScreen);
    state = 'playing';

    banner.text = 'BOSHLADIK!';
    banner.t = 1.4;
    burst(wx(player.x), 0.1, 0, 0xffb98a, 18, 4);
    shockwave(wx(player.x), 0, 0xff5fa2, 6, 0.7);
    fovKick = 4;
    bloomBoost = 0.6;
  }

  function gameOver() {
    state = 'over';
    input.attackHeld = false;
    shockwave(wx(player.x), 0, 0xff3b5c, 5, 0.8);
    burst(wx(player.x), 1.0, 0, 0xff3b5c, 30, 7);

    let rank = -1;
    if (score > 0) {
      rank = addRecord(playerName, score, level, kills);
    }
    best = getBest();
    updateHud();

    finalScore.textContent = score;
    finalKills.textContent = kills;
    finalLevel.textContent = level;

    if (rank === 0) {
      rankMessage.textContent = "🎉 YANGI REKORD! Siz 1-o'rindasiz!";
    } else if (rank > 0) {
      rankMessage.textContent = '🏆 Siz rekordlar jadvalida ' + (rank + 1) + "-o'rinni egalladingiz!";
    } else {
      rankMessage.textContent = '';
    }
    show(overScreen);
  }

  function togglePause() {
    if (state === 'playing') {
      state = 'paused';
      input.attackHeld = false;
      show(pauseScreen);
    } else if (state === 'paused') {
      state = 'playing';
      hide(pauseScreen);
    }
  }

  function goToMenu() {
    state = 'menu';
    resetGame();
    heroFig.body.rotation.z = 0;
    hide(pauseScreen);
    hide(overScreen);
    hide(recordsScreen);
    show(menuScreen);
  }

  let recordsReturn = menuScreen;
  function openRecords(from) {
    recordsReturn = from;
    hide(from);
    renderRecords();
    show(recordsScreen);
  }

  /* =====================================================
     TUGMALAR, KLAVIATURA VA SICHQONCHA
  ===================================================== */
  $('btnStart').addEventListener('click', startGame);
  $('btnRestart').addEventListener('click', startGame);
  $('btnResume').addEventListener('click', togglePause);
  $('btnQuitToMenu').addEventListener('click', goToMenu);
  $('btnOverMenu').addEventListener('click', goToMenu);
  $('btnIntro').addEventListener('click', startIntro);
  $('btnSkip').addEventListener('click', finishIntro);
  $('btnRecords').addEventListener('click', () => openRecords(menuScreen));
  $('btnOverRecords').addEventListener('click', () => openRecords(overScreen));
  $('btnBack').addEventListener('click', () => {
    hide(recordsScreen);
    show(recordsReturn);
  });
  $('btnClear').addEventListener('click', () => {
    if (confirm("Barcha rekordlar o'chirilsinmi?")) {
      try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* e'tiborsiz */ }
      best = 0;
      renderRecords();
      updateHud();
    }
  });

  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') startGame();
  });

  document.addEventListener('click', (e) => {
    if (e.target.tagName === 'BUTTON') e.target.blur();
  });

  // ----- Sichqoncha: chap tugma = qilich bilan urish -----
  function mouseToCanvas(e) {
    const r = canvas.getBoundingClientRect();
    mouse.x = (e.clientX - r.left) / r.width * W;
    mouse.y = (e.clientY - r.top) / r.height * H;
  }

  stage.addEventListener('mousemove', (e) => {
    mouseToCanvas(e);
    mouse.inside = true;
  });
  stage.addEventListener('mouseleave', () => {
    mouse.inside = false;
  });
  stage.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;                       // faqat chap tugma
    if (state !== 'playing') return;
    if (e.target.closest('button, input, label, table')) return;
    mouseToCanvas(e);
    mouse.inside = true;
    input.attackHeld = true;                          // tugmani bosib tursa, uzluksiz uradi
    queueAttack(true);
    e.preventDefault();
  });
  window.addEventListener('mouseup', (e) => {
    if (e.button === 0) input.attackHeld = false;
  });
  stage.addEventListener('contextmenu', (e) => {
    if (state === 'playing') e.preventDefault();
  });

  // ----- Klaviatura -----
  const KEYMAP = {
    ArrowLeft: 'left', KeyA: 'left',
    ArrowRight: 'right', KeyD: 'right',
    ArrowUp: 'jump', KeyW: 'jump', Space: 'jump'
  };

  window.addEventListener('keydown', (e) => {
    if (state === 'intro') {
      if (e.code === 'Enter' || e.code === 'Space' || e.code === 'Escape') {
        e.preventDefault();
        finishIntro();
      }
      return;
    }
    if (e.target.tagName === 'INPUT') return;
    const act = KEYMAP[e.code];
    if (act) {
      input[act] = true;
      e.preventDefault();
    }
    if ((e.code === 'KeyJ' || e.code === 'KeyX') && !e.repeat) {
      queueAttack(false);
    }
    if ((e.code === 'KeyP' || e.code === 'Escape') && !e.repeat) {
      togglePause();
    }
  });

  window.addEventListener('keyup', (e) => {
    const act = KEYMAP[e.code];
    if (act) {
      input[act] = false;
      e.preventDefault();
    }
  });

  function releaseAllKeys() {
    input.left = input.right = input.jump = false;
    input.attackBuf = 0;
    input.attackHeld = false;
  }
  window.addEventListener('blur', () => {
    releaseAllKeys();
    if (state === 'playing') togglePause();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && state === 'playing') togglePause();
  });

  // ----- Telefon tugmalari -----
  document.querySelectorAll('#touch-controls button').forEach((btn) => {
    const act = btn.dataset.action;
    const down = (e) => {
      e.preventDefault();
      if (act === 'attack') {
        queueAttack(false);
      } else {
        input[act] = true;
      }
    };
    const up = (e) => {
      e.preventDefault();
      if (act !== 'attack') input[act] = false;
    };
    btn.addEventListener('pointerdown', down);
    ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => btn.addEventListener(ev, up));
  });

  /* =====================================================
     ASOSIY SIKL
  ===================================================== */
  let last = 0;
  let errShown = false;
  let lastState = '';

  function loop(ts) {
    requestAnimationFrame(loop);   // xato bo'lsa ham sikl to'xtamaydi
    try {
      const raw = Math.min((ts - last) / 1000, 0.033);
      last = ts;
      clock += raw;

      let dt = raw;
      if (state === 'intro') dt = updateIntro(raw);
      else if (state === 'playing') update(raw);

      if (state !== lastState) {
        lastState = state;
        stage.classList.toggle('playing', state === 'playing');
      }

      const fxDt = state === 'paused' ? 0 : dt;
      animateWorld(raw);
      syncScene(raw);
      updateFx(fxDt);
      updateCamera(raw);
      drawFx();
      render();
    } catch (err) {
      if (!errShown) {
        errShown = true;
        showError(err);
      }
    }
  }

  /* =====================================================
     BOSHLANISH
  ===================================================== */
  $('introDate').textContent = formatDate(new Date());

  try {
    nameInput.value = localStorage.getItem(NAME_KEY) || '';
  } catch (e) {
    nameInput.value = '';
  }

  // Qahramon modeli
  heroFig = createStickman({ hero: true, color: 0x15121c, headColor: 0xfff1d6, eyeColor: 0x0a0610 });
  scene.add(heroFig.group);

  resetGame();
  startIntro();

  requestAnimationFrame((ts) => {
    last = ts;
    loop(ts);
  });
})();