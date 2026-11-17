// 10만 명 가상 이용 시뮬레이션.
//   node simulation/simulate.js              → 현재 planner.js
//   node simulation/simulate.js --v1         → 첫 구현(legacy/planner-v1.js)
//   node simulation/simulate.js --compare    → 두 버전 비교 리포트 (docs/simulation-report.md 갱신)
// 옵션: --n 100000  --seed 20261117
//
// 각 사용자는 계획을 받은 뒤 그 계획대로 매달 적금에 자동이체하고 생활합니다.
// 소득 변동·실직·돌발 지출·과소 보고된 지출·절약 피로(무리한 감축일수록 덜 지킴)를 반영합니다.
// 결과에서 '컴플레인'을 규칙으로 판정해 집계합니다.

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { population, mulberry32, normal, uniform, PERSONAS } from './population.js';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : def;
};
const N = Number(opt('--n', 100000));
const SEED = Number(opt('--seed', 20261117));

export const COMPLAINTS = {
  C1: '계산 결과가 NaN·음수·무한대로 나오거나 오류로 멈춤',
  C2: '입력한 값을 제대로 알아듣지 못함 (쉼표, 만원 단위, 목표 날짜, 잘못된 값 안내 없음)',
  C3: '"가능하다"는 계획을 그대로 따랐는데 목표 금액에 못 미침',
  C4: '생활비가 모자라 적금을 2번 이상 깨야 했음',
  C5: '고정비를 줄이라거나 생활비를 과하게 깎으라는 비현실적 계획',
  C6: '"불가능"이라고만 하고 받아들일 만한 대안이 없음',
  C7: '이미 목표를 달성했는데 이상한 안내(음수 저축액 등)',
  C8: '월 저축액이 1,000원 단위로 떨어지지 않아 자동이체 설정이 불편',
  C9: '예산 합계 + 저축액이 수입과 맞지 않음',
  C10: '계획 계산이 느림(사용자당 20ms 이상)',
};

const fin = (x) => typeof x === 'number' && Number.isFinite(x);

function seededMonthRng(userId, month) {
  return mulberry32((SEED * 2654435761 + userId * 40503 + month * 97) >>> 0);
}

/**
 * 계획을 따라 실제로 살아보는 부분. 결과: 목표 달성 여부, 생활비 부족 횟수 등.
 * 계획에 checkInEvery가 있으면(v2) 알림을 받은 사용자가 점검을 합니다:
 * 생활비 통장 여유분(cushion 초과)을 목표 통장으로 옮기고, 실제 지출·잔액으로 replan.
 */
function live(user, plan, months, goal, monthlySaving, replan) {
  const t = user.truth;
  let saving = monthlySaving;
  // 항목별 '평소 지출 수준' = 원래 수준 − 실제로 지켜낸 감축액
  const level = new Map();
  const applyBudget = (budget, cumulative) => {
    const byName = new Map(budget.categories.map((c) => [c.name, c]));
    for (const e of t.expenses) {
      const b = byName.get(e.name);
      const prev = cumulative ? level.get(e.name) : e.trueMean;
      const asked = b ? Math.max(0, b.current - b.recommended) : 0;
      const totalRatio = e.trueMean > 0 ? (e.trueMean - prev + asked) / e.trueMean : 0;
      let factor = 0;
      if (e.type === 'essential') factor = user.discipline * 0.8;
      if (e.type === 'discretionary') factor = user.discipline * Math.max(0, 1 - Math.max(0, totalRatio - 0.2) * 1.8);
      level.set(e.name, Math.max(0, prev - asked * factor));
    }
  };
  applyBudget(plan.budget, false);
  const cushion = plan.budget.cushion;
  const every = plan.budget.checkInEvery;
  const recentSpend = new Map(t.expenses.map((e) => [e.name, []]));
  const recentIncome = [];

  let savings = t.current;
  let cash = 0;
  let shortMonths = 0;
  let jobLoss = 0;
  for (let m = 1; m <= months; m++) {
    const rng = seededMonthRng(user.id, m);
    if (jobLoss > 0) jobLoss--;
    else if (rng() < t.jobLossRisk) jobLoss = 1 + Math.floor(rng() * 3);
    let income = t.variable
      ? t.incomeMean * Math.max(0.15, 1 + normal(rng) * t.incomeCV)
      : t.incomeMean * (1 + normal(rng) * 0.01);
    if (jobLoss > 0) income *= t.variable ? 0.2 : 0;
    recentIncome.push(Math.round(income));
    cash += income;
    savings = savings * (1 + t.monthlyRateAfterTax) + saving;
    cash -= saving;
    let spend = 0;
    for (const e of t.expenses) {
      const lv = level.get(e.name);
      const x = e.type === 'fixed' ? e.trueMean : lv * Math.max(0, 1 + normal(rng) * e.cv);
      recentSpend.get(e.name).push(Math.round(x / 1000) * 1000);
      spend += x;
    }
    if (rng() < 0.05) spend += t.incomeMean * uniform(rng, 0.1, 0.8); // 돌발 지출(병원비·수리비·경조사)
    cash -= spend;
    if (cash < 0) {
      shortMonths++;
      const w = Math.min(-cash, savings);
      savings -= w;
      cash += w;
    }
    if (every && cushion !== undefined && (m === months || (m % every === 0 && rng() < user.engagement))) {
      if (cash > cushion) {
        savings += cash - cushion;
        cash = cushion;
      }
      if (m < months && replan) {
        const hist = {};
        for (const [k, v] of recentSpend) hist[k] = v.slice(-3);
        const np = replan(user.input, {
          goalAmount: goal,
          currentSavings: Math.round(savings),
          monthsLeft: months - m,
          expenseHistory: hist,
          incomeHistory: t.variable ? recentIncome.slice(-6) : undefined,
        });
        if (np.ok) {
          saving = np.budget.savings;
          applyBudget(np.budget, true);
        }
      }
    }
  }
  return { success: savings >= goal * 0.995, finalRatio: goal > 0 ? savings / goal : 1, shortMonths, endCash: cash };
}

// 사용자는 제시된 대안 중 '기간이 참을 만하고(extendRatio 이내) 목표도 충분한(minGoalRatio 이상)' 첫 대안을 고릅니다.
function pickAlternative(user, plan) {
  const t = user.truth;
  for (const a of plan.alternatives || []) {
    const months = a.months ?? (a.type === 'extend' ? NaN : t.months);
    const goal = a.goal ?? t.goal;
    const monthlySaving = a.monthlySaving ?? plan.budget.savings;
    if (a.type === 'more_income' || a.type === 'fix_deficit') continue; // 당장 실행할 수 있는 계획이 아님
    if (!fin(months) || !fin(goal) || !fin(monthlySaving) || months < 1) continue;
    if (months <= t.months * user.tolerance.extendRatio && goal >= t.goal * user.tolerance.minGoalRatio) {
      return { months, goal, monthlySaving };
    }
  }
  return null;
}

export function evaluate(buildPlan, user, replan) {
  const complaints = new Set();
  const t = user.truth;
  let plan;
  const t0 = performance.now();
  try {
    plan = buildPlan(structuredClone(user.input));
  } catch {
    complaints.add('C1');
    return { complaints, outcome: 'crash' };
  }
  if (performance.now() - t0 > 20) complaints.add('C10');

  if (user.invalid) {
    // 올바른 동작: 계산을 멈추고 오류 메시지 제공
    if (!(plan && plan.ok === false && plan.errors?.length)) complaints.add('C2');
    return { complaints, outcome: 'invalid_input' };
  }
  if (!plan || plan.ok === false) {
    complaints.add('C2');
    return { complaints, outcome: 'rejected' };
  }
  const s = plan.summary;
  const nums = [s.requiredMonthly, plan.budget.savings, plan.budget.buffer, s.income, ...plan.budget.categories.map((c) => c.recommended)];
  if (nums.some((x) => !fin(x)) || plan.budget.savings < 0) {
    complaints.add('C1');
    return { complaints, outcome: 'broken' };
  }
  if (s.goal !== t.goal || s.months !== t.months || s.current !== t.current) complaints.add('C2');

  if (user.quirks.includes('already_met')) {
    if (s.requiredMonthly < 0 || plan.budget.savings > 0) complaints.add('C7');
    return { complaints, outcome: 'already_met' };
  }

  // 비현실적 감축 요청
  for (const c of plan.budget.categories) {
    const ratio = c.current > 0 ? (c.current - c.recommended) / c.current : 0;
    if ((c.type === 'fixed' && ratio > 0.001) || (c.type === 'essential' && ratio > 0.1 + 1e-9) || (c.type === 'discretionary' && ratio > 0.35 + 1e-9)) {
      complaints.add('C5');
      break;
    }
  }
  if (plan.budget.savings % 1000 !== 0) complaints.add('C8');
  const sum = plan.budget.categories.reduce((a, c) => a + c.recommended, 0) + plan.budget.savings + plan.budget.buffer - (plan.budget.deficit || 0);
  if (Math.abs(sum - s.income) > 1 || plan.budget.buffer < -1) complaints.add('C9');

  let run;
  let target;
  if (s.feasible) {
    target = { months: t.months, goal: t.goal, monthlySaving: plan.budget.savings };
  } else {
    target = pickAlternative(user, plan);
    if (!target) {
      complaints.add('C6');
      // 구조적 한계인지: 적자이거나, 가장 관대한 사용자(기간 2.2배·목표 60%) 기준으로도 불가능
      const sv = plan.budget.savings;
      const rr = t.monthlyRateAfterTax;
      const n = Math.floor(t.months * 2.2);
      const best = rr === 0 ? t.current + sv * n : t.current * (1 + rr) ** n + (sv * ((1 + rr) ** n - 1)) / rr;
      const reason = sv <= 0 ? 'deficit' : best < t.goal * 0.6 ? 'unrealistic_goal' : 'not_offered';
      return { complaints, outcome: 'gave_up', reason };
    }
  }
  run = live(user, plan, target.months, target.goal, target.monthlySaving, replan);
  if (!run.success) complaints.add('C3');
  if (run.shortMonths >= 2) complaints.add('C4');
  return {
    complaints,
    outcome: s.feasible ? 'followed_plan' : 'followed_alternative',
    success: run.success,
    finalRatio: run.finalRatio,
    shortMonths: run.shortMonths,
  };
}

export async function runSimulation(plannerPath, n = N) {
  const { buildPlan, replan } = await import(plannerPath);
  const stats = {
    users: 0,
    complaintUsers: 0,
    complaints: Object.fromEntries(Object.keys(COMPLAINTS).map((k) => [k, 0])),
    outcomes: {},
    planned: 0,
    succeeded: 0,
    byPersona: {},
    byQuirk: {},
    gaveUp: { deficit: 0, unrealistic_goal: 0, not_offered: 0 },
  };
  const started = performance.now();
  for (const user of population(n, SEED)) {
    const r = evaluate(buildPlan, user, replan);
    stats.users++;
    stats.outcomes[r.outcome] = (stats.outcomes[r.outcome] || 0) + 1;
    if (r.reason) stats.gaveUp[r.reason]++;
    if (r.complaints.size) stats.complaintUsers++;
    for (const c of r.complaints) stats.complaints[c]++;
    const p = (stats.byPersona[user.persona] ??= { users: 0, complaintUsers: 0, planned: 0, succeeded: 0, top: {} });
    p.users++;
    if (r.complaints.size) p.complaintUsers++;
    for (const c of r.complaints) p.top[c] = (p.top[c] || 0) + 1;
    if (r.success !== undefined) {
      stats.planned++;
      p.planned++;
      if (r.success) { stats.succeeded++; p.succeeded++; }
    }
    for (const q of user.quirks.concat(user.invalid ? [user.invalid] : [])) {
      const b = (stats.byQuirk[q] ??= { users: 0, complaintUsers: 0 });
      b.users++;
      if (r.complaints.size) b.complaintUsers++;
    }
  }
  stats.seconds = (performance.now() - started) / 1000;
  return stats;
}

// ---------------- 리포트 ----------------
const pct = (a, b) => (b ? `${((a / b) * 100).toFixed(1)}%` : '-');

function table(rows) {
  const [head, ...body] = rows;
  return [`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`, ...body.map((r) => `| ${r.join(' | ')} |`)].join('\n');
}

export function renderReport(v1, v2) {
  const lines = [];
  lines.push('# 저축 플래너 10만 명 시뮬레이션 리포트', '');
  lines.push(`- 가상 사용자: **${v2.users.toLocaleString()}명** (시드 ${SEED}, \`npm run simulate:compare\`로 재현)`);
  lines.push('- 실제 개인정보가 아닌 합성 데이터입니다. 8개 사용자 유형, 7개 목표 유형, 입력 습관(쉼표·만원 단위·날짜 입력 등)을 섞었습니다.');
  lines.push('- 계획을 받은 뒤 매달 적금 자동이체 → 소득 변동·실직·돌발 지출(월 5%)·지출 과소 보고·절약 피로를 반영해 기간 끝까지 생활합니다.', '');
  lines.push('## 핵심 지표', '');
  lines.push(table([
    ['지표', 'v1 (첫 구현)', 'v2 (개선 후)'],
    ['컴플레인이 1건 이상인 사용자', pct(v1.complaintUsers, v1.users), pct(v2.complaintUsers, v2.users)],
    ['계획(또는 대안)을 따라 목표 달성', pct(v1.succeeded, v1.planned), pct(v2.succeeded, v2.planned)],
    ['계획을 받아 실행한 사용자', pct(v1.planned, v1.users), pct(v2.planned, v2.users)],
    ['대안 없이 포기', pct(v1.outcomes.gave_up || 0, v1.users), pct(v2.outcomes.gave_up || 0, v2.users)],
    ['실행 시간 (10만 명)', `${v1.seconds.toFixed(1)}초`, `${v2.seconds.toFixed(1)}초`],
  ]), '');
  lines.push('## 컴플레인 유형별', '');
  lines.push(table([
    ['코드', '내용', 'v1', 'v2'],
    ...Object.entries(COMPLAINTS).map(([k, label]) => [k, label, `${v1.complaints[k].toLocaleString()} (${pct(v1.complaints[k], v1.users)})`, `${v2.complaints[k].toLocaleString()} (${pct(v2.complaints[k], v2.users)})`]),
  ]), '');
  lines.push('### C6(대안 없음) 세부', '');
  lines.push(table([
    ['원인', 'v1', 'v2'],
    ['적자: 줄일 수 있는 만큼 줄여도 저축할 돈이 없음', v1.gaveUp.deficit.toLocaleString(), v2.gaveUp.deficit.toLocaleString()],
    ['목표 과다: 기간 2.2배로 늘려도 목표의 60% 미만', v1.gaveUp.unrealistic_goal.toLocaleString(), v2.gaveUp.unrealistic_goal.toLocaleString()],
    ['받아들일 만한 대안을 제시하지 못함 (서비스가 개선할 수 있는 부분)', v1.gaveUp.not_offered.toLocaleString(), v2.gaveUp.not_offered.toLocaleString()],
  ]), '');
  lines.push('## 사용자 유형별 (목표 달성률 / 컴플레인 비율)', '');
  lines.push(table([
    ['유형', '인원', 'v1 달성', 'v2 달성', 'v1 컴플레인', 'v2 컴플레인'],
    ...Object.keys(PERSONAS).map((k) => {
      const a = v1.byPersona[k];
      const b = v2.byPersona[k];
      return [PERSONAS[k].label, b.users.toLocaleString(), pct(a.succeeded, a.planned), pct(b.succeeded, b.planned), pct(a.complaintUsers, a.users), pct(b.complaintUsers, b.users)];
    }),
  ]), '');
  lines.push('## 입력 습관별 컴플레인 비율', '');
  const quirkLabel = {
    comma: '쉼표 입력 (3,000,000)', manwon: '만원 단위 (300만원)', blank_current: '현재 저축액 비움', rate_decimal: '이율을 0.035처럼 입력',
    rate_typo: '이율 오타 (3.5 → 35)', target_date: '기간 대신 목표 날짜', already_met: '이미 목표 달성', period_zero: '기간 0개월', negative_expense: '음수 지출', blank_goal: '목표 금액 비움',
  };
  lines.push(table([
    ['입력', '인원', 'v1', 'v2'],
    ...Object.keys(quirkLabel).filter((q) => v2.byQuirk[q]).map((q) => [quirkLabel[q], v2.byQuirk[q].users.toLocaleString(), pct(v1.byQuirk[q]?.complaintUsers || 0, v1.byQuirk[q]?.users || 0), pct(v2.byQuirk[q].complaintUsers, v2.byQuirk[q].users)]),
  ]), '');
  return lines.join('\n');
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const v1Path = join(here, 'legacy/planner-v1.js');
  const v2Path = join(here, '../planner.js');
  if (args.includes('--compare')) {
    const v1 = await runSimulation(v1Path);
    const v2 = await runSimulation(v2Path);
    const body = renderReport(v1, v2);
    const out = join(here, '../docs/simulation-results.md');
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, body + '\n');
    console.log(body);
  } else {
    const stats = await runSimulation(args.includes('--v1') ? v1Path : v2Path);
    console.log(`사용자 ${stats.users.toLocaleString()}명 · ${stats.seconds.toFixed(1)}초`);
    console.log(`컴플레인 사용자 ${pct(stats.complaintUsers, stats.users)} · 목표 달성 ${pct(stats.succeeded, stats.planned)} (실행 ${stats.planned.toLocaleString()}명)`);
    console.log('결과:', stats.outcomes, '포기 원인:', stats.gaveUp);
    for (const [k, label] of Object.entries(COMPLAINTS)) console.log(`${k} ${String(stats.complaints[k]).padStart(6)} ${pct(stats.complaints[k], stats.users).padStart(6)}  ${label}`);
    for (const [k, v] of Object.entries(stats.byPersona)) console.log(`  ${PERSONAS[k].label.padEnd(14)} 달성 ${pct(v.succeeded, v.planned)} 컴플레인 ${pct(v.complaintUsers, v.users)} ${JSON.stringify(v.top)}`);
    for (const [k, v] of Object.entries(stats.byQuirk)) console.log(`  [${k}] ${v.users} → 컴플레인 ${pct(v.complaintUsers, v.users)}`);
  }
}
