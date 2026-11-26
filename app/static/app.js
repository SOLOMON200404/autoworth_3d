import * as THREE from "three";
import { OrbitControls } from "three/addons/OrbitControls.js";
import { RoomEnvironment } from "three/addons/RoomEnvironment.js";

const $ = (id) => document.getElementById(id);
const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;
const inr = (n) => "₹" + Math.round(n).toLocaleString("en-IN");
const lakh = (n) => "₹" + (n / 1e5).toFixed(n >= 1e7 ? 0 : 2).replace(/\.?0+$/, "") + " L";
const SEG_COLOR = { Budget: 0x4de2ff, "Mid-range": 0xffb454, Premium: 0xb58bff };
const COLORS = { Pearl: "#e8ecf4", Midnight: "#1a2140", Crimson: "#d4264a", Ocean: "#1f7bd8", Emerald: "#17a374", Sunset: "#ff8a3d" };

/* ---------- generic helpers ---------- */
function makeRenderer(canvas) {
  try {
    const r = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
    r.setPixelRatio(Math.min(devicePixelRatio, 2));
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.05;
    r.outputColorSpace = THREE.SRGBColorSpace;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (w && h) r.setSize(w, h, false);
    return r;
  } catch (e) { console.warn("WebGL unavailable; showing animated car fallback", e); makeCarFallback(canvas); return null; }
}
function makeCarFallback(canvas) {
  const root = document.createElement("div");
  root.className = "car-fallback " + (canvas.id === "heroCanvas" ? "hero-fallback" : "studio-fallback");
  root.setAttribute("aria-hidden", "true");
  root.innerHTML = `<div class="fallback-platform"></div><div class="fallback-spin"><div class="fallback-car">
    <div class="fallback-shell"></div><div class="fallback-cabin"></div><div class="fallback-glass"></div>
    <i class="fallback-wheel wheel-a"></i><i class="fallback-wheel wheel-b"></i>
    <i class="fallback-wheel wheel-c"></i><i class="fallback-wheel wheel-d"></i>
    <i class="fallback-light light-a"></i><i class="fallback-light light-b"></i>
  </div></div>`;
  root.style.setProperty("--car-color", canvas.id === "heroCanvas" ? COLORS.Crimson : COLORS.Pearl);
  canvas.after(root); canvas.style.opacity = "0"; canvas._carFallback = root;
  return root;
}
function fit(renderer, camera, canvas) {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (!w || !h) return;
  if (canvas.width !== Math.floor(w * renderer.getPixelRatio()) || canvas.height !== Math.floor(h * renderer.getPixelRatio())) {
    renderer.setSize(w, h, false);
  }
  if (camera.aspect !== w / h) { camera.aspect = w / h; camera.updateProjectionMatrix(); }
}
function whenVisible(el, cb) {
  let vis = true;
  new IntersectionObserver((e) => { vis = e[0].isIntersecting; cb(vis); }, { threshold: 0.01 }).observe(el);
  return () => vis;
}
function envMap(renderer) {
  const pm = new THREE.PMREMGenerator(renderer);
  const t = pm.fromScene(new RoomEnvironment(), 0.04).texture;
  pm.dispose(); return t;
}
function textSprite(text, { size = 64, color = "#cfd8f5", scale = 1 } = {}) {
  const c = document.createElement("canvas"); const ctx = c.getContext("2d");
  c.width = 512; c.height = 128;
  ctx.font = `600 ${size}px Inter, sans-serif`; ctx.fillStyle = color; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(text, 256, 64);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  s.scale.set(2.4 * scale, 0.6 * scale, 1); return s;
}
let DOT = null;
function dotTex() {
  if (DOT) return DOT; const c = document.createElement("canvas"); c.width = c.height = 64; const x = c.getContext("2d");
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, "#fff"); g.addColorStop(0.35, "#ffffffcc"); g.addColorStop(1, "#ffffff00");
  x.fillStyle = g; x.fillRect(0, 0, 64, 64); DOT = new THREE.CanvasTexture(c); return DOT;
}
function particles(count, spread, color, size = 0.04) {
  const g = new THREE.BufferGeometry(); const a = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) { a[i * 3] = (Math.random() - 0.5) * spread; a[i * 3 + 1] = Math.random() * spread * 0.5; a[i * 3 + 2] = (Math.random() - 0.5) * spread; }
  g.setAttribute("position", new THREE.BufferAttribute(a, 3));
  const p = new THREE.Points(g, new THREE.PointsMaterial({ color, size: size * 2.2, map: dotTex(), transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending }));
  return p;
}

/* ---------- procedural 3D car ---------- */
const STYLES = {
  hatch: { name: "Hatchback", L: 3.7, W: 1.62, H: 0.66, c1: -0.95, c2: 0.9, T: 1.3, wr: 0.34, base: 0.26 },
  sedan: { name: "Sedan", L: 4.5, W: 1.72, H: 0.68, c1: -1.15, c2: 0.95, T: 1.27, wr: 0.36, base: 0.26 },
  suv:   { name: "SUV", L: 4.6, W: 1.85, H: 0.92, c1: -1.7, c2: 1.2, T: 1.72, wr: 0.46, base: 0.38 },
};
function styleFor(engine, power) { return engine >= 1750 || power >= 115 ? "suv" : engine >= 1250 || power >= 85 ? "sedan" : "hatch"; }

function buildCar(styleKey, colorHex) {
  const S = STYLES[styleKey]; const g = new THREE.Group();
  const paint = new THREE.MeshPhysicalMaterial({ color: colorHex, metalness: 0.65, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.08 });
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x0b1020, metalness: 0.9, roughness: 0.05, clearcoat: 1 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x0a0c14, roughness: 0.7, metalness: 0.3 });
  const hl = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xbfeaff, emissiveIntensity: 2.2 });
  const tl = new THREE.MeshStandardMaterial({ color: 0xff2a44, emissive: 0xff2a44, emissiveIntensity: 1.8 });
  const rim = new THREE.MeshStandardMaterial({ color: 0xcfd6e6, metalness: 1, roughness: 0.22 });

  // lower body (side profile extruded across width)
  const b = new THREE.Shape(); const L = S.L / 2, y0 = S.base, H = S.H;
  b.moveTo(-L + 0.18, y0); b.lineTo(L - 0.18, y0); b.quadraticCurveTo(L, y0, L, y0 + 0.2);
  b.lineTo(L, H - 0.14); b.quadraticCurveTo(L, H, L - 0.28, H + 0.02);   // hood nose
  b.lineTo(-L + 0.25, H + 0.02); b.quadraticCurveTo(-L, H, -L, H - 0.16);
  b.lineTo(-L, y0 + 0.2); b.quadraticCurveTo(-L, y0, -L + 0.18, y0);
  const bodyGeo = new THREE.ExtrudeGeometry(b, { depth: S.W - 0.16, bevelEnabled: true, bevelSize: 0.08, bevelThickness: 0.08, bevelSegments: 5, curveSegments: 14 });
  bodyGeo.translate(0, 0, -(S.W - 0.16) / 2);
  const body = new THREE.Mesh(bodyGeo, paint); g.add(body);

  // cabin (glass) + roof cap
  const c = new THREE.Shape();
  c.moveTo(S.c1, H); c.lineTo(S.c1 + (styleKey === "suv" ? 0.25 : 0.55), S.T); c.lineTo(S.c2 - 0.5, S.T); c.lineTo(S.c2, H);
  const cabGeo = new THREE.ExtrudeGeometry(c, { depth: S.W - 0.42, bevelEnabled: true, bevelSize: 0.05, bevelThickness: 0.05, bevelSegments: 3 });
  cabGeo.translate(0, 0, -(S.W - 0.42) / 2);
  g.add(new THREE.Mesh(cabGeo, glass));
  const roof = new THREE.Mesh(new THREE.BoxGeometry(S.c2 - S.c1 - 0.85, 0.06, S.W - 0.38), paint);
  roof.position.set((S.c1 + 0.55 + S.c2 - 0.5) / 2 - 0.03, S.T + 0.045, 0); g.add(roof);

  // wheels
  const wheel = new THREE.Group();
  const tire = new THREE.Mesh(new THREE.CylinderGeometry(S.wr, S.wr, 0.26, 36), dark); tire.rotation.x = Math.PI / 2;
  const rm = new THREE.Mesh(new THREE.CylinderGeometry(S.wr * 0.68, S.wr * 0.68, 0.28, 24), rim); rm.rotation.x = Math.PI / 2;
  wheel.add(tire, rm);
  for (let i = 0; i < 5; i++) { const sp = new THREE.Mesh(new THREE.BoxGeometry(S.wr * 1.2, 0.03, 0.3), rim); sp.rotation.z = (i / 5) * Math.PI; wheel.add(sp); }
  g.userData.wheels = [];
  const wx = S.L * 0.31, wz = S.W / 2 - 0.1;
  [[wx, wz], [wx, -wz], [-wx, wz], [-wx, -wz]].forEach(([x, z]) => { const w = wheel.clone(); w.position.set(x, S.wr, z); g.add(w); g.userData.wheels.push(w); });

  // lights, grille, mirrors
  [-1, 1].forEach((s) => {
    const h = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.11, 0.34), hl); h.position.set(L + 0.05, H - 0.2, s * (S.W / 2 - 0.34)); g.add(h);
    const t = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.1, 0.34), tl); t.position.set(-L - 0.05, H - 0.2, s * (S.W / 2 - 0.34)); g.add(t);
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.1, 0.08), paint); m.position.set(S.c2 - 0.55, H + 0.14, s * (S.W / 2 - 0.02)); g.add(m);
  });
  const grille = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.14, S.W * 0.34), dark); grille.position.set(L + 0.07, H - 0.34, 0); g.add(grille);
  const beam = new THREE.PointLight(0xbfeaff, 1.2, 6); beam.position.set(L + 0.6, H - 0.2, 0); g.add(beam);

  g.userData.paint = paint; g.userData.style = S; g.userData.span = S.L;
  g.position.y = 0; return g;
}
function disposeGroup(g) { g.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose()); }); }

function addPlatform(scene, color = 0x4de2ff) {
  const g = new THREE.Group();
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(3.6, 3.8, 0.12, 80), new THREE.MeshStandardMaterial({ color: 0x0c1226, metalness: 0.9, roughness: 0.25 }));
  disc.position.y = -0.06; g.add(disc);
  const ring = new THREE.Mesh(new THREE.RingGeometry(3.45, 3.6, 96), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: 0.9 }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.002; g.add(ring);
  const ring2 = new THREE.Mesh(new THREE.RingGeometry(2.4, 2.43, 96), new THREE.MeshBasicMaterial({ color: 0x8b7bff, side: THREE.DoubleSide, transparent: true, opacity: 0.5 }));
  ring2.rotation.x = -Math.PI / 2; ring2.position.y = 0.003; g.add(ring2);
  scene.add(g); return { g, ring, ring2 };
}

/* ---------- HERO scene ---------- */
function initHero() {
  const canvas = $("heroCanvas"); const r = makeRenderer(canvas); if (!r) return;
  const scene = new THREE.Scene(); scene.environment = envMap(r);
  scene.fog = new THREE.FogExp2(0x070a12, 0.045);
  const cam = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
  const plat = addPlatform(scene);
  let car = buildCar("sedan", COLORS.Crimson); scene.add(car);
  const stars = particles(900, 40, 0x9fb4ff, 0.05); stars.position.y = -4; scene.add(stars);
  const glow = particles(120, 9, 0x4de2ff, 0.07); scene.add(glow);
  scene.add(new THREE.AmbientLight(0xffffff, 0.35));
  const key = new THREE.DirectionalLight(0xffffff, 2.4); key.position.set(4, 6, 3); scene.add(key);
  const rim = new THREE.PointLight(0x8b7bff, 60, 20); rim.position.set(-5, 2, -4); scene.add(rim);
  let mx = 0, my = 0; addEventListener("pointermove", (e) => { mx = e.clientX / innerWidth - 0.5; my = e.clientY / innerHeight - 0.5; });
  const vis = whenVisible(canvas, () => {});
  const clock = new THREE.Clock(); let snapped = false;
  // cycle paint colours
  const palette = Object.values(COLORS).map((c) => new THREE.Color(c)); let pi = 0, target = palette[0].clone();
  setInterval(() => { pi = (pi + 1) % palette.length; target = palette[pi].clone(); }, 3500);
  (function loop() {
    requestAnimationFrame(loop); if (!vis()) return;
    fit(r, cam, canvas); const t = clock.getElapsedTime();
    const wide = canvas.clientWidth / canvas.clientHeight > 1.15;
    car.rotation.y = t * 0.35 + 0.6;
    car.position.x = wide ? 3.4 : 0; car.position.y = 0.02 + Math.sin(t * 1.4) * 0.02;
    plat.g.position.x = car.position.x;
    car.userData.paint.color.lerp(target, 0.04);
    car.userData.wheels.forEach((w) => (w.rotation.z -= 0.03));
    plat.ring2.rotation.z = t * 0.2; plat.ring.material.opacity = 0.65 + Math.sin(t * 2) * 0.25;
    stars.rotation.y = t * 0.012; glow.rotation.y = -t * 0.05;
    const dist = wide ? 13.5 : 17;
    const want = new THREE.Vector3(2 + mx * 2.4 + (wide ? 3.4 : 0), 2.8 - my * 1.4, dist);
    if (!snapped) { cam.position.copy(want); snapped = true; } else cam.position.lerp(want, 0.04);
    cam.lookAt(car.position.x, 0.8, 0);
    r.render(scene, cam);
  })();
}

/* ---------- STUDIO scene (reactive car) ---------- */
const studio = {};
function initStudio() {
  const canvas = $("carCanvas"); studio.canvas = canvas; studio.color = COLORS.Pearl;
  const r = makeRenderer(canvas); if (!r) { studio.styleKey = "hatch"; return; }
  const scene = new THREE.Scene(); scene.environment = envMap(r);
  const cam = new THREE.PerspectiveCamera(34, 1, 0.1, 100); cam.position.set(5.6, 2.4, 6.6);
  const controls = new OrbitControls(cam, canvas);
  controls.enableDamping = true; controls.enablePan = false; controls.minDistance = 4.5; controls.maxDistance = 12;
  controls.maxPolarAngle = Math.PI / 2.05; controls.target.set(0, 0.35, 0); controls.autoRotate = true; controls.autoRotateSpeed = 1.6;
  const plat = addPlatform(scene);
  scene.add(new THREE.AmbientLight(0xffffff, 0.4));
  const key = new THREE.DirectionalLight(0xffffff, 2.2); key.position.set(4, 6, 3); scene.add(key);
  const rimL = new THREE.PointLight(0x8b7bff, 50, 20); rimL.position.set(-5, 2, -4); scene.add(rimL);
  const dust = particles(200, 14, 0x4de2ff, 0.04); scene.add(dust);

  Object.assign(studio, { r, scene, cam, controls, plat, canvas, car: null, color: COLORS.Pearl, styleKey: null, bursts: [], pulse: 0, spin: 0 });
  setCar("hatch");
  const vis = whenVisible(canvas, () => {}); const clock = new THREE.Clock();
  (function loop() {
    requestAnimationFrame(loop); if (!vis()) return;
    fit(r, cam, canvas); const dt = clock.getDelta(), t = clock.elapsedTime;
    controls.update();
    if (studio.car) {
      const target = studio.targetScale; studio.car.scale.lerp(new THREE.Vector3(target, target, target), 0.1);
      studio.car.userData.wheels.forEach((w) => (w.rotation.z -= 0.02 + studio.spin * 0.5));
      studio.spin *= 0.94;
      studio.car.position.y = Math.sin(t * 1.5) * 0.015;
    }
    plat.ring.material.opacity = 0.6 + Math.sin(t * 2) * 0.25; plat.ring2.rotation.z = t * 0.25;
    dust.rotation.y = t * 0.04;
    // pulse rings + sparks
    studio.bursts = studio.bursts.filter((b) => {
      b.life += dt;
      if (b.type === "ring") { const k = b.life / 1.4; b.mesh.scale.setScalar(1 + k * 4); b.mesh.material.opacity = Math.max(0, 0.9 - k); }
      else { const k = b.life / 1.6; const p = b.mesh.geometry.attributes.position; for (let i = 0; i < p.count; i++) { p.array[i * 3] += b.v[i * 3] * dt; p.array[i * 3 + 1] += b.v[i * 3 + 1] * dt; p.array[i * 3 + 2] += b.v[i * 3 + 2] * dt; b.v[i * 3 + 1] -= 2.2 * dt; } p.needsUpdate = true; b.mesh.material.opacity = Math.max(0, 1 - k); }
      if (b.life > 1.7) { scene.remove(b.mesh); b.mesh.geometry.dispose(); b.mesh.material.dispose(); return false; } return true;
    });
    r.render(scene, cam);
  })();
}
function setCar(styleKey) {
  if (!studio.r) {
    studio.styleKey = styleKey;
    if (studio.canvas?._carFallback) studio.canvas._carFallback.dataset.style = styleKey;
    if ($("styleChip")) $("styleChip").textContent = STYLES[styleKey].name;
    return;
  }
  if (studio.car) { studio.scene.remove(studio.car); disposeGroup(studio.car); }
  const car = buildCar(styleKey, studio.color); studio.car = car; studio.styleKey = styleKey;
  car.scale.setScalar(0.01); studio.targetScale = styleKey === "suv" ? 0.95 : styleKey === "sedan" ? 0.92 : 1.02;
  studio.scene.add(car); studio.spin = 2;
  $("styleChip").textContent = STYLES[styleKey].name;
}
function setPaint(hex) {
  studio.color = hex;
  if (studio.car) studio.car.userData.paint.color.set(hex);
  if (studio.canvas?._carFallback) studio.canvas._carFallback.style.setProperty("--car-color", hex);
}
function burst(color) {
  if (!studio.r) return;
  const ring = new THREE.Mesh(new THREE.RingGeometry(1.0, 1.08, 96), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: 0.9, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.02; studio.scene.add(ring); studio.bursts.push({ type: "ring", mesh: ring, life: 0 });
  const n = 160, g = new THREE.BufferGeometry(), pos = new Float32Array(n * 3), v = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2, s = 1 + Math.random() * 3; pos[i * 3 + 1] = 0.5; v[i * 3] = Math.cos(a) * s; v[i * 3 + 2] = Math.sin(a) * s; v[i * 3 + 1] = 2 + Math.random() * 3.5; }
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const pts = new THREE.Points(g, new THREE.PointsMaterial({ color, size: 0.2, map: dotTex(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  studio.scene.add(pts); studio.bursts.push({ type: "spark", mesh: pts, v, life: 0 }); studio.spin = 3;
}

/* ---------- 2D charts ---------- */
function lineChart(canvas, pts, { xLabel, fmtX, highlight }) {
  const dpr = Math.min(devicePixelRatio, 2); const w = canvas.clientWidth, h = canvas.clientHeight;
  canvas.width = w * dpr; canvas.height = h * dpr; const ctx = canvas.getContext("2d"); ctx.scale(dpr, dpr);
  const pad = { l: 56, r: 16, t: 16, b: 32 }; const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = 0, y1 = Math.max(...ys) * 1.1;
  const sx = (x) => pad.l + ((x - x0) / (x1 - x0)) * (w - pad.l - pad.r), sy = (y) => h - pad.b - ((y - y0) / (y1 - y0)) * (h - pad.t - pad.b);
  let start = null;
  function draw(ts) {
    if (!start) start = ts; const k = REDUCED ? 1 : Math.min(1, (ts - start) / 900); const e = 1 - Math.pow(1 - k, 3);
    ctx.clearRect(0, 0, w, h); ctx.font = "12px Inter,sans-serif"; ctx.fillStyle = "#8a94b2"; ctx.strokeStyle = "#ffffff12"; ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) { const v = (y1 / 4) * i, y = sy(v); ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(w - pad.r, y); ctx.stroke(); ctx.textAlign = "right"; ctx.fillText(lakh(v), pad.l - 8, y + 4); }
    ctx.textAlign = "center"; const step = Math.ceil(pts.length / 6); pts.forEach((p, i) => { if (i % step === 0) ctx.fillText(fmtX(p.x), sx(p.x), h - 10); });
    const n = Math.max(2, Math.floor(pts.length * e)); const grad = ctx.createLinearGradient(0, 0, w, 0); grad.addColorStop(0, "#4de2ff"); grad.addColorStop(1, "#8b7bff");
    ctx.beginPath(); pts.slice(0, n).forEach((p, i) => (i ? ctx.lineTo(sx(p.x), sy(p.y)) : ctx.moveTo(sx(p.x), sy(p.y))));
    ctx.strokeStyle = grad; ctx.lineWidth = 3; ctx.lineJoin = "round"; ctx.stroke();
    ctx.lineTo(sx(pts[n - 1].x), sy(0)); ctx.lineTo(sx(pts[0].x), sy(0)); ctx.closePath();
    const fill = ctx.createLinearGradient(0, pad.t, 0, h); fill.addColorStop(0, "#4de2ff33"); fill.addColorStop(1, "#4de2ff00"); ctx.fillStyle = fill; ctx.fill();
    if (highlight != null && k === 1) { const p = pts.find((q) => q.x === highlight); if (p) { ctx.beginPath(); ctx.arc(sx(p.x), sy(p.y), 6, 0, 7); ctx.fillStyle = "#fff"; ctx.shadowColor = "#4de2ff"; ctx.shadowBlur = 14; ctx.fill(); ctx.shadowBlur = 0; } }
    if (k < 1) requestAnimationFrame(draw);
  }
  requestAnimationFrame(draw);
}

/* ---------- app state / form ---------- */
let META, lastPrice = 0, timer = null, reqId = 0, firstResult = true, selectedColor = "Pearl";
const F = ["brand", "fuel", "transmission", "seller_type", "owner", "seats"];
const R = { year: (v) => v, km_driven: (v) => Number(v).toLocaleString("en-IN") + " km", engine: (v) => v + " cc", max_power: (v) => v + " bhp", mileage: (v) => v + " kmpl" };

function fillSelect(id, arr, def) { const el = $(id); el.innerHTML = arr.map((v) => `<option>${v}</option>`).join(""); if (def != null && arr.includes(def)) el.value = def; }
function syncRange(id) { const el = $(id); const p = ((el.value - el.min) / (el.max - el.min)) * 100; el.style.setProperty("--p", p + "%"); const o = $("o_" + id.replace("km_driven", "km")); if (o) o.textContent = R[id](el.value); }

function payload() {
  const ask = Number($("asking").value);
  return { brand: $("brand").value, year: +$("year").value, fuel: $("fuel").value, transmission: $("transmission").value, seller_type: $("seller_type").value, owner: $("owner").value,
    km_driven: +$("km_driven").value, seats: +$("seats").value, engine: +$("engine").value, max_power: +$("max_power").value, mileage: +$("mileage").value, asking_price: ask > 0 ? ask : null };
}
function schedule(now = false) {
  $("liveChip").firstChild && ($("liveChip").style.opacity = 0.5);
  clearTimeout(timer); timer = setTimeout(estimate, now ? 0 : 450);
}
function countUp(el, from, to, ms = 1100) {
  if (REDUCED) { el.textContent = inr(to); return; }
  const t0 = performance.now(); (function f(t) { const k = Math.min(1, (t - t0) / ms), e = 1 - Math.pow(1 - k, 4); el.textContent = inr(from + (to - from) * e); if (k < 1) requestAnimationFrame(f); })(t0);
}

async function estimate() {
  const id = ++reqId; const body = payload();
  const sk = styleFor(body.engine, body.max_power); if (sk !== studio.styleKey) setCar(sk);
  let res;
  try { const r = await fetch("/api/predict", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); if (!r.ok) throw new Error(await r.text()); res = await r.json(); }
  catch (e) { console.error(e); $("liveChip").style.opacity = 1; $("liveChip").lastChild.textContent = "Error"; return; }
  if (id !== reqId) return; $("liveChip").style.opacity = 1; $("liveChip").lastChild.textContent = "Live";
  show(res, body);
}

function show(res, body) {
  $("reveal").hidden = false; $("result").hidden = false; $("charts").hidden = false;
  countUp($("price"), lastPrice || res.price * 0.7, res.price); lastPrice = res.price;
  $("rangeText").textContent = `Likely range ${lakh(res.low)} – ${lakh(res.high)}`;
  $("rangeBig").textContent = `${inr(res.low)} – ${inr(res.high)}`;
  $("lowL").textContent = inr(res.low); $("highL").textContent = inr(res.high);
  const sb = $("segBadge"); sb.textContent = res.segment + " segment"; sb.className = "seg " + res.segment;
  burst(SEG_COLOR[res.segment]);
  // bar
  const lo = res.low, hi = res.high, span = hi - lo, pad = span * 0.35; const min = lo - pad, max = hi + pad, tot = max - min;
  const pct = (v) => Math.min(100, Math.max(0, ((v - min) / tot) * 100));
  $("band").style.left = pct(lo) + "%"; $("band").style.right = 100 - pct(hi) + "%"; $("band").style.inset = `0 ${100 - pct(hi)}% 0 ${pct(lo)}%`;
  $("mid").style.left = pct(res.price) + "%";
  const v = $("verdict"), ask = $("ask");
  if (res.verdict) {
    v.hidden = false; v.className = "verdict " + res.verdict.tone; v.textContent = res.verdict.label;
    ask.hidden = false; ask.style.left = Math.min(88, Math.max(12, pct(body.asking_price))) + "%"; ask.textContent = "Asking " + lakh(body.asking_price);
    $("hint").textContent = res.verdict.tone === "good" ? `The asking price is about ${res.verdict.pct}% below the model's fair value. Worth acting on quickly.`
      : res.verdict.tone === "bad" ? `The asking price is about ${res.verdict.pct}% above fair value. A reasonable counter-offer is near ${inr(res.price)}.`
      : `The asking price sits inside the fair range (${res.verdict.pct}% from the estimate), so there's limited room to negotiate.`;
  } else { v.hidden = true; ask.hidden = true; $("hint").textContent = "Add the seller's asking price to see whether it's a deal."; }
  const c1 = smooth(res.age_curve.filter((p) => p.year <= YMAX).reverse().map((p) => ({ x: p.year, y: p.price })));
  lineChart($("ageChart"), c1, { fmtX: (x) => x, highlight: body.year });
  lineChart($("kmChart"), smooth(res.km_curve.map((p) => ({ x: p.km, y: p.price }))), { fmtX: (x) => x / 1000 + "k", highlight: Math.round(body.km_driven / 25000) * 25000 });
  $("similar").innerHTML = res.similar.map((s) => `<div><span>${s.year} · ${s.km.toLocaleString("en-IN")} km · ${s.fuel}</span><br>${s.name}<b>${inr(s.price)}</b></div>`).join("");
}
const REF = 2026; let YMAX = 2020;
const smooth = (a) => a.map((p, i) => ({ ...p, y: (a[Math.max(0, i - 1)].y + p.y * 2 + a[Math.min(a.length - 1, i + 1)].y) / 4 }));

async function boot() {
  META = await (await fetch("/api/meta")).json();
  const d = META.defaults;
  fillSelect("brand", META.brands, "Maruti"); fillSelect("fuel", META.fuel, "Diesel"); fillSelect("transmission", META.transmission, "Manual");
  fillSelect("seller_type", META.seller_type, "Individual"); fillSelect("owner", META.owner, "First Owner"); fillSelect("seats", META.seats, 5);
  const [y0, y1] = META.ranges.year; $("year").min = y0; $("year").max = y1; YMAX = y1;
  $("km_driven").max = Math.ceil(META.ranges.km_driven[1] / 10000) * 10000;
  $("engine").min = Math.floor(META.ranges.engine[0] / 50) * 50; $("engine").max = Math.ceil(META.ranges.engine[1] / 50) * 50;
  $("max_power").min = Math.floor(META.ranges.max_power[0]); $("max_power").max = Math.ceil(META.ranges.max_power[1]);
  const set = (id, v) => { $(id).value = v; syncRange(id); };
  set("year", Math.min(2018, y1)); set("km_driven", Math.round(d.km_driven / 1000) * 1000 || 60000); set("engine", Math.round(d.engine / 50) * 50); set("max_power", Math.round(d.max_power)); set("mileage", Math.round(d.mileage * 2) / 2);
  Object.keys(R).forEach((id) => $(id).addEventListener("input", () => { syncRange(id); schedule(); }));
  F.concat("asking").forEach((id) => $(id).addEventListener("input", () => schedule()));
  $("form").addEventListener("submit", (e) => { e.preventDefault(); schedule(true); });
  $("colors").innerHTML = Object.entries(COLORS).map(([n, c]) => `<button type="button" role="radio" aria-label="${n}" aria-checked="${n === selectedColor}" data-n="${n}" style="background:${c};color:${c}"></button>`).join("");
  $("colors").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; selectedColor = b.dataset.n; [...$("colors").children].forEach((x) => x.setAttribute("aria-checked", x === b)); setPaint(COLORS[selectedColor]); });
  // hero stats
  const best = META.best_model.replace("Boosting: ", "");
  $("heroStats").innerHTML = `<div><b>6.4k</b><span>real listings</span></div><div><b>${best}</b><span>champion model</span></div><div><b>±${Math.round(META.band * 100)}%</b><span>80% price band</span></div>`;
  initHero(); initStudio();
  schedule(true);
}
boot();
