// three.js 장면: 해부학 골격 + 기구 + 분석 오버레이
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { Mat3, Vec3 } from "@/lib/biomech/math";
import type { Joints } from "@/lib/biomech/pose";
import type { Surface } from "@/lib/biomech/types";
import type { LiteFrame } from "./transfer";

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

export interface LabelPoint {
  key: string;
  x: number;
  y: number;
  visible: boolean;
}

export interface RigOptions {
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
  bones: Record<string, Bone> = {};
  vert: THREE.InstancedMesh;
  ribs: THREE.Mesh[] = [];
  sternum: THREE.Mesh;
  pelvis: THREE.Group;
  skull: THREE.Group;
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
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xcfc8b8, 1.15));
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
    const grid = new THREE.GridHelper(40, 80, C.grid, C.grid);
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.55;
    grid.position.y = 0.001;
    this.scene.add(grid);

    this.mats = {
      bone: new THREE.MeshStandardMaterial({ color: C.bone, roughness: 0.72 }),
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

    this.vert = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), this.mats.knob, 26);
    this.vert.castShadow = true;
    this.skel.add(this.vert);
    for (let i = 0; i < 10; i++) {
      const arc = Math.PI * 1.72;
      const g = new THREE.TorusGeometry(1, 0.06, 5, 30, arc);
      g.rotateZ(Math.PI / 2 + (Math.PI * 2 - arc) / 2);
      g.rotateX(Math.PI / 2);
      const r = new THREE.Mesh(g, this.mats.bone);
      r.castShadow = true;
      this.ribs.push(r);
      this.skel.add(r);
    }
    this.sternum = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), this.mats.knob);
    this.skel.add(this.sternum);
    this.pelvis = new THREE.Group();
    this.skull = new THREE.Group();
    this.skel.add(this.pelvis, this.skull);

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

    this.resize();
    this.loop();
  }

  setBody(H: number) {
    if (Math.abs(H - this.H) < 1e-3 && Object.keys(this.bones).length) return;
    this.H = H;
    for (const b of Object.values(this.bones)) {
      this.skel.remove(b.shaft);
      if (b.a) this.skel.remove(b.a);
      if (b.b) this.skel.remove(b.b);
    }
    this.bones = {};
    const s = H / 1.75;
    const mk = (k: string, r0: number, r1: number, ka: number, kb: number, mat = this.mats.bone) =>
      (this.bones[k] = new Bone(this.skel, mat, this.mats.knob, r0 * s, r1 * s, ka * s, kb * s));
    for (const k of ["L", "R"]) {
      mk(`femur${k}`, 0.017, 0.0125, 0.026, 0.03);
      mk(`tibia${k}`, 0.0145, 0.011, 0.0, 0.017);
      mk(`fibula${k}`, 0.005, 0.005, 0.008, 0.008, this.mats.shade);
      mk(`calc${k}`, 0.017, 0.012, 0.018, 0);
      mk(`meta${k}`, 0.011, 0.0075, 0, 0.011);
      mk(`meta2${k}`, 0.007, 0.005, 0, 0.008);
      mk(`toes${k}`, 0.0065, 0.004, 0, 0.006);
      mk(`humerus${k}`, 0.012, 0.0095, 0.024, 0.018);
      mk(`radius${k}`, 0.0072, 0.0062, 0.0, 0.01);
      mk(`ulna${k}`, 0.0062, 0.0052, 0.012, 0, this.mats.shade);
      mk(`hand${k}`, 0.009, 0.004, 0.0, 0.006);
      mk(`clav${k}`, 0.0062, 0.0062, 0.008, 0.009);
      mk(`scap${k}`, 0.004, 0.022, 0, 0, this.mats.shade);
    }
    mk("neck", 0.011, 0.011, 0, 0, this.mats.knob);
    // 골반
    this.pelvis.clear();
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1, 0.14, 8, 34), this.mats.bone);
    ring.rotation.x = Math.PI / 2 + 0.35;
    ring.scale.set(0.072 * H, 0.05 * H, 0.072 * H);
    ring.position.set(0, 0.012 * H, 0.0);
    ring.castShadow = true;
    const wingG = new THREE.SphereGeometry(1, 18, 12, 0, Math.PI);
    for (const sgn of [1, -1]) {
      const w = new THREE.Mesh(wingG, this.mats.bone);
      w.scale.set(0.048 * H, 0.048 * H, 0.012 * H);
      w.rotation.set(0.15, sgn * 1.2, 0);
      w.position.set(sgn * 0.062 * H, 0.045 * H, -0.012 * H);
      w.castShadow = true;
      this.pelvis.add(w);
    }
    const sac = new THREE.Mesh(new THREE.ConeGeometry(0.03 * H, 0.07 * H, 10), this.mats.knob);
    sac.rotation.x = Math.PI;
    sac.position.set(0, 0.035 * H, -0.035 * H);
    this.pelvis.add(ring, sac);
    // 두개골
    this.skull.clear();
    const cran = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 20), this.mats.bone);
    cran.scale.set(0.05 * H, 0.056 * H, 0.06 * H);
    cran.position.set(0, 0.012 * H, -0.006 * H);
    cran.castShadow = true;
    const face = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), this.mats.bone);
    face.scale.set(0.038 * H, 0.036 * H, 0.03 * H);
    face.position.set(0, -0.02 * H, 0.03 * H);
    const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.052 * H, 0.016 * H, 0.04 * H), this.mats.knob);
    jaw.position.set(0, -0.045 * H, 0.03 * H);
    this.skull.add(cran, face, jaw);
    for (const sgn of [1, -1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.0115 * H, 12, 10), this.mats.dark);
      eye.position.set(sgn * 0.017 * H, -0.002 * H, 0.052 * H);
      this.skull.add(eye);
    }
    this.vert.geometry.dispose();
    this.vert.geometry = new THREE.BoxGeometry(0.028 * s, 0.016 * s, 0.024 * s);
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
    // 체형 정보가 오기 전에 첫 프레임이 그려질 수 있다 (빌드 환경에 따라 effect 순서가 다름)
    if (!Object.keys(this.bones).length) this.setBody(this.H);
    const j = f.j;
    const H = this.H;
    const P = (k: keyof Joints) => tv(j[k]);
    const B = this.bones;
    for (const k of ["L", "R"] as const) {
      const hip = P(`hip${k}`),
        knee = P(`knee${k}`),
        ank = P(`ankle${k}`),
        heel = P(`heel${k}`),
        ball = P(`ball${k}`),
        toe = P(`toe${k}`);
      B[`femur${k}`].set(hip, knee);
      B[`tibia${k}`].set(knee, ank);
      const Rf = k === "L" ? f.R.footL : f.R.footR;
      const lat = new THREE.Vector3(Rf[0], Rf[3], Rf[6]).multiplyScalar((k === "L" ? 1 : -1) * 0.022 * (H / 1.75));
      const k2 = knee.clone().lerp(ank, 0.06).add(lat);
      B[`fibula${k}`].set(k2, ank.clone().add(lat.clone().multiplyScalar(0.8)));
      B[`calc${k}`].set(heel.clone().lerp(ank, 0.15), ank.clone().lerp(ball, 0.2));
      B[`meta${k}`].set(ank.clone().lerp(ball, 0.15), ball);
      B[`meta2${k}`].set(ank.clone().lerp(ball, 0.3).add(lat.clone().multiplyScalar(0.9)), ball.clone().add(lat.clone().multiplyScalar(1.1)));
      B[`toes${k}`].set(ball, toe);
      const sh = P(`sh${k}`),
        el = P(`el${k}`),
        wr = P(`wr${k}`),
        fi = P(`fing${k}`);
      B[`humerus${k}`].set(sh, el);
      const Rt = f.R.thorax;
      const tx = new THREE.Vector3(Rt[0], Rt[3], Rt[6]);
      const tz = new THREE.Vector3(Rt[2], Rt[5], Rt[8]);
      const ty = new THREE.Vector3(Rt[1], Rt[4], Rt[7]);
      const sideV = tx.clone().multiplyScalar(k === "L" ? 1 : -1);
      const fd = new THREE.Vector3().subVectors(wr, el);
      const off = new THREE.Vector3().crossVectors(fd, sideV).normalize().multiplyScalar(0.011 * (H / 1.75));
      B[`radius${k}`].set(el.clone().add(off), wr.clone().add(off));
      B[`ulna${k}`].set(el.clone().sub(off), wr.clone().sub(off));
      B[`hand${k}`].set(wr, fi);
      const notch = P("c7").add(ty.clone().multiplyScalar(-0.03 * H)).add(tz.clone().multiplyScalar(0.075 * H)).add(sideV.clone().multiplyScalar(0.012 * H));
      B[`clav${k}`].set(notch, sh.clone().add(tz.clone().multiplyScalar(-0.006 * H)));
      const scTop = sh.clone().add(tz.clone().multiplyScalar(-0.05 * H)).add(sideV.clone().multiplyScalar(-0.02 * H));
      B[`scap${k}`].set(scTop.clone().add(ty.clone().multiplyScalar(-0.1 * H)).add(sideV.clone().multiplyScalar(-0.03 * H)), scTop);
    }
    const head = P("head");
    const c7 = P("c7");
    const neckTop = head.clone().lerp(c7, 0.38);
    B.neck.set(c7, neckTop);
    // 척추 마디
    const pts: [V, V, number, Mat3][] = [
      [P("l5"), P("t12"), 5, f.R.lumbar],
      [P("t12"), c7, 12, f.R.thorax],
      [c7, neckTop, 6, f.R.head],
    ];
    let idx = 0;
    const mtx = new THREE.Matrix4();
    for (const [a, b, n, R] of pts) {
      for (let i = 0; i < n; i++) {
        const p = a.clone().lerp(b, (i + 0.5) / n);
        const m = m4From(R, [p.x, p.y, p.z]);
        const sc = n === 5 ? 1.35 : n === 12 ? 1 : 0.75;
        mtx.copy(m).multiply(new THREE.Matrix4().makeScale(sc, 1, sc));
        this.vert.setMatrixAt(idx++, mtx);
      }
    }
    this.vert.count = idx;
    this.vert.instanceMatrix.needsUpdate = true;
    // 갈비뼈
    const Rt = f.R.thorax;
    const t12 = P("t12");
    const thLen = t12.distanceTo(c7);
    const RtM = m4From(Rt, [0, 0, 0]);
    for (let i = 0; i < this.ribs.length; i++) {
      const u = 0.12 + (i / (this.ribs.length - 1)) * 0.8;
      const w = (0.06 + 0.035 * Math.sin(Math.PI * (0.25 + u * 0.75))) * H * (i === this.ribs.length - 1 ? 0.75 : 1);
      const d = (0.045 + 0.022 * Math.sin(Math.PI * (0.2 + u * 0.7))) * H;
      const r = this.ribs[i];
      const base = t12.clone().lerp(c7, u);
      const loc = new THREE.Vector3(0, -0.012 * H, d * 0.92).applyMatrix4(RtM);
      r.position.copy(base).add(loc);
      r.quaternion.setFromRotationMatrix(RtM);
      r.rotateX(0.32);
      r.scale.set(w, 0.09, d);
    }
    const st = c7.clone().add(new THREE.Vector3(0, -0.45 * thLen, 0.105 * H).applyMatrix4(RtM));
    this.sternum.position.copy(st);
    this.sternum.quaternion.setFromRotationMatrix(RtM);
    this.sternum.rotateX(0.18);
    this.sternum.scale.set(0.018 * H, 0.5 * thLen, 0.01 * H);
    // 골반, 두개골
    this.pelvis.matrixAutoUpdate = false;
    this.pelvis.matrix.copy(m4From(f.R.pelvis, j.pelvis));
    this.skull.matrixAutoUpdate = false;
    this.skull.matrix.copy(m4From(f.R.head, j.head));

    this.updateGear(f);
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
