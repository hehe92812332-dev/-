// 해부학 골격 모델: 체형 크기에 맞춰 뼈 형상을 만들고, 매 프레임 관절 위치·분절 좌표계에 붙여 움직인다.
// 기준 치수는 키 175cm 성인이며 s = 키/1.75 로 비례한다.
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { Mat3 } from "@/lib/biomech/math";
import type { LiteFrame } from "./transfer";

type V = THREE.Vector3;
const v = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const tv = (p: number[]) => new THREE.Vector3(p[0], p[1], p[2]);
const UP = v(0, 1, 0);

function m4(R: Mat3, p: number[]) {
  return new THREE.Matrix4().set(R[0], R[1], R[2], p[0], R[3], R[4], R[5], p[1], R[6], R[7], R[8], p[2], 0, 0, 0, 1);
}
const col = (R: Mat3, i: 0 | 1 | 2) => v(R[i], R[3 + i], R[6 + i]);
const rot = (R: Mat3, x: V) => v(R[0] * x.x + R[1] * x.y + R[2] * x.z, R[3] * x.x + R[4] * x.y + R[5] * x.z, R[6] * x.x + R[7] * x.y + R[8] * x.z);
const rotT = (R: Mat3, x: V) => v(R[0] * x.x + R[3] * x.y + R[6] * x.z, R[1] * x.x + R[4] * x.y + R[7] * x.z, R[2] * x.x + R[5] * x.y + R[8] * x.z);

interface Ring {
  t: number;
  rx: number;
  rz: number;
  dz?: number;
  dx?: number;
}

/** y 0~1 축을 따라 타원 단면을 잇는 뼈 형상 (양 끝은 둥글게 막음) */
function boneGeo(rings: Ring[], seg = 14): THREE.BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  const n = rings.length;
  for (const r of rings) {
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      pos.push(Math.cos(a) * r.rx + (r.dx ?? 0), r.t, Math.sin(a) * r.rz + (r.dz ?? 0));
    }
  }
  const row = seg + 1;
  for (let k = 0; k < n - 1; k++)
    for (let i = 0; i < seg; i++) {
      const a = k * row + i,
        b = a + row;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  // 끝 막기
  const capA = pos.length / 3;
  pos.push(rings[0].dx ?? 0, rings[0].t - Math.min(rings[0].rx, rings[0].rz) * 0.0, rings[0].dz ?? 0);
  const capB = capA + 1;
  pos.push(rings[n - 1].dx ?? 0, rings[n - 1].t, rings[n - 1].dz ?? 0);
  for (let i = 0; i < seg; i++) {
    idx.push(capA, i + 1, i);
    idx.push(capB, (n - 1) * row + i, (n - 1) * row + i + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function tube(points: V[], r: number, closed = false, seg = 24, radial = 7) {
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points, closed, "centripetal"), seg, r, radial, closed);
}

/** 세 점으로 만든 두께 있는 판 (견갑골·천골 등) */
function plate(pts: V[], thick: number, bulge = 0): THREE.BufferGeometry {
  const c = pts.reduce((a, p) => a.add(p), v()).multiplyScalar(1 / pts.length);
  const nrm = v().crossVectors(v().subVectors(pts[1], pts[0]), v().subVectors(pts[2], pts[0])).normalize();
  const shape = new THREE.Shape();
  // 판 평면 좌표
  const ex = v().subVectors(pts[1], pts[0]).normalize();
  const ey = v().crossVectors(nrm, ex);
  const to2 = (p: V) => {
    const d = v().subVectors(p, c);
    return new THREE.Vector2(d.dot(ex), d.dot(ey));
  };
  const p2 = pts.map(to2);
  shape.moveTo(p2[0].x, p2[0].y);
  for (let i = 1; i < p2.length; i++) {
    const a = p2[i - 1],
      b = p2[i];
    shape.quadraticCurveTo((a.x + b.x) / 2 * 1.06, (a.y + b.y) / 2 * 1.06, b.x, b.y);
  }
  shape.quadraticCurveTo((p2[p2.length - 1].x + p2[0].x) / 2 * 1.06, (p2[p2.length - 1].y + p2[0].y) / 2 * 1.06, p2[0].x, p2[0].y);
  const g = new THREE.ExtrudeGeometry(shape, { depth: thick, bevelEnabled: true, bevelThickness: thick * 0.4, bevelSize: thick * 0.5, bevelSegments: 2, curveSegments: 6 });
  g.translate(0, 0, -thick / 2);
  if (bulge) {
    const pa = g.getAttribute("position") as THREE.BufferAttribute;
    let maxR = 0;
    for (let i = 0; i < pa.count; i++) maxR = Math.max(maxR, Math.hypot(pa.getX(i), pa.getY(i)));
    for (let i = 0; i < pa.count; i++) {
      const rr = Math.hypot(pa.getX(i), pa.getY(i)) / maxR;
      pa.setZ(i, pa.getZ(i) + bulge * (1 - rr * rr));
    }
    g.computeVertexNormals();
  }
  const m = new THREE.Matrix4().makeBasis(ex, ey, nrm).setPosition(c);
  g.applyMatrix4(m);
  return g;
}

/** 곡면 판: 두 곡선 사이를 채운 얇은 면 (장골 날개) */
function sheet(a: V[], b: V[], thick: number, bulge: V, segU = 16, segV = 8): THREE.BufferGeometry {
  const ca = new THREE.CatmullRomCurve3(a),
    cb = new THREE.CatmullRomCurve3(b);
  const pos: number[] = [];
  const idx: number[] = [];
  const grid = (off: number) => {
    const start = pos.length / 3;
    for (let i = 0; i <= segU; i++) {
      const pa = ca.getPoint(i / segU),
        pb = cb.getPoint(i / segU);
      for (let j = 0; j <= segV; j++) {
        const t = j / segV;
        const p = pa.clone().lerp(pb, t).addScaledVector(bulge, Math.sin(Math.PI * t) * Math.sin(Math.PI * (0.15 + 0.7 * (i / segU))) + off);
        pos.push(p.x, p.y, p.z);
      }
    }
    return start;
  };
  const s0 = grid(0);
  const s1 = grid(0);
  // 두 번째 면은 두께만큼 안쪽
  const nb = bulge.clone().normalize().multiplyScalar(-thick);
  for (let k = s1; k < pos.length / 3; k++) {
    pos[k * 3] += nb.x;
    pos[k * 3 + 1] += nb.y;
    pos[k * 3 + 2] += nb.z;
  }
  const row = segV + 1;
  for (let i = 0; i < segU; i++)
    for (let j = 0; j < segV; j++) {
      const a0 = s0 + i * row + j,
        b0 = a0 + row;
      idx.push(a0, b0, a0 + 1, a0 + 1, b0, b0 + 1);
      const a1 = s1 + i * row + j,
        b1 = a1 + row;
      idx.push(a1, a1 + 1, b1, a1 + 1, b1 + 1, b1);
    }
  // 가장자리 막기
  const edge = (k0: number, k1: number) => idx.push(s0 + k0, s1 + k0, s0 + k1, s0 + k1, s1 + k0, s1 + k1);
  for (let i = 0; i < segU; i++) {
    edge(i * row + segV, (i + 1) * row + segV);
    edge((i + 1) * row, i * row);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function merge(gs: THREE.BufferGeometry[]) {
  const clean = gs.map((g) => {
    const n = g.index ? g.toNonIndexed() : g.clone();
    for (const k of Object.keys(n.attributes)) if (k !== "position" && k !== "normal") n.deleteAttribute(k);
    if (!n.getAttribute("normal")) n.computeVertexNormals();
    return n;
  });
  return mergeGeometries(clean, false)!;
}

const sphere = (r: number, p: V, sx = 1, sy = 1, sz = 1, seg = 16) => {
  const g = new THREE.SphereGeometry(r, seg, Math.max(8, seg * 0.7));
  g.scale(sx, sy, sz);
  g.translate(p.x, p.y, p.z);
  return g;
};
const box = (w: number, h: number, d: number, p: V, rx = 0) => {
  const g = new THREE.BoxGeometry(w, h, d);
  if (rx) g.rotateX(rx);
  g.translate(p.x, p.y, p.z);
  return g;
};
const cyl = (r: number, h: number, p: V, r2 = r) => {
  const g = new THREE.CylinderGeometry(r2, r, h, 14);
  g.translate(p.x, p.y, p.z);
  return g;
};

/** X선처럼 가장자리만 밝은 반투명 피부 */
export function skinMaterial(color = 0x9aa6b2) {
  return new THREE.ShaderMaterial({
    uniforms: { col: { value: new THREE.Color(color) }, base: { value: 0.07 }, rim: { value: 0.42 } },
    vertexShader: `varying vec3 vN; varying vec3 vV;
      void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform vec3 col; uniform float base; uniform float rim; varying vec3 vN; varying vec3 vV;
      void main(){ float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.4); gl_FragColor = vec4(col, base + rim * f); }`,
    transparent: true,
    depthWrite: false,
    side: THREE.FrontSide,
  });
}

interface Dims {
  H: number;
  hipW: number;
  lumbar: number;
  thorax: number;
  l5: V; // 골반 좌표계
  shL: V; // 흉곽 좌표계 (원점 T12)
  shR: V;
  c7Head: V; // 머리 좌표계에서 C7
  girth: number;
}

export class Anatomy {
  group = new THREE.Group();
  private skinGroup = new THREE.Group();
  private pelvis = new THREE.Mesh();
  private lumbar = new THREE.Mesh();
  private thorax = new THREE.Mesh();
  private thoraxCart = new THREE.Mesh();
  private lumbarDisc = new THREE.Mesh();
  private thoraxDisc = new THREE.Mesh();
  private head = new THREE.Mesh();
  private headDark = new THREE.Mesh();
  private teeth = new THREE.Mesh();
  private long: Record<string, THREE.Mesh> = {};
  private skin: Record<string, THREE.Mesh> = {};
  private key = "";
  private girth = 1;

  constructor(
    private mats: { bone: THREE.Material; cart: THREE.Material; dark: THREE.Material; tooth: THREE.Material; skin: THREE.Material },
  ) {
    const parts = [this.pelvis, this.lumbar, this.thorax, this.head, this.lumbarDisc, this.thoraxDisc, this.thoraxCart, this.headDark, this.teeth];
    for (const p of parts) {
      p.castShadow = true;
      p.matrixAutoUpdate = false;
      this.group.add(p);
    }
    this.pelvis.material = this.lumbar.material = this.thorax.material = this.head.material = mats.bone;
    this.lumbarDisc.material = this.thoraxDisc.material = this.thoraxCart.material = mats.cart;
    this.headDark.material = mats.dark;
    this.teeth.material = mats.tooth;
    this.headDark.castShadow = false;
    this.group.add(this.skinGroup);
    this.skinGroup.renderOrder = 5;
  }

  setGirth(bmi: number) {
    const g = Math.max(0.8, Math.min(1.5, Math.sqrt(bmi / 22)));
    if (Math.abs(g - this.girth) > 0.01) {
      this.girth = g;
      this.key = "";
    }
  }

  /** 체형이 바뀌면 다음 프레임에서 형상을 다시 만든다 */
  invalidate() {
    this.key = "";
  }

  setSkin(on: boolean) {
    this.skinGroup.visible = on;
  }

  private dimsOf(f: LiteFrame, H: number): Dims {
    const j = f.j;
    const t12 = tv(j.t12);
    return {
      H,
      hipW: tv(j.hipL).distanceTo(tv(j.hipR)),
      lumbar: tv(j.l5).distanceTo(t12),
      thorax: t12.distanceTo(tv(j.c7)),
      l5: rotT(f.R.pelvis, v().subVectors(tv(j.l5), tv(j.pelvis))),
      shL: rotT(f.R.thorax, v().subVectors(tv(j.shL), t12)),
      shR: rotT(f.R.thorax, v().subVectors(tv(j.shR), t12)),
      c7Head: rotT(f.R.head, v().subVectors(tv(j.c7), tv(j.head))),
      girth: this.girth,
    };
  }

  private build(d: Dims) {
    const s = d.H / 1.75;
    const S = (x: number) => x * s;
    this.buildPelvis(d, S);
    this.buildSpine(d, S);
    this.buildThorax(d, S);
    this.buildHead(d, S);
    this.buildLong(S);
    this.buildSkin(d, S);
  }

  private set(mesh: THREE.Mesh, g: THREE.BufferGeometry) {
    mesh.geometry?.dispose();
    mesh.geometry = g;
  }

  /* ───────── 골반 (골반 좌표계: 원점 = 양 고관절 중심) ───────── */
  private buildPelvis(d: Dims, S: (x: number) => number) {
    const gs: THREE.BufferGeometry[] = [];
    const hw = d.hipW / 2;
    for (const sg of [1, -1]) {
      const x = (q: number) => sg * q;
      // 장골 날개: 아래 경계(관골구 위) → 위 경계(장골능)
      // 날개는 거의 세워져(바깥으로 약 30°) 그릇 모양을 이룬다
      const lower = [v(x(S(0.03)), S(0.05), S(-0.055)), v(x(hw * 0.9), S(0.035), S(-0.02)), v(x(hw * 1.0), S(0.025), S(0.022))];
      const crest = [v(x(S(0.038)), S(0.14), S(-0.072)), v(x(S(0.1)), S(0.158), S(-0.045)), v(x(S(0.128)), S(0.14), S(0.0)), v(x(S(0.118)), S(0.1), S(0.048)), v(x(S(0.102)), S(0.078), S(0.062))];
      const lo = new THREE.CatmullRomCurve3(lower).getPoints(4);
      gs.push(sheet(lo, crest, S(0.006), v(x(S(0.014)), 0, S(-0.004))));
      // 장골능 테두리
      gs.push(tube(crest, S(0.006), false, 20, 6));
      // 관골구 테두리
      const ac = new THREE.TorusGeometry(S(0.027), S(0.0065), 6, 18);
      ac.rotateY(sg * (Math.PI / 2 - 0.5));
      ac.translate(x(hw * 1.02), 0, 0);
      gs.push(ac);
      // 치골·좌골 고리 (폐쇄공)
      const ring = [
        v(x(hw * 0.92), S(-0.008), S(0.022)),
        v(x(S(0.045)), S(-0.02), S(0.055)),
        v(x(S(0.012)), S(-0.035), S(0.062)),
        v(x(S(0.014)), S(-0.065), S(0.05)),
        v(x(S(0.045)), S(-0.085), S(0.02)),
        v(x(hw * 0.78), S(-0.085), S(-0.012)),
        v(x(hw * 0.95), S(-0.04), S(-0.02)),
      ];
      gs.push(tube(ring, S(0.0085), true, 30, 7));
      gs.push(sphere(S(0.016), ring[5], 1.1, 0.9, 1.2)); // 좌골결절
      gs.push(sphere(S(0.009), crest[4], 1, 1, 1)); // 위앞엉덩뼈가시
    }
    // 치골결합
    gs.push(box(S(0.012), S(0.03), S(0.012), v(0, S(-0.048), S(0.06))));
    // 천골·미골 (L5 아래에서 뒤로 기울어짐)
    const l5 = d.l5;
    const sac = plate([v(S(0.05), l5.y - S(0.012), l5.z - S(0.012)), v(S(-0.05), l5.y - S(0.012), l5.z - S(0.012)), v(0, S(-0.05), l5.z - S(0.045))], S(0.018), S(-0.008));
    gs.push(sac);
    gs.push(tube([v(0, S(-0.05), l5.z - S(0.045)), v(0, S(-0.07), l5.z - S(0.035)), v(0, S(-0.078), l5.z - S(0.02))], S(0.006), false, 8, 6));
    this.set(this.pelvis, merge(gs));
  }

  /* ───────── 척추 ───────── */
  private vertebra(gs: THREE.BufferGeometry[], disc: THREE.BufferGeometry[], c: V, r: number, h: number, kind: "L" | "T" | "C", S: (x: number) => number) {
    gs.push(cyl(r, h, c, r * 0.96));
    // 척추뼈고리 + 가시돌기 + 가로돌기
    gs.push(tube([v(c.x + r * 0.7, c.y, c.z - r * 0.6), v(c.x, c.y + h * 0.1, c.z - r * 1.6), v(c.x - r * 0.7, c.y, c.z - r * 0.6)], r * 0.22, false, 8, 5));
    if (kind === "L") {
      gs.push(box(S(0.008), S(0.02), S(0.03), v(c.x, c.y - S(0.002), c.z - r - S(0.02))));
      gs.push(box(S(0.075), S(0.008), S(0.01), v(c.x, c.y, c.z - r * 0.9)));
    } else if (kind === "T") {
      gs.push(box(S(0.006), S(0.01), S(0.038), v(c.x, c.y - S(0.012), c.z - r - S(0.018)), 0.7));
      gs.push(box(S(0.055), S(0.008), S(0.01), v(c.x, c.y + S(0.003), c.z - r * 1.0)));
    } else {
      gs.push(box(S(0.005), S(0.006), S(0.02), v(c.x, c.y - S(0.003), c.z - r - S(0.01)), 0.3));
      gs.push(box(S(0.04), S(0.006), S(0.008), v(c.x, c.y, c.z - r * 0.3)));
    }
    disc.push(cyl(r * 0.95, Math.max(S(0.004), h * 0.28), v(c.x, c.y + h * 0.62, c.z)));
  }

  private buildSpine(d: Dims, S: (x: number) => number) {
    // 요추 (요추 좌표계: 원점 L5, y = T12 방향). 앞으로 휜 전만.
    const gs: THREE.BufferGeometry[] = [],
      ds: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 5; i++) {
      const t = (i + 0.5) / 5;
      const c = v(0, t * d.lumbar, S(0.016) * Math.sin(Math.PI * t));
      this.vertebra(gs, ds, c, S(0.022 - 0.0015 * i), d.lumbar / 5 * 0.7, "L", S);
    }
    this.set(this.lumbar, merge(gs));
    this.set(this.lumbarDisc, merge(ds));
  }

  /** 흉추 후만 (뒤로 볼록): 흉곽 좌표계 y 에서의 z 이동 */
  private kz(y: number, len: number, S: (x: number) => number) {
    return -S(0.026) * Math.sin(Math.PI * Math.min(1, Math.max(0, y / len)));
  }

  /* ───────── 흉곽 (흉곽 좌표계: 원점 T12, y = C7 방향) ───────── */
  private buildThorax(d: Dims, S: (x: number) => number) {
    const L = d.thorax;
    const bone: THREE.BufferGeometry[] = [],
      cart: THREE.BufferGeometry[] = [];
    const disc: THREE.BufferGeometry[] = [];
    // 흉추 12개 (위가 T1)
    const yT = (i: number) => L - S(0.012) - ((i - 1) / 11) * (L - S(0.03));
    for (let i = 1; i <= 12; i++) {
      const y = yT(i);
      this.vertebra(bone, disc, v(0, y, this.kz(y, L, S)), S(0.0135 + 0.0005 * i), (L / 12) * 0.7, "T", S);
    }
    // 갈비뼈
    const W = [0.058, 0.085, 0.105, 0.118, 0.128, 0.136, 0.142, 0.144, 0.142, 0.136, 0.122, 0.104].map(S);
    const D = [0.1, 0.12, 0.135, 0.145, 0.15, 0.152, 0.15, 0.14, 0.12, 0.09, 0.03, 0].map(S);
    const DR = [0.035, 0.05, 0.065, 0.075, 0.085, 0.095, 0.1, 0.1, 0.095, 0.085, 0.06, 0.045].map(S);
    const stTop = yT(1) - S(0.04);
    const stLen = S(0.17);
    const stZ = (y: number) => S(0.13) + ((stTop - y) / stLen) * S(0.03);
    const ends: Record<string, V> = {};
    for (let i = 1; i <= 12; i++) {
      const y = yT(i);
      const w = W[i - 1],
        dd = D[i - 1],
        dr = DR[i - 1];
      const z0 = this.kz(y, L, S);
      for (const sg of [1, -1]) {
        const a = v(sg * S(0.012), y, z0 - S(0.008));
        const b = v(sg * w * 0.55, y + S(0.004), z0 - S(0.045));
        const c = v(sg * w * 0.98, y - dr * 0.3, S(0.0));
        if (i >= 11) {
          bone.push(tube([a, b, c, v(sg * w * 0.92, y - dr * 0.55, S(0.03))], S(0.0048), false, 18, 6));
          continue;
        }
        const e = v(sg * w * 0.86, y - dr * 0.65, dd * 0.55);
        const f = v(sg * w * 0.48, y - dr * 0.92, dd * 0.9);
        bone.push(tube([a, b, c, e, f], S(i === 1 ? 0.0065 : 0.0052), false, 26, 6));
        ends[`${i}${sg}`] = f;
        // 늑연골: 1~7번은 흉골로, 8~10번은 위 연골로
        if (i <= 7) {
          const sy = stTop - S(0.01) - ((i - 1) / 6.3) * (stLen - S(0.03));
          cart.push(tube([f, v(sg * S(0.032), (f.y + sy) / 2, stZ(sy) - S(0.004)), v(sg * S(0.014), sy, stZ(sy))], S(0.0045), false, 10, 6));
        } else {
          const sy = stTop - stLen + S(0.03) - (i - 8) * S(0.012);
          cart.push(tube([f, v(sg * S(0.05 + 0.015 * (i - 8)), sy - S(0.01), S(0.135)), v(sg * S(0.03), sy, stZ(sy))], S(0.004), false, 10, 6));
        }
      }
    }
    // 흉골: 자루·몸통·칼돌기
    bone.push(plate([v(S(0.028), stTop, stZ(stTop)), v(S(-0.028), stTop, stZ(stTop)), v(0, stTop - S(0.05), stZ(stTop - S(0.05)))], S(0.008)));
    const b0 = stTop - S(0.04),
      b1 = stTop - stLen + S(0.02);
    bone.push(tube([v(0, b0, stZ(b0)), v(0, (b0 + b1) / 2, stZ((b0 + b1) / 2)), v(0, b1, stZ(b1))], S(0.011), false, 10, 8).scale(1, 1, 0.45).translate(0, 0, stZ(b1) * 0.55));
    cart.push(sphere(S(0.008), v(0, b1 - S(0.018), stZ(b1) + S(0.002)), 1, 1.6, 0.6));
    // 쇄골: 흉골 위끝 → 어깨 (S자)
    for (const [sg, sh] of [
      [1, d.shL],
      [-1, d.shR],
    ] as [number, V][]) {
      const a = v(sg * S(0.022), stTop + S(0.005), stZ(stTop) - S(0.004));
      const acro = sh.clone().add(v(-sg * S(0.012), S(0.016), S(-0.01)));
      const m1 = a.clone().lerp(acro, 0.33).add(v(0, S(0.006), S(0.014)));
      const m2 = a.clone().lerp(acro, 0.7).add(v(0, S(0.008), S(-0.012)));
      bone.push(tube([a, m1, m2, acro], S(0.0062), false, 18, 7));
      // 견갑골: 위각·아래각·관절와 + 견갑극
      const sup = v(sg * S(0.055), yT(1) - S(0.012), this.kz(yT(1), L, S) - S(0.06));
      const inf = v(sg * S(0.085), yT(7), this.kz(yT(7), L, S) - S(0.075));
      const glen = sh.clone().add(v(-sg * S(0.018), S(-0.008), S(-0.022)));
      bone.push(plate([sup, glen, inf], S(0.005), S(-0.006) * sg * 0));
      const spineA = sup.clone().lerp(inf, 0.22);
      bone.push(tube([spineA, spineA.clone().lerp(acro, 0.5).add(v(0, S(0.006), S(-0.012))), acro], S(0.0055), false, 12, 6));
      bone.push(sphere(S(0.014), glen, 0.6, 1.1, 0.9)); // 관절와
    }
    this.set(this.thorax, merge(bone));
    this.set(this.thoraxCart, merge(cart));
    this.set(this.thoraxDisc, merge(disc));
  }

  /* ───────── 두개골 (머리 좌표계: 원점 머리 중심) ───────── */
  private buildHead(d: Dims, S: (x: number) => number) {
    const gs: THREE.BufferGeometry[] = [];
    const dark: THREE.BufferGeometry[] = [];
    const teeth: THREE.BufferGeometry[] = [];
    gs.push(sphere(S(0.074), v(0, S(0.022), S(-0.012)), 1, 1.08, 1.27, 30)); // 머리뼈 둥근 천장
    gs.push(sphere(S(0.05), v(0, S(-0.03), S(0.042)), 1.05, 0.95, 0.85, 22)); // 위턱·얼굴
    gs.push(sphere(S(0.03), v(0, S(0.03), S(0.055)), 1.9, 1, 0.9, 18)); // 이마
    for (const sg of [1, -1]) {
      gs.push(tube([v(sg * S(0.048), S(-0.02), S(0.055)), v(sg * S(0.064), S(-0.018), S(0.02)), v(sg * S(0.062), S(-0.016), S(-0.01))], S(0.006), false, 10, 6)); // 광대활
      gs.push(sphere(S(0.012), v(sg * S(0.045), S(-0.016), S(0.06)), 1.4, 1, 1)); // 광대뼈
      dark.push(sphere(S(0.017), v(sg * S(0.022), S(0.0), S(0.083)), 1.05, 0.95, 0.6)); // 눈확
      gs.push(sphere(S(0.012), v(sg * S(0.058), S(-0.045), S(-0.025)), 0.7, 1.2, 1)); // 꼭지돌기
    }
    dark.push(sphere(S(0.01), v(0, S(-0.026), S(0.09)), 0.9, 1.3, 0.5)); // 코안
    // 아래턱: U자
    const jaw = [
      v(S(0.056), S(-0.022), S(-0.008)),
      v(S(0.052), S(-0.07), S(0.004)),
      v(S(0.038), S(-0.088), S(0.052)),
      v(0, S(-0.096), S(0.078)),
      v(S(-0.038), S(-0.088), S(0.052)),
      v(S(-0.052), S(-0.07), S(0.004)),
      v(S(-0.056), S(-0.022), S(-0.008)),
    ];
    gs.push(tube(jaw, S(0.0085), false, 40, 8));
    gs.push(sphere(S(0.012), v(0, S(-0.094), S(0.08)), 1.4, 1, 0.8)); // 턱끝
    // 치아
    for (const [y, rr] of [
      [S(-0.06), S(0.034)],
      [S(-0.069), S(0.031)],
    ]) {
      for (let i = 0; i < 12; i++) {
        const a = -Math.PI * 0.42 + (i / 11) * Math.PI * 0.84;
        teeth.push(box(S(0.006), S(0.009), S(0.006), v(Math.sin(a) * rr, y, S(0.045) + Math.cos(a) * rr * 0.95)));
      }
    }
    // 목뼈 7개: C7 → 머리뼈 아래 (앞으로 휜 전만)
    const disc: THREE.BufferGeometry[] = [];
    const base = v(0, S(-0.045), S(-0.025));
    const c7 = d.c7Head;
    for (let i = 0; i < 7; i++) {
      const t = (i + 0.5) / 7;
      const c = c7.clone().lerp(base, t).add(v(0, 0, S(0.012) * Math.sin(Math.PI * t)));
      this.vertebra(gs, disc, c, S(0.0105), c7.distanceTo(base) / 7 * 0.65, "C", S);
    }
    gs.push(...disc);
    this.set(this.head, merge(gs));
    this.set(this.headDark, merge(dark));
    this.set(this.teeth, merge(teeth));
  }

  /* ───────── 긴뼈 (매 프레임 두 관절 사이에 배치) ───────── */
  private mkLong(key: string, g: THREE.BufferGeometry, mat: THREE.Material = this.mats.bone) {
    let m = this.long[key];
    if (!m) {
      m = new THREE.Mesh();
      m.castShadow = true;
      m.matrixAutoUpdate = false;
      this.long[key] = m;
      this.group.add(m);
    }
    m.material = mat;
    m.geometry?.dispose();
    m.geometry = g;
  }

  private buildLong(S: (x: number) => number) {
    const R = (t: number, rx: number, rz: number, dz = 0, dx = 0): Ring => ({ t, rx: S(rx), rz: S(rz), dz: S(dz), dx: S(dx) });
    for (const k of ["L", "R"]) {
      this.mkLong(`femur${k}`, boneGeo([R(0, 0.017, 0.016), R(0.04, 0.026, 0.022), R(0.1, 0.019, 0.018), R(0.2, 0.0145, 0.015, 0.002), R(0.5, 0.0135, 0.0145, 0.004), R(0.8, 0.017, 0.016, 0.001), R(0.92, 0.031, 0.024, -0.004), R(0.975, 0.036, 0.026, -0.006), R(1.0, 0.026, 0.018, -0.006)]));
      this.mkLong(`fneck${k}`, merge([boneGeo([R(0, 0.0, 0.0), R(0.02, 0.016, 0.016), R(0.35, 0.0235, 0.0235), R(0.55, 0.02, 0.02), R(0.62, 0.015, 0.016), R(1.0, 0.017, 0.019)])]));
      this.mkLong(`tibia${k}`, boneGeo([R(0, 0.026, 0.02, -0.002), R(0.025, 0.036, 0.027, -0.003), R(0.07, 0.03, 0.025), R(0.14, 0.02, 0.021, 0.004), R(0.35, 0.0145, 0.016, 0.003), R(0.75, 0.0125, 0.013), R(0.92, 0.017, 0.015), R(0.985, 0.02, 0.016), R(1.0, 0.015, 0.012)]));
      this.mkLong(`fibula${k}`, boneGeo([R(0, 0.007, 0.007), R(0.04, 0.0105, 0.01), R(0.12, 0.0062, 0.006), R(0.88, 0.0055, 0.0055), R(0.96, 0.0095, 0.008), R(1, 0.006, 0.005)], 8));
      this.mkLong(`humerus${k}`, boneGeo([R(0, 0.012, 0.012), R(0.03, 0.02, 0.02), R(0.1, 0.0155, 0.0155), R(0.25, 0.012, 0.012), R(0.75, 0.0115, 0.012), R(0.9, 0.018, 0.012, 0.002), R(0.97, 0.029, 0.016, 0.004), R(1, 0.022, 0.013, 0.004)]));
      this.mkLong(`ulna${k}`, boneGeo([R(0, 0.009, 0.012, -0.004), R(0.05, 0.012, 0.016, -0.002), R(0.12, 0.009, 0.01), R(0.6, 0.0065, 0.007), R(0.95, 0.0065, 0.0065), R(1, 0.008, 0.008)], 10));
      this.mkLong(`radius${k}`, boneGeo([R(0, 0.0095, 0.0095), R(0.06, 0.008, 0.008), R(0.15, 0.0068, 0.0068), R(0.7, 0.0085, 0.008), R(0.94, 0.0145, 0.011), R(1, 0.013, 0.01)], 10));
      this.mkLong(`hhead${k}`, sphere(S(0.023), v(), 1, 1, 1, 18));
      this.mkLong(`patella${k}`, sphere(S(0.012), v(), 1, 1.35, 0.6, 14));
      this.mkLong(`calc${k}`, merge([sphere(S(0.015), v(0, S(-0.004), S(-0.006)), 0.95, 1.05, 1.9, 14), sphere(S(0.015), v(0, S(0.012), S(0.024)), 1.2, 0.8, 1.15, 12)]));
    }
  }

  /* ───────── 피부 실루엣 ───────── */
  private mkSkin(key: string, g: THREE.BufferGeometry) {
    let m = this.skin[key];
    if (!m) {
      m = new THREE.Mesh();
      m.matrixAutoUpdate = false;
      m.material = this.mats.skin;
      m.renderOrder = 5;
      this.skin[key] = m;
      this.skinGroup.add(m);
    }
    m.geometry?.dispose();
    m.geometry = g;
  }

  private buildSkin(d: Dims, S0: (x: number) => number) {
    const gF = d.girth;
    const S = (x: number) => S0(x) * gF;
    const R = (t: number, rx: number, rz: number, dz = 0, dx = 0): Ring => ({ t, rx: S(rx), rz: S(rz), dz: S0(dz), dx: S0(dx) });
    for (const k of ["L", "R"]) {
      this.mkSkin(`thigh${k}`, boneGeo([R(-0.12, 0.06, 0.07, 0.0), R(0.0, 0.085, 0.085), R(0.3, 0.078, 0.078), R(0.75, 0.058, 0.056), R(1.0, 0.05, 0.048, 0.006), R(1.06, 0.045, 0.045, 0.006)], 18));
      this.mkSkin(`shank${k}`, boneGeo([R(-0.04, 0.047, 0.047, 0.004), R(0.08, 0.05, 0.055, -0.006), R(0.3, 0.05, 0.06, -0.012), R(0.75, 0.032, 0.033), R(1.0, 0.03, 0.033), R(1.05, 0.03, 0.034)], 16));
      this.mkSkin(`uarm${k}`, boneGeo([R(-0.08, 0.04, 0.045), R(0.05, 0.05, 0.05), R(0.45, 0.044, 0.042), R(0.95, 0.036, 0.034), R(1.04, 0.032, 0.03)], 16));
      this.mkSkin(`farm${k}`, boneGeo([R(-0.04, 0.034, 0.032), R(0.25, 0.037, 0.032), R(0.85, 0.027, 0.02), R(1.02, 0.026, 0.017)], 14));
      this.mkSkin(`foot${k}`, boneGeo([R(-0.05, 0.03, 0.035), R(0.15, 0.038, 0.04), R(0.7, 0.045, 0.02), R(1.0, 0.04, 0.014)], 12));
      this.mkSkin(`hand${k}`, boneGeo([R(0, 0.03, 0.014), R(0.45, 0.04, 0.014), R(1.0, 0.03, 0.01)], 12));
    }
    const L = d.thorax;
    // 몸통: 흉곽 좌표계(가슴), 요추 좌표계(배), 골반 좌표계(엉덩이)
    this.mkSkin("chest", boneGeo([R(-0.02, 0.135, 0.1, 0.055), R(0.35, 0.15, 0.115, 0.06), R(0.75, 0.165, 0.11, 0.045), R(0.95, 0.16, 0.085, 0.03), R(1.04, 0.07, 0.055, 0.0)].map((r) => ({ ...r, t: r.t * L })), 22));
    this.mkSkin("belly", boneGeo([R(-0.02, 0.135, 0.1, 0.05), R(0.5, 0.13, 0.1, 0.055), R(1.0, 0.135, 0.1, 0.055)].map((r) => ({ ...r, t: r.t * d.lumbar })), 22));
    this.mkSkin("hips", boneGeo([R(-0.11, 0.1, 0.075, 0.0), R(-0.06, 0.155, 0.1, 0.0), R(0.03, 0.16, 0.105, 0.005), R(0.1, 0.14, 0.1, 0.03)].map((r) => ({ ...r, t: S0(r.t * 1) / 1 }))  , 22));
    this.mkSkin("neck", boneGeo([R(0, 0.055, 0.055, 0.01), R(1, 0.05, 0.05, 0.012)], 14));
    this.mkSkin("head", sphere(S0(0.085), v(0, S0(0.005), S0(0.01)), 0.95, 1.22, 1.15, 26));
  }

  /** 두 점 사이에 y축을 맞추고 front 방향으로 z축을 맞춘 행렬 */
  private place(mesh: THREE.Mesh | undefined, a: V, b: V, front: V, scaleLen = true) {
    if (!mesh) return;
    const y = v().subVectors(b, a);
    const L = Math.max(1e-4, y.length());
    y.multiplyScalar(1 / L);
    let z = front.clone().sub(y.clone().multiplyScalar(front.dot(y)));
    if (z.lengthSq() < 1e-6) z = Math.abs(y.z) < 0.9 ? v(0, 0, 1) : v(1, 0, 0);
    z.normalize();
    const x = v().crossVectors(y, z);
    const m = new THREE.Matrix4().makeBasis(x, scaleLen ? y.clone().multiplyScalar(L) : y, z).setPosition(a);
    mesh.matrix.copy(m);
  }

  private placeAt(mesh: THREE.Mesh | undefined, p: V, y: V, front: V) {
    if (!mesh) return;
    let z = front.clone().sub(y.clone().multiplyScalar(front.dot(y)));
    if (z.lengthSq() < 1e-6) z = v(0, 0, 1);
    z.normalize();
    const x = v().crossVectors(y, z);
    mesh.matrix.copy(new THREE.Matrix4().makeBasis(x, y, z).setPosition(p));
  }

  update(f: LiteFrame, H: number) {
    // 형상은 체형이 바뀐 뒤 첫 프레임에서 한 번만 만든다 (보간 프레임의 미세한 치수 차이로 다시 만들지 않음)
    if (!this.key) {
      this.key = "built";
      this.build(this.dimsOf(f, H));
    }
    const j = f.j;
    const s = H / 1.75;
    this.pelvis.matrix.copy(m4(f.R.pelvis, j.pelvis));
    this.lumbar.matrix.copy(m4(f.R.lumbar, j.l5));
    this.lumbarDisc.matrix.copy(this.lumbar.matrix);
    this.thorax.matrix.copy(m4(f.R.thorax, j.t12));
    this.thoraxCart.matrix.copy(this.thorax.matrix);
    this.thoraxDisc.matrix.copy(this.thorax.matrix);
    const hm = m4(f.R.head, j.head);
    this.head.matrix.copy(hm);
    this.headDark.matrix.copy(hm);
    this.teeth.matrix.copy(hm);
    const px = col(f.R.pelvis, 0),
      py = col(f.R.pelvis, 1),
      pz = col(f.R.pelvis, 2);
    const tzv = col(f.R.thorax, 2);
    const L = this.long;
    for (const k of ["L", "R"] as const) {
      const sg = k === "L" ? 1 : -1;
      const hip = tv(j[`hip${k}`]),
        knee = tv(j[`knee${k}`]),
        ank = tv(j[`ankle${k}`]),
        heel = tv(j[`heel${k}`]),
        ball = tv(j[`ball${k}`]);
      const th = v().subVectors(knee, hip).normalize();
      const sh = v().subVectors(ank, knee).normalize();
      let front = v().subVectors(th, sh);
      const Rf = k === "L" ? f.R.footL : f.R.footR;
      const footFwd = col(Rf, 2);
      if (front.lengthSq() < 0.004) front = footFwd.clone();
      front.normalize();
      // 대퇴골: 대전자 → 무릎, 목은 대퇴골두(고관절) → 대전자
      const troch = hip.clone().addScaledVector(px, sg * 0.04 * s).addScaledVector(py, -0.022 * s).addScaledVector(pz, -0.004 * s);
      const shaftTop = troch.clone().addScaledVector(th, 0.004 * s);
      this.place(L[`femur${k}`], shaftTop, knee.clone().addScaledVector(th, 0.004 * s), front);
      this.place(L[`fneck${k}`], hip.clone().addScaledVector(px, -sg * 0.008 * s), troch, pz);
      // 무릎뼈
      const pat = knee.clone().addScaledVector(front, 0.028 * s).addScaledVector(th, -0.006 * s);
      this.placeAt(L[`patella${k}`], pat, th.clone().add(sh).normalize(), front);
      // 경골·비골
      const lat = col(Rf, 0).multiplyScalar(sg);
      this.place(L[`tibia${k}`], knee.clone().addScaledVector(sh, 0.012 * s), ank.clone().addScaledVector(sh, -0.004 * s).addScaledVector(lat, -0.004 * s), footFwd);
      this.place(L[`fibula${k}`], knee.clone().addScaledVector(sh, 0.03 * s).addScaledVector(lat, 0.026 * s).addScaledVector(footFwd, -0.012 * s), ank.clone().addScaledVector(sh, 0.012 * s).addScaledVector(lat, 0.022 * s).addScaledVector(footFwd, -0.008 * s), footFwd);
      // 종골·거골
      this.place(L[`calc${k}`], heel.clone().lerp(ank, 0.5).addScaledVector(footFwd, 0.006 * s), heel.clone().lerp(ank, 0.5).add(col(Rf, 1)), footFwd, false);
      // 팔
      const shp = tv(j[`sh${k}`]),
        el = tv(j[`el${k}`]),
        wr = tv(j[`wr${k}`]);
      const ud = v().subVectors(el, shp).normalize();
      const fd = v().subVectors(wr, el).normalize();
      let efront = fd.clone().sub(ud.clone().multiplyScalar(fd.dot(ud)));
      if (efront.lengthSq() < 0.004) efront = tzv.clone();
      efront.normalize();
      this.placeAt(L[`hhead${k}`], shp.clone().addScaledVector(col(f.R.thorax, 0), -sg * 0.004 * s), ud, efront);
      this.place(L[`humerus${k}`], shp, el.clone().addScaledVector(ud, 0.006 * s), efront);
      // 아래팔: 노뼈(엄지 쪽)·자뼈(새끼 쪽)
      let thumb = tzv.clone().sub(fd.clone().multiplyScalar(tzv.dot(fd)));
      if (thumb.lengthSq() < 1e-4) thumb = col(f.R.thorax, 0).multiplyScalar(sg);
      thumb.normalize();
      const off = 0.011 * s;
      this.place(L[`ulna${k}`], el.clone().addScaledVector(thumb, -off).addScaledVector(ud, -0.008 * s), wr.clone().addScaledVector(thumb, -off * 0.9), efront);
      this.place(L[`radius${k}`], el.clone().addScaledVector(thumb, off * 0.6).addScaledVector(fd, 0.006 * s), wr.clone().addScaledVector(thumb, off), efront);
      // 피부
      const S = this.skin;
      this.place(S[`thigh${k}`], hip.clone().addScaledVector(px, sg * 0.012 * s), knee, front);
      this.place(S[`shank${k}`], knee, ank, footFwd);
      this.place(S[`uarm${k}`], shp, el, efront);
      this.place(S[`farm${k}`], el, wr, efront);
      this.place(S[`foot${k}`], heel.clone().addScaledVector(col(Rf, 1), 0.035 * s), ball.clone().lerp(tv(j[`toe${k}`]), 0.6).addScaledVector(col(Rf, 1), 0.012 * s), col(Rf, 1));
      this.place(S[`hand${k}`], wr, tv(j[`fing${k}`]), efront);
    }
    const S = this.skin;
    S.chest && S.chest.matrix.copy(m4(f.R.thorax, j.t12));
    S.belly && S.belly.matrix.copy(m4(f.R.lumbar, j.l5));
    S.hips && S.hips.matrix.copy(m4(f.R.pelvis, j.pelvis));
    S.head && S.head.matrix.copy(hm);
    const c7 = tv(j.c7);
    const headBase = tv(j.head).addScaledVector(col(f.R.head, 1), -0.05 * s).addScaledVector(col(f.R.head, 2), -0.01 * s);
    this.place(S.neck, c7.addScaledVector(col(f.R.thorax, 2), 0.02 * s), headBase, col(f.R.head, 2));
  }
}

export const _unused = rot;
