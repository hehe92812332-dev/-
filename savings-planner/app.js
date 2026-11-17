import { buildPlan, replan, parseAmount, won, DEFAULT_CATEGORIES, TYPE_LABELS, CUT_LIMITS } from './planner.js';

const STORE_KEY = 'moaplan:v1';
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const pct = (x, d = 0) => `${(x * 100).toFixed(d)}%`;
const comma = (n) => (Number.isFinite(n) ? Math.round(n).toLocaleString('ko-KR') : '-');

function shortWon(n) {
  if (n >= 1e8) return `${+(n / 1e8).toFixed(n % 1e8 ? 1 : 0)}억`;
  if (n >= 1e4) return `${Math.round(n / 1e4).toLocaleString('ko-KR')}만`;
  return comma(n);
}

const SAMPLE = {
  sample: true,
  goalName: '결혼 자금',
  goalAmount: '3,000만원',
  currentSavings: '500만원',
  periodMode: 'months',
  months: 24,
  targetDate: '',
  annualRate: '3.5',
  taxFree: false,
  incomeMonthly: '310만원',
  incomeType: 'fixed',
  incomeHistory: ['', '', '', '', '', ''],
  expenses: [
    { name: '주거비(월세·관리비)', type: 'fixed', amount: '650000' },
    { name: '보험료', type: 'fixed', amount: '120000' },
    { name: '통신비', type: 'essential', amount: '75000' },
    { name: '교통비', type: 'essential', amount: '110000' },
    { name: '식비(장보기)', type: 'essential', amount: '320000', history: ['290000', '310000', '340000'], showHist: true },
    { name: '경조사·선물', type: 'essential', amount: '60000' },
    { name: '외식·배달', type: 'discretionary', amount: '380000', history: ['290000', '340000', '410000'], showHist: true },
    { name: '쇼핑·의류', type: 'discretionary', amount: '210000', history: ['120000', '310000', '180000'], showHist: true },
    { name: '여가·취미', type: 'discretionary', amount: '120000' },
    { name: '구독 서비스', type: 'discretionary', amount: '42000' },
  ],
};

const blank = () => ({
  sample: false,
  goalName: '', goalAmount: '', currentSavings: '', periodMode: 'months', months: 12, targetDate: '', annualRate: '', taxFree: false,
  incomeMonthly: '', incomeType: 'fixed', incomeHistory: ['', '', '', '', '', ''],
  expenses: DEFAULT_CATEGORIES.map((c) => ({ ...c, amount: '' })),
});

let state = load() || structuredClone(SAMPLE);
let lastPlan = null;
let lastInput = null;

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  } catch {
    /* 저장 불가(사생활 보호 모드 등) — 계산은 그대로 동작 */
  }
}

// ---------------- 폼 ↔ 상태 ----------------

const simpleFields = ['goalName', 'goalAmount', 'currentSavings', 'months', 'targetDate', 'annualRate', 'incomeMonthly'];

function fillForm() {
  for (const f of simpleFields) $(f).value = state[f] ?? '';
  $('taxFree').checked = !!state.taxFree;
  $(state.periodMode === 'date' ? 'pm-date' : 'pm-months').checked = true;
  $(state.incomeType === 'variable' ? 'it-var' : 'it-fixed').checked = true;
  $('sample-note').hidden = !state.sample;
  renderIncomeHistory();
  renderExpenses();
  syncVisibility();
}

function syncVisibility() {
  $('f-months').hidden = state.periodMode !== 'months';
  $('f-date').hidden = state.periodMode !== 'date';
  $('income-history').hidden = state.incomeType !== 'variable';
}

function monthLabel(offset) {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + offset);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function renderIncomeHistory() {
  $('income-hist-inputs').innerHTML = state.incomeHistory
    .map((v, i) => `<label>${monthLabel(i - 6)}<input id="ih-${i}" data-ih="${i}" inputmode="numeric" value="${esc(v)}" placeholder="0"></label>`)
    .join('');
}

function renderExpenses() {
  const months = [-3, -2, -1].map(monthLabel);
  $('expense-rows').innerHTML = state.expenses
    .map((e, i) => {
      const h = e.history || ['', '', ''];
      return `<div class="exp-item">
        <div class="exp-row">
          <input id="en-${i}" data-e="${i}" data-k="name" value="${esc(e.name)}" aria-label="지출 항목 이름" placeholder="항목 이름">
          <select id="et-${i}" data-e="${i}" data-k="type" aria-label="${esc(e.name)} 유형">
            ${Object.entries(TYPE_LABELS).map(([k, l]) => `<option value="${k}"${e.type === k ? ' selected' : ''}>${l}</option>`).join('')}
          </select>
          <input id="ea-${i}" data-e="${i}" data-k="amount" value="${esc(e.amount)}" inputmode="numeric" aria-label="${esc(e.name)} 한 달 금액" placeholder="0">
          <button type="button" class="icon-btn" data-del="${i}" aria-label="${esc(e.name)} 삭제">×</button>
        </div>
        <button type="button" class="toggle-hist" data-th="${i}">${e.showHist ? '− 최근 3개월 접기' : '+ 최근 3개월 입력'}</button>
        ${e.showHist ? `<div class="exp-hist">${months.map((m, j) => `${j === 0 ? '<span>최근</span>' : ''}<input id="eh-${i}-${j}" data-eh="${i}" data-j="${j}" value="${esc(h[j])}" inputmode="numeric" aria-label="${esc(e.name)} ${m}" placeholder="${m}">`).join('')}</div>` : ''}
      </div>`;
    })
    .join('');
}

function toInput() {
  const input = {
    goalName: state.goalName,
    goalAmount: state.goalAmount,
    currentSavings: state.currentSavings,
    annualRate: state.annualRate,
    taxFree: state.taxFree,
    income: { type: state.incomeType, monthly: state.incomeMonthly },
    expenses: state.expenses.map((e) => ({
      name: e.name,
      type: e.type,
      amount: e.amount,
      history: e.showHist ? (e.history || []).filter((x) => String(x).trim() !== '') : [],
    })),
  };
  if (state.periodMode === 'date') {
    input.startDate = new Date().toISOString().slice(0, 10);
    input.targetDate = state.targetDate;
  } else input.months = state.months;
  if (state.incomeType === 'variable') {
    const h = state.incomeHistory.filter((x) => String(x).trim() !== '');
    if (h.length) input.income.history = h;
    if (!String(state.incomeMonthly).trim() && h.length) input.income.monthly = h.at(-1);
  }
  return input;
}

function updateHints() {
  for (const id of ['goalAmount', 'currentSavings', 'incomeMonthly']) {
    const el = document.querySelector(`.hint[data-for="${id}"]`);
    const v = parseAmount(state[id]);
    const input = $(id);
    el.classList.remove('err');
    input.removeAttribute('aria-invalid');
    if (v === null) el.textContent = '';
    else if (!Number.isFinite(v) || v < 0) {
      el.textContent = '숫자나 "300만원"처럼 적어 주세요';
      el.classList.add('err');
      input.setAttribute('aria-invalid', 'true');
    } else el.textContent = `= ${won(v)}`;
  }
}

// ---------------- 계산 & 렌더 ----------------

let timer;
function schedule() {
  clearTimeout(timer);
  timer = setTimeout(recalc, 180);
}

function recalc() {
  save();
  updateHints();
  lastInput = toInput();
  lastPlan = buildPlan(lastInput);
  render(lastPlan);
}

const STATUS = {
  comfortable: ['여유 있음', 'good', '지금 수입·지출로 넉넉하게 모을 수 있어요.'],
  tight: ['빠듯함', 'warn', '모을 수는 있지만 여유가 적어요. 돌발 지출에 대비해 생활비 통장 여유분을 꼭 지켜 주세요.'],
  adjust: ['지출 조정', 'warn', '아래 지출 계획대로 몇 가지 항목만 줄이면 기간 안에 모을 수 있어요.'],
  infeasible: ['기간 내 어려움', 'bad', '지금 수입·지출로는 기간 안에 목표를 채우기 어려워요. 아래 대안 중 하나를 골라 보세요.'],
  achieved: ['달성', 'good', '추가로 모을 필요가 없어요.'],
};

function render(plan) {
  const root = $('results');
  if (!String(state.goalAmount).trim() && !String(state.incomeMonthly).trim()) {
    root.innerHTML = '<div class="panel empty"><h2 style="justify-content:center">목표 금액과 월 수입을 넣어 보세요</h2><p>입력하는 대로 저축 계획, 지출 분석, 항목별 예산이 여기에 나타납니다.</p></div>';
    return;
  }
  if (!plan.ok) {
    root.innerHTML = `<div class="panel"><h2>입력을 확인해 주세요</h2><ul class="warnings errors">${plan.errors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul></div>`;
    return;
  }
  root.innerHTML = [heroPanel(plan), alternativesPanel(plan), chartPanel(plan), analysisPanel(plan), budgetPanel(plan), insightsPanel(plan), checkinPanel(plan), passbookPanel(plan)].join('');
  bindResultEvents(plan);
}

function heroPanel(plan) {
  const s = plan.summary;
  const b = plan.budget;
  const [label, tone, sub] = STATUS[s.status];
  const headline =
    s.status === 'achieved'
      ? `목표 <span class="num">${won(s.goal)}</span> 달성`
      : s.status === 'infeasible'
        ? `매달 <span class="num">${won(s.requiredMonthly)}</span>이 필요해요`
        : `매달 <span class="num">${won(b.savings)}</span>씩 ${s.months}개월`;
  return `<div class="panel hero">
    <span class="stamp ${tone}">${label}</span>
    <div class="goal-name">${esc(s.goalName || '나의 목표')} · ${won(s.goal)}${s.current ? ` · 지금 ${won(s.current)} (${pct(s.progress)})` : ''}</div>
    <h1 class="headline">${headline}</h1>
    <p class="sub">${sub}</p>
    <dl class="kpis">
      <div class="kpi"><dt>월 저축액</dt><dd>${comma(b.savings)}원</dd></div>
      <div class="kpi"><dt>저축률</dt><dd>${pct(s.savingsRate)}</dd></div>
      <div class="kpi"><dt>생활비 통장 여유/월</dt><dd>${b.deficit ? `<span style="color:var(--bad)">−${comma(b.deficit)}원</span>` : `${comma(b.buffer)}원`}</dd></div>
      <div class="kpi"><dt>예상 세후 이자</dt><dd>${comma(s.interestTotal)}원</dd></div>
    </dl>
    ${plan.warnings.length ? `<ul class="warnings">${plan.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
    <div class="actions" style="margin-top:14px"><button type="button" class="ghost" id="btn-copy">계획 요약 복사</button><span class="toast" id="copy-toast" role="status"></span></div>
  </div>`;
}

function alternativesPanel(plan) {
  if (!plan.alternatives.length) return '';
  return `<div class="panel"><h2>이렇게 바꿔 보세요 <small>대안을 누르면 그 조건으로 다시 계산합니다</small></h2>
    <div class="alts">${plan.alternatives
      .map((a, i) => `<div class="alt"><strong>${esc(a.title)}</strong><p>${esc(a.detail)}</p>${['extend', 'lower_goal', 'balanced'].includes(a.type) ? `<button type="button" class="ghost" data-alt="${i}">이 조건으로 계획 보기</button>` : ''}</div>`)
      .join('')}</div></div>`;
}

function chartPanel(plan) {
  const s = plan.summary;
  const rows = plan.schedule;
  if (!rows.length || s.status === 'achieved' && s.current >= s.goal) return '';
  const W = 640, H = 230, L = 58, R = 16, T = 16, B = 30;
  const n = rows.length;
  const maxY = Math.max(s.goal, rows.at(-1).balance, s.current) * 1.08;
  const x = (m) => L + ((W - L - R) * m) / n;
  const y = (v) => T + (H - T - B) * (1 - v / maxY);
  const pts = [[0, s.current], ...rows.map((r) => [r.month, r.balance])];
  const line = pts.map(([m, v], i) => `${i ? 'L' : 'M'}${x(m).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const area = `${line}L${x(n).toFixed(1)},${y(0)}L${x(0)},${y(0)}Z`;
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * maxY / 1.08);
  const xTicks = [...new Set([0, Math.round(n / 2), n])];
  const ms = rows.filter((r) => r.milestone);
  return `<div class="panel"><h2>모이는 속도 <small>${n}개월 뒤 예상 ${won(s.finalBalance)}</small></h2>
    <svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="월별 예상 잔액 그래프">
      ${yTicks.map((v) => `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${shortWon(v)}</text>`).join('')}
      ${xTicks.map((m) => `<text x="${x(m)}" y="${H - 10}" text-anchor="${m === 0 ? 'start' : m === n ? 'end' : 'middle'}">${m === 0 ? '지금' : `${m}개월`}</text>`).join('')}
      <path class="bal-area" d="${area}"/>
      <path class="bal-line" d="${line}"/>
      <line class="goal-line" x1="${L}" x2="${W - R}" y1="${y(s.goal)}" y2="${y(s.goal)}"/>
      <text class="goal-label" x="${W - R}" y="${y(s.goal) - 6}" text-anchor="end">목표 ${shortWon(s.goal)}</text>
      ${ms.map((r) => `<circle class="dot" cx="${x(r.month)}" cy="${y(r.balance)}" r="4.5"><title>${r.month}개월: ${r.milestone}% 달성</title></circle>`).join('')}
    </svg>
    <div class="legend"><span><i></i>예상 잔액 (세후 이자 포함)</span><span><i class="g"></i>목표 금액</span><span>● 25·50·75·100% 달성 시점</span></div>
  </div>`;
}

function analysisPanel(plan) {
  const a = plan.analysis;
  const s = plan.summary;
  const inc = s.income || 1;
  const cats = [...a.categories].sort((p, q) => q.current - p.current);
  const maxShare = Math.max(0.3, ...cats.map((c) => c.share), ...cats.map((c) => c.benchmark));
  const free = Math.max(0, 1 - a.fixedShare - a.essentialShare - a.discretionaryShare);
  const colors = { fixed: 'var(--muted)', essential: 'var(--accent)', discretionary: 'var(--warn)', free: 'var(--line)' };
  const info = a.income;
  const incLine = info.type === 'variable' && info.average
    ? `최근 ${info.months}개월 평균 ${won(Math.round(info.average))} · 최저 ${won(info.min)} · 최고 ${won(info.max)} (변동 ${pct(info.cv)}) → 계획 기준 <b>${won(s.income)}</b>`
    : `계획 기준 월 수입 <b>${won(s.income)}</b>`;
  return `<div class="panel"><h2>수입·지출 분석 <small>지출 ${won(s.totalExpense)} / 수입 ${won(s.income)}</small></h2>
    <p class="help" style="margin-bottom:10px">${incLine}</p>
    <div class="mix" role="img" aria-label="수입 구성">
      ${['fixed', 'essential', 'discretionary'].map((t) => `<span style="width:${Math.min(100, a[t + 'Share'] * 100)}%;background:${colors[t]}"></span>`).join('')}
      <span style="width:${free * 100}%;background:${colors.free}"></span>
    </div>
    <div class="mix-legend">
      <span><i class="sw" style="background:${colors.fixed}"></i>고정비 <b>${pct(a.fixedShare)}</b></span>
      <span><i class="sw" style="background:${colors.essential}"></i>필수 생활비 <b>${pct(a.essentialShare)}</b></span>
      <span><i class="sw" style="background:${colors.discretionary}"></i>선택 지출 <b>${pct(a.discretionaryShare)}</b></span>
      <span><i class="sw" style="background:${colors.free}"></i>남는 돈 <b>${pct(free)}</b></span>
    </div>
    <div class="bars">${cats
      .map((c) => {
        const chips = [];
        if (c.overBenchmark) chips.push('<span class="chip warn">권장보다 많음</span>');
        if (c.trend === 'up') chips.push('<span class="chip bad">증가 중</span>');
        if (c.trend === 'down') chips.push('<span class="chip good">감소 중</span>');
        if ((c.volatility ?? 0) > 0.3) chips.push('<span class="chip">들쭉날쭉</span>');
        if (!c.fromHistory && c.type !== 'fixed') chips.push('<span class="chip">추정치</span>');
        return `<div class="bar-row">
          <div class="nm"><span class="name" title="${esc(c.name)}">${esc(c.name)}</span>${chips.length ? `<span class="chips">${chips.join('')}</span>` : ''}</div>
          <div class="track" title="권장 비중 ${pct(c.benchmark)}"><div class="fill ${c.overBenchmark ? 'over' : ''} t-${c.type}" style="width:${Math.min(100, (c.share / maxShare) * 100)}%"></div><div class="mark" style="left:${Math.min(100, (c.benchmark / maxShare) * 100)}%"></div></div>
          <div class="val">${comma(c.current)} · ${pct(c.share, 1)}</div>
        </div>`;
      })
      .join('')}</div>
    <p class="help" style="margin-top:10px">막대 = 수입 대비 비중, 세로선 = 권장 비중. 최근 3개월을 넣은 항목은 평균으로 계산합니다.</p>
  </div>`;
}

function budgetPanel(plan) {
  const b = plan.budget;
  const s = plan.summary;
  if (!b.categories.length && !b.savings) return '';
  const rows = b.categories
    .map((c) => `<tr>
      <td>${esc(c.name)} <span class="t-badge">${TYPE_LABELS[c.type]}</span></td>
      <td class="num">${comma(c.current)}</td>
      <td class="num">${comma(c.recommended)}</td>
      <td class="num">${c.cut ? `<span class="cut">−${comma(c.cut)}</span>` : '–'}</td>
      <td class="num">${c.weekly ? comma(c.weekly) : '–'}</td>
    </tr>`)
    .join('');
  const spend = b.categories.reduce((a, c) => a + c.recommended, 0);
  return `<div class="panel"><h2>지출 계획 <small>한 달 기준 · 원</small></h2>
    <div class="table-wrap"><table>
      <thead><tr><th>항목</th><th>지금</th><th>권장 예산</th><th>줄일 금액</th><th>주간 한도</th></tr></thead>
      <tbody>${rows}
        <tr class="sep"><td>지출 합계</td><td class="num">${comma(s.totalExpense)}</td><td class="num">${comma(spend)}</td><td class="num">${b.totalCut ? `<span class="cut">−${comma(b.totalCut)}</span>` : '–'}</td><td></td></tr>
        <tr><td>목표 통장 자동이체</td><td></td><td class="num">${comma(b.savings)}</td><td></td><td></td></tr>
        <tr><td>생활비 통장 여유 (돌발 지출 대비)</td><td></td><td class="num">${b.deficit ? `−${comma(b.deficit)}` : comma(b.buffer)}</td><td></td><td></td></tr>
        <tr class="total"><td>합계 = 계획 기준 수입</td><td></td><td class="num">${comma(spend + b.savings + b.buffer - b.deficit)}</td><td></td><td></td></tr>
      </tbody>
    </table></div>
    <p class="help" style="margin-top:10px">줄이는 한도: 고정비 ${pct(CUT_LIMITS.fixed)}, 필수 생활비 최대 ${pct(CUT_LIMITS.essential)}, 선택 지출 최대 ${pct(CUT_LIMITS.discretionary)}. 주간 한도는 선택 지출을 일주일 단위로 나눈 금액이에요. 월급날 목표 통장으로 자동이체를 걸어 두세요.</p>
  </div>`;
}

function insightsPanel(plan) {
  if (!plan.insights.length) return '';
  return `<div class="panel"><h2>분석 요약</h2><ul class="insights">${plan.insights.map((i) => `<li class="${i.level}">${esc(i.text)}</li>`).join('')}</ul></div>`;
}

function checkinPanel(plan) {
  const s = plan.summary;
  if (s.status === 'achieved') return '';
  return `<div class="panel"><h2>중간 점검 <small>${plan.budget.checkInEvery}개월마다 해 주세요</small></h2>
    <p class="help" style="margin-bottom:10px">계획대로 가고 있는지 확인하고, 지금 잔액과 남은 기간으로 월 저축액을 다시 맞춥니다. 생활비 통장에 ${won(plan.budget.cushion)}보다 많이 남아 있으면 넘는 돈은 목표 통장으로 옮기는 것으로 계산해요.</p>
    <div class="checkin">
      <label class="field">지난 개월 수<input id="ci-elapsed" type="number" min="1" max="${s.months - 1}" value="${Math.min(3, Math.max(1, s.months - 1))}"></label>
      <label class="field">목표 통장 잔액<input id="ci-balance" inputmode="numeric" placeholder="예: 900만원"></label>
      <label class="field">생활비 통장 잔액<input id="ci-cash" inputmode="numeric" placeholder="선택"></label>
    </div>
    <div class="actions" style="margin-top:10px"><button type="button" class="primary" id="btn-checkin">다시 계산</button></div>
    <div class="checkin-out" id="checkin-out" role="status"></div>
  </div>`;
}

function passbookPanel(plan, all = false) {
  const rows = plan.schedule;
  if (!rows.length || plan.budget.savings === 0) return '';
  const show = all ? rows : rows.slice(0, 12);
  return `<div class="panel" id="pb-panel"><h2>월별 저축 일정 <small>통장 내역처럼 미리 보기</small></h2>
    <div class="table-wrap passbook"><table>
      <thead><tr><th>회차</th><th>날짜</th><th>입금</th><th>이자(세후)</th><th>잔액</th><th>비고</th></tr></thead>
      <tbody>${show.map((r) => `<tr class="${r.milestone ? 'ms' : ''}"><td>${r.month}</td><td>${monthLabel(r.month - 1)}</td><td>${comma(r.deposit)}</td><td>${comma(r.interest)}</td><td>${comma(r.balance)}</td><td>${r.milestone ? `${r.milestone}% 달성` : ''}</td></tr>`).join('')}</tbody>
    </table></div>
    ${rows.length > 12 && !all ? `<button type="button" class="link pb-more" id="btn-pb-all">${rows.length}개월 전체 보기</button>` : ''}
  </div>`;
}

function summaryText(plan) {
  const s = plan.summary;
  const b = plan.budget;
  const lines = [
    `[모아플랜] ${s.goalName || '나의 목표'} ${won(s.goal)} / ${s.months}개월`,
    `상태: ${STATUS[s.status][0]}`,
    `월 저축액: ${won(b.savings)} (저축률 ${pct(s.savingsRate)})`,
    `생활비 통장 여유: ${won(b.buffer)}/월`,
    '',
    '지출 계획(권장 예산):',
    ...b.categories.map((c) => `- ${c.name}: ${won(c.recommended)}${c.cut ? ` (−${won(c.cut)})` : ''}`),
  ];
  if (plan.alternatives.length) lines.push('', '대안:', ...plan.alternatives.map((a) => `- ${a.title}`));
  return lines.join('\n');
}

function bindResultEvents(plan) {
  $('btn-copy')?.addEventListener('click', () => {
    const text = summaryText(plan);
    const done = (msg) => ($('copy-toast').textContent = msg);
    navigator.clipboard?.writeText(text).then(() => done('복사했습니다'), () => done('복사가 막혀 있어요. 아래 내용을 직접 선택해 복사해 주세요.'));
  });
  document.querySelectorAll('[data-alt]').forEach((btn) =>
    btn.addEventListener('click', () => {
      const a = plan.alternatives[Number(btn.dataset.alt)];
      state.periodMode = 'months';
      state.months = a.months;
      state.goalAmount = String(a.goal);
      state.sample = false;
      fillForm();
      recalc();
      $('results').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }),
  );
  $('btn-pb-all')?.addEventListener('click', () => {
    $('pb-panel').outerHTML = passbookPanel(plan, true);
  });
  $('btn-checkin')?.addEventListener('click', () => {
    const out = $('checkin-out');
    const elapsed = Number($('ci-elapsed').value);
    const bal = parseAmount($('ci-balance').value);
    const cash = parseAmount($('ci-cash').value) ?? 0;
    const s = plan.summary;
    if (!Number.isInteger(elapsed) || elapsed < 1 || elapsed >= s.months) {
      out.innerHTML = `<span style="color:var(--bad)">지난 개월 수는 1~${s.months - 1} 사이로 넣어 주세요.</span>`;
      return;
    }
    if (bal === null || !Number.isFinite(bal) || bal < 0) {
      out.innerHTML = '<span style="color:var(--bad)">목표 통장 잔액을 넣어 주세요.</span>';
      return;
    }
    const move = Number.isFinite(cash) ? Math.max(0, cash - plan.budget.cushion) : 0;
    const expected = plan.schedule[elapsed - 1]?.balance ?? 0;
    const np = replan(lastInput, { currentSavings: bal + move, monthsLeft: s.months - elapsed });
    if (!np.ok) {
      out.textContent = np.errors.join(' ');
      return;
    }
    const diff = bal + move - expected;
    out.innerHTML = `${move ? `생활비 통장에서 <b>${won(move)}</b>을 목표 통장으로 옮기면 ` : ''}계획 대비 <b style="color:${diff >= 0 ? 'var(--good)' : 'var(--bad)'}">${diff >= 0 ? '+' : ''}${won(diff)}</b>입니다.<br>
      남은 ${s.months - elapsed}개월 동안 매달 <b>${won(np.budget.savings)}</b>${np.budget.savings !== plan.budget.savings ? ` (지금 ${won(plan.budget.savings)} → ${np.budget.savings > plan.budget.savings ? '늘리기' : '줄여도 됨'})` : ''}을 모으면 됩니다. 상태: <b>${STATUS[np.summary.status][0]}</b>`;
  });
}

// ---------------- 이벤트 ----------------

function bind() {
  const form = $('plan-form');
  form.addEventListener('submit', (e) => e.preventDefault());
  form.addEventListener('input', (e) => {
    const t = e.target;
    state.sample = false;
    $('sample-note').hidden = true;
    if (simpleFields.includes(t.id)) state[t.id] = t.value;
    else if (t.id === 'taxFree') state.taxFree = t.checked;
    else if (t.name === 'periodMode') { state.periodMode = t.value; syncVisibility(); }
    else if (t.name === 'incomeType') { state.incomeType = t.value; syncVisibility(); }
    else if (t.dataset.ih !== undefined) state.incomeHistory[Number(t.dataset.ih)] = t.value;
    else if (t.dataset.e !== undefined) state.expenses[Number(t.dataset.e)][t.dataset.k] = t.value;
    else if (t.dataset.eh !== undefined) {
      const ex = state.expenses[Number(t.dataset.eh)];
      ex.history = ex.history || ['', '', ''];
      ex.history[Number(t.dataset.j)] = t.value;
      if (Number(t.dataset.j) === 2 && t.value.trim()) {
        ex.amount = t.value;
        $(`ea-${t.dataset.eh}`).value = t.value;
      }
    }
    schedule();
  });
  form.addEventListener('change', (e) => {
    if (e.target.dataset.k === 'type') schedule();
  });
  form.addEventListener('click', (e) => {
    const del = e.target.closest('[data-del]');
    const th = e.target.closest('[data-th]');
    if (del) {
      state.expenses.splice(Number(del.dataset.del), 1);
      renderExpenses();
      schedule();
    } else if (th) {
      const ex = state.expenses[Number(th.dataset.th)];
      ex.showHist = !ex.showHist;
      if (ex.showHist && !ex.history) ex.history = ['', '', ''];
      renderExpenses();
      schedule();
    }
  });
  $('btn-add-exp').addEventListener('click', () => {
    state.expenses.push({ name: '', type: 'discretionary', amount: '' });
    renderExpenses();
    $(`en-${state.expenses.length - 1}`).focus();
  });
  $('btn-sample').addEventListener('click', () => {
    state = structuredClone(SAMPLE);
    fillForm();
    recalc();
  });
  $('btn-reset').addEventListener('click', () => {
    state = blank();
    fillForm();
    recalc();
    $('goalAmount').focus();
  });
}

fillForm();
bind();
recalc();
