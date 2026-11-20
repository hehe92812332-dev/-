// 사용자 신체 입력 → 분절 길이·질량. 기본 비율은 Winter(2009)·Dempster 인체 분절 비율을 따른다.
import { clamp } from "./math";

export type Sex = "m" | "f";

export interface BodyInput {
  sex: Sex;
  heightCm: number;
  weightKg: number;
  /** 발 길이(신발 사이즈, mm) */
  footMm: number;
  /** 넙다리(대퇴): 대전자(골반 옆 튀어나온 뼈) ~ 무릎 관절선 */
  thighCm: number;
  /** 정강이(하퇴): 무릎 관절선 ~ 안쪽 복사뼈 */
  shankCm: number;
  /** 위팔: 어깨 끝(견봉) ~ 팔꿈치 바깥 뼈 */
  upperArmCm: number;
  /** 아래팔: 팔꿈치 ~ 손목(경상돌기) */
  forearmCm: number;
  /** 손: 손목 주름 ~ 가운뎃손가락 끝 */
  handCm: number;
  /** 대전자 ~ 어깨 끝 높이 차 */
  torsoCm: number;
  /** 어깨너비(견봉~견봉) */
  shoulderCm: number;
  /** 골반너비(장골능) */
  hipCm: number;
  /** 다리 길이 차이 (왼쪽 - 오른쪽, cm) */
  legDiffCm: number;
}

export interface Mobility {
  /** 체중 부하 발목 배측굴곡 (도) */
  ankleDF: number;
  /** 고관절 굴곡 (도) */
  hipFlex: number;
  /** 하지직거상 각도 (햄스트링 유연성, 도) */
  hamstring: number;
  /** 어깨 굴곡 (팔 들어올리기, 도) */
  shoulderFlex: number;
  /** 흉추 회전 (도) */
  thoracicRot: number;
}

export interface Capacity {
  /** 하체 파워·근력 수준 0~100 */
  power: number;
  /** 움직임 조절·안정성 0~100 (무릎 내반/외반, 체간 안정 등) */
  control: number;
  /** 좌우 근력 차이 % (+ 왼쪽이 강함) */
  asym: number;
}

export interface Profile {
  body: BodyInput;
  mobility: Mobility;
  capacity: Capacity;
}

/** 키·성별만으로 표준 비율 신체 입력 생성 */
export function standardBody(heightCm = 175, sex: Sex = "m", weightKg?: number): BodyInput {
  const H = heightCm;
  return {
    sex,
    heightCm: H,
    weightKg: weightKg ?? Math.round((sex === "m" ? 22.5 : 21) * (H / 100) ** 2),
    footMm: Math.round(H * (sex === "m" ? 1.53 : 1.5) / 5) * 5,
    thighCm: round1(H * 0.245),
    shankCm: round1(H * 0.246),
    upperArmCm: round1(H * 0.186),
    forearmCm: round1(H * 0.146),
    handCm: round1(H * 0.108),
    torsoCm: round1(H * 0.288),
    shoulderCm: round1(H * (sex === "m" ? 0.232 : 0.222)),
    hipCm: round1(H * (sex === "m" ? 0.165 : 0.178)),
    legDiffCm: 0,
  };
}

export const defaultMobility = (): Mobility => ({ ankleDF: 38, hipFlex: 125, hamstring: 80, shoulderFlex: 170, thoracicRot: 45 });
export const defaultCapacity = (): Capacity => ({ power: 50, control: 60, asym: 0 });
export const defaultProfile = (): Profile => ({ body: standardBody(), mobility: defaultMobility(), capacity: defaultCapacity() });

/** 발목 관절 높이 (cm) */
export const ankleHeightCm = (b: Pick<BodyInput, "heightCm">) => 0.039 * b.heightCm;
/** 고관절(대전자) 높이 = 넙다리 + 정강이 + 발목 높이 */
export const legLengthCm = (b: BodyInput) => b.thighCm + b.shankCm + ankleHeightCm(b);
/** 무릎 높이 */
export const kneeHeightCm = (b: BodyInput) => b.shankCm + ankleHeightCm(b);
/** 팔 전체 (견봉 ~ 가운뎃손가락 끝) */
export const armLengthCm = (b: BodyInput) => b.upperArmCm + b.forearmCm + b.handCm;

/** 예전 입력(다리 길이·무릎 높이·팔 길이)을 분절 길이로 변환 */
function migrateLegacy(raw: Record<string, unknown>): Record<string, unknown> {
  const out = { ...raw };
  const H = typeof raw.heightCm === "number" ? raw.heightCm : 175;
  const ah = 0.039 * H;
  if (out.thighCm === undefined && typeof raw.legCm === "number" && typeof raw.kneeCm === "number") {
    out.thighCm = round1(raw.legCm - raw.kneeCm);
    out.shankCm = round1(raw.kneeCm - ah);
  }
  if (out.upperArmCm === undefined && typeof raw.armCm === "number") {
    out.upperArmCm = round1(raw.armCm * (0.186 / 0.44));
    out.forearmCm = round1(raw.armCm * (0.146 / 0.44));
    out.handCm = round1(raw.armCm * (0.108 / 0.44));
  }
  delete out.legCm;
  delete out.kneeCm;
  delete out.armCm;
  return out;
}

function round1(x: number) {
  return Math.round(x * 10) / 10;
}

export interface InputIssue {
  field: string;
  severity: "warn" | "error";
  message: string;
  /** true 면 값을 바꾸지 않고 확인만 요청 */
  notice?: boolean;
}

/** 입력 범위 (UI 슬라이더와 공유) */
export const LIMITS = {
  heightCm: [120, 220],
  weightKg: [25, 200],
  footMm: [180, 340],
  thighCm: [25, 65],
  shankCm: [25, 65],
  upperArmCm: [18, 45],
  forearmCm: [14, 36],
  handCm: [10, 26],
  torsoCm: [28, 78],
  shoulderCm: [25, 55],
  hipCm: [18, 45],
  legDiffCm: [-4, 4],
  ankleDF: [0, 55],
  hipFlex: [60, 145],
  hamstring: [25, 130],
  shoulderFlex: [90, 190],
  thoracicRot: [5, 80],
  power: [0, 100],
  control: [0, 100],
  asym: [-40, 40],
} as const;

export type LimitKey = keyof typeof LIMITS;

const num = (x: unknown, fallback: number) => (typeof x === "number" && Number.isFinite(x) ? x : fallback);

/**
 * 입력 정리. 범위 밖 값은 자르고, 서로 맞지 않는 비율(예: 다리+몸통이 키보다 큼)은
 * 키를 기준으로 비례 조정하면서 경고를 남긴다.
 */
export function sanitizeProfile(p: Partial<Profile> | undefined): { profile: Profile; issues: InputIssue[] } {
  const issues: InputIssue[] = [];
  const base = defaultProfile();
  const bi = { ...base.body, ...migrateLegacy((p?.body ?? {}) as Record<string, unknown>) } as BodyInput;
  const sex: Sex = bi.sex === "f" ? "f" : "m";
  const fix = (key: LimitKey, raw: unknown, fallback: number, label: string) => {
    const [lo, hi] = LIMITS[key];
    const v = num(raw, fallback);
    if (raw !== undefined && (typeof raw !== "number" || !Number.isFinite(raw))) {
      issues.push({ field: key, severity: "error", message: `${label} 값이 숫자가 아니어서 기본값을 썼습니다.` });
    }
    if (v < lo || v > hi) {
      issues.push({ field: key, severity: "warn", message: `${label}은(는) ${lo}~${hi} 범위로 조정했습니다.` });
      return clamp(v, lo, hi);
    }
    return v;
  };

  const heightCm = fix("heightCm", bi.heightCm, 175, "키");
  const std = standardBody(heightCm, sex);
  const H = heightCm;
  const body: BodyInput = {
    sex,
    heightCm,
    weightKg: fix("weightKg", bi.weightKg, std.weightKg, "체중"),
    footMm: fix("footMm", bi.footMm, std.footMm, "발 길이"),
    thighCm: fix("thighCm", bi.thighCm, std.thighCm, "넙다리 길이"),
    shankCm: fix("shankCm", bi.shankCm, std.shankCm, "정강이 길이"),
    upperArmCm: fix("upperArmCm", bi.upperArmCm, std.upperArmCm, "위팔 길이"),
    forearmCm: fix("forearmCm", bi.forearmCm, std.forearmCm, "아래팔 길이"),
    handCm: fix("handCm", bi.handCm, std.handCm, "손 길이"),
    torsoCm: fix("torsoCm", bi.torsoCm, std.torsoCm, "몸통 길이"),
    shoulderCm: fix("shoulderCm", bi.shoulderCm, std.shoulderCm, "어깨너비"),
    hipCm: fix("hipCm", bi.hipCm, std.hipCm, "골반너비"),
    legDiffCm: fix("legDiffCm", bi.legDiffCm, 0, "다리 길이 차이"),
  };

  // 키 대비 비율 검사 — 측정 실수(예: cm 대신 inch)를 잡아낸다
  const ratio = (v: number, lo: number, hi: number, field: keyof BodyInput, label: string, stdV: number) => {
    const r = v / H;
    if (r < lo || r > hi) {
      const nv = round1(clamp(r, lo, hi) * H);
      issues.push({
        field,
        severity: "warn",
        message: `${label} ${v}cm는 키 ${H}cm에 비해 ${r < lo ? "짧아" : "길어"} 측정 오류로 보고 ${nv}cm로 맞췄습니다. (표준 ${stdV}cm)`,
      });
      return nv;
    }
    return v;
  };
  body.thighCm = ratio(body.thighCm, 0.19, 0.3, "thighCm", "넙다리 길이", std.thighCm);
  body.shankCm = ratio(body.shankCm, 0.19, 0.3, "shankCm", "정강이 길이", std.shankCm);
  body.torsoCm = ratio(body.torsoCm, 0.23, 0.35, "torsoCm", "몸통 길이", std.torsoCm);
  body.upperArmCm = ratio(body.upperArmCm, 0.15, 0.23, "upperArmCm", "위팔 길이", std.upperArmCm);
  body.forearmCm = ratio(body.forearmCm, 0.115, 0.18, "forearmCm", "아래팔 길이", std.forearmCm);
  body.handCm = ratio(body.handCm, 0.085, 0.13, "handCm", "손 길이", std.handCm);
  body.shoulderCm = ratio(body.shoulderCm, 0.18, 0.29, "shoulderCm", "어깨너비", std.shoulderCm);
  body.hipCm = ratio(body.hipCm, 0.13, 0.22, "hipCm", "골반너비", std.hipCm);
  const fr = body.footMm / 10 / H;
  if (fr < 0.125 || fr > 0.185) {
    const nv = Math.round((clamp(fr, 0.125, 0.185) * H * 10) / 5) * 5;
    issues.push({
      field: "footMm",
      severity: "warn",
      message: `발 길이 ${body.footMm}mm는 키에 비해 ${fr < 0.125 ? "작아" : "커"} ${nv}mm로 맞췄습니다. 신발 사이즈(mm)로 입력해 주세요.`,
    });
    body.footMm = nv;
  }

  // 다리 + 몸통 + 머리·목(0.12~0.25H) 이 키와 맞지 않으면 비례 조정
  const legNow = legLengthCm(body);
  const headNeck = H - legNow - body.torsoCm;
  if (headNeck < 0.12 * H || headNeck > 0.25 * H) {
    const target = headNeck < 0.12 * H ? 0.12 * H : 0.25 * H;
    const ah = ankleHeightCm(body);
    const k = (H - target - ah) / (body.thighCm + body.shankCm + body.torsoCm);
    const nth = round1(body.thighCm * k),
      nsh = round1(body.shankCm * k),
      nt = round1(body.torsoCm * k);
    issues.push({
      field: "torsoCm",
      severity: "warn",
      message: `넙다리(${body.thighCm}) + 정강이(${body.shankCm}) + 몸통(${body.torsoCm})이 키 ${H}cm와 맞지 않아 머리·목 길이가 ${Math.round(headNeck)}cm가 됩니다. 넙다리 ${nth}cm, 정강이 ${nsh}cm, 몸통 ${nt}cm로 비례 조정했습니다.`,
    });
    body.thighCm = nth;
    body.shankCm = nsh;
    body.torsoCm = nt;
  }
  const bmi = body.weightKg / (H / 100) ** 2;
  if (bmi < 15 || bmi > 40) {
    issues.push({
      field: "weightKg",
      severity: "warn",
      notice: true,
      message:
        bmi > 40
          ? `키 ${H}cm에 체중 ${body.weightKg}kg(BMI ${bmi.toFixed(1)})입니다. 파운드(lb)로 입력했다면 kg으로 바꿔 주세요. 값은 그대로 계산합니다.`
          : `키 대비 체중(BMI ${bmi.toFixed(1)})이 매우 낮습니다. 입력을 확인해 주세요. 값은 그대로 계산합니다.`,
    });
  }

  const mi = { ...base.mobility, ...(p?.mobility ?? {}) };
  const mobility: Mobility = {
    ankleDF: fix("ankleDF", mi.ankleDF, 38, "발목 가동성"),
    hipFlex: fix("hipFlex", mi.hipFlex, 125, "고관절 굴곡"),
    hamstring: fix("hamstring", mi.hamstring, 80, "햄스트링 유연성"),
    shoulderFlex: fix("shoulderFlex", mi.shoulderFlex, 170, "어깨 굴곡"),
    thoracicRot: fix("thoracicRot", mi.thoracicRot, 45, "흉추 회전"),
  };
  const ci = { ...base.capacity, ...(p?.capacity ?? {}) };
  const capacity: Capacity = {
    power: fix("power", ci.power, 50, "파워"),
    control: fix("control", ci.control, 60, "조절 능력"),
    asym: fix("asym", ci.asym, 0, "좌우 근력 차이"),
  };
  return { profile: { body, mobility, capacity }, issues };
}

/** 계산용 분절 모델 (단위: m, kg) */
export interface Body {
  H: number;
  M: number;
  sex: Sex;
  hipW: number;
  shW: number;
  thigh: [number, number]; // [L, R]
  shank: [number, number];
  ankleH: [number, number];
  foot: { len: number; heel: number; toe: number; ball: number; width: number };
  legLen: number; // 평균 고관절 높이
  torso: number;
  l5: [number, number, number]; // 골반 좌표계에서 고관절 중심 → L5
  lumbar: number;
  thorax: number;
  shoulderOff: [number, number]; // 흉곽 좌표계에서 C7 → 어깨관절 (y, z)
  neck: number;
  skull: number;
  upperArm: number;
  forearm: number;
  hand: number;
  armLen: number;
  mass: {
    head: number;
    thorax: number;
    abdomen: number;
    pelvis: number;
    thigh: number;
    shank: number;
    foot: number;
    upperArm: number;
    forearm: number;
    hand: number;
  };
  mobility: Mobility;
  capacity: Capacity;
}

export function buildBody(profile: Profile): Body {
  const b = profile.body;
  const H = b.heightCm / 100;
  const M = b.weightKg;
  const footLen = b.footMm / 1000;
  const ankleH = 0.039 * H;
  const thighBase = b.thighCm / 100;
  const shankBase = b.shankCm / 100;
  const leg = thighBase + shankBase + ankleH;
  const chain = thighBase + shankBase;
  const diff = b.legDiffCm / 100;
  // 다리 길이 차이는 넙다리·정강이에 비례 배분
  const kL = (chain + diff / 2) / chain;
  const kR = (chain - diff / 2) / chain;
  const torso = b.torsoCm / 100;
  const l5: [number, number, number] = [0, 0.045 * H, -0.03 * H];
  const shoulderOff: [number, number] = [-0.02 * H, 0.025 * H];
  const spine = torso - l5[1] - shoulderOff[0]; // L5 → C7
  const headNeck = H - leg - torso;
  const skull = Math.min(0.13 * H, headNeck * 0.72);
  const neck = Math.max(0.02 * H, headNeck + shoulderOff[0] - skull);
  const arm = (b.upperArmCm + b.forearmCm + b.handCm) / 100;
  return {
    H,
    M,
    sex: b.sex,
    hipW: (b.hipCm / 100) * 0.6,
    shW: (b.shoulderCm / 100) * 0.86,
    thigh: [thighBase * kL, thighBase * kR],
    shank: [shankBase * kL, shankBase * kR],
    ankleH: [ankleH, ankleH],
    foot: { len: footLen, heel: 0.24 * footLen, toe: 0.76 * footLen, ball: 0.52 * footLen, width: 0.38 * footLen },
    legLen: leg,
    torso,
    l5,
    lumbar: spine * 0.38,
    thorax: spine * 0.62,
    shoulderOff,
    neck,
    skull,
    upperArm: b.upperArmCm / 100,
    forearm: b.forearmCm / 100,
    hand: b.handCm / 100,
    armLen: arm,
    mass: {
      head: 0.081 * M,
      thorax: 0.216 * M,
      abdomen: 0.139 * M,
      pelvis: 0.142 * M,
      thigh: 0.1 * M,
      shank: 0.0465 * M,
      foot: 0.0145 * M,
      upperArm: 0.028 * M,
      forearm: 0.016 * M,
      hand: 0.006 * M,
    },
    mobility: profile.mobility,
    capacity: profile.capacity,
  };
}
