// 가상 사용자 10만 명 생성기 (재현 가능한 시드 난수).
// 실제 개인 데이터가 아닙니다. 국내 가구 소득·지출 구조를 대략 본뜬 합성 데이터입니다.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const uniform = (rng, a, b) => a + (b - a) * rng();
export const randInt = (rng, a, b) => Math.floor(uniform(rng, a, b + 1));
export function normal(rng) {
  const u = 1 - rng();
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
function pick(rng, weighted) {
  const total = weighted.reduce((a, [, w]) => a + w, 0);
  let r = rng() * total;
  for (const [v, w] of weighted) {
    r -= w;
    if (r <= 0) return v;
  }
  return weighted[weighted.length - 1][0];
}
const round = (x, unit = 10000) => Math.round(x / unit) * unit;

export const PERSONAS = {
  student: { label: '대학생·아르바이트', weight: 8, income: [600000, 1300000], variable: true, cv: [0.2, 0.35], housing: [0.25, 0.45] },
  junior: { label: '사회초년생', weight: 22, income: [2300000, 3300000], variable: false, housing: [0.18, 0.32] },
  mid: { label: '직장인(경력 3~10년)', weight: 25, income: [3300000, 5500000], variable: false, housing: [0.15, 0.28] },
  senior: { label: '고소득 직장인', weight: 8, income: [5500000, 11000000], variable: false, housing: [0.12, 0.25] },
  dual: { label: '맞벌이 가구', weight: 12, income: [5500000, 10000000], variable: false, housing: [0.15, 0.3] },
  freelancer: { label: '프리랜서', weight: 10, income: [1800000, 6000000], variable: true, cv: [0.35, 0.6], housing: [0.15, 0.3] },
  self_employed: { label: '자영업', weight: 8, income: [2500000, 9000000], variable: true, cv: [0.25, 0.5], housing: [0.12, 0.25] },
  retiree: { label: '은퇴·연금 생활', weight: 7, income: [1200000, 2800000], variable: false, housing: [0.05, 0.15] },
};

const GOALS = {
  emergency: { label: '비상금', months: [6, 18] },
  travel: { label: '여행', amount: [1500000, 6000000], months: [3, 12] },
  car: { label: '자동차', amount: [15000000, 40000000], months: [12, 48] },
  wedding: { label: '결혼 자금', amount: [20000000, 60000000], months: [18, 48] },
  house: { label: '전세·주택 자금', amount: [50000000, 300000000], months: [36, 120] },
  lump: { label: '목돈 마련', amount: [10000000, 30000000], months: [12, 36] },
  debt: { label: '대출 상환 자금', amount: [5000000, 20000000], months: [12, 36] },
};
const GOAL_WEIGHTS = {
  student: [['travel', 5], ['emergency', 4], ['lump', 2], ['debt', 2]],
  junior: [['emergency', 3], ['travel', 3], ['lump', 4], ['car', 2], ['wedding', 2], ['house', 1]],
  mid: [['lump', 3], ['car', 2], ['wedding', 2], ['house', 3], ['travel', 2], ['emergency', 2]],
  senior: [['house', 4], ['car', 2], ['lump', 2], ['travel', 2]],
  dual: [['house', 5], ['car', 2], ['lump', 2], ['travel', 2], ['emergency', 1]],
  freelancer: [['emergency', 4], ['lump', 3], ['travel', 2], ['house', 1], ['car', 1]],
  self_employed: [['emergency', 3], ['lump', 3], ['debt', 2], ['house', 2], ['car', 1]],
  retiree: [['emergency', 3], ['travel', 3], ['lump', 2]],
};

// 지출 항목: [이름, 유형, 소득 대비 비율 범위 또는 정액 범위, 월별 변동계수]
function expenseTemplate(rng, persona, income) {
  const p = PERSONAS[persona];
  const scale = uniform(rng, 0.75, 1.2); // 씀씀이 성향
  const list = [];
  const add = (name, type, amount, cv) => list.push({ name, type, trueMean: round(amount, 1000), cv });
  add('주거비(월세·관리비)', 'fixed', income * uniform(rng, ...p.housing), 0);
  if (rng() < (persona === 'student' || persona === 'retiree' ? 0.15 : 0.4)) add('대출 상환', 'fixed', income * uniform(rng, 0.05, 0.22), 0);
  add('보험료', 'fixed', income * uniform(rng, 0.02, 0.07), 0);
  add('통신비', 'essential', uniform(rng, 50000, 130000) * (persona === 'dual' ? 1.8 : 1), 0.05);
  add('교통비', 'essential', income * uniform(rng, 0.03, 0.07) * scale, 0.12);
  add('식비(장보기)', 'essential', income * uniform(rng, 0.09, 0.17) * scale, 0.1);
  add('생활용품', 'essential', income * uniform(rng, 0.015, 0.04) * scale, 0.2);
  add('경조사·선물', 'essential', income * uniform(rng, 0.01, 0.035), 0.6);
  add('외식·배달', 'discretionary', income * uniform(rng, 0.04, 0.14) * scale, 0.2);
  add('쇼핑·의류', 'discretionary', income * uniform(rng, 0.02, 0.11) * scale, 0.35);
  add('여가·취미', 'discretionary', income * uniform(rng, 0.02, 0.09) * scale, 0.3);
  add('구독 서비스', 'discretionary', uniform(rng, 15000, 70000), 0.05);
  return list;
}

const fmtComma = (n) => Math.round(n).toLocaleString('en-US');
function fmtManwon(n) {
  const man = Math.round(n / 10000);
  return man >= 10000 && man % 10000 === 0 ? `${man / 10000}억` : `${man}만원`;
}

export function createUser(rng, id) {
  const persona = pick(rng, Object.entries(PERSONAS).map(([k, v]) => [k, v.weight]));
  const p = PERSONAS[persona];
  const incomeMean = round(uniform(rng, ...p.income), 10000);
  const incomeCV = p.variable ? uniform(rng, ...p.cv) : 0.01;
  const expenses = expenseTemplate(rng, persona, incomeMean);
  const monthlyExpense = expenses.reduce((a, e) => a + e.trueMean, 0);

  const goalType = pick(rng, GOAL_WEIGHTS[persona]);
  const g = GOALS[goalType];
  let goal = goalType === 'emergency' ? monthlyExpense * uniform(rng, 3, 6) : uniform(rng, ...g.amount);
  goal = round(goal, goal > 10000000 ? 1000000 : 100000);
  const months = randInt(rng, ...g.months);
  let current = rng() < 0.3 ? 0 : round(goal * uniform(rng, 0, 0.45), 10000);

  const rateBlank = rng() < 0.15;
  const nominalRate = rateBlank ? 0 : Math.round(uniform(rng, 2.5, 4.5) * 10) / 10;
  const quirks = [];
  if (rng() < 0.02) {
    quirks.push('already_met');
    current = round(goal * uniform(rng, 1, 1.3), 10000);
  }

  const truth = {
    goal, current, months, nominalRate,
    monthlyRateAfterTax: (nominalRate / 100) * (1 - 0.154) / 12, // 이자소득세 15.4%
    incomeMean, incomeCV, variable: p.variable,
    jobLossRisk: p.variable ? 0.006 : persona === 'retiree' ? 0 : 0.002,
    expenses,
  };

  // ---- 사용자가 실제로 입력하는 값 (실수·습관 포함) ----
  const hasExpenseHistory = rng() < 0.55; // 카드 내역 등으로 최근 3개월 입력
  const inputExpenses = expenses.map((e) => {
    const history = Array.from({ length: 3 }, () => round(Math.max(0, e.trueMean * (1 + normal(rng) * e.cv)), 1000));
    // 기억에 의존한 추정치는 과소 보고되는 경향(특히 재량 지출)
    const under = e.type === 'fixed' ? 0 : e.type === 'essential' ? uniform(rng, 0, 0.1) : uniform(rng, 0, 0.25);
    return {
      name: e.name,
      type: e.type,
      amount: hasExpenseHistory ? history[2] : round(e.trueMean * (1 - under), 1000),
      ...(hasExpenseHistory ? { history } : {}),
    };
  });

  const incomeHistory = p.variable && rng() < 0.7
    ? Array.from({ length: 6 }, () => round(incomeMean * Math.max(0.15, 1 + normal(rng) * incomeCV), 10000))
    : null;
  const input = {
    goalName: g.label,
    goalAmount: goal,
    currentSavings: current,
    months,
    annualRate: nominalRate,
    income: {
      type: p.variable ? 'variable' : 'fixed',
      monthly: incomeHistory ? incomeHistory[5] : incomeMean,
      ...(incomeHistory ? { history: incomeHistory } : {}),
    },
    expenses: inputExpenses,
  };

  // 입력 습관/실수
  const r = rng();
  if (r < 0.12) {
    quirks.push('comma');
    input.goalAmount = fmtComma(goal);
    input.income.monthly = fmtComma(input.income.monthly);
    input.expenses[0].amount = fmtComma(input.expenses[0].amount);
  } else if (r < 0.17) {
    quirks.push('manwon');
    input.goalAmount = fmtManwon(goal);
    input.income.monthly = fmtManwon(input.income.monthly);
  }
  if (rng() < 0.08) {
    quirks.push('blank_current');
    if (current === 0) input.currentSavings = '';
    else quirks.pop();
  }
  if (rateBlank && rng() < 0.5) input.annualRate = '';
  if (!rateBlank) {
    const q = rng();
    if (q < 0.03) { quirks.push('rate_decimal'); input.annualRate = nominalRate / 100; }
    else if (q < 0.04) { quirks.push('rate_typo'); input.annualRate = nominalRate * 10; }
  }
  if (rng() < 0.1) {
    quirks.push('target_date');
    delete input.months;
    input.startDate = '2026-12-01';
    const d = new Date(Date.UTC(2026, 11 + months, 1));
    input.targetDate = d.toISOString().slice(0, 10);
  }
  // 유효하지 않은 입력: 서비스가 명확한 오류 메시지를 보여줘야 정상
  let invalid = null;
  if (rng() < 0.005) { invalid = 'period_zero'; input.months = 0; delete input.targetDate; }
  else if (rng() < 0.005) { invalid = 'negative_expense'; input.expenses[1].amount = -Math.abs(Number(input.expenses[1].amount) || 50000); }
  else if (rng() < 0.005) { invalid = 'blank_goal'; input.goalAmount = ''; }

  return {
    id,
    persona,
    goalType,
    discipline: uniform(rng, 0.35, 1), // 절약 계획을 지키는 정도
    engagement: 0.3 + 0.6 * mulberry32(id * 7919 + 13)(), // 점검 알림에 응하는 확률 (기존 난수열에 영향 없게 별도 시드)
    tolerance: { extendRatio: uniform(rng, 1.2, 2.2), minGoalRatio: uniform(rng, 0.6, 0.9) },
    quirks,
    invalid,
    truth,
    input,
  };
}

export function* population(n, seed = 20261117) {
  const rng = mulberry32(seed);
  for (let i = 0; i < n; i++) yield createUser(rng, i);
}
