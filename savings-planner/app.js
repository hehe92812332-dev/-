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
  const d = new Date();
  $('today').textContent = `작성일 ${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}.`;
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
          <button type="button" class="del" data-del="${i}" aria-label="${esc(e.name)} 지우기">×</button>
        </div>
        <button type="button" class="toggle-hist" data-th="${i}">${e.showHist ? '석 달 기록 접기' : '석 달 기록 적기'}</button>
        ${e.showHist ? `<div class="exp-hist">${months.map((m, j) => `<label>${m}<input id="eh-${i}-${j}" data-eh="${i}" data-j="${j}" value="${esc(h[j])}" inputmode="numeric" aria-label="${esc(e.name)} ${m}" placeholder="0"></label>`).join('')}</div>` : ''}
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
      el.textContent = "숫자나 300만원처럼 적어 주세요";
      el.classList.add('err');
      input.setAttribute('aria-invalid', 'true');
    } else el.textContent = korWon(v);
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
  comfortable: ['여유 있게 모을 수 있어요', 'good'],
  tight: ['모을 수는 있지만 빠듯해요', 'warn'],
  adjust: ['지출을 조금 줄이면 돼요', 'warn'],
  infeasible: ['이 기간 안에는 어려워요', 'bad'],
  achieved: ['이미 다 모았어요', 'good'],
};

/** 1001000 → "100만 1천원", 998864 → "99만 8,864원" — 사람이 말하는 방식 */
function korWon(n) {
  if (!Number.isFinite(n)) return '-';
  const v = Math.round(Math.abs(n));
  const sign = n < 0 ? '−' : '';
  if (v < 10000) return `${sign}${v.toLocaleString('ko-KR')}원`;
  const eok = Math.floor(v / 1e8);
  const man = Math.floor((v % 1e8) / 1e4);
  const rest = v % 1e4;
  const parts = [];
  if (eok) parts.push(`${eok}억`);
  if (man) parts.push(`${man.toLocaleString('ko-KR')}만`);
  if (rest) parts.push(rest % 1000 === 0 ? `${rest / 1000}천` : rest.toLocaleString('ko-KR'));
  return `${sign}${parts.join(' ')}원`;
}

function render(plan) {
  const root = $('results');
  if (!String(state.goalAmount).trim() && !String(state.incomeMonthly).trim()) {
    root.innerHTML = '<div class="empty"><h2>얼마를, 언제까지 모을까요?</h2><p>왼쪽 계획서에 목표 금액과 월 수입부터 적어 보세요. 적는 대로 이곳에 저축 계획과 지출 계획이 채워집니다.</p></div>';
    return;
  }
  if (!plan.ok) {
    root.innerHTML = `<div class="sec"><h2>여기만 고치면 계산할 수 있어요</h2><ul class="cautions err">${plan.errors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul></div>`;
    return;
  }
  root.innerHTML = [heroPanel(plan), alternativesPanel(plan), chartPanel(plan), analysisPanel(plan), budgetPanel(plan), insightsPanel(plan), checkinPanel(plan), passbookPanel(plan)].join('');
  bindResultEvents(plan);
}

function heroPanel(plan) {
  const s = plan.summary;
  const b = plan.budget;
  const [label, tone] = STATUS[s.status];
  const goalLine = `${esc(s.goalName || '목표')} ${korWon(s.goal)}${s.current ? ` · 지금 ${korWon(s.current)}, ${pct(s.progress)} 왔어요` : ''}`;
  let headline;
  let summary;
  if (s.status === 'achieved') {
    headline = s.current >= s.goal ? `벌써 <mark>${korWon(s.current)}</mark>을 모으셨네요.` : `더 넣지 않아도 이자로 <mark>${s.months}개월 뒤</mark> 채워져요.`;
    summary = '새 목표를 세우거나, 일부는 비상금으로 따로 떼어 두세요.';
  } else if (s.status === 'infeasible') {
    headline = `매달 <mark>${korWon(s.requiredMonthly)}</mark>이 필요한데,<br>지금은 ${b.savings ? `${korWon(b.savings)}까지` : '모을 여유가 없어요'}${b.savings ? '만 가능해요.' : ''}`;
    summary = b.savings
      ? `지출을 줄일 수 있는 만큼 줄여도 한 달에 ${korWon(b.savings)}이 최선이에요. 아래에서 기간이나 목표를 조금 바꾼 계획을 골라 보세요.`
      : `지금은 쓰는 돈이 버는 돈보다 많거나 거의 같아요. 저축보다 매달 ${korWon(b.deficit)}의 적자를 막는 게 먼저예요.`;
  } else {
    headline = `매달 <mark>${korWon(b.savings)}</mark>씩<br>${s.months}개월 모으면 됩니다.`;
    summary = `월 수입 ${korWon(s.income)} 가운데 <b>${pct(s.savingsRate)}</b>를 저축하는 계획이에요. `
      + (b.totalCut ? `그러려면 지출을 한 달에 <b>${korWon(b.totalCut)}</b> 줄여야 하고, ` : '')
      + `생활비 통장에는 매달 <b>${korWon(b.buffer)}</b>쯤 남겨 돌발 지출에 대비해요.`
      + (s.interestTotal > 0 ? ` 세후 이자로 약 <b>${korWon(s.interestTotal)}</b>이 더 붙어요.` : '');
  }
  return `<section class="sec hero">
    <span class="verdict-label tone-${tone}"><i></i>${label}</span>
    <h2 class="headline">${headline}<span class="goal">${goalLine}</span></h2>
    <p class="summary">${summary}</p>
    ${plan.warnings.length ? `<ul class="cautions">${plan.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
    <div class="hero-actions"><button type="button" class="text-btn" id="btn-copy">계획 요약 복사하기</button><span class="toast" id="copy-toast" role="status"></span></div>
  </section>`;
}

function alternativesPanel(plan) {
  if (!plan.alternatives.length) return '';
  return `<section class="sec"><h2>이렇게 바꾸면 가능해요</h2>
    <p class="lede">고르면 그 조건으로 계획을 다시 짜 드려요.</p>
    <div class="alts">${plan.alternatives
      .map((a, i) => `<div class="alt"><strong>${esc(a.title)}</strong><p>${esc(a.detail)}</p>${['extend', 'lower_goal', 'balanced'].includes(a.type) ? `<button type="button" class="go" data-alt="${i}">이걸로 할게요</button>` : ''}</div>`)
      .join('')}</div></section>`;
}

function chartPanel(plan) {
  const s = plan.summary;
  const rows = plan.schedule;
  if (!rows.length || (s.status === 'achieved' && s.current >= s.goal)) return '';
  // 화면 폭에 맞춰 그려서 휴대폰에서도 글자가 작아지지 않게
  const W = Math.max(300, Math.min(760, $('results').clientWidth || 640));
  const H = W < 480 ? 220 : 250, L = 50, R = 8, T = 28, B = 28;
  const n = rows.length;
  const top = Math.max(s.goal, rows.at(-1).balance, s.current);
  const step = niceStep(top / 4);
  const maxY = Math.ceil((top * 1.05) / step) * step;
  const x = (m) => L + ((W - L - R) * m) / n;
  const y = (v) => T + (H - T - B) * (1 - v / maxY);
  const pts = [[0, s.current], ...rows.map((r) => [r.month, r.balance])];
  const line = pts.map(([m, v], i) => `${i ? 'L' : 'M'}${x(m).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const area = `${line}L${x(n).toFixed(1)},${y(0)}L${x(0)},${y(0)}Z`;
  const yTicks = [];
  for (let v = step; v < maxY - 1; v += step) yTicks.push(v);
  const xTicks = [...new Set([0, Math.round(n / 2), n])];
  const ms = rows.filter((r) => r.milestone === 50 || r.milestone === 100);
  return `<section class="sec"><h2>이렇게 불어나요</h2>
    <p class="lede">${n}개월 뒤 예상 잔액은 ${korWon(s.finalBalance)}이에요. 이자는 세금을 뗀 금액으로 계산했어요.</p>
    <svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="월별 예상 잔액 그래프">
      ${yTicks.map((v) => `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text x="${L - 10}" y="${y(v) + 4}" text-anchor="end">${shortWon(v)}</text>`).join('')}
      <line class="base" x1="${L}" x2="${W - R}" y1="${y(0)}" y2="${y(0)}"/>
      ${xTicks.map((m) => `<text x="${x(m)}" y="${H - 8}" text-anchor="${m === 0 ? 'start' : m === n ? 'end' : 'middle'}">${m === 0 ? '지금' : `${m}개월`}</text>`).join('')}
      <path class="bal-area" d="${area}"/>
      <line class="goal-line" x1="${L}" x2="${W - R}" y1="${y(s.goal)}" y2="${y(s.goal)}"/>
      <text class="goal-label" x="${L + 4}" y="${y(s.goal) - 7}">목표 ${shortWon(s.goal)}</text>
      <path class="bal-line" d="${line}"/>
      ${ms.map((r) => `<circle class="dot" cx="${x(r.month)}" cy="${y(r.balance)}" r="4"/><text class="ms-label" x="${x(r.month) - (r.month === n ? 4 : 8)}" y="${y(r.balance) - 12}" text-anchor="end">${r.milestone === 100 ? '목표 도달' : '절반'} · ${r.month}개월</text>`).join('')}
    </svg>
  </section>`;
}

function niceStep(raw) {
  const p = 10 ** Math.floor(Math.log10(Math.max(raw, 1)));
  for (const m of [1, 2, 2.5, 5, 10]) if (raw <= m * p) return m * p;
  return 10 * p;
}

function analysisPanel(plan) {
  const a = plan.analysis;
  const s = plan.summary;
  const cats = [...a.categories].sort((p, q) => q.current - p.current);
  const maxShare = Math.max(0.3, ...cats.map((c) => c.share), ...cats.map((c) => c.benchmark));
  const free = Math.max(0, 1 - a.fixedShare - a.essentialShare - a.discretionaryShare);
  const colors = { fixed: 'var(--bar-3)', essential: 'var(--bar-2)', discretionary: 'var(--bar)' };
  const info = a.income;
  const incLine = info.type === 'variable' && info.average
    ? `최근 ${info.months}개월 수입은 평균 ${korWon(Math.round(info.average))}, 적은 달은 ${korWon(info.min)}까지 내려갔어요. 그래서 <b>${korWon(s.income)}</b>을 기준으로 잡았어요.`
    : `한 달에 ${korWon(s.income)}을 벌어 ${korWon(s.totalExpense)}을 쓰고 있어요.`;
  return `<section class="sec"><h2>돈이 어디로 가고 있나</h2>
    <p class="lede">${incLine}</p>
    <div class="mix" role="img" aria-label="수입 대비 고정비 ${pct(a.fixedShare)}, 필수 생활비 ${pct(a.essentialShare)}, 선택 지출 ${pct(a.discretionaryShare)}, 남는 돈 ${pct(free)}">
      ${['fixed', 'essential', 'discretionary'].map((t) => `<span style="flex:${Math.min(1, a[t + 'Share'])};background:${colors[t]}"></span>`).join('')}
      <span style="flex:${free};background:repeating-linear-gradient(-45deg, var(--rule) 0 2px, transparent 2px 6px)"></span>
    </div>
    <div class="mix-legend">
      <span><i class="sw" style="background:${colors.fixed}"></i>고정비<b>${pct(a.fixedShare)}</b></span>
      <span><i class="sw" style="background:${colors.essential}"></i>필수 생활비<b>${pct(a.essentialShare)}</b></span>
      <span><i class="sw" style="background:${colors.discretionary}"></i>선택 지출<b>${pct(a.discretionaryShare)}</b></span>
      <span><i class="sw" style="background:repeating-linear-gradient(-45deg, var(--ink-3) 0 1.5px, transparent 1.5px 4px)"></i>남는 돈<b>${pct(free)}</b></span>
    </div>
    <div class="bars">${cats
      .map((c) => {
        const flags = [];
        if (c.overBenchmark) flags.push(`<span class="w">권장 ${pct(c.benchmark)}보다 많음</span>`);
        if (c.trend === 'up') flags.push('<span class="b">석 달째 늘어남</span>');
        if (c.trend === 'down') flags.push('<span class="g">줄어드는 중</span>');
        if ((c.volatility ?? 0) > 0.3) flags.push('달마다 들쭉날쭉');
        if (!c.fromHistory && c.type !== 'fixed') flags.push('기억으로 적음');
        return `<div class="bar-row">
          <div class="nm"><span class="name" title="${esc(c.name)}">${esc(c.name)}</span>${flags.length ? `<span class="flags">${flags.join(' · ')}</span>` : ''}</div>
          <div class="track" title="권장 비중 ${pct(c.benchmark)}"><div class="fill ${c.overBenchmark && c.type !== 'fixed' ? 'over' : ''} t-${c.type}" style="width:${Math.min(100, (c.share / maxShare) * 100)}%"></div><div class="mark" style="left:${Math.min(100, (c.benchmark / maxShare) * 100)}%"></div></div>
          <div class="val">${comma(c.current)}원<small>수입의 ${pct(c.share, 1)}</small></div>
        </div>`;
      })
      .join('')}</div>
    <p class="bars-foot">점선은 수입 대비 권장 비중이에요. 최근 3개월을 적은 항목은 석 달 평균으로 계산했어요.</p>
  </section>`;
}

function budgetPanel(plan) {
  const b = plan.budget;
  const s = plan.summary;
  if (!b.categories.length && !b.savings) return '';
  const rows = b.categories
    .map((c) => `<tr>
      <td>${esc(c.name)}<span class="type">${TYPE_LABELS[c.type]}</span></td>
      <td class="dim">${comma(c.current)}</td>
      <td>${comma(c.recommended)}</td>
      <td>${c.cut ? `<span class="cut">−${comma(c.cut)}</span>` : '<span class="dim">–</span>'}</td>
      <td>${c.weekly ? comma(c.weekly) : '<span class="dim">–</span>'}</td>
    </tr>`)
    .join('');
  const spend = b.categories.reduce((a, c) => a + c.recommended, 0);
  return `<section class="sec"><h2>이번 달부터 이렇게 쓰세요</h2>
    <p class="lede">월급이 들어오면 저축액을 먼저 목표 통장으로 보내고, 나머지로 아래 예산 안에서 생활하면 됩니다. 단위는 원이에요.</p>
    <div class="table-wrap"><table>
      <thead><tr><th>항목</th><th>지금</th><th>예산</th><th>줄일 금액</th><th>한 주에</th></tr></thead>
      <tbody>${rows}
        <tr class="sum"><td>지출 합계</td><td class="dim">${comma(s.totalExpense)}</td><td>${comma(spend)}</td><td>${b.totalCut ? `<span class="cut">−${comma(b.totalCut)}</span>` : ''}</td><td></td></tr>
        <tr class="save"><td>목표 통장으로 자동이체</td><td></td><td>${comma(b.savings)}</td><td></td><td></td></tr>
        <tr><td>생활비 통장에 남길 돈</td><td></td><td>${b.deficit ? `<span style="color:var(--bad)">−${comma(b.deficit)}</span>` : comma(b.buffer)}</td><td></td><td></td></tr>
        <tr class="total"><td>합계 (계획 기준 수입)</td><td></td><td>${comma(spend + b.savings + b.buffer - b.deficit)}</td><td></td><td></td></tr>
      </tbody>
    </table></div>
    <p class="table-foot">고정비는 손대지 않았고, 필수 생활비는 최대 ${pct(CUT_LIMITS.essential)}, 선택 지출은 최대 ${pct(CUT_LIMITS.discretionary)}까지만 줄였어요. ‘한 주에’는 선택 지출 예산을 주 단위로 나눈 금액이라 체크카드 한도로 쓰기 좋아요.</p>
  </section>`;
}

function insightsPanel(plan) {
  const items = plan.insights.slice(1); // 첫 줄은 위 요약과 같은 내용
  const warn = items.filter((i) => i.level === 'warn' || i.level === 'bad');
  const info = items.filter((i) => i.level !== 'warn' && i.level !== 'bad');
  if (!items.length) return '';
  const list = (xs, cls) => `<ol class="${cls}">${xs.map((i) => `<li><span>${esc(i.text)}</span></li>`).join('')}</ol>`;
  return `<section class="sec"><h2>살펴보니</h2>
    <div class="notes">
      ${warn.length ? `<div><h3>눈여겨볼 것</h3>${list(warn, 'warnlist')}</div>` : ''}
      ${info.length ? `<div><h3>알아 두면 좋은 것</h3>${list(info, '')}</div>` : ''}
    </div></section>`;
}

function checkinPanel(plan) {
  const s = plan.summary;
  if (s.status === 'achieved') return '';
  return `<section class="sec"><h2>${plan.budget.checkInEvery}개월마다 점검하기</h2>
    <p class="lede">통장 잔액을 적으면 남은 기간에 맞춰 월 저축액을 다시 맞춰 드려요. 생활비 통장에 ${korWon(plan.budget.cushion)}보다 많이 남았다면 넘는 만큼은 목표 통장으로 옮기는 걸로 계산해요.</p>
    <div class="checkin">
      <label>지난 개월 수<input id="ci-elapsed" type="number" min="1" max="${s.months - 1}" value="${Math.min(3, Math.max(1, s.months - 1))}"></label>
      <label>목표 통장 잔액<input id="ci-balance" inputmode="numeric" placeholder="900만원"></label>
      <label>생활비 통장 잔액<input id="ci-cash" inputmode="numeric" placeholder="모르면 비워 두세요"></label>
      <button type="button" class="go" id="btn-checkin">다시 맞추기</button>
    </div>
    <div class="checkin-out" id="checkin-out" role="status"></div>
  </section>`;
}

const MEMO = { 25: '1/4 왔다', 50: '벌써 절반!', 75: '조금만 더', 100: '다 모았다!' };

function passbookPanel(plan, all = false) {
  const rows = plan.schedule;
  if (!rows.length || plan.budget.savings === 0) return '';
  const show = all ? rows : rows.slice(0, 12);
  return `<section class="sec" id="pb-panel"><h2>미리 써 본 통장</h2>
    <p class="lede">계획대로 넣으면 통장에 이렇게 찍혀요.</p>
    <div class="passbook"><table>
      <thead><tr><th>회차</th><th>날짜</th><th>입금</th><th>이자</th><th>잔액</th><th></th></tr></thead>
      <tbody>${show.map((r) => `<tr><td>${r.month}</td><td>${monthLabel(r.month - 1)}</td><td>${comma(r.deposit)}</td><td>${comma(r.interest)}</td><td>${comma(r.balance)}</td><td class="memo">${r.milestone ? MEMO[r.milestone] : ''}</td></tr>`).join('')}</tbody>
    </table></div>
    ${rows.length > 12 && !all ? `<button type="button" class="text-btn pb-more" id="btn-pb-all">${rows.length}개월 전부 보기</button>` : ''}
  </section>`;
}

function summaryText(plan) {
  const s = plan.summary;
  const b = plan.budget;
  const lines = [
    `[모아플랜] ${s.goalName || '목표'} ${won(s.goal)} / ${s.months}개월`,
    STATUS[s.status][0],
    `매달 저축: ${won(b.savings)} (수입의 ${pct(s.savingsRate)})`,
    `생활비 통장에 남길 돈: ${won(b.buffer)}/월`,
    '',
    '항목별 예산:',
    ...b.categories.map((c) => `- ${c.name}: ${won(c.recommended)}${c.cut ? ` (−${won(c.cut)})` : ''}`),
  ];
  if (plan.alternatives.length) lines.push('', '바꿀 수 있는 계획:', ...plan.alternatives.map((a) => `- ${a.title}`));
  return lines.join('\n');
}

function bindResultEvents(plan) {
  $('btn-copy')?.addEventListener('click', () => {
    const text = summaryText(plan);
    const done = (msg) => ($('copy-toast').textContent = msg);
    const pr = navigator.clipboard?.writeText(text);
    if (!pr) return done('이 브라우저에서는 복사가 안 돼요.');
    pr.then(() => done('복사했어요. 메모장이나 카톡에 붙여 넣으세요.'), () => done('이 화면에서는 복사가 막혀 있어요.'));
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
      out.innerHTML = `<span style="color:var(--bad)">지난 개월 수는 1부터 ${s.months - 1} 사이로 적어 주세요.</span>`;
      return;
    }
    if (bal === null || !Number.isFinite(bal) || bal < 0) {
      out.innerHTML = '<span style="color:var(--bad)">목표 통장 잔액을 적어 주세요.</span>';
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
    const ahead = diff >= 0;
    const change = np.budget.savings === plan.budget.savings ? '지금처럼' : np.budget.savings > plan.budget.savings ? '조금 늘려서' : '조금 줄여도 되니';
    out.innerHTML = `${move ? `생활비 통장에서 <b>${korWon(move)}</b>을 목표 통장으로 옮기면, ` : ''}계획보다 <b style="color:var(--${ahead ? 'good' : 'bad'})">${korWon(Math.abs(diff))} ${ahead ? '앞서' : '뒤처져'}</b> 있어요.
      남은 ${s.months - elapsed}개월은 ${change} 매달 <mark>${korWon(np.budget.savings)}</mark>씩 모으면 됩니다. (${STATUS[np.summary.status][0]})`;
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

let lastWidth = window.innerWidth;
let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (Math.abs(window.innerWidth - lastWidth) > 40 && lastPlan) {
      lastWidth = window.innerWidth;
      render(lastPlan);
    }
  }, 200);
});
