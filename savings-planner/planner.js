// 저축 플래너 계산 엔진 (브라우저·Node 공용, 의존성 없음)
//
// buildPlan(input) → { ok, errors, warnings, summary, analysis, budget, alternatives, schedule, insights }
//
// v2 변경점 (10만 명 시뮬레이션 결과 반영, docs/simulation-report.md 참고)
//  - 금액 입력: 숫자·쉼표·원·만/천/억 단위 모두 인식, 음수·빈 값은 명확한 오류
//  - 기간: 개월 수 또는 시작일~목표일. 0개월·600개월 초과는 오류
//  - 이율: 0.035 → 3.5%로 해석, 15% 초과는 오타로 보고 0%로 보수 계산, 이자소득세 15.4% 반영
//  - 소득이 들쭉날쭉하면 평균이 아닌 보수적 소득(평균−0.5σ, 최저 이상)으로 계획
//  - 기억으로 적은 지출은 과소 추정분만큼 '안전 여유'를 따로 확보
//  - 감축 한도: 고정비 0%, 필수 생활비 10%, 선택 지출 30% (기준 대비 초과분부터)
//  - 불가능할 때 기간 연장 · 목표 조정 · 필요한 추가 수입 3가지 대안 제시
//  - 월 저축액은 1,000원 단위 올림, 예산 합계 = 수입 이 항상 성립

export const TAX_RATE = 0.154;
export const CUT_LIMITS = { fixed: 0, essential: 0.1, discretionary: 0.3 };
export const MAX_MONTHS = 600;
// 줄이기로 한 지출 중 실제로는 지키지 못할 수 있는 비율. 이만큼은 여유분으로 남깁니다.
export const CUT_SLIP = 0.4;
const UNIT = 1000;

export const TYPE_LABELS = { fixed: '고정비', essential: '필수 생활비', discretionary: '선택 지출' };

// 소득 대비 권장 비중(국내 가계부 앱·재무설계 가이드에서 흔히 쓰는 수준의 참고값)
const BENCHMARKS = [
  [/주거|월세|관리비|전세/, 0.25],
  [/대출|상환|이자/, 0.2],
  [/보험/, 0.07],
  [/통신|휴대폰|인터넷/, 0.04],
  [/교통|주유|차량/, 0.07],
  [/외식|배달|카페|커피/, 0.07],
  [/식비|장보기|식료품/, 0.13],
  [/생활용품|생필품/, 0.03],
  [/경조사|선물/, 0.03],
  [/쇼핑|의류|미용/, 0.05],
  [/여가|취미|문화|여행/, 0.05],
  [/구독|OTT|멤버십/, 0.015],
  [/교육|학원/, 0.08],
  [/의료|병원|약/, 0.04],
];
const TYPE_BENCHMARK = { fixed: 0.1, essential: 0.05, discretionary: 0.04 };

export const DEFAULT_CATEGORIES = [
  { name: '주거비(월세·관리비)', type: 'fixed' },
  { name: '대출 상환', type: 'fixed' },
  { name: '보험료', type: 'fixed' },
  { name: '통신비', type: 'essential' },
  { name: '교통비', type: 'essential' },
  { name: '식비(장보기)', type: 'essential' },
  { name: '생활용품', type: 'essential' },
  { name: '경조사·선물', type: 'essential' },
  { name: '외식·배달', type: 'discretionary' },
  { name: '쇼핑·의류', type: 'discretionary' },
  { name: '여가·취미', type: 'discretionary' },
  { name: '구독 서비스', type: 'discretionary' },
];

// ---------------- 입력 해석 ----------------

const SMALL = { 십: 10, 백: 100, 천: 1000 };
const BIG = { 만: 1e4, 억: 1e8, 조: 1e12 };

/** "3,000,000" · "300만원" · "1억 5천만" · "3.5만" · 3000000 → 숫자. 해석 불가 시 NaN, 빈 값은 null */
export function parseAmount(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;
  let s = String(value).trim().replace(/[,\s₩]|원$/g, '').replace(/원/g, '');
  if (s === '') return null;
  let sign = 1;
  if (s.startsWith('-') || s.startsWith('−')) {
    sign = -1;
    s = s.slice(1);
  }
  if (/^\d+(\.\d+)?$/.test(s)) return sign * Number(s);
  const tokens = s.match(/\d+(?:\.\d+)?|[십백천만억조]/g);
  if (!tokens || tokens.join('') !== s) return NaN;
  let total = 0;
  let section = 0;
  let num = null;
  for (const t of tokens) {
    if (SMALL[t]) {
      section += (num ?? 1) * SMALL[t];
      num = null;
    } else if (BIG[t]) {
      section += num ?? 0;
      total += (section || 1) * BIG[t];
      section = 0;
      num = null;
    } else {
      if (num !== null) return NaN;
      num = Number(t);
    }
  }
  return sign * Math.round(total + section + (num ?? 0));
}

/** 'YYYY-MM-DD' 두 날짜 사이의 저축 개월 수 (시작 달 포함, 목표 달 제외) */
export function monthsBetween(start, target) {
  const a = /^(\d{4})-(\d{2})/.exec(String(start || ''));
  const b = /^(\d{4})-(\d{2})/.exec(String(target || ''));
  if (!a || !b) return NaN;
  return (Number(b[1]) - Number(a[1])) * 12 + (Number(b[2]) - Number(a[2]));
}

function parseRate(value, warnings) {
  if (value === '' || value === null || value === undefined) return 0;
  let r = typeof value === 'number' ? value : Number(String(value).replace(/[%\s]/g, ''));
  if (!Number.isFinite(r)) {
    warnings.push('연이율을 알아볼 수 없어 0%로 계산했습니다.');
    return 0;
  }
  if (r < 0) {
    warnings.push('연이율은 음수일 수 없어 0%로 계산했습니다.');
    return 0;
  }
  if (r > 0 && r < 1) {
    warnings.push(`연이율 ${r}는 ${+(r * 100).toFixed(2)}%로 이해했습니다.`);
    r = Math.round(r * 1e6) / 1e4;
  }
  if (r > 15) {
    warnings.push(`연이율 ${r}%는 예·적금으로는 비정상적으로 높습니다(오타일 수 있어요). 안전하게 이자 없이(0%) 계산했습니다.`);
    return 0;
  }
  return r;
}

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
function std(xs) {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
}
const ceilUnit = (x, u = UNIT) => Math.ceil(x / u - 1e-9) * u + 0; // + 0: -0 방지
const floorUnit = (x, u = UNIT) => Math.floor(x / u + 1e-9) * u + 0;

function benchmarkFor(name, type) {
  for (const [re, share] of BENCHMARKS) if (re.test(name)) return share;
  return TYPE_BENCHMARK[type] ?? 0.05;
}

// ---------------- 이자 계산 (월복리, 매월 말 납입) ----------------

export function futureValue(pv, pmt, r, n) {
  if (r === 0) return pv + pmt * n;
  const g = Math.pow(1 + r, n);
  return pv * g + (pmt * (g - 1)) / r;
}

export function requiredPayment(goal, pv, r, n) {
  const g = r === 0 ? 1 : Math.pow(1 + r, n);
  const need = goal - pv * g;
  if (need <= 0) return 0;
  return r === 0 ? need / n : (need * r) / (g - 1);
}

export function monthsToReach(goal, pv, pmt, r) {
  if (pv >= goal) return 0;
  if (pmt <= 0 && (r === 0 || pv <= 0)) return Infinity;
  const n = r === 0 ? (goal - pv) / pmt : Math.log((goal * r + pmt) / (pv * r + pmt)) / Math.log(1 + r);
  return Number.isFinite(n) ? Math.ceil(n - 1e-9) : Infinity;
}

// ---------------- 메인 ----------------

export function buildPlan(raw) {
  const input = raw || {};
  const errors = [];
  const warnings = [];

  // 목표·기간
  const goal = parseAmount(input.goalAmount);
  if (goal === null) errors.push('목표 금액을 입력해 주세요.');
  else if (!Number.isFinite(goal)) errors.push(`목표 금액 "${input.goalAmount}"을(를) 알아볼 수 없습니다. 예: 30000000 또는 3천만원`);
  else if (goal <= 0) errors.push('목표 금액은 0보다 커야 합니다.');

  let current = parseAmount(input.currentSavings);
  if (current === null) current = 0;
  else if (!Number.isFinite(current)) errors.push(`현재 모아둔 금액 "${input.currentSavings}"을(를) 알아볼 수 없습니다.`);
  else if (current < 0) errors.push('현재 모아둔 금액은 음수일 수 없습니다.');

  let months;
  if (input.months !== undefined && input.months !== null && input.months !== '') months = Number(input.months);
  else if (input.targetDate) months = monthsBetween(input.startDate || todayISO(), input.targetDate);
  if (months === undefined) errors.push('저축 기간(개월) 또는 목표 날짜를 입력해 주세요.');
  else if (!Number.isFinite(months)) errors.push('저축 기간을 알아볼 수 없습니다.');
  else if (months < 1) errors.push(input.targetDate ? '목표 날짜는 시작 달보다 최소 한 달 뒤여야 합니다.' : '저축 기간은 1개월 이상이어야 합니다.');
  else if (months > MAX_MONTHS) errors.push(`저축 기간은 최대 ${MAX_MONTHS}개월(50년)까지 계산할 수 있습니다.`);
  else if (!Number.isInteger(months)) months = Math.round(months);

  const annualRate = parseRate(input.annualRate, warnings);
  const taxFree = Boolean(input.taxFree);
  const effectiveAnnual = annualRate * (taxFree ? 1 : 1 - TAX_RATE);
  const r = effectiveAnnual / 100 / 12;

  // 소득
  const inc = input.income || {};
  const reportedIncome = parseAmount(inc.monthly);
  const incomeHistory = (inc.history || []).map(parseAmount).filter((x) => Number.isFinite(x) && x >= 0);
  if ((reportedIncome === null || reportedIncome === 0) && !incomeHistory.length) errors.push('월 수입(실수령액)을 입력해 주세요.');
  else if (reportedIncome !== null && !Number.isFinite(reportedIncome)) errors.push(`월 수입 "${inc.monthly}"을(를) 알아볼 수 없습니다.`);
  else if (reportedIncome < 0) errors.push('월 수입은 음수일 수 없습니다.');

  // 지출
  const expenses = [];
  (input.expenses || []).forEach((e, i) => {
    const name = String(e.name || `지출 ${i + 1}`).trim();
    const type = CUT_LIMITS[e.type] !== undefined ? e.type : 'essential';
    const amount = parseAmount(e.amount);
    const history = (e.history || []).map(parseAmount).filter((x) => Number.isFinite(x));
    if (amount !== null && !Number.isFinite(amount)) errors.push(`"${name}" 금액 "${e.amount}"을(를) 알아볼 수 없습니다.`);
    else if ((amount ?? 0) < 0 || history.some((x) => x < 0)) errors.push(`"${name}" 금액이 음수입니다. 환급·캐시백은 지출에서 빼고 입력해 주세요.`);
    if ((amount === null || amount === 0) && !history.length) return;
    expenses.push({ name, type, amount: amount ?? 0, history });
  });

  if (errors.length) return { ok: false, errors, warnings };

  // ---- 소득 분석 ----
  let planningIncome = reportedIncome || 0;
  const incomeInfo = { reported: reportedIncome || 0, type: inc.type === 'variable' ? 'variable' : 'fixed', months: incomeHistory.length };
  if (incomeHistory.length >= 2) {
    const m = mean(incomeHistory);
    const sd = std(incomeHistory);
    const sorted = [...incomeHistory].sort((a, b) => a - b);
    const median = sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
    Object.assign(incomeInfo, { average: m, std: sd, cv: m > 0 ? sd / m : 0, min: sorted[0], max: sorted.at(-1) });
    if (incomeInfo.cv > 0.1) {
      incomeInfo.type = 'variable';
      planningIncome = Math.max(sorted[0], Math.min(m, median) - 0.75 * sd);
      warnings.push(`최근 ${incomeHistory.length}개월 수입이 들쭉날쭉해(평균 ${won(m)}) 수입이 적은 달도 버틸 수 있게 ${won(floorUnit(planningIncome, 10000))} 기준으로 계획했습니다.`);
    } else {
      planningIncome = m;
    }
  } else if (incomeInfo.type === 'variable') {
    planningIncome = (reportedIncome || 0) * 0.8;
    warnings.push('수입이 일정하지 않은데 지난 수입 기록이 없어 입력한 수입의 80%를 기준으로 계획했습니다. 최근 3~6개월 수입을 넣으면 더 정확해집니다.');
  }
  planningIncome = floorUnit(planningIncome);

  // ---- 지출 분석 ----
  let estimationReserve = 0;
  const categories = expenses.map((e) => {
    const base = e.history.length ? mean(e.history) : e.amount;
    const benchmark = benchmarkFor(e.name, e.type);
    const share = planningIncome > 0 ? base / planningIncome : 0;
    const c = {
      name: e.name,
      type: e.type,
      current: ceilUnit(base),
      share,
      benchmark,
      overBenchmark: share > benchmark * 1.2,
      fromHistory: e.history.length > 0,
    };
    if (e.history.length >= 2) {
      const first = e.history[0];
      const last = e.history.at(-1);
      c.trend = first > 0 && last / first > 1.15 ? 'up' : first > 0 && last / first < 0.85 ? 'down' : 'flat';
      c.volatility = base > 0 ? std(e.history) / base : 0;
    }
    if (!c.fromHistory && e.type !== 'fixed') estimationReserve += base * (e.type === 'discretionary' ? 0.12 : 0.05);
    return c;
  });
  const totalExpense = categories.reduce((a, c) => a + c.current, 0);
  const surplus = planningIncome - totalExpense;

  // 안전 여유: 돌발 지출 대비(수입의 5%) + 기억으로 적은 지출의 과소 추정분
  const minBuffer = ceilUnit(planningIncome * 0.05 + estimationReserve);

  // ---- 필요한 월 저축액 ----
  const requiredExact = requiredPayment(goal, current, r, months);
  const requiredMonthly = ceilUnit(requiredExact);
  const achieved = current >= goal;
  const reachedByInterest = !achieved && requiredMonthly === 0;

  const budget = categories.map((c) => ({ name: c.name, type: c.type, current: c.current, recommended: c.current, cut: 0, weekly: null }));
  let status;
  let savings = requiredMonthly;
  let maxSaving = null;
  let slipReserve = 0;

  if (achieved || reachedByInterest) {
    status = 'achieved';
    savings = 0;
  } else if (surplus >= requiredMonthly + minBuffer) {
    status = surplus - requiredMonthly >= planningIncome * 0.1 ? 'comfortable' : 'tight';
  } else {
    // 감축액의 CUT_SLIP 만큼은 못 지킬 수 있으니, 실제로 필요한 감축은 need / (1 - CUT_SLIP)
    const need = requiredMonthly + minBuffer - surplus;
    const cutTotal = applyCuts(budget, categories, planningIncome, need / (1 - CUT_SLIP));
    slipReserve = ceilUnit(cutTotal * CUT_SLIP);
    if (cutTotal - slipReserve >= need - UNIT) {
      status = 'adjust';
    } else {
      status = 'infeasible';
      const spend = budget.reduce((a, b) => a + b.recommended, 0);
      maxSaving = Math.max(0, floorUnit(planningIncome - spend - minBuffer - slipReserve));
      savings = maxSaving;
    }
  }
  for (const b of budget) {
    b.cut = b.current - b.recommended;
    if (b.type === 'discretionary') b.weekly = floorUnit((b.recommended * 12) / 52, 100);
  }
  const spend = budget.reduce((a, b) => a + b.recommended, 0);
  const leftover = planningIncome - spend - savings;

  // ---- 대안 ----
  const alternatives = [];
  if (status === 'infeasible') {
    if (maxSaving > 0) {
      const n = monthsToReach(goal, current, maxSaving, r);
      if (Number.isFinite(n) && n <= MAX_MONTHS) {
        alternatives.push({ type: 'extend', months: n, goal, monthlySaving: maxSaving, title: `기간을 ${n}개월로 늘리기`, detail: `${n - months}개월 더 모으면 월 ${won(maxSaving)}으로 ${won(goal)}을 달성합니다.` });
      }
      const reachable = floorUnit(futureValue(current, maxSaving, r, months), 10000);
      if (reachable > current) {
        alternatives.push({ type: 'lower_goal', months, goal: reachable, monthlySaving: maxSaving, title: `목표를 ${won(reachable)}으로 조정`, detail: `기간은 그대로 ${months}개월, 월 ${won(maxSaving)}씩 모으면 목표의 ${Math.round((reachable / goal) * 100)}%를 달성합니다.` });
      }
      // 절충안: 기간을 조금 늘리고 목표도 조금 낮추기 (기간 1.25·1.5·2배일 때 모을 수 있는 금액)
      const fullMonths = alternatives.find((a) => a.type === 'extend')?.months ?? Infinity;
      for (const f of [1.25, 1.5, 2]) {
        const n = Math.min(MAX_MONTHS, Math.ceil(months * f));
        if (n >= fullMonths) break;
        const g = floorUnit(futureValue(current, maxSaving, r, n), 10000);
        if (g <= current || g >= goal) continue;
        alternatives.push({ type: 'balanced', months: n, goal: g, monthlySaving: maxSaving, title: `${n}개월 동안 ${won(g)} 모으기`, detail: `기간을 ${n - months}개월 늘리고 목표를 ${Math.round((g / goal) * 100)}%로 조정하는 절충안입니다.` });
      }
    }
    const extra = ceilUnit(requiredMonthly + minBuffer + slipReserve - (planningIncome - spend), 10000);
    alternatives.push({ type: 'more_income', months, goal, monthlySaving: requiredMonthly, extraIncome: extra, title: `월 ${won(extra)} 추가 수입 만들기`, detail: '부업·연봉 협상·중고 판매 등으로 이만큼 더 벌면 원래 계획대로 갈 수 있습니다.' });
    if (maxSaving === 0) {
      const fixed = budget.filter((b) => b.type === 'fixed').sort((a, b) => b.current - a.current)[0];
      alternatives.push({ type: 'fix_deficit', title: '먼저 적자부터 해결하기', detail: `지금은 생활비가 수입보다 많습니다.${fixed ? ` 가장 큰 고정비인 "${fixed.name}"(${won(fixed.current)})을 줄일 방법(이사·대환대출·보험 리모델링)을 먼저 검토해 보세요.` : ''}` });
    }
  }

  // ---- 월별 일정 ----
  const plannedMonths = months;
  const schedule = [];
  let bal = current;
  let interestTotal = 0;
  const milestones = [0.25, 0.5, 0.75, 1];
  let mi = milestones.findIndex((p) => current < goal * p);
  for (let m = 1; m <= plannedMonths; m++) {
    const interest = bal * r;
    interestTotal += interest;
    bal += interest + savings;
    const row = { month: m, deposit: savings, interest: Math.round(interest), balance: Math.round(bal) };
    while (mi >= 0 && mi < milestones.length && bal >= goal * milestones[mi]) {
      row.milestone = Math.round(milestones[mi] * 100);
      mi++;
    }
    schedule.push(row);
  }
  const finalBalance = schedule.length ? schedule.at(-1).balance : current;

  const summary = {
    goalName: input.goalName || '',
    goal, current, months,
    annualRate, effectiveAnnualRate: effectiveAnnual, taxFree,
    income: planningIncome,
    totalExpense, surplus,
    requiredMonthly,
    status,
    feasible: status !== 'infeasible',
    savingsRate: planningIncome > 0 ? savings / planningIncome : 0,
    finalBalance,
    interestTotal: Math.round(interestTotal),
    progress: goal > 0 ? Math.min(1, current / goal) : 0,
  };

  const result = {
    ok: true,
    errors: [],
    warnings,
    summary,
    analysis: { income: incomeInfo, categories, fixedShare: share(categories, 'fixed', planningIncome), essentialShare: share(categories, 'essential', planningIncome), discretionaryShare: share(categories, 'discretionary', planningIncome), estimationReserve: Math.round(estimationReserve) },
    budget: {
      categories: budget,
      savings,
      buffer: Math.max(0, leftover),
      deficit: Math.max(0, -leftover),
      minBuffer: minBuffer + slipReserve,
      slipReserve,
      // 생활비 통장에 늘 남겨 둘 금액(돌발 지출 대비). 넘는 돈은 점검 때 목표 통장으로 옮깁니다.
      cushion: ceilUnit(incomeInfo.type === 'variable' ? Math.max(planningIncome * 0.5, totalExpense) : planningIncome * 0.5, 10000),
      checkInEvery: 3,
      totalCut: budget.reduce((a, b) => a + b.cut, 0),
    },
    alternatives,
    schedule,
  };
  result.insights = buildInsights(result);
  return result;
}

/**
 * 중간 점검: 지금 잔액·남은 기간·최근 실제 지출로 계획을 다시 계산합니다.
 * update = { currentSavings, monthsLeft, expenseHistory?: {이름: [최근 금액들]}, incomeHistory?: [...] }
 */
export function replan(input, update) {
  const next = { ...input, income: { ...(input.income || {}) }, expenses: (input.expenses || []).map((e) => ({ ...e })) };
  if (update.goalAmount !== undefined) next.goalAmount = update.goalAmount;
  next.currentSavings = update.currentSavings;
  next.months = update.monthsLeft;
  delete next.targetDate;
  delete next.startDate;
  if (update.incomeHistory?.length) next.income.history = update.incomeHistory;
  if (update.expenseHistory) {
    for (const e of next.expenses) {
      const h = update.expenseHistory[e.name];
      if (h?.length) {
        e.history = h;
        e.amount = h.at(-1);
      }
    }
  }
  return buildPlan(next);
}

function share(categories, type, income) {
  const s = categories.filter((c) => c.type === type).reduce((a, c) => a + c.current, 0);
  return income > 0 ? s / income : 0;
}

/** 기준 대비 초과분 → 선택 지출 비례 → 필수 생활비 비례 순으로 감축. 실제 감축 총액 반환 */
function applyCuts(budget, categories, income, need) {
  let remaining = need;
  const cap = (b) => floorUnit(b.current * CUT_LIMITS[b.type]);
  const room = (b) => cap(b) - (b.current - b.recommended);
  const cutBy = (b, amount) => {
    const a = Math.min(room(b), ceilUnit(Math.max(0, amount)));
    if (a <= 0) return 0;
    b.recommended -= a;
    remaining -= a;
    return a;
  };
  // 1) 선택 지출 중 권장 비중을 넘는 부분
  for (const b of budget) {
    if (remaining <= 0) break;
    const c = categories.find((x) => x.name === b.name);
    if (b.type !== 'discretionary' || !c.overBenchmark) continue;
    cutBy(b, Math.min(remaining, b.current - c.benchmark * income));
  }
  // 2) 선택 지출 → 3) 필수 생활비 비례 감축
  for (const type of ['discretionary', 'essential']) {
    if (remaining <= 0) break;
    const pool = budget.filter((b) => b.type === type && room(b) > 0);
    const totalRoom = pool.reduce((a, b) => a + room(b), 0);
    if (totalRoom <= 0) continue;
    const want = remaining;
    for (const b of pool) cutBy(b, Math.min(remaining, (want * room(b)) / totalRoom));
  }
  return need - remaining;
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export function won(n) {
  if (!Number.isFinite(n)) return '-';
  const v = Math.round(n);
  const abs = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  if (abs >= 1e8) {
    const eok = Math.floor(abs / 1e8);
    const man = Math.round((abs % 1e8) / 1e4);
    return `${sign}${eok}억${man ? ` ${man.toLocaleString('ko-KR')}만` : ''}원`;
  }
  if (abs >= 1e4 && abs % 1e4 === 0) return `${sign}${(abs / 1e4).toLocaleString('ko-KR')}만원`;
  return `${sign}${abs.toLocaleString('ko-KR')}원`;
}

const pctText = (x) => `${Math.round(x * 100)}%`;

function buildInsights(plan) {
  const { summary: s, analysis: a, budget: b } = plan;
  const out = [];
  const push = (level, text) => out.push({ level, text });

  if (s.status === 'achieved') {
    push('good', s.current >= s.goal ? '이미 목표 금액을 모으셨어요! 새 목표를 세우거나 일부를 비상금으로 남겨 두세요.' : `지금 모은 돈만으로도 이자를 받아 ${s.months}개월 뒤 목표에 도달합니다. 추가 저축은 필요 없어요.`);
  } else {
    const label = { comfortable: '여유 있게 달성 가능', tight: '달성 가능하지만 빠듯함', adjust: '지출 조정 시 달성 가능', infeasible: '현재 수입·지출로는 기간 내 달성 어려움' }[s.status];
    push(s.status === 'infeasible' ? 'bad' : s.status === 'comfortable' ? 'good' : 'warn', `${label} — 매달 ${won(s.requiredMonthly)}씩 ${s.months}개월이 필요합니다(저축률 ${pctText(s.requiredMonthly / Math.max(1, s.income))}).`);
  }
  if (a.fixedShare > 0.5) push('warn', `고정비가 수입의 ${pctText(a.fixedShare)}로 높습니다. 고정비는 한 번 줄이면 매달 효과가 이어지니 주거·대출·보험부터 점검해 보세요.`);
  const over = a.categories.filter((c) => c.overBenchmark && c.type !== 'fixed').sort((x, y) => y.share / y.benchmark - x.share / x.benchmark);
  for (const c of over.slice(0, 3)) push('warn', `"${c.name}"이(가) 수입의 ${pctText(c.share)}로 권장 수준(${pctText(c.benchmark)})보다 높습니다.`);
  for (const c of a.categories.filter((c) => c.trend === 'up' && c.type !== 'fixed').slice(0, 2)) push('warn', `"${c.name}" 지출이 최근 석 달 동안 늘고 있습니다.`);
  for (const c of a.categories.filter((c) => (c.volatility ?? 0) > 0.3).slice(0, 2)) push('info', `"${c.name}"은(는) 달마다 차이가 커서(변동 ${pctText(c.volatility)}) 예산에 조금 여유를 두는 게 좋습니다.`);
  if (b.totalCut > 0) push('info', `지출을 월 ${won(b.totalCut)} 줄이는 계획입니다. 고정비는 건드리지 않고, 선택 지출은 최대 30%, 필수 생활비는 최대 10%까지만 줄였습니다.`);
  if (a.estimationReserve > 0) push('info', `기억으로 적은 지출은 실제보다 적게 잡히기 쉬워 월 ${won(ceilUnit(a.estimationReserve))}을 여유분으로 남겼습니다. 카드 내역으로 최근 3개월을 입력하면 더 정확해요.`);
  if (b.buffer > 0) push('info', `매달 ${won(b.buffer)}은 생활비 통장에 남겨 두세요. 돌발 지출이 생겨도 적금을 깨지 않게 해 줍니다.`);
  if (s.status !== 'achieved') push('info', `${b.checkInEvery}개월마다 중간 점검을 해 주세요. 생활비 통장 잔액이 ${won(b.cushion)}을 넘으면 넘는 만큼 목표 통장으로 옮기고, 실제 지출로 계획을 다시 맞춥니다.`);
  if (b.deficit > 0) push('bad', `지금 계획으로는 매달 ${won(b.deficit)}이 모자랍니다.`);
  if (s.interestTotal > 0) push('info', `기간 동안 세후 이자로 약 ${won(s.interestTotal)}을 받습니다(연 ${s.annualRate}%, ${s.taxFree ? '비과세' : '이자소득세 15.4% 반영'}).`);
  if (a.income.type === 'variable') push('info', '수입이 많은 달에는 계획보다 더 저축하고, 적은 달에는 생활비 통장에 남은 여유분으로 버티세요.');
  return out;
}
