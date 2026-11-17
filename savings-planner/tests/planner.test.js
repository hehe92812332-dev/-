import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPlan, replan, parseAmount, monthsBetween, requiredPayment, futureValue, monthsToReach, won, CUT_LIMITS } from '../planner.js';

const base = () => ({
  goalAmount: 12000000,
  currentSavings: 0,
  months: 12,
  annualRate: 0,
  income: { type: 'fixed', monthly: 3000000 },
  expenses: [
    { name: '주거비(월세·관리비)', type: 'fixed', amount: 600000 },
    { name: '식비(장보기)', type: 'essential', amount: 400000, history: [400000, 400000, 400000] },
    { name: '외식·배달', type: 'discretionary', amount: 300000, history: [300000, 300000, 300000] },
    { name: '쇼핑·의류', type: 'discretionary', amount: 200000, history: [200000, 200000, 200000] },
  ],
});

const sumsToIncome = (p) => {
  const b = p.budget;
  const total = b.categories.reduce((a, c) => a + c.recommended, 0) + b.savings + b.buffer - b.deficit;
  assert.equal(total, p.summary.income);
};

test('parseAmount: 쉼표·원·만/천/억 단위', () => {
  assert.equal(parseAmount('3,000,000'), 3000000);
  assert.equal(parseAmount('300만원'), 3000000);
  assert.equal(parseAmount('300만'), 3000000);
  assert.equal(parseAmount('1억 5천만원'), 150000000);
  assert.equal(parseAmount('1억5000만'), 150000000);
  assert.equal(parseAmount('3.5만'), 35000);
  assert.equal(parseAmount('5천'), 5000);
  assert.equal(parseAmount(' 250000 원 '), 250000);
  assert.equal(parseAmount(''), null);
  assert.ok(Number.isNaN(parseAmount('abc')));
  assert.ok(Number.isNaN(parseAmount('3만4만')) === false); // 3만 + 4만으로 읽힘
  assert.equal(parseAmount('-5만'), -50000);
});

test('monthsBetween', () => {
  assert.equal(monthsBetween('2026-12-01', '2027-12-01'), 12);
  assert.equal(monthsBetween('2026-12-15', '2027-01-01'), 1);
  assert.ok(Number.isNaN(monthsBetween('', '2027-01-01')));
});

test('이자 계산식: 필요 저축액으로 정확히 목표에 도달', () => {
  const r = 0.035 / 12;
  const pmt = requiredPayment(10000000, 1000000, r, 24);
  assert.ok(Math.abs(futureValue(1000000, pmt, r, 24) - 10000000) < 1e-6);
  assert.equal(monthsToReach(10000000, 1000000, pmt, r), 24);
  assert.equal(requiredPayment(100, 0, 0, 4), 25);
  assert.equal(monthsToReach(100, 0, 0, 0), Infinity);
});

test('여유 있는 계획: 저축액 1,000원 단위, 합계 = 수입, 감축 없음', () => {
  const p = buildPlan({ ...base(), annualRate: 3.5 });
  assert.equal(p.ok, true);
  assert.equal(p.summary.status, 'comfortable');
  assert.equal(p.budget.savings % 1000, 0);
  assert.equal(p.budget.totalCut, 0);
  assert.ok(p.schedule.at(-1).balance >= 12000000);
  sumsToIncome(p);
});

test('이자소득세 15.4% 반영, 비과세 선택 시 미반영', () => {
  const taxed = buildPlan({ ...base(), annualRate: 4 });
  const free = buildPlan({ ...base(), annualRate: 4, taxFree: true });
  assert.ok(Math.abs(taxed.summary.effectiveAnnualRate - 4 * 0.846) < 1e-9);
  assert.equal(free.summary.effectiveAnnualRate, 4);
  assert.ok(free.summary.requiredMonthly <= taxed.summary.requiredMonthly);
});

test('지출 조정 필요: 고정비는 그대로, 한도 이내로만 감축', () => {
  const input = base();
  input.goalAmount = 17000000;
  const p = buildPlan(input);
  assert.equal(p.summary.status, 'adjust');
  for (const c of p.budget.categories) {
    assert.ok(c.cut <= c.current * CUT_LIMITS[c.type] + 1e-9, `${c.name} 감축 한도 초과`);
    if (c.type === 'fixed') assert.equal(c.cut, 0);
  }
  assert.ok(p.budget.slipReserve > 0);
  sumsToIncome(p);
});

test('불가능: 기간 연장·목표 조정·추가 수입 대안 제시', () => {
  const input = base();
  input.goalAmount = 40000000;
  const p = buildPlan(input);
  assert.equal(p.summary.status, 'infeasible');
  const types = p.alternatives.map((a) => a.type);
  assert.ok(types.includes('extend'));
  assert.ok(types.includes('lower_goal'));
  assert.ok(types.includes('more_income'));
  const ext = p.alternatives.find((a) => a.type === 'extend');
  assert.ok(futureValue(0, ext.monthlySaving, 0, ext.months) >= ext.goal);
  sumsToIncome(p);
});

test('적자: 저축 0원, 적자 해결 안내', () => {
  const input = base();
  input.income.monthly = 1200000;
  const p = buildPlan(input);
  assert.equal(p.summary.status, 'infeasible');
  assert.equal(p.budget.savings, 0);
  assert.ok(p.budget.deficit > 0);
  assert.ok(p.alternatives.some((a) => a.type === 'fix_deficit'));
  sumsToIncome(p);
});

test('이미 목표 달성', () => {
  const p = buildPlan({ ...base(), currentSavings: '1,300만원' });
  assert.equal(p.summary.status, 'achieved');
  assert.equal(p.budget.savings, 0);
  assert.equal(p.summary.requiredMonthly, 0);
});

test('변동 소득: 평균보다 낮은 보수적 소득으로 계획', () => {
  const input = base();
  input.income = { type: 'variable', monthly: 3000000, history: [4500000, 2000000, 3500000, 1500000, 3800000, 2700000] };
  const p = buildPlan(input);
  assert.equal(p.analysis.income.type, 'variable');
  assert.ok(p.summary.income < p.analysis.income.average);
  assert.ok(p.summary.income >= p.analysis.income.min);
  assert.ok(p.budget.cushion >= p.summary.totalExpense);
});

test('기억으로 적은 지출은 여유분 확보', () => {
  const input = base();
  input.expenses = input.expenses.map(({ history, ...e }) => e);
  const p = buildPlan(input);
  assert.ok(p.analysis.estimationReserve > 0);
  assert.ok(p.budget.minBuffer > 3000000 * 0.05);
});

test('이율 입력 해석: 0.035 → 3.5%, 35% → 0%로 보수 계산', () => {
  const a = buildPlan({ ...base(), annualRate: 0.035 });
  assert.equal(a.summary.annualRate, 3.5);
  assert.ok(a.warnings.length);
  const b = buildPlan({ ...base(), annualRate: 35 });
  assert.equal(b.summary.annualRate, 0);
  assert.ok(b.warnings.some((w) => w.includes('비정상')));
});

test('목표 날짜로 기간 입력', () => {
  const p = buildPlan({ ...base(), months: undefined, startDate: '2026-12-01', targetDate: '2027-12-01' });
  assert.equal(p.summary.months, 12);
});

test('잘못된 입력은 계산하지 않고 이유를 알려줌', () => {
  for (const patch of [{ goalAmount: '' }, { months: 0 }, { months: 601 }, { goalAmount: '많이' }, { income: { monthly: '' } }]) {
    const p = buildPlan({ ...base(), ...patch });
    assert.equal(p.ok, false, JSON.stringify(patch));
    assert.ok(p.errors.length);
  }
  const neg = base();
  neg.expenses[1].amount = -50000;
  neg.expenses[1].history = [];
  assert.equal(buildPlan(neg).ok, false);
});

test('지출 패턴 분석: 권장 비중 초과·증가 추세·변동성', () => {
  const input = base();
  input.expenses.push({ name: '외식·배달2', type: 'discretionary', amount: 0, history: [100000, 300000, 500000] });
  input.expenses[2].history = [250000, 300000, 350000];
  const p = buildPlan(input);
  const eat = p.analysis.categories.find((c) => c.name === '외식·배달');
  assert.equal(eat.overBenchmark, true); // 30만/300만 = 10% > 7%×1.2
  assert.equal(eat.trend, 'up');
  const v = p.analysis.categories.find((c) => c.name === '외식·배달2');
  assert.ok(v.volatility > 0.3);
  assert.ok(p.insights.some((i) => i.text.includes('외식·배달')));
});

test('중간 점검(replan): 남은 기간·현재 잔액으로 재계산', () => {
  const input = base();
  const p = replan(input, { currentSavings: 6000000, monthsLeft: 6, expenseHistory: { '외식·배달': [350000, 350000, 350000] } });
  assert.equal(p.summary.months, 6);
  assert.equal(p.summary.current, 6000000);
  assert.equal(p.summary.requiredMonthly, 1000000);
  assert.equal(p.analysis.categories.find((c) => c.name === '외식·배달').current, 350000);
});

test('won() 표기', () => {
  assert.equal(won(3000000), '300만원');
  assert.equal(won(150000000), '1억 5,000만원');
  assert.equal(won(12345), '12,345원');
});
