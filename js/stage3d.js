/* 沖煮檯的 3D 版（three.js）。模型由 blender/brewers.py 產生，經 build.js 轉成 js/models.js（base64 GLB）。
 * 吃的狀態和 Draw.svg() 完全相同（ui.js 的 drawFrame 組出來的 ds），所以模擬引擎不必知道 3D 的存在。
 * 填充體（液體、粉層）用兩片裁切平面控制上下界，再蓋一片圓盤當液面；半徑由 Blender 匯出的內輪廓 profile 內插。
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const lerp = (a, b, k) => a + (b - a) * k;
const DEFAULT_VIEW = { theta: -0.56, phi: 1.07 };  // 3/4 視角：左前方、俯角約 30°
const SLOW_MS = 45;                               // 中位數影格時間超過就退回 SVG

// 每種器具的動畫對應：粉層基準高度（佔濾杯可填範圍的比例）、有沒有手沖壺
const RIGS = {
  cone: { bed: 0.33, kettle: true },
  chemex: { bed: 0.27, kettle: true },
  siphon: { kettle: false, lowMax: 0.62 }
};

function rgb(tds) { const c = window.Draw.coffeeRGB(tds); return new THREE.Color(c[0] / 255, c[1] / 255, c[2] / 255); }

function webglOK() {
  try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch (e) { return false; }
}

class Fill {
  constructor(mesh) {
    this.mesh = mesh;
    this.prof = JSON.parse(mesh.userData.profile);
    this.y0 = this.prof[0][1]; this.y1 = this.prof[this.prof.length - 1][1];
    this.top = new THREE.Plane(new THREE.Vector3(0, -1, 0), this.y1);
    this.bot = new THREE.Plane(new THREE.Vector3(0, 1, 0), -this.y0);
    const liquid = mesh.material.name !== 'ground';
    const base = { roughness: liquid ? 0.55 : 0.95, metalness: 0, transparent: liquid, opacity: liquid ? 0.9 : 1, side: THREE.DoubleSide };
    this.mat = new THREE.MeshStandardMaterial(Object.assign({ clippingPlanes: [this.top, this.bot], clipShadows: true }, base));
    this.capMat = new THREE.MeshStandardMaterial(base);
    mesh.material = this.mat;
    mesh.renderOrder = 1;
    this.cap = new THREE.Mesh(new THREE.CircleGeometry(1, 48).rotateX(-Math.PI / 2), this.capMat);
    this.cap.renderOrder = 1;
    this.cap.receiveShadow = true;
    this.cap.scale.setScalar(1e-4);  // 單位圓，未設定前縮到看不見，免得被算進取景範圍
    mesh.parent.add(this.cap);
  }
  radius(y) {
    const p = this.prof;
    for (let i = 0; i < p.length - 1; i++) if (y >= p[i][1] && y <= p[i + 1][1]) return lerp(p[i][0], p[i + 1][0], (y - p[i][1]) / Math.max(1e-9, p[i + 1][1] - p[i][1]));
    return y < this.y0 ? p[0][0] : p[p.length - 1][0];
  }
  at(k) { return lerp(this.y0, this.y1, clamp(k, 0, 1)); }
  // 顯示 [lo, hi] 這段（世界座標 y，模型不縮放所以等於本地座標）
  set(hi, lo, color, opacity) {
    lo = lo == null ? this.y0 - 1 : lo;
    const on = hi > Math.max(lo, this.y0) + 1e-4;
    this.mesh.visible = this.cap.visible = on;
    if (!on) return;
    this.top.constant = hi; this.bot.constant = -lo;
    this.cap.position.y = hi;
    const r = this.radius(hi); this.cap.scale.set(r, 1, r);
    if (color) { this.mat.color.copy(color); this.capMat.color.copy(color); }
    if (opacity != null) { this.mat.opacity = this.capMat.opacity = opacity; }
  }
}

class Stage3D {
  constructor() {
    this.ready = false; this.failed = false;
    this.types = Object.keys(RIGS);
    this.kit = {};
    this.cur = null;
    this.frameTimes = [];
  }

  supports(type) { return this.ready && !this.failed && this.types.includes(type); }

  init(container) {
    if (!webglOK() || !window.BREWER_GLB) { this.failed = true; return Promise.resolve(false); }
    this.el = container;
    const R = this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
    R.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    R.localClippingEnabled = true;
    R.shadowMap.enabled = true; R.shadowMap.type = THREE.PCFSoftShadowMap;
    R.toneMapping = THREE.NeutralToneMapping; R.toneMappingExposure = 1.0;
    container.appendChild(R.domElement);

    const S = this.scene = new THREE.Scene();
    S.add(new THREE.HemisphereLight(0xfff4e6, 0x8a6a52, 1.6));
    const key = new THREE.DirectionalLight(0xfff1df, 2.3);
    key.position.set(-0.35, 0.8, 0.45); key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024); key.shadow.radius = 4; key.shadow.bias = -0.0005;
    Object.assign(key.shadow.camera, { left: -0.3, right: 0.3, top: 0.3, bottom: -0.3, near: 0.1, far: 2 });
    S.add(key, key.target);
    const rim = new THREE.DirectionalLight(0xdfeeff, 0.8); rim.position.set(0.4, 0.5, -0.6); S.add(rim);

    this.camera = new THREE.PerspectiveCamera(30, 1, 0.01, 10);
    const C = this.controls = new OrbitControls(this.camera, R.domElement);
    C.enableZoom = false; C.enablePan = false; C.enableDamping = true; C.dampingFactor = 0.08;
    C.minPolarAngle = 0.45; C.maxPolarAngle = 1.5;
    R.domElement.style.touchAction = 'pan-y';   // 手機上下滑仍能捲動頁面，左右拖曳才轉器具
    this.idleSince = 0; this.dragging = false;
    C.addEventListener('start', () => { this.dragging = true; });
    C.addEventListener('end', () => { this.dragging = false; this.idleSince = performance.now(); });

    new ResizeObserver(() => this.resize()).observe(container);
    this.visible = true;
    new IntersectionObserver(es => { this.visible = es[0].isIntersecting; }).observe(container);

    return new Promise(resolve => {
      const bin = Uint8Array.from(atob(window.BREWER_GLB), c => c.charCodeAt(0));
      new GLTFLoader().parse(bin.buffer, '', gltf => { this.setup(gltf.scene); resolve(true); },
        err => { console.warn('3D 模型載入失敗', err); this.failed = true; resolve(false); });
    });
  }

  setup(root) {
    const glass = new THREE.MeshStandardMaterial({ color: 0xeef8f8, roughness: 0.08, metalness: 0, transparent: true, opacity: 0.13, depthWrite: false });  // 單面：玻璃有內外兩層，雙面會疊四層變霧白
    const flame = new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0.9 });
    const fills = [];
    root.traverse(o => {
      if (!o.isMesh) return;
      const role = o.userData.role;
      if (role === 'glass') { o.material = glass; o.renderOrder = 3; return; }
      if (role === 'flame') { o.material = flame; return; }
      if (role === 'fill') { fills.push(o); o.castShadow = false; return; }
      o.castShadow = true; o.receiveShadow = true;
      if (o.material.name === 'water') { o.material.transparent = true; o.material.opacity = 0.7; }
    });
    this.scene.add(root);
    const byName = n => root.getObjectByName(n);
    this.counter = byName('P_counter'); this.counter.scale.set(1.6, 1, 1.6);
    this.kettle = byName('P_kettle');
    this.kettleTip = byName('kettle_tip');
    for (const t of this.types) {
      const g = byName('B_' + t);
      if (!g) continue;
      const kit = { root: g, fills: {}, anchors: {} };
      g.traverse(o => {
        if (o.userData.role === 'fill' && o.isMesh) kit.fills[o.userData.key] = new Fill(o);
        if (o.userData.role === 'anchor') kit.anchors[o.userData.key] = o.position.clone();
        if (o.userData.role === 'flame') kit.flame = o;
        if (o.userData.role === 'crust') kit.crust = o;
      });
      g.visible = false;
      this.kit[t] = kit;
    }
    // 動態小物：水流、滴落、悶蒸氣泡
    const waterMat = new THREE.MeshStandardMaterial({ color: 0xbfe3f0, roughness: 0.1, transparent: true, opacity: 0.75 });
    this.dripMat = new THREE.MeshStandardMaterial({ roughness: 0.2, transparent: true, opacity: 0.92 });
    this.stream = new THREE.Mesh(new THREE.BufferGeometry(), waterMat); this.stream.visible = false;
    this.dripCol = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 10).translate(0, -0.5, 0), this.dripMat); this.dripCol.visible = false;
    this.drops = [0, 1, 2].map(() => { const m = new THREE.Mesh(new THREE.SphereGeometry(0.0022, 10, 8), this.dripMat); m.visible = false; return m; });
    const bubMat = new THREE.MeshStandardMaterial({ color: 0xc9a27a, roughness: 0.5 });
    this.bubbles = [0, 1, 2, 3, 4, 5].map(i => { const m = new THREE.Mesh(new THREE.SphereGeometry(0.0018 + (i % 3) * 0.0009, 10, 8), bubMat); m.visible = false; return m; });
    this.scene.add(this.stream, this.dripCol, ...this.drops, ...this.bubbles);
    this.kettleTilt = 0; this.kettleLift = 0;
    this.ready = true;
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  resize() {
    const w = this.el.clientWidth, h = this.el.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }

  show(type) {
    if (this.cur === type) return;
    for (const t in this.kit) this.kit[t].root.visible = t === type;
    this.cur = type;
    const kit = this.kit[type], rig = RIGS[type];
    this.kettle.visible = !!rig.kettle;
    // 取景：器具＋（舉起來的）手沖壺
    const box = new THREE.Box3().setFromObject(kit.root);
    if (rig.kettle) { this.poseKettle(kit, 1, 0.4); box.union(new THREE.Box3().setFromObject(this.kettle)); this.poseKettle(kit, 0, 0); }
    const c = box.getCenter(new THREE.Vector3()), r = box.getSize(new THREE.Vector3()).length() / 2;
    this.dist = r / Math.sin(THREE.MathUtils.degToRad(this.camera.fov / 2)) * 1.0;
    this.controls.target.copy(c);
    this.setView(DEFAULT_VIEW.theta, DEFAULT_VIEW.phi);
  }

  setView(theta, phi) {
    const s = new THREE.Spherical(this.dist, phi, theta);
    this.camera.position.setFromSpherical(s).add(this.controls.target);
    this.camera.lookAt(this.controls.target);
    this.controls.update();
  }

  // lift 0：放在檯面右後方；1：舉到注水位置。tilt：前傾角（弧度）
  poseKettle(kit, lift, tilt) {
    const K = this.kettle, a = kit.anchors.kettle;
    const rest = new THREE.Vector3(0.19, 0, -0.05);
    K.position.set(lerp(rest.x, a.x, lift), lerp(rest.y, a.y, lift), lerp(rest.z, a.z, lift));
    K.rotation.set(0, lerp(0.5, 0, lift), tilt);
    K.updateMatrixWorld(true);
  }

  update(type, ds) {
    if (!this.supports(type)) return;
    this.show(type);
    this.ds = ds;
    const kit = this.kit[type], rig = RIGS[type], F = kit.fills;
    this.streamOn = false;
    if (type === 'siphon') {
      const up = clamp(ds.upFrac || 0, 0, 1), down = clamp(ds.downFrac || 0, 0, 1);
      const upTop = F.up.at(up);
      F.up.set(up > 0.01 ? upTop : -1, null, rgb(ds.slurryTds || 0.8), 0.9);
      const lowK = ds.released ? down : 1 - up;
      F.low.set(lowK > 0.005 ? F.low.at(lowK * rig.lowMax) : -1, null, ds.released ? rgb(ds.tds) : new THREE.Color(0x9fd2e6), ds.released ? 0.92 : 0.7);
      kit.crust.visible = up > 0.05;
      if (kit.crust.visible) { const r = F.up.radius(upTop) / 0.01 * 0.97; kit.crust.position.y = upTop - 0.0085; kit.crust.scale.set(r, 1, r); }
      kit.flame.visible = !ds.released || ds.static;
    } else {
      const bedTop = F.bed.at(rig.bed * (1 + 0.18 * (ds.bedWet || 0)));
      const dry = new THREE.Color(0x8a5a38), wet = new THREE.Color(0x3e2414);
      F.bed.set(bedTop, null, dry.lerp(wet, clamp(ds.bedWet || 0, 0, 1)));
      const liqTop = lerp(bedTop, F.up.y1, clamp(ds.level || 0, 0, 1));
      F.up.set(liqTop - bedTop > 0.0008 ? liqTop : -1, bedTop, rgb(ds.slurryTds || 1), 0.78);
      const cupTop = F.cup.at(clamp(ds.cupFrac || 0, 0, 1));
      F.cup.set(cupTop, null, rgb(ds.tds), 0.93);
      this.surface = { liqTop: Math.max(liqTop, bedTop), cupTop, drip: kit.anchors.drip, bedTop, bedR: F.bed.radius(bedTop) };
    }
  }

  // 每一格：手沖壺動作、水流、滴落、氣泡、火焰、閒置時轉回預設視角
  animate(now) {
    const ds = this.ds, type = this.cur;
    if (!ds || !type) return;
    const kit = this.kit[type], rig = RIGS[type];
    const t = ds.t || 0;
    if (rig.kettle) {
      const target = ds.pour ? 1 : 0;
      this.kettleLift = lerp(this.kettleLift, target, 0.12);
      this.kettleTilt = lerp(this.kettleTilt, ds.pour ? 0.36 + clamp(ds.rate || 0, 0, 8) * 0.012 : 0, 0.12);
      this.poseKettle(kit, this.kettleLift, this.kettleTilt);
      const S = this.surface;
      if (ds.pour && this.kettleLift > 0.85) {
        const tip = this.kettleTip.getWorldPosition(new THREE.Vector3());
        const st = ds.style, A = st === 'center' || st === 'melodrip' ? 0 : st === 'stir' ? 0.008 : 0.016 * S.bedR / 0.05;
        const end = new THREE.Vector3(A * Math.sin(t * 3.2), S.liqTop, st === 'spiral' || !st ? A * Math.cos(t * 3.2) : 0);
        const ctrl = new THREE.Vector3(lerp(tip.x, end.x, 0.25), lerp(tip.y, end.y, 0.15), lerp(tip.z, end.z, 0.25));
        const w = clamp(1.2 + (ds.rate || 0) * 0.35, 1.2, 4.5) * 0.0005;
        this.stream.geometry.dispose();
        this.stream.geometry = new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(tip, ctrl, end), 16, w, 6, false);
        this.stream.visible = true;
      } else this.stream.visible = false;
      // 滴落：流量大就是一條線，小就是三顆水滴
      const flow = ds.flow && S.drip && S.cupTop < S.drip.y;
      this.dripMat.color.copy(rgb((ds.tds || 1.3) + 1.2));
      if (flow && ds.flowRate > 1.8) {
        this.dripCol.visible = true; this.drops.forEach(d => { d.visible = false; });
        const r = clamp(ds.flowRate * 0.35, 0.5, 2) * 0.001;
        this.dripCol.position.copy(S.drip); this.dripCol.scale.set(r, S.drip.y - S.cupTop, r);
      } else {
        this.dripCol.visible = false;
        this.drops.forEach((d, i) => {
          d.visible = !!flow;
          if (flow) { const ph = (t * 1.8 + i / 3) % 1; d.position.set(S.drip.x, lerp(S.drip.y, S.cupTop, ph), S.drip.z); }
        });
      }
      this.bubbles.forEach((b, i) => {
        b.visible = !!ds.bloom;
        if (ds.bloom) { const a = i * 1.7 + t * 0.4, rr = S.bedR * (0.25 + 0.5 * ((i * 0.37) % 1)); b.position.set(rr * Math.cos(a), S.bedTop + 0.001, rr * Math.sin(a)); }
      });
    } else {
      this.stream.visible = this.dripCol.visible = false;
      this.drops.forEach(d => { d.visible = false; }); this.bubbles.forEach(b => { b.visible = false; });
    }
    if (kit.flame && kit.flame.visible) { const k = 1 + 0.12 * Math.sin(now / 70) + 0.06 * Math.sin(now / 23); kit.flame.scale.set(1 / Math.sqrt(k), k, 1 / Math.sqrt(k)); }
    // 放開 2.5 秒後慢慢轉回預設角度
    if (!this.dragging && this.idleSince && now - this.idleSince > 2500) {
      const s = new THREE.Spherical().setFromVector3(this.camera.position.clone().sub(this.controls.target));
      let dt = DEFAULT_VIEW.theta - s.theta; dt = Math.atan2(Math.sin(dt), Math.cos(dt));
      const dp = DEFAULT_VIEW.phi - s.phi;
      if (Math.abs(dt) + Math.abs(dp) < 0.002) this.idleSince = 0;
      else this.setView(s.theta + dt * 0.05, s.phi + dp * 0.05);
    }
  }

  loop(now) {
    requestAnimationFrame(this.loop);
    if (!this.visible || document.hidden || !this.cur || this.failed || this.el.offsetParent === null) { this.last = 0; return; }
    if (this.last) this.watchSpeed(now - this.last);
    this.last = now;
    this.animate(now);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  // 前 90 格的中位數太慢就放棄 3D，交回 SVG
  watchSpeed(dt) {
    if (this.speedChecked) return;
    this.frameTimes.push(dt);
    if (this.frameTimes.length < 90) return;
    this.speedChecked = true;
    const m = this.frameTimes.sort((a, b) => a - b)[45];
    if (m > SLOW_MS) { this.failed = true; window.dispatchEvent(new CustomEvent('stage3d', { detail: { slow: true } })); }
  }
}

const S3 = new Stage3D();
window.Stage3D = S3;
const mount = () => {
  const el = document.getElementById('stage-3d');
  if (!el) return;
  S3.init(el).then(ok => window.dispatchEvent(new CustomEvent('stage3d', { detail: { ready: ok } })));
};
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
