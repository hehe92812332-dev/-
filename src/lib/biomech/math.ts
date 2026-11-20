// 작은 3D 수학 도구. 좌표계: X = 대상자 왼쪽, Y = 위, Z = 앞 (오른손 좌표계).
export type Vec3 = [number, number, number];
export type Mat3 = [number, number, number, number, number, number, number, number, number];

export const DEG = Math.PI / 180;
export const RAD = 180 / Math.PI;

export const v3 = (x = 0, y = 0, z = 0): Vec3 => [x, y, z];
export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const addScaled = (a: Vec3, b: Vec3, s: number): Vec3 => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
export const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
export const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
export const norm = (a: Vec3): Vec3 => {
  const l = len(a);
  return l > 1e-12 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 1, 0];
};
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const lerpV = (a: Vec3, b: Vec3, t: number): Vec3 => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
export const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);
export const smooth = (t: number) => {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
};
export const isFiniteV = (a: Vec3) => Number.isFinite(a[0]) && Number.isFinite(a[1]) && Number.isFinite(a[2]);

export const I3 = (): Mat3 => [1, 0, 0, 0, 1, 0, 0, 0, 1];

export function mul(a: Mat3, b: Mat3): Mat3 {
  return [
    a[0] * b[0] + a[1] * b[3] + a[2] * b[6],
    a[0] * b[1] + a[1] * b[4] + a[2] * b[7],
    a[0] * b[2] + a[1] * b[5] + a[2] * b[8],
    a[3] * b[0] + a[4] * b[3] + a[5] * b[6],
    a[3] * b[1] + a[4] * b[4] + a[5] * b[7],
    a[3] * b[2] + a[4] * b[5] + a[5] * b[8],
    a[6] * b[0] + a[7] * b[3] + a[8] * b[6],
    a[6] * b[1] + a[7] * b[4] + a[8] * b[7],
    a[6] * b[2] + a[7] * b[5] + a[8] * b[8],
  ];
}

export const apply = (m: Mat3, v: Vec3): Vec3 => [
  m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
  m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
  m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
];

/** 행렬의 열 벡터 = 로컬 축의 월드 방향 */
export const col = (m: Mat3, i: 0 | 1 | 2): Vec3 => [m[i], m[3 + i], m[6 + i]];

/** X축(좌우축) 회전: +a 이면 위쪽(+Y)이 앞(+Z)으로 숙여진다 */
export function Rx(deg: number): Mat3 {
  const a = deg * DEG,
    c = Math.cos(a),
    s = Math.sin(a);
  return [1, 0, 0, 0, c, -s, 0, s, c];
}
/** Y축(수직축) 회전: +a 이면 앞(+Z)이 왼쪽(+X)으로 돈다 */
export function Ry(deg: number): Mat3 {
  const a = deg * DEG,
    c = Math.cos(a),
    s = Math.sin(a);
  return [c, 0, s, 0, 1, 0, -s, 0, c];
}
/** Z축(전후축) 회전: +a 이면 아래(-Y)가 왼쪽(+X)으로 벌어진다 */
export function Rz(deg: number): Mat3 {
  const a = deg * DEG,
    c = Math.cos(a),
    s = Math.sin(a);
  return [c, -s, 0, s, c, 0, 0, 0, 1];
}

/** 세 축 벡터(열)로 회전행렬 구성 */
export const fromAxes = (x: Vec3, y: Vec3, z: Vec3): Mat3 => [x[0], y[0], z[0], x[1], y[1], z[1], x[2], y[2], z[2]];

/** 두 벡터 사이 각도(도) */
export function angleBetween(a: Vec3, b: Vec3) {
  const la = len(a),
    lb = len(b);
  if (la < 1e-12 || lb < 1e-12) return 0;
  return Math.acos(clamp(dot(a, b) / (la * lb), -1, 1)) * RAD;
}

/** 단조 함수 f(x) = 0 의 해를 [lo, hi] 에서 찾는다 (regula falsi + 이분법). 부호가 같으면 가까운 끝값 반환 */
export function solveMonotone(f: (x: number) => number, lo: number, hi: number, tol = 1e-4, maxIter = 40) {
  let flo = f(lo),
    fhi = f(hi);
  if (!Number.isFinite(flo) || !Number.isFinite(fhi)) return { x: lo, ok: false, iter: 0 };
  if (flo === 0) return { x: lo, ok: true, iter: 0 };
  if (fhi === 0) return { x: hi, ok: true, iter: 0 };
  if (flo * fhi > 0) return { x: Math.abs(flo) < Math.abs(fhi) ? lo : hi, ok: false, iter: 0 };
  let side = 0;
  for (let i = 0; i < maxIter; i++) {
    // Illinois 변형 regula falsi
    let x = (lo * fhi - hi * flo) / (fhi - flo);
    if (!Number.isFinite(x) || x <= lo || x >= hi) x = (lo + hi) / 2;
    const fx = f(x);
    if (Math.abs(fx) < tol || hi - lo < tol) return { x, ok: true, iter: i + 1 };
    if (fx * fhi > 0) {
      hi = x;
      fhi = fx;
      if (side === -1) flo /= 2;
      side = -1;
    } else {
      lo = x;
      flo = fx;
      if (side === 1) fhi /= 2;
      side = 1;
    }
  }
  return { x: (lo + hi) / 2, ok: true, iter: maxIter };
}

/** 2-링크 역기구학. root 에서 target 까지, 중간 관절은 pole 방향으로. 도달 불가하면 최대한 뻗는다. */
export function ik2(root: Vec3, target: Vec3, l1: number, l2: number, pole: Vec3) {
  const d0 = dist(root, target);
  const dmax = (l1 + l2) * 0.9999;
  const dmin = Math.abs(l1 - l2) + 1e-4;
  const d = clamp(d0, dmin, dmax);
  const dir = d0 > 1e-9 ? scale(sub(target, root), 1 / d0) : ([0, -1, 0] as Vec3);
  let p = sub(pole, scale(dir, dot(pole, dir)));
  if (len(p) < 1e-6) p = Math.abs(dir[1]) < 0.9 ? cross(dir, [0, 1, 0]) : cross(dir, [1, 0, 0]);
  p = norm(p);
  const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  const mid = add(add(root, scale(dir, a)), scale(p, h));
  const end = add(root, scale(dir, d));
  return { mid, end, reached: d0 <= dmax + 1e-9 && d0 >= dmin - 1e-9, overreach: Math.max(0, d0 - dmax) };
}
