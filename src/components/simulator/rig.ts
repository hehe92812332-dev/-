// three.js 장면: 해부학 골격 + 기구 + 분석 오버레이
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { Mat3, Vec3 } from "@/lib/biomech/math";
import type { Joints } from "@/lib/biomech/pose";
import type { Surface } from "@/lib/biomech/types";
import type { LiteFrame } from "./transfer";
import { Anatomy, skinMaterial } from "./anatomy";

const C = {
  bone: 0xe9dec6,
  knob: 0xddcfb0,
  boneShade: 0xcdbd99,
  ground: 0xe9e6df,
  grid: 0xd6d1c6,
  com: 0x0f8b6c,
  left: 0x2f6fde,
  right: 0xe0662f,
  toe: 0x7a5cd6,
  knee: 0xd9433b,
  ghost: 0x8c8c8c,
  plate: 0xbfd3ee,
  plateEdge: 0x7e9cc6,
  steel: 0x8b9097,
  bench: 0x3b3f45,
  box: 0xc9b48f,
};

type V = THREE.Vector3;
const tv = (p: Vec3, out = new THREE.Vector3()) => out.set(p[0], p[1], p[2]);
const UP = new THREE.Vector3(0, 1, 0);

function m4From(R: Mat3, pos: Vec3) {
  const m = new THREE.Matrix4();
  m.set(R[0], R[1], R[2], pos[0], R[3], R[4], R[5], pos[1], R[6], R[7], R[8], pos[2], 0, 0, 0, 1);
  return m;
}

class Bone {
  shaft: THREE.Mesh;
  a?: THREE.Mesh;
  b?: THREE.Mesh;
  constructor(group: THREE.Group, mat: THREE.Material, knobMat: THREE.Material, r0: number, r1: number, knobA: number, knobB: number) {
    const g = new THREE.CylinderGeometry(r1, r0, 1, 10, 1);
    g.translate(0, 0.5, 0);
    this.shaft = new THREE.Mesh(g, mat);
    this.shaft.castShadow = true;
    group.add(this.shaft);
    if (knobA > 0) {
      this.a = new THREE.Mesh(new THREE.SphereGeometry(knobA, 14, 10), knobMat);
      this.a.castShadow = true;
      group.add(this.a);
    }
    if (knobB > 0) {
      this.b = new THREE.Mesh(new THREE.SphereGeometry(knobB, 14, 10), knobMat);
      this.b.castShadow = true;
      group.add(this.b);
    }
  }
  set(a: V, b: V) {
    const d = new THREE.Vector3().subVectors(b, a);
    const L = d.length();
    this.shaft.position.copy(a);
    if (L > 1e-6) this.shaft.quaternion.setFromUnitVectors(UP, d.multiplyScalar(1 / L));
    this.shaft.scale.set(1, Math.max(L, 1e-4), 1);
    this.a?.position.copy(a);
    this.b?.position.copy(b);
  }
  visible(v: boolean) {
    this.shaft.visible = v;
    if (this.a) this.a.visible = v;
    if (this.b) this.b.visible = v;
  }
}

/** 손가락·발가락 같은 작은 뼈: 인스턴스 메시 하나로 그린다 */
class SmallBones {
  cyl: THREE.InstancedMesh;
  sph: THREE.InstancedMesh;
  private n = 0;
  private m = 0;
  private q = new THREE.Quaternion();
  private mx = new THREE.Matrix4();
  private sc = new THREE.Vector3();
  private d = new THREE.Vector3();
  constructor(group: THREE.Group, mat: THREE.Material, knob: THREE.Material, cap: number) {
    const g = new THREE.CylinderGeometry(1, 1, 1, 8, 1);
    g.translate(0, 0.5, 0);
    this.cyl = new THREE.InstancedMesh(g, mat, cap);
    this.sph = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 10, 8), knob, cap * 2);
    this.cyl.castShadow = this.sph.castShadow = true;
    this.cyl.frustumCulled = this.sph.frustumCulled = false;
    group.add(this.cyl, this.sph);
  }
  begin() {
    this.n = 0;
    this.m = 0;
  }
  bone(a: V, b: V, r: number, knobA = 1.3, knobB = 1.3) {
    if (this.n >= this.cyl.count && this.n >= (this.cyl.instanceMatrix.count ?? 0)) return;
    this.d.subVectors(b, a);
    const L = Math.max(1e-4, this.d.length());
    this.q.setFromUnitVectors(UP, this.d.multiplyScalar(1 / L));
    this.mx.compose(a, this.q, this.sc.set(r, L, r));
    this.cyl.setMatrixAt(this.n++, this.mx);
    if (knobA > 0) this.ball(a, r * knobA);
    if (knobB > 0) this.ball(b, r * knobB);
  }
  ball(p: V, r: number) {
    if (this.m >= this.sph.instanceMatrix.count) return;
    this.mx.compose(p, this.q.identity(), this.sc.set(r, r, r));
    this.sph.setMatrixAt(this.m++, this.mx);
  }
  end() {
    this.cyl.count = this.n;
    this.sph.count = this.m;
    this.cyl.instanceMatrix.needsUpdate = true;
    this.sph.instanceMatrix.needsUpdate = true;
  }
}

/** 축(axis)에 수직인 굽힘 방향(toward)으로 dir 을 각도만큼 돌린다 → [새 방향, 새 굽힘 방향] */
function bend(dir: V, toward: V, deg: number): [V, V] {
  const a = (deg * Math.PI) / 180;
  const t = toward.clone().sub(dir.clone().multiplyScalar(toward.dot(dir))).normalize();
  const nd = dir.clone().multiplyScalar(Math.cos(a)).addScaledVector(t, Math.sin(a)).normalize();
  const nt = t.clone().multiplyScalar(Math.cos(a)).addScaledVector(dir, -Math.sin(a)).normalize();
  return [nd, nt];
}

export interface LabelPoint {
  key: string;
  x: number;
  y: number;
  visible: boolean;
}

export interface RigOptions {
  dark?: boolean;
  skin?: boolean;
  risk?: boolean;
  ghost: boolean;
  trails: boolean;
  overlays: boolean;
}

export class Rig {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  root = new THREE.Group();
  skel = new THREE.Group();
  gear = new THREE.Group();
  over = new THREE.Group();
  ghost = new THREE.Group();
  trails = new THREE.Group();
  surfaces = new THREE.Group();
  H = 1.75;
  small!: SmallBones;
  anat!: Anatomy;
  private ground!: THREE.Mesh;
  private grid!: THREE.GridHelper;
  private hemi!: THREE.HemisphereLight;
  private dark = false;
  mats: Record<string, THREE.Material>;
  comBall: THREE.Mesh;
  comLine: THREE.Line;
  comRing: THREE.Mesh;
  bos: THREE.LineLoop;
  footBars: Record<string, { bar: THREE.Mesh; axis: THREE.Line; dot: THREE.Mesh }> = {};
  kneeMarks: Record<string, { toe: THREE.Line; knee: THREE.Line }> = {};
  pelvisLine: THREE.Line;
  ghostLines: THREE.LineSegments;
  bar: THREE.Group;
  db: THREE.Group;
  ball: THREE.Mesh;
  kb: THREE.Group;
  plateW: THREE.Mesh;
  private riskSpots: { mesh: THREE.Mesh; region: string; side: "L" | "R" | "C"; at: (f: LiteFrame) => THREE.Vector3 }[] = [];
  private riskLevels: Record<string, { level: string; side?: string }> = {};
  private riskGroup = new THREE.Group();
  private raf = 0;
  private targetGoal = new THREE.Vector3(0, 0.9, 0);
  private camGoal: THREE.Vector3 | null = null;
  private follow = false;
  private lastLoadKey = "";
  private surfKey = "";
  private disposed = false;

  constructor(private host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: false });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.setClearColor(0xf6f4ef, 1);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    host.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.display = "block";
    this.camera = new THREE.PerspectiveCamera(32, 1, 0.05, 60);
    this.camera.position.set(3.2, 1.6, 4.2);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.minDistance = 1.2;
    this.controls.maxDistance = 14;
    this.controls.maxPolarAngle = Math.PI * 0.495;
    this.controls.addEventListener("start", () => (this.camGoal = null));

    // 조명
    this.hemi = new THREE.HemisphereLight(0xffffff, 0xcfc8b8, 1.15);
    this.scene.add(this.hemi);
    const sun = new THREE.DirectionalLight(0xffffff, 1.35);
    sun.position.set(2.5, 5, 3.5);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -3;
    sun.shadow.camera.right = 3;
    sun.shadow.camera.top = 3;
    sun.shadow.camera.bottom = -3;
    sun.shadow.radius = 4;
    sun.shadow.bias = -0.0005;
    this.scene.add(sun);
    this.scene.add(sun.target);

    // 바닥
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshStandardMaterial({ color: C.ground, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);
    this.ground = ground;
    const grid = new THREE.GridHelper(40, 80, C.grid, C.grid);
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.55;
    grid.position.y = 0.001;
    this.scene.add(grid);
    this.grid = grid;

    this.mats = {
      bone: new THREE.MeshStandardMaterial({ color: C.bone, roughness: 0.58, metalness: 0.02 }),
      knob: new THREE.MeshStandardMaterial({ color: C.knob, roughness: 0.65 }),
      shade: new THREE.MeshStandardMaterial({ color: C.boneShade, roughness: 0.8 }),
      dark: new THREE.MeshStandardMaterial({ color: 0x2b2a27, roughness: 0.9 }),
      steel: new THREE.MeshStandardMaterial({ color: C.steel, metalness: 0.55, roughness: 0.35 }),
      plate: new THREE.MeshStandardMaterial({ color: C.plate, transparent: true, opacity: 0.42, roughness: 0.25, depthWrite: false, side: THREE.DoubleSide }),
      iron: new THREE.MeshStandardMaterial({ color: 0x45484d, metalness: 0.3, roughness: 0.5 }),
      ball: new THREE.MeshStandardMaterial({ color: 0x6e5a43, roughness: 0.9 }),
    };

    this.scene.add(this.root);
    this.root.add(this.skel, this.gear, this.over, this.ghost, this.trails, this.surfaces);

    this.small = new SmallBones(this.skel, this.mats.bone, this.mats.knob, 140);
    this.anat = new Anatomy({
      bone: this.mats.bone,
      cart: new THREE.MeshStandardMaterial({ color: 0xc9d4d8, roughness: 0.45, transparent: true, opacity: 0.92 }),
      dark: this.mats.dark,
      tooth: new THREE.MeshStandardMaterial({ color: 0xf3efe2, roughness: 0.35 }),
      skin: skinMaterial(0x9fb0c0),
    });
    this.skel.add(this.anat.group);

    // 오버레이
    this.comBall = new THREE.Mesh(new THREE.SphereGeometry(0.022, 18, 12), new THREE.MeshBasicMaterial({ color: C.com, depthTest: false }));
    this.comBall.renderOrder = 10;
    const lg = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 1, 0)]);
    this.comLine = new THREE.Line(lg, new THREE.LineDashedMaterial({ color: C.com, dashSize: 0.035, gapSize: 0.022, depthTest: false }));
    this.comLine.renderOrder = 9;
    this.comRing = new THREE.Mesh(new THREE.RingGeometry(0.03, 0.042, 32), new THREE.MeshBasicMaterial({ color: C.com, side: THREE.DoubleSide }));
    this.comRing.rotation.x = -Math.PI / 2;
    this.bos = new THREE.LineLoop(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: C.com, transparent: true, opacity: 0.55 }));
    this.pelvisLine = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: C.com, depthTest: false }));
    this.pelvisLine.renderOrder = 9;
    this.over.add(this.comBall, this.comLine, this.comRing, this.bos, this.pelvisLine);
    for (const k of ["L", "R"]) {
      const col = k === "L" ? C.left : C.right;
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 1, 8).translate(0, 0.5, 0), new THREE.MeshBasicMaterial({ color: col }));
      const axis = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: 0.8 }));
      const dot = new THREE.Mesh(new THREE.CircleGeometry(0.018, 20), new THREE.MeshBasicMaterial({ color: col, side: THREE.DoubleSide }));
      dot.rotation.x = -Math.PI / 2;
      this.footBars[k] = { bar, axis, dot };
      this.over.add(bar, axis, dot);
      const toe = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: C.toe, depthTest: false }));
      const knee = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: C.knee, depthTest: false }));
      toe.renderOrder = knee.renderOrder = 9;
      this.kneeMarks[k] = { toe, knee };
      this.over.add(toe, knee);
    }
    this.ghostLines = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: C.ghost, transparent: true, opacity: 0.55 }));
    this.ghost.add(this.ghostLines);

    // 기구
    this.bar = new THREE.Group();
    this.db = new THREE.Group();
    this.kb = new THREE.Group();
    this.ball = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), this.mats.ball);
    this.ball.castShadow = true;
    this.plateW = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.03, 28), this.mats.iron);
    this.gear.add(this.bar, this.db, this.kb, this.ball, this.plateW);
    this.buildKettlebell();

    this.root.add(this.riskGroup);
    const P = (k: keyof Joints) => (f: LiteFrame) => tv(f.j[k]);
    const mid = (a: keyof Joints, b: keyof Joints, u: number) => (f: LiteFrame) => tv(f.j[a]).lerp(tv(f.j[b]), u);
    const spot = (region: string, side: "L" | "R" | "C", at: (f: LiteFrame) => THREE.Vector3, r: number) => {
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(r, 20, 14),
        new THREE.MeshBasicMaterial({ color: 0xc8402a, transparent: true, opacity: 0.4, depthWrite: false }),
      );
      mesh.renderOrder = 8;
      this.riskGroup.add(mesh);
      this.riskSpots.push({ mesh, region, side, at });
    };
    spot("lumbar", "C", mid("l5", "t12", 0.5), 0.075);
    for (const k of ["L", "R"] as const) {
      spot("knee", k, P(`knee${k}`), 0.055);
      spot("ankle", k, mid(`ankle${k}`, `heel${k}`, 0.4), 0.048);
      spot("hip", k, P(`hip${k}`), 0.06);
      spot("hamstring", k, mid(`hip${k}`, `knee${k}`, 0.5), 0.065);
      spot("shoulder", k, P(`sh${k}`), 0.055);
      spot("elbowWrist", k, P(`el${k}`), 0.04);
      spot("elbowWrist", k, P(`wr${k}`), 0.035);
    }
    this.resize();
    this.loop();
  }

  /** 부위별 위험 수준 (low 는 표시 안 함) */
  setRisk(list: { region: string; level: string; side?: string }[] | undefined) {
    this.riskLevels = {};
    for (const r of list ?? []) this.riskLevels[r.region] = { level: r.level, side: r.side };
  }

  private updateRisk(f: LiteFrame, on: boolean) {
    this.riskGroup.visible = on;
    if (!on) return;
    const pulse = 0.85 + 0.15 * Math.sin(performance.now() / 260);
    for (const s of this.riskSpots) {
      const r = this.riskLevels[s.region];
      const show = !!r && r.level !== "low" && (s.side === "C" || !r.side || r.side === "both" || r.side === s.side);
      s.mesh.visible = show;
      if (!show) continue;
      s.mesh.position.copy(s.at(f));
      const mat = s.mesh.material as THREE.MeshBasicMaterial;
      mat.color.setHex(r.level === "high" ? 0xd9432b : 0xe0a21e);
      mat.opacity = (r.level === "high" ? 0.5 : 0.36) * pulse;
      s.mesh.scale.setScalar((this.H / 1.75) * (r.level === "high" ? 1.15 : 0.95) * pulse);
    }
  }

  setBody(H: number, bmi = 22) {
    this.H = H;
    this.anat.setGirth(bmi);
    this.anat.invalidate();
  }

  /** 해부 모드: 어두운 배경 + 반투명 피부 */
  setLook(dark: boolean, skin: boolean) {
    this.anat.setSkin(skin);
    if (dark === this.dark) return;
    this.dark = dark;
    this.renderer.setClearColor(dark ? 0x0c0f13 : 0xf6f4ef, 1);
    (this.ground.material as THREE.MeshStandardMaterial).color.setHex(dark ? 0x14181d : C.ground);
    const gm = this.grid.material as THREE.LineBasicMaterial;
    gm.color.setHex(dark ? 0x262d35 : C.grid);
    gm.opacity = dark ? 0.8 : 0.55;
    this.hemi.groundColor.setHex(dark ? 0x30343a : 0xcfc8b8);
    this.hemi.intensity = dark ? 0.95 : 1.15;
  }

  /** 손을 쥐고 있는지 (바·덤벨·케틀벨·철봉) */
  private gripping(f: LiteFrame, k: "L" | "R") {
    const g = tv(f.j[`grip${k}`]);
    const L = f.load;
    if (L && L.carried && !L.released) {
      if (L.kind === "dumbbell") return 1;
      if (L.kind === "barbell" && !L.onBody) return Math.hypot(g.y - L.center[1], g.z - L.center[2]) < 0.07 ? 1 : 0;
      if (L.kind === "barbell" && L.onBody) return Math.hypot(g.y - L.center[1], g.z - L.center[2]) < 0.09 ? 0.85 : 0;
      if (L.kind === "kettlebell") return g.distanceTo(tv(L.center)) < 0.3 ? 1 : 0;
      if (L.kind === "medball" || L.kind === "handball") return g.distanceTo(tv(L.center)) < 0.3 ? 0.45 : 0;
    }
    for (const sf of f.surfaces ?? []) if (sf.kind === "bar" && Math.abs(g.y - sf.center[1]) < 0.06) return 1;
    return 0;
  }

  private drawHand(f: LiteFrame, k: "L" | "R") {
    const sc = this.H / 1.75;
    const s = k === "L" ? 1 : -1;
    const wr = tv(f.j[`wr${k}`]),
      fi = tv(f.j[`fing${k}`]);
    const L = Math.max(0.05, wr.distanceTo(fi));
    const Rt = f.R.thorax;
    const fwd = new THREE.Vector3(Rt[2], Rt[5], Rt[8]);
    const flat = f.contacts.some((c) => c.id === `hand${k}`) && wr.y < 0.12;
    let d: V, w: V, n: V;
    if (flat) {
      // 바닥을 짚은 손: 손바닥이 바닥, 손가락은 앞으로
      d = new THREE.Vector3(fwd.x, 0, fwd.z);
      if (d.lengthSq() < 1e-4) d.set(0, 0, 1);
      d.normalize();
      n = new THREE.Vector3(0, -1, 0);
      w = new THREE.Vector3().crossVectors(d, n).normalize().multiplyScalar(-s);
    } else {
      d = new THREE.Vector3().subVectors(fi, wr).normalize();
      w = fwd.clone().sub(d.clone().multiplyScalar(fwd.dot(d)));
      if (w.lengthSq() < 1e-4) w.set(Rt[0] * s, Rt[3] * s, Rt[6] * s);
      w.normalize();
      n = new THREE.Vector3().crossVectors(d, w).normalize().multiplyScalar(s);
    }
    const grip = flat ? 0 : this.gripping(f, k);
    const curl = [12 + 50 * grip, 16 + 58 * grip, 10 + 34 * grip];
    const pw = 0.046 * this.H; // 손바닥 너비
    const palm = 0.44 * L;
    const offs = [0.36, 0.12, -0.12, -0.36];
    const lens = [0.92, 1.0, 0.94, 0.74];
    const segs = [0.46, 0.31, 0.23];
    const rad = [0.0047, 0.005, 0.0046, 0.004];
    for (let i = 0; i < 4; i++) {
      const base = wr.clone().addScaledVector(d, 0.012 * sc).addScaledVector(w, offs[i] * pw * 0.45);
      const knuckle = wr.clone().addScaledVector(d, palm * (i === 3 ? 0.9 : 1)).addScaledVector(w, offs[i] * pw);
      this.small.bone(base, knuckle, rad[i] * sc, 1.2, 1.35);
      let p = knuckle,
        dir = d.clone(),
        tw = n.clone();
      const fl = (L - palm) * lens[i];
      for (let j = 0; j < 3; j++) {
        [dir, tw] = bend(dir, tw, curl[j]);
        const q = p.clone().addScaledVector(dir, fl * segs[j]);
        this.small.bone(p, q, rad[i] * sc * (1 - j * 0.18), 0, 1.25);
        p = q;
      }
    }
    // 엄지
    const tb = wr.clone().addScaledVector(d, 0.01 * sc).addScaledVector(w, 0.3 * pw);
    let tdir = d.clone().multiplyScalar(0.55).addScaledVector(w, 0.75).addScaledVector(n, 0.35).normalize();
    let ttw = n.clone();
    const tl = [0.24 * L, 0.18 * L, 0.14 * L];
    let tp = tb;
    for (let j = 0; j < 3; j++) {
      if (j > 0) [tdir, ttw] = bend(tdir, ttw, 8 + 32 * grip);
      const q = tp.clone().addScaledVector(tdir, tl[j]);
      this.small.bone(tp, q, (j === 0 ? 0.0055 : 0.0048) * sc, j === 0 ? 1.2 : 0, 1.25);
      tp = q;
    }
    // 손목뼈 덩어리
    this.small.ball(wr.clone().addScaledVector(d, 0.018 * sc), 0.011 * sc);
  }

  private drawFoot(f: LiteFrame, k: "L" | "R") {
    const sc = this.H / 1.75;
    const s = k === "L" ? 1 : -1;
    const Rf = k === "L" ? f.R.footL : f.R.footR;
    const lat = new THREE.Vector3(Rf[0], Rf[3], Rf[6]).multiplyScalar(s).normalize(); // 바깥쪽
    const up = new THREE.Vector3(Rf[1], Rf[4], Rf[7]).normalize();
    const ank = tv(f.j[`ankle${k}`]),
      ball = tv(f.j[`ball${k}`]),
      toe = tv(f.j[`toe${k}`]),
      heel = tv(f.j[`heel${k}`]);
    const FL = heel.distanceTo(toe);
    const fw = 0.36 * FL;
    const toeDir = new THREE.Vector3().subVectors(toe, ball);
    const tlen = Math.max(0.02, toeDir.length());
    toeDir.normalize();
    const mid = ank.clone().lerp(ball, 0.32).addScaledVector(up, -0.012 * sc);
    // 엄지(안쪽) → 새끼(바깥쪽)
    const offs = [-0.46, -0.2, 0.02, 0.22, 0.42];
    const back = [0, 0.01, 0.02, 0.035, 0.055];
    const tl = [1.0, 0.82, 0.74, 0.66, 0.56];
    const rad = [0.0075, 0.0055, 0.0052, 0.005, 0.0048];
    for (let i = 0; i < 5; i++) {
      const head = ball.clone().addScaledVector(lat, offs[i] * fw).addScaledVector(toeDir, -back[i] * FL);
      const base = mid.clone().addScaledVector(lat, offs[i] * fw * 0.55);
      this.small.bone(base, head, rad[i] * sc, 1.15, 1.35);
      const L = tlen * tl[i];
      const n = i === 0 ? 2 : 3;
      let p = head;
      let dir = toeDir.clone(),
        tw = up.clone().multiplyScalar(-1);
      for (let j = 0; j < n; j++) {
        if (j > 0) [dir, tw] = bend(dir, tw, 10);
        const q = p.clone().addScaledVector(dir, (L / n) * (j === 0 ? 1.2 : 0.9));
        this.small.bone(p, q, rad[i] * sc * 0.8, 0, 1.2);
        p = q;
      }
    }
    // 발목뼈(거골·주상골) 덩어리
    this.small.ball(ank.clone().addScaledVector(up, -0.01 * sc), 0.016 * sc);
    this.small.ball(ank.clone().lerp(ball, 0.25).addScaledVector(up, -0.02 * sc), 0.014 * sc);
  }

  private buildKettlebell() {
    const body = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), this.mats.iron);
    body.castShadow = true;
    const handle = new THREE.Mesh(new THREE.TorusGeometry(0.75, 0.12, 8, 20, Math.PI), this.mats.iron);
    handle.position.y = 0.75;
    this.kb.add(body, handle);
  }

  private buildBarbell(mass: number) {
    this.bar.clear();
    const steel = this.mats.steel;
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 2.2, 12), steel);
    shaft.rotation.z = Math.PI / 2;
    shaft.castShadow = true;
    this.bar.add(shaft);
    for (const sgn of [1, -1]) {
      const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.42, 14), steel);
      sleeve.rotation.z = Math.PI / 2;
      sleeve.position.x = sgn * 0.88;
      const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.03, 16), steel);
      collar.rotation.z = Math.PI / 2;
      collar.position.x = sgn * 0.66;
      this.bar.add(sleeve, collar);
    }
    // 원판: 20kg 바 제외 양쪽 무게
    let side = Math.max(0, (mass - 20) / 2);
    const plates: number[] = [];
    for (const p of [25, 20, 15, 10, 5, 2.5, 1.25]) {
      while (side >= p - 1e-6 && plates.length < 10) {
        plates.push(p);
        side -= p;
      }
    }
    const radius = (p: number) => (p >= 10 ? 0.225 : p >= 5 ? 0.115 : 0.085);
    const thick = (p: number) => (p >= 20 ? 0.055 : p >= 10 ? 0.04 : 0.025);
    for (const sgn of [1, -1]) {
      let x = 0.68;
      for (const p of plates) {
        const t = thick(p);
        const g = new THREE.CylinderGeometry(radius(p), radius(p), t, 40);
        const m = new THREE.Mesh(g, this.mats.plate);
        m.rotation.z = Math.PI / 2;
        m.position.x = sgn * (x + t / 2);
        const e = new THREE.LineSegments(new THREE.EdgesGeometry(g, 30), new THREE.LineBasicMaterial({ color: C.plateEdge, transparent: true, opacity: 0.8 }));
        e.rotation.z = Math.PI / 2;
        e.position.copy(m.position);
        this.bar.add(m, e);
        x += t + 0.004;
      }
    }
  }

  private buildDumbbell(mass: number) {
    this.db.clear();
    const each = Math.max(1, mass / 2);
    const r = 0.045 + Math.min(0.06, each * 0.0022);
    for (const k of [0, 1]) {
      const g = new THREE.Group();
      const h = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.14, 10), this.mats.steel);
      h.rotation.z = Math.PI / 2;
      g.add(h);
      for (const sgn of [1, -1]) {
        const head = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.05, 14), this.mats.iron);
        head.rotation.z = Math.PI / 2;
        head.position.x = sgn * 0.095;
        head.castShadow = true;
        g.add(head);
      }
      g.name = `db${k}`;
      this.db.add(g);
    }
  }

  setSurfaces(list: Surface[] | undefined) {
    const key = JSON.stringify(list ?? []);
    if (key === this.surfKey) return;
    this.surfKey = key;
    this.surfaces.clear();
    for (const s of list ?? []) {
      if (s.kind === "line") {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(s.size[0], s.size[2]), new THREE.MeshBasicMaterial({ color: 0x55524c }));
        m.rotation.x = -Math.PI / 2;
        m.position.set(s.center[0], 0.003, s.center[2]);
        this.surfaces.add(m);
        continue;
      }
      if (s.kind === "bar") {
        const m = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, s.size[0], 12), this.mats.steel);
        m.rotation.z = Math.PI / 2;
        m.position.set(s.center[0], s.center[1], s.center[2]);
        this.surfaces.add(m);
        for (const sgn of [1, -1]) {
          const post = new THREE.Mesh(new THREE.BoxGeometry(0.05, s.center[1], 0.05), this.mats.iron);
          post.position.set(sgn * (s.size[0] / 2), s.center[1] / 2, s.center[2]);
          this.surfaces.add(post);
        }
        continue;
      }
      const color = s.kind === "bench" ? C.bench : s.kind === "platform" ? 0x55595f : C.box;
      const m = new THREE.Mesh(new THREE.BoxGeometry(s.size[0], s.size[1], s.size[2]), new THREE.MeshStandardMaterial({ color, roughness: 0.85 }));
      m.position.set(s.center[0], s.center[1], s.center[2]);
      m.castShadow = true;
      m.receiveShadow = true;
      this.surfaces.add(m);
    }
  }

  /** 프레임 표시. ghost = 표준 체형 같은 시점 프레임 */
  setFrame(f: LiteFrame, ghost: LiteFrame | undefined, opt: RigOptions, trails?: { com: Vec3[]; bar?: Vec3[] }) {
    if (this.disposed) return;
    const j = f.j;
    const H = this.H;
    this.anat.update(f, H);
    this.small.begin();
    for (const k of ["L", "R"] as const) {
      this.drawHand(f, k);
      this.drawFoot(f, k);
    }
    this.small.end();
    void j;

    this.setLook(opt.dark ?? true, opt.skin ?? true);
    this.updateGear(f);
    this.updateRisk(f, opt.risk ?? true);
    this.setSurfaces(f.surfaces);
    this.updateOverlays(f, opt);
    this.updateGhost(ghost, opt.ghost);
    this.updateTrails(trails, opt.trails);
    if (this.follow) {
      // 카메라가 무게중심을 따라 평행 이동 (시점 각도 유지)
      const want = new THREE.Vector3(f.com[0] * 0.6, this.targetGoal.y, f.com[2]);
      const delta = want.sub(this.targetGoal);
      this.targetGoal.add(delta);
      this.camera.position.add(delta);
      this.controls.target.add(delta);
      this.camGoal?.add(delta);
    }
  }

  private updateGear(f: LiteFrame) {
    const L = f.load;
    this.bar.visible = this.db.visible = this.kb.visible = this.ball.visible = this.plateW.visible = false;
    if (!L || L.mass <= 0) return;
    const key = `${L.kind}:${Math.round(L.mass * 4)}`;
    if (key !== this.lastLoadKey) {
      this.lastLoadKey = key;
      if (L.kind === "barbell") this.buildBarbell(L.mass);
      if (L.kind === "dumbbell") this.buildDumbbell(L.mass);
    }
    const c = tv(L.center);
    if (L.kind === "barbell") {
      this.bar.visible = true;
      this.bar.position.copy(c);
    } else if (L.kind === "dumbbell") {
      this.db.visible = true;
      this.db.children.forEach((g, i) => {
        const k = i === 0 ? "L" : "R";
        const gp = tv(f.j[`grip${k}`]);
        const fd = new THREE.Vector3().subVectors(tv(f.j[`fing${k}`]), tv(f.j[`wr${k}`])).normalize();
        g.position.copy(gp);
        const fw = new THREE.Vector3(f.R.thorax[2], 0, f.R.thorax[8]);
        if (fw.lengthSq() < 1e-4) fw.set(0, 0, 1);
        void fd;
        g.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), fw.normalize());
      });
    } else if (L.kind === "kettlebell") {
      this.kb.visible = true;
      const r = 0.07 + Math.min(0.05, L.mass * 0.0012);
      this.kb.scale.setScalar(r);
      this.kb.position.copy(c);
    } else if (L.kind === "medball" || L.kind === "handball") {
      this.ball.visible = true;
      this.ball.scale.setScalar(L.kind === "medball" ? 0.1 + Math.min(0.04, L.mass * 0.008) : 0.09);
      this.ball.position.copy(c);
    } else if (L.kind === "plate") {
      this.plateW.visible = true;
      this.plateW.position.copy(c);
    }
  }

  private updateOverlays(f: LiteFrame, opt: RigOptions) {
    this.over.visible = opt.overlays;
    if (!opt.overlays) return;
    const com = tv(f.com);
    const gy = f.contacts.length && f.contacts[0].pts.length ? Math.min(...f.contacts.flatMap((c) => c.pts.map((p) => p[1]))) : 0;
    this.comBall.position.copy(com);
    const pos = this.comLine.geometry.attributes.position as THREE.BufferAttribute;
    pos.setXYZ(0, com.x, com.y, com.z);
    pos.setXYZ(1, com.x, Math.max(0, gy) + 0.002, com.z);
    pos.needsUpdate = true;
    this.comLine.computeLineDistances();
    this.comRing.position.set(com.x, Math.max(0, gy) + 0.003, com.z);
    // 지지면 (발만)
    const feetPts = f.contacts.filter((c) => c.group !== "body").flatMap((c) => c.pts.map((p) => [p[0], p[2], p[1]] as [number, number, number]));
    const hull = convexHull(feetPts.map((p) => [p[0], p[1]] as [number, number]));
    const yH = feetPts.length ? Math.min(...feetPts.map((p) => p[2])) + 0.004 : 0.004;
    setPts(this.bos, hull.map(([x, z]) => new THREE.Vector3(x, yH, z)));
    this.bos.visible = hull.length >= 3;
    // 발 하중 막대
    for (const k of ["L", "R"] as const) {
      const fb = this.footBars[k];
      const ld = f.loads.find((l) => l.id === k);
      const on = !!ld && ld.share > 0.001;
      fb.bar.visible = fb.dot.visible = fb.axis.visible = on;
      if (!on || !ld) continue;
      const cop = tv(ld.cop);
      fb.bar.position.set(cop.x, cop.y + 0.004, cop.z);
      fb.bar.scale.set(1, Math.max(0.005, ld.share * 0.42), 1);
      fb.dot.position.set(cop.x, cop.y + 0.005, cop.z);
      const heel = tv(f.j[`heel${k}`]),
        toe = tv(f.j[`toe${k}`]);
      setPts(fb.axis, [new THREE.Vector3(heel.x, cop.y + 0.004, heel.z), new THREE.Vector3(toe.x, cop.y + 0.004, toe.z)]);
    }
    // 무릎 방향 표시: 보라 = 발끝 방향, 빨강 = 무릎 이동 방향
    for (const k of ["L", "R"] as const) {
      const km = this.kneeMarks[k];
      const knee = tv(f.j[`knee${k}`]);
      const Rf = k === "L" ? f.R.footL : f.R.footR;
      const fwd = new THREE.Vector3(Rf[2], 0, Rf[8]).normalize();
      const thigh = new THREE.Vector3().subVectors(knee, tv(f.j[`hip${k}`]));
      const shank = new THREE.Vector3().subVectors(tv(f.j[`ankle${k}`]), knee);
      const kneeDir = new THREE.Vector3().subVectors(thigh.clone().normalize(), shank.clone().normalize());
      kneeDir.y = 0;
      const show = kneeDir.lengthSq() > 0.02;
      km.toe.visible = km.knee.visible = show;
      if (!show) continue;
      kneeDir.normalize();
      const L = 0.09 * (this.H / 1.75);
      setPts(km.toe, [knee, knee.clone().addScaledVector(fwd, L)]);
      setPts(km.knee, [knee, knee.clone().addScaledVector(kneeDir, L)]);
    }
    const hl = tv(f.j.hipL),
      hr = tv(f.j.hipR);
    const ext = new THREE.Vector3().subVectors(hl, hr).multiplyScalar(0.45);
    setPts(this.pelvisLine, [hl.clone().add(ext), hr.clone().sub(ext)]);
  }

  private updateGhost(g: LiteFrame | undefined, on: boolean) {
    this.ghost.visible = on && !!g;
    if (!on || !g) return;
    const j = g.j;
    const pairs: [keyof Joints, keyof Joints][] = [
      ["hipL", "kneeL"],
      ["kneeL", "ankleL"],
      ["ankleL", "heelL"],
      ["heelL", "toeL"],
      ["hipR", "kneeR"],
      ["kneeR", "ankleR"],
      ["ankleR", "heelR"],
      ["heelR", "toeR"],
      ["hipL", "hipR"],
      ["pelvis", "l5"],
      ["l5", "t12"],
      ["t12", "c7"],
      ["c7", "head"],
      ["head", "headTop"],
      ["shL", "shR"],
      ["shL", "elL"],
      ["elL", "wrL"],
      ["wrL", "fingL"],
      ["shR", "elR"],
      ["elR", "wrR"],
      ["wrR", "fingR"],
    ];
    const pts: THREE.Vector3[] = [];
    for (const [a, b] of pairs) pts.push(tv(j[a]), tv(j[b]));
    setPts(this.ghostLines, pts);
  }

  private updateTrails(tr: { com: Vec3[]; bar?: Vec3[] } | undefined, on: boolean) {
    this.trails.visible = on && !!tr;
    if (!on || !tr) return;
    this.trails.clear();
    const add = (ps: Vec3[], color: number) => {
      if (ps.length < 2) return;
      const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(ps.map((p) => tv(p))), new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.7 }));
      this.trails.add(l);
    };
    add(tr.com, C.com);
    if (tr.bar) add(tr.bar, C.left);
  }

  /** 카메라 프리셋. yaw: 정면 0, 피험자 오른쪽 측면 90 */
  view(preset: "front" | "side" | "oblique" | "top" | "back", H: number, center?: Vec3) {
    const tgt = new THREE.Vector3(center?.[0] ?? 0, 0.5 * H, center?.[2] ?? 0);
    const dist = (preset === "top" ? 3.0 : 2.55) * H;
    const yaw = { front: 0, side: 90, oblique: 38, top: 20, back: 180 }[preset];
    const elev = { front: 8, side: 6, oblique: 16, top: 62, back: 10 }[preset];
    const a = (-yaw * Math.PI) / 180,
      e = (elev * Math.PI) / 180;
    this.targetGoal.copy(tgt);
    this.camGoal = new THREE.Vector3(tgt.x + dist * Math.sin(a) * Math.cos(e), tgt.y + dist * Math.sin(e), tgt.z + dist * Math.cos(a) * Math.cos(e));
  }

  setFollow(v: boolean) {
    this.follow = v;
  }

  resize() {
    const w = this.host.clientWidth || 600,
      h = this.host.clientHeight || 400;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = "100%";
    this.renderer.domElement.style.height = "100%";
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  project(p: Vec3): { x: number; y: number; visible: boolean } {
    const v = tv(p).project(this.camera);
    const w = this.host.clientWidth,
      h = this.host.clientHeight;
    return { x: ((v.x + 1) / 2) * w, y: ((1 - v.y) / 2) * h, visible: v.z < 1 && Math.abs(v.x) < 1.2 && Math.abs(v.y) < 1.2 };
  }

  private loop = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    this.controls.target.lerp(this.targetGoal, 0.12);
    if (this.camGoal) {
      this.camera.position.lerp(this.camGoal, 0.14);
      if (this.camera.position.distanceTo(this.camGoal) < 0.01) this.camGoal = null;
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };

  snapshot(): string {
    this.renderer.render(this.scene, this.camera);
    return this.renderer.domElement.toDataURL("image/png");
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.controls.dispose();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
    });
    for (const m of Object.values(this.mats)) m.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

/** 점 개수가 바뀌면 three 의 setFromPoints 가 기존 버퍼를 넘어 읽으므로 새 버퍼로 교체 */
function setPts(obj: THREE.Line | THREE.LineSegments | THREE.LineLoop, pts: THREE.Vector3[]) {
  const cur = obj.geometry.getAttribute("position") as THREE.BufferAttribute | undefined;
  if (!cur || cur.count !== pts.length) {
    obj.geometry.dispose();
    obj.geometry = new THREE.BufferGeometry().setFromPoints(pts);
  } else obj.geometry.setFromPoints(pts);
}

function convexHull(pts: [number, number][]): [number, number][] {
  const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cr = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo: [number, number][] = [];
  for (const q of p) {
    while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop();
    lo.push(q);
  }
  const up: [number, number][] = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop();
    up.push(q);
  }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}
