// 저축 플래너 v1 (첫 구현). 10만 명 시뮬레이션의 기준선으로 보존합니다.
// 현재 서비스 코드는 ../../planner.js 입니다.

const LIMITS = { fixed: 0, essential: 0.2, discretionary: 0.5 };

export function buildPlan(input) {
  const goal = Number(input.goalAmount);
  const current = Number(input.currentSavings || 0);
  const months = Number(input.months);
  const rate = Number(input.annualRate || 0) / 100 / 12;

  let income = Number(input.income.monthly);
  if (input.income.type === 'variable' && input.income.history?.length) {
    income = input.income.history.reduce((a, b) => a + Number(b), 0) / input.income.history.length;
  }

  const expenses = input.expenses.map((e) => ({ ...e, amount: Number(e.amount) }));
  const totalExpense = expenses.reduce((a, e) => a + e.amount, 0);
  const surplus = income - totalExpense;

  const growth = Math.pow(1 + rate, months);
  const required = rate === 0
    ? (goal - current) / months
    : ((goal - current * growth) * rate) / (growth - 1);

  const budget = expenses.map((e) => ({ name: e.name, type: e.type, current: e.amount, recommended: e.amount }));
  let feasible = surplus >= required;
  let gap = required - surplus;

  if (!feasible) {
    for (const type of ['discretionary', 'essential']) {
      const pool = budget.filter((b) => b.type === type);
      const cuttable = pool.reduce((a, b) => a + b.current * LIMITS[type], 0);
      if (cuttable <= 0) continue;
      const ratio = Math.min(1, gap / cuttable);
      for (const b of pool) {
        const cut = b.current * LIMITS[type] * ratio;
        b.recommended = b.current - cut;
        gap -= cut;
      }
      if (gap <= 0) break;
    }
    feasible = gap <= 0.5;
  }

  const savings = feasible ? required : Math.max(0, income - budget.reduce((a, b) => a + b.recommended, 0));
  const alternatives = [];
  if (!feasible && savings > 0) {
    let m = months;
    let bal = current;
    while (bal < goal && m < 1200) {
      m++;
      bal = current;
      for (let i = 0; i < m; i++) bal = bal * (1 + rate) + savings;
    }
    alternatives.push({ type: 'extend', months: m });
  }

  const schedule = [];
  let bal = current;
  for (let i = 1; i <= months; i++) {
    bal = bal * (1 + rate) + savings;
    schedule.push({ month: i, deposit: savings, balance: bal });
  }

  return {
    ok: true,
    summary: { goal, current, months, income, totalExpense, surplus, requiredMonthly: required, feasible },
    budget: { categories: budget, savings, buffer: income - budget.reduce((a, b) => a + b.recommended, 0) - savings },
    alternatives,
    schedule,
  };
}
