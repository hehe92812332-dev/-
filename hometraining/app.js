(function () {
  "use strict";

  const app = document.getElementById("app");
  const ORDER = ["stroke", "sci", "pd"];

  /* ── 저장 (브라우저에만 남습니다) ── */
  const store = {
    get(key, fallback) {
      try {
        const v = localStorage.getItem("hg:" + key);
        return v === null ? fallback : JSON.parse(v);
      } catch (e) { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem("hg:" + key, JSON.stringify(value)); } catch (e) { /* 저장 불가 환경 */ }
    },
  };

  let mode = store.get("mode", "alone");
  const todayKey = new Date().toISOString().slice(0, 10);

  /* ── 글자 크기 ── */
  const sizeBtn = document.getElementById("textsize");
  function applySize(big) {
    document.documentElement.classList.toggle("is-large", big);
    sizeBtn.setAttribute("aria-pressed", String(big));
  }
  applySize(store.get("large", false));
  sizeBtn.addEventListener("click", () => {
    const big = !document.documentElement.classList.contains("is-large");
    store.set("large", big);
    applySize(big);
  });

  /* ── 도우미 ── */
  const refLinks = (ids) =>
    ids.map((n) => `<a class="ref" href="#/evidence/${n}" aria-label="근거 문헌 ${n}번">${n}</a>`).join("");

  function stairs(labels, active, asLinks, id) {
    return `
      <div class="stairs ${asLinks ? "stairs--tabs" : ""}" ${asLinks ? 'role="tablist" aria-label="기능 단계"' : 'aria-hidden="true"'}>
        <svg class="rail" viewBox="0 0 300 100" preserveAspectRatio="none" aria-hidden="true">
          <line x1="2" y1="74" x2="298" y2="6" />
        </svg>
        ${labels.map((l, i) => {
          const n = i + 1;
          const inner = `<span class="step-n">${n}단계</span><span class="step-t">${l}</span>`;
          return asLinks
            ? `<a class="step ${active === n ? "is-on" : ""}" role="tab" aria-selected="${active === n}" href="#/c/${id}/${n}" style="--h:${n}">${inner}</a>`
            : `<div class="step" style="--h:${n}">${inner}</div>`;
        }).join("")}
      </div>`;
  }

  /* ── 처음 화면 ── */
  function renderHome() {
    const rows = ORDER.map((id) => {
      const c = CONDITIONS[id];
      return `
        <li class="cond-row">
          <a href="#/c/${id}" class="cond-link">
            <h3 class="cond-name">${c.name}</h3>
            <p class="cond-lede">${c.lede}</p>
            <p class="cond-levels">${c.levels.map((l) => l.title).join(" / ")}</p>
            <span class="cond-go">프로그램 보기</span>
          </a>
        </li>`;
    }).join("");

    app.innerHTML = `
      <section class="hero wrap">
        <div class="hero-text">
          <h1 class="hero-title">할 수 있는 만큼,<br>집에서 한 걸음.</h1>
          <p class="hero-lede">
            뇌졸중, 척수손상, 파킨슨병 이후 집에서 할 수 있는 운동을
            지금의 몸 상태에 맞춰 세 단계로 나누었습니다.
            모든 운동은 혼자 하는 방법과 보호자와 함께 하는 방법을 따로 알려 드립니다.
          </p>
          <div class="hero-actions">
            <a class="btn btn--solid" href="#/c/stroke">뇌졸중</a>
            <a class="btn btn--solid" href="#/c/sci">척수손상</a>
            <a class="btn btn--solid" href="#/c/pd">파킨슨병</a>
          </div>
        </div>
        <figure class="hero-fig">
          ${stairs(["누워서·앉아서", "잡고 서서", "걸으면서"], 0, false)}
          <figcaption>단계는 걷기와 일상동작에 필요한 도움의 정도로 나눕니다. 단계가 낮다고 운동이 덜 중요한 것은 아닙니다.</figcaption>
        </figure>
      </section>

      <section class="wrap block">
        <h2 class="h2">어떤 질환인가요?</h2>
        <ul class="cond-list">${rows}</ul>
      </section>

      <section class="wrap block how">
        <h2 class="h2">이렇게 사용하세요</h2>
        <ol class="how-list">
          <li><strong>질환을 고릅니다.</strong> 진단받은 질환의 프로그램으로 들어갑니다.</li>
          <li><strong>두 가지 질문에 답합니다.</strong> 걷기와 일상동작을 기준으로 맞는 단계를 찾아 드립니다. 담당 치료사가 정해 준 단계가 있다면 그것을 따릅니다.</li>
          <li><strong>혼자 할지, 보호자와 할지 고릅니다.</strong> 같은 운동이라도 방법과 범위가 달라집니다.</li>
          <li><strong>한 주 계획대로 하고, 한 일은 표시합니다.</strong> 표시는 이 기기에만 저장됩니다.</li>
        </ol>
      </section>

      <section class="wrap block modes">
        <h2 class="h2">혼자 할 때와 함께 할 때</h2>
        <div class="modes-grid">
          <div class="mode-card mode-card--alone">
            <h3>혼자 해요</h3>
            <p>넘어질 위험이 낮은 동작과 범위만 안내합니다. 혼자 하기에 위험한 동작은 앉아서 하는 대체 운동으로 바꿔 드립니다.</p>
          </div>
          <div class="mode-card mode-card--carer">
            <h3>보호자와 해요</h3>
            <p>보호자가 서는 위치, 잡는 곳, 도와주는 정도를 알려 드립니다. 보호자가 함께하면 혼자보다 조금 더 어려운 동작까지 할 수 있습니다.</p>
          </div>
        </div>
        <p class="modes-ev">보호자가 참여하는 운동은 퇴원 후 운동량을 늘리고 환자와 보호자의 부담을 줄이는 방법으로 연구되었습니다. ${refLinks([5, 6])}</p>
      </section>
    `;
  }

  /* ── 질환 화면 ── */
  function renderCondition(id, levelParam) {
    const c = CONDITIONS[id];
    if (!c) return renderNotFound();
    const saved = store.get("level:" + id, null);
    const level = levelParam ? Number(levelParam) : saved;
    if (levelParam) store.set("level:" + id, level);

    const lv = level ? c.levels[level - 1] : null;

    app.innerHTML = `
      <section class="wrap cond-head">
        <p class="crumb"><a href="#/">처음</a> / ${c.name}</p>
        <h1 class="cond-title">${c.name} 홈 트레이닝</h1>
        <p class="cond-intro">${c.lede}</p>
        <p class="cond-measure"><strong>단계 기준</strong> ${gloss(c.measure + ". " + c.measureNote)} ${refLinks(c.basis)}</p>
      </section>

      <section class="wrap level-pick">
        ${stairs(c.levels.map((l) => l.title), level || 0, true, id)}
        <div class="quiz" id="quiz"></div>
      </section>

      <div id="program">${lv ? programHTML(id, c, lv, level) : emptyProgram()}</div>
    `;

    renderQuiz(id, c, !lv);
    bindProgram(id, level);
  }

  function emptyProgram() {
    return `<section class="wrap empty"><p>위의 단계 중 하나를 고르거나, 두 가지 질문에 답해 단계를 찾아보세요.</p></section>`;
  }

  function renderQuiz(id, c, open) {
    const box = document.getElementById("quiz");
    const fallback = c.quizFallback || 1;
    let i = 0;

    function closed() {
      box.innerHTML = `<button class="link-btn" type="button" id="quiz-open">내 단계 다시 찾기</button>`;
      box.querySelector("#quiz-open").addEventListener("click", () => { i = 0; ask(); });
    }
    function ask() {
      const item = c.quiz[i];
      box.innerHTML = `
        <div class="quiz-card" role="group" aria-labelledby="quiz-q">
          <p class="quiz-count">질문 ${i + 1} / ${c.quiz.length}</p>
          <p class="quiz-q" id="quiz-q">${item.q}</p>
          <div class="quiz-btns">
            <button class="btn btn--solid" type="button" data-a="yes">예</button>
            <button class="btn btn--line" type="button" data-a="no">아니요</button>
          </div>
        </div>`;
      box.querySelectorAll("[data-a]").forEach((b) =>
        b.addEventListener("click", () => {
          if (b.dataset.a === "yes") return item.check ? confirm(item) : done(item.level);
          i += 1;
          if (i >= c.quiz.length) return done(fallback);
          ask();
          box.querySelector(".quiz-q").focus?.();
        })
      );
    }
    // 혼자 걷는다고 답해도 최근에 넘어졌다면 한 단계 낮춰 안내합니다
    function confirm(item) {
      box.innerHTML = `
        <div class="quiz-card" role="group" aria-labelledby="quiz-q">
          <p class="quiz-count">확인 질문</p>
          <p class="quiz-q" id="quiz-q">${item.check.q}</p>
          <div class="quiz-btns">
            <button class="btn btn--solid" type="button" data-a="yes">예</button>
            <button class="btn btn--line" type="button" data-a="no">아니요</button>
          </div>
        </div>`;
      box.querySelector('[data-a="yes"]').addEventListener("click", () => {
        store.set("fellNote:" + id, true);
        done(item.check.level);
      });
      box.querySelector('[data-a="no"]').addEventListener("click", () => {
        store.set("fellNote:" + id, false);
        done(item.level);
      });
    }
    function done(n) {
      location.hash = `#/c/${id}/${n}`;
    }
    open ? ask() : closed();
  }

  function dateKey(offset) {
    const d = new Date();
    d.setDate(d.getDate() - offset);
    return d.toISOString().slice(0, 10);
  }

  function weekLogHTML(id, level, total) {
    const names = ["일", "월", "화", "수", "목", "금", "토"];
    const cells = [];
    for (let k = 6; k >= 0; k--) {
      const key = dateKey(k);
      let n = 0;
      for (let i = 0; i < total; i++) if (store.get(`done:${key}:${id}:${level}:${i}`, false)) n++;
      const d = new Date(); d.setDate(d.getDate() - k);
      cells.push(`<li class="${n === 0 ? "" : n >= total ? "is-full" : "is-part"}" title="${key}"><span>${k === 0 ? "오늘" : names[d.getDay()]}</span><b>${n}</b></li>`);
    }
    return `
      <div class="week-log" aria-label="지난 7일 동안 한 운동 수">
        <p class="week-log-t">지난 7일 기록 <span>(하루 ${total}가지 중 한 개수)</span></p>
        <ol>${cells.join("")}</ol>
      </div>`;
  }

  function gearHTML(id, level) {
    const g = GEAR[id] && GEAR[id][level - 1];
    if (!g) return "";
    return `
      <div class="gear">
        <h3 class="h3">준비물</h3>
        <ul>${g.map(([name, alt]) => `<li><span class="gear-n">${name}</span>${alt && alt !== "—" ? `<span class="gear-alt">없으면 ${alt}</span>` : ""}</li>`).join("")}</ul>
      </div>`;
  }

  function programHTML(id, c, lv, level) {
    const m = MODES[mode];
    const days = ["월", "화", "수", "목", "금", "토", "일"];
    const badDay = store.get("badday:" + todayKey, false);
    const fell = store.get("fellNote:" + id, false);
    const ex = lv.exercises.map((e, idx) => exerciseHTML(id, level, e, idx)).join("");

    return gloss(`
      <div class="modebar" role="region" aria-label="운동 방식">
        <div class="wrap modebar-row">
          <div class="seg" role="radiogroup" aria-label="운동 방식 고르기">
            <button type="button" role="radio" class="seg-btn ${mode === "alone" ? "is-on" : ""}" aria-checked="${mode === "alone"}" data-mode="alone">혼자 해요</button>
            <button type="button" role="radio" class="seg-btn ${mode === "carer" ? "is-on" : ""}" aria-checked="${mode === "carer"}" data-mode="carer">보호자와 해요</button>
          </div>
          <label class="bad-day-toggle">
            <input type="checkbox" id="bad-day" ${badDay ? "checked" : ""}>
            <span>오늘은 힘든 날</span>
          </label>
          <button type="button" class="link-btn" id="print">인쇄하기</button>
        </div>
      </div>

      <section class="wrap program mode-${mode} ${badDay ? "is-bad-day" : ""}">
        <header class="prog-head">
          <div>
            <h2 class="prog-title">${level}단계 · ${lv.title}</h2>
            <p class="prog-who">${lv.who}</p>
            <p class="prog-goal"><strong>목표</strong> ${lv.goal}</p>
          </div>
          ${weekLogHTML(id, level, lv.exercises.length)}
        </header>

        ${fell && level < c.levels.length && !(c.quizFallback) ? `<p class="fell-note">최근에 넘어진 적이 있다고 답하셔서 한 단계 낮춰 안내했습니다. 담당 치료사와 상의한 뒤 다음 단계로 올라가세요.</p>` : ""}

        ${badDay ? `
        <aside class="bad-day">
          <h3 class="h3">힘든 날에는 이렇게 줄이세요</h3>
          <ul>${BAD_DAY.map((r) => `<li>${r}</li>`).join("")}</ul>
        </aside>` : ""}

        <div class="prog-grid">
          <dl class="fitt">
            ${lv.fitt.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("")}
          </dl>
          <div class="week">
            <h3 class="h3">한 주 계획</h3>
            <ol class="week-row">
              ${lv.week.map((w, i) => `<li class="${w === "쉼" || w.startsWith("쉼") ? "is-rest" : ""}"><span class="wd">${days[i]}</span><span class="wt">${w}</span></li>`).join("")}
            </ol>
            <p class="week-note">요일은 바꿔도 됩니다. 근력 운동은 이틀 연속 하지 않습니다.</p>
          </div>
        </div>

        <aside class="rules rules--${mode}">
          <h3 class="h3">${m.label} — 시작 전에</h3>
          <ul>${m.rules.map((r) => `<li>${r}</li>`).join("")}</ul>
        </aside>

        ${gearHTML(id, level)}

        <div class="ex-headrow">
          <h3 class="h3 ex-heading">오늘의 운동 <span class="ex-count">${lv.exercises.length}가지, 순서대로</span></h3>
          <button type="button" class="btn btn--solid" data-follow="0">처음부터 따라 하기</button>
        </div>
        <ol class="ex-list">${ex}</ol>

        <aside class="cautions">
          <h3 class="h3">${c.name} — 꼭 알아 두세요</h3>
          <ul>${c.cautions.map((x) => `<li>${x}</li>`).join("")}</ul>
          <p><a href="#/safety">운동을 멈춰야 할 때 전체 보기</a></p>
        </aside>
      </section>
    `);
  }

  function exerciseHTML(id, level, e, idx) {
    const part = mode === "alone" ? e.alone : e.carer;
    const unsafe = mode === "alone" && e.alone.safe === false;
    const doneKey = `done:${todayKey}:${id}:${level}:${idx}`;
    const isDone = store.get(doneKey, false);

    const extra = mode === "alone"
      ? (part.note ? `<p class="ex-note">${part.note}</p>` : "")
      : (part.role ? `<p class="ex-note"><strong>보호자 역할</strong> ${part.role}</p>` : "");

    return `
      <li class="ex ${isDone ? "is-done" : ""}">
        <details ${idx === 0 ? "open" : ""}>
          <summary>
            <span class="ex-num">${idx + 1}</span>
            <span class="ex-main">
              <span class="ex-name">${e.name}</span>
              <span class="ex-dose">${e.dose}</span>
            </span>
            ${unsafe ? `<span class="ex-flag">대체 동작</span>` : ""}
          </summary>
          <div class="ex-body">
            ${e.fig ? `<figure class="ex-fig"><img src="${e.fig}" alt="${e.name} 자세" loading="lazy"></figure>` : ""}
            <p class="ex-aim">${e.aim}</p>
            ${unsafe ? `<p class="ex-warn">${e.alone.instead}</p>` : ""}
            <div class="ex-tools">
              <button type="button" class="tool-btn" data-follow="${idx}">따라 하기 (횟수·타이머)</button>
              <button type="button" class="tool-btn tts-only" data-speak="${idx}">소리로 듣기</button>
            </div>
            <ol class="ex-steps">${part.steps.map((s) => `<li>${s}</li>`).join("")}</ol>
            ${extra}
            <p class="ex-stop"><strong>멈출 때</strong> ${e.stop}</p>
            <div class="ex-foot">
              <span class="ex-refs">근거 ${refLinks(e.refs)}</span>
              <label class="done">
                <input type="checkbox" data-done="${doneKey}" ${isDone ? "checked" : ""}>
                <span>오늘 했어요</span>
              </label>
            </div>
          </div>
        </details>
      </li>`;
  }

  function bindProgram(id, level) {
    document.querySelectorAll("[data-mode]").forEach((b) =>
      b.addEventListener("click", () => {
        if (b.dataset.mode === mode) return;
        mode = b.dataset.mode;
        store.set("mode", mode);
        const c = CONDITIONS[id];
        const open = [...document.querySelectorAll(".ex details")].map((d) => d.open);
        document.getElementById("program").innerHTML = programHTML(id, c, c.levels[level - 1], level);
        document.querySelectorAll(".ex details").forEach((d, i) => { d.open = open[i]; });
        bindProgram(id, level);
        document.querySelector(`[data-mode="${mode}"]`).focus();
      })
    );
    document.querySelectorAll("[data-done]").forEach((cb) =>
      cb.addEventListener("change", () => {
        store.set(cb.dataset.done, cb.checked);
        cb.closest(".ex").classList.toggle("is-done", cb.checked);
      })
    );
    const p = document.getElementById("print");
    if (p) p.addEventListener("click", () => {
      document.querySelectorAll(".ex details").forEach((d) => { d.open = true; });
      window.print();
    });
    const bd = document.getElementById("bad-day");
    if (bd) bd.addEventListener("change", () => {
      store.set("badday:" + todayKey, bd.checked);
      rerender(id, level);
      document.getElementById("bad-day").focus();
    });
    document.querySelectorAll("[data-follow]").forEach((b) =>
      b.addEventListener("click", () => openFollow(id, level, Number(b.dataset.follow), b))
    );
    document.querySelectorAll("[data-speak]").forEach((b) =>
      b.addEventListener("click", () => speak(exerciseSpeech(CONDITIONS[id].levels[level - 1].exercises[Number(b.dataset.speak)])))
    );
  }

  function rerender(id, level) {
    const c = CONDITIONS[id];
    const open = [...document.querySelectorAll(".ex details")].map((d) => d.open);
    document.getElementById("program").innerHTML = programHTML(id, c, c.levels[level - 1], level);
    document.querySelectorAll(".ex details").forEach((d, i) => { d.open = open[i]; });
    bindProgram(id, level);
  }

  /* ── 쉬운 말 풀이 ── */
  const TERMS = Object.keys(GLOSSARY).sort((a, b) => b.length - a.length);
  const termRe = new RegExp("(" + TERMS.map((t) => t.replace(/[.*+?^${}()|[\]\\&]/g, "\\$&")).join("|") + ")", "g");
  function gloss(html) {
    let inButton = 0;
    return html.split(/(<[^>]+>)/).map((part) => {
      if (part.startsWith("<")) {
        if (/^<button/.test(part)) inButton++;
        if (/^<\/button/.test(part)) inButton--;
        return part;
      }
      if (inButton > 0) return part;
      return part.replace(termRe, (t) => `<button type="button" class="term" data-term="${t}" aria-expanded="false">${t}</button>`);
    }).join("");
  }

  const pop = document.createElement("div");
  pop.className = "gloss-pop";
  pop.setAttribute("role", "tooltip");
  pop.id = "gloss-pop";
  pop.hidden = true;
  document.body.appendChild(pop);
  let popFor = null;
  function closePop() {
    pop.hidden = true;
    if (popFor) popFor.setAttribute("aria-expanded", "false");
    popFor = null;
  }
  document.addEventListener("click", (ev) => {
    const t = ev.target.closest(".term");
    if (!t) { if (!ev.target.closest(".gloss-pop")) closePop(); return; }
    ev.preventDefault();
    ev.stopPropagation();
    if (popFor === t) return closePop();
    closePop();
    pop.innerHTML = `<strong>${t.dataset.term}</strong> ${GLOSSARY[t.dataset.term]}`;
    pop.hidden = false;
    const r = t.getBoundingClientRect();
    const w = Math.min(320, window.innerWidth - 32);
    pop.style.width = w + "px";
    pop.style.left = Math.max(16, Math.min(r.left + window.scrollX, window.scrollX + window.innerWidth - w - 16)) + "px";
    pop.style.top = (r.bottom + window.scrollY + 8) + "px";
    t.setAttribute("aria-expanded", "true");
    t.setAttribute("aria-describedby", "gloss-pop");
    popFor = t;
  }, true);
  document.addEventListener("keydown", (ev) => { if (ev.key === "Escape") closePop(); });

  /* ── 소리로 듣기 ── */
  const canSpeak = "speechSynthesis" in window;
  if (!canSpeak) document.documentElement.classList.add("no-tts");
  function speak(text) {
    if (!canSpeak) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "ko-KR";
    u.rate = 0.9;
    window.speechSynthesis.speak(u);
  }
  function exerciseSpeech(e) {
    const part = mode === "alone" ? e.alone : e.carer;
    const unsafe = mode === "alone" && e.alone.safe === false;
    return [
      e.name + ". " + e.dose + ".",
      unsafe ? e.alone.instead : "",
      ...part.steps.map((s, i) => `${i + 1}. ${s}`),
      "멈출 때. " + e.stop,
    ].join(" ").replace(/[·—×]/g, (m) => (m === "×" ? " 곱하기 " : " "));
  }

  /* ── 따라 하기: 한 동작씩 크게, 횟수 세기와 타이머 ── */
  function beep() {
    try {
      const ac = new (window.AudioContext || window.webkitAudioContext)();
      const o = ac.createOscillator();
      o.frequency.value = 880;
      o.connect(ac.destination);
      o.start();
      o.stop(ac.currentTime + 0.35);
    } catch (e) { /* 소리 불가 */ }
    if (navigator.vibrate) navigator.vibrate(300);
  }

  function openFollow(id, level, start, opener) {
    const lv = CONDITIONS[id].levels[level - 1];
    let idx = start;
    let reps = 0;
    let sets = 0;
    let timer = null;

    const ov = document.createElement("div");
    ov.className = "follow mode-" + mode;
    ov.setAttribute("role", "dialog");
    ov.setAttribute("aria-modal", "true");
    ov.setAttribute("aria-labelledby", "follow-t");
    document.body.appendChild(ov);
    document.body.classList.add("has-follow");

    function stopTimer() { if (timer) { clearInterval(timer); timer = null; } }
    function runTimer(sec, label) {
      stopTimer();
      const out = ov.querySelector(".rest-timer");
      let left = sec;
      out.hidden = false;
      out.textContent = `${label} ${left}초`;
      timer = setInterval(() => {
        left -= 1;
        out.textContent = left > 0 ? `${label} ${left}초` : `${label} 끝`;
        if (left <= 0) {
          stopTimer();
          beep();
          if (canSpeak) speak(label + " 끝");
        }
      }, 1000);
    }

    function draw() {
      stopTimer();
      const e = lv.exercises[idx];
      const part = mode === "alone" ? e.alone : e.carer;
      const unsafe = mode === "alone" && e.alone.safe === false;
      ov.innerHTML = `
        <div class="follow-in">
          <div class="follow-top">
            <span>운동 ${idx + 1} / ${lv.exercises.length} · ${MODES[mode].label}</span>
            <button type="button" class="link-btn" data-f="close">닫기</button>
          </div>
          <h2 class="follow-name" id="follow-t">${e.name}</h2>
          <p class="follow-dose">${e.dose}</p>
          ${unsafe ? `<p class="ex-warn">${e.alone.instead}</p>` : ""}
          <ol class="follow-steps">${part.steps.map((s) => `<li>${gloss(s)}</li>`).join("")}</ol>
          <p class="ex-stop"><strong>멈출 때</strong> ${e.stop}</p>

          <div class="follow-pad">
            <button type="button" class="count-btn" data-count aria-live="polite">
              <span class="count-n">${reps}</span><span class="count-l">회 — 누를 때마다 하나</span>
            </button>
            <div class="follow-side">
              <p class="set-n" aria-live="polite">끝낸 세트 <b>${sets}</b></p>
              <button type="button" class="tool-btn" data-f="set">세트 끝 · 1분 쉬기</button>
              <button type="button" class="tool-btn" data-f="hold">30초 재기</button>
              <button type="button" class="tool-btn" data-f="reset">횟수 다시</button>
              <button type="button" class="tool-btn tts-only" data-f="speak">소리로 듣기</button>
            </div>
          </div>
          <p class="rest-timer" aria-live="assertive" hidden></p>

          <div class="follow-nav">
            <button type="button" class="btn btn--line" data-f="prev" ${idx === 0 ? "disabled" : ""}>이전 운동</button>
            <button type="button" class="btn btn--solid" data-f="next">${idx === lv.exercises.length - 1 ? "다 했어요" : "이 운동 끝, 다음으로"}</button>
          </div>
        </div>`;
      ov.querySelector("[data-count]").addEventListener("click", () => {
        reps += 1;
        ov.querySelector(".count-n").textContent = reps;
      });
      ov.querySelectorAll("[data-f]").forEach((b) => b.addEventListener("click", () => act(b.dataset.f)));
      ov.querySelector("[data-count]").focus();
    }

    function act(f) {
      const e = lv.exercises[idx];
      if (f === "close") return close();
      if (f === "speak") return speak(exerciseSpeech(e));
      if (f === "reset") { reps = 0; ov.querySelector(".count-n").textContent = 0; return; }
      if (f === "hold") return runTimer(30, "버티기");
      if (f === "set") {
        sets += 1; reps = 0;
        ov.querySelector(".count-n").textContent = 0;
        ov.querySelector(".set-n b").textContent = sets;
        return runTimer(60, "쉬는 시간");
      }
      if (f === "prev") { idx -= 1; reps = 0; sets = 0; return draw(); }
      if (f === "next") {
        store.set(`done:${todayKey}:${id}:${level}:${idx}`, true);
        if (idx === lv.exercises.length - 1) return close();
        idx += 1; reps = 0; sets = 0;
        return draw();
      }
    }

    function onKey(ev) {
      if (ev.key === "Escape") return close();
      if (ev.key !== "Tab") return;
      const f = [...ov.querySelectorAll("button:not([disabled])")].filter((b) => b.offsetParent !== null);
      if (!f.length) return;
      if (ev.shiftKey && document.activeElement === f[0]) { ev.preventDefault(); f[f.length - 1].focus(); }
      else if (!ev.shiftKey && document.activeElement === f[f.length - 1]) { ev.preventDefault(); f[0].focus(); }
    }
    function close() {
      stopTimer();
      if (canSpeak) window.speechSynthesis.cancel();
      document.removeEventListener("keydown", onKey);
      ov.remove();
      document.body.classList.remove("has-follow");
      rerender(id, level);
      const back = document.querySelector(`[data-follow="${opener ? opener.dataset.follow : 0}"]`);
      if (back) back.focus();
    }
    document.addEventListener("keydown", onKey);
    draw();
  }

  /* ── 안전 수칙 ── */
  function renderSafety() {
    app.innerHTML = `
      <section class="wrap page">
        <h1 class="page-title">안전 수칙</h1>
        <p class="page-lede">아래 기준은 미국스포츠의학회(ACSM) 운동 처방 지침과 각 질환 진료지침의 안전 권고를 가정에 맞게 정리한 것입니다. ${refLinks([21, 2, 9, 15])}</p>

        <div class="safety-grid">
          <div class="safety-box safety-box--stop">
            <h2 class="h3">바로 멈추세요</h2>
            <ul>${SAFETY_STOP.map((s) => `<li>${s}</li>`).join("")}</ul>
          </div>
          <div class="safety-box">
            <h2 class="h3">이런 날은 쉬세요</h2>
            <ul>${SAFETY_SKIP.map((s) => `<li>${s}</li>`).join("")}</ul>
          </div>
        </div>

        <h2 class="h2">얼마나 힘들게 해야 하나요?</h2>
        <p class="page-text">운동 강도는 '자각적 운동 강도(RPE, 6–20)'로 정합니다. 맥박을 재기 어렵거나 혈압약 때문에 맥박이 잘 오르지 않는 분도 쓸 수 있습니다. 대부분의 프로그램은 11–14 사이를 목표로 합니다.</p>
        <ol class="rpe">
          ${RPE.map(([n, t]) => `<li style="--n:${n}" class="${n >= 11 && n <= 14 ? "is-target" : ""}"><span class="rpe-n">${n}</span><span class="rpe-t">${t}</span></li>`).join("")}
        </ol>

        <h2 class="h2">질환별 주의</h2>
        <div class="by-cond">
          ${ORDER.map((id) => `
            <div class="by-cond-item">
              <h3 class="h3"><a href="#/c/${id}">${CONDITIONS[id].name}</a></h3>
              <ul>${gloss(CONDITIONS[id].cautions.map((x) => `<li>${x}</li>`).join(""))}</ul>
            </div>`).join("")}
        </div>
      </section>`;
  }

  /* ── 근거 문헌 ── */
  function renderEvidence(focus) {
    const list = Object.entries(REFS).map(([n, r]) => `
      <li id="ref-${n}" class="${String(focus) === n ? "is-focus" : ""}" tabindex="-1">
        <span class="ref-n">${n}</span>
        <div>
          <p class="ref-text">${r.text} <em>${r.src}</em></p>
          <p class="ref-tag">${r.tag}</p>
        </div>
      </li>`).join("");

    app.innerHTML = `
      <section class="wrap page">
        <h1 class="page-title">근거 문헌</h1>
        <p class="page-lede">프로그램의 단계 나누기, 운동 종류, 운동량은 아래의 임상진료지침과 SCI(E)급 학술지 논문을 바탕으로 했습니다.</p>

        <div class="method">
          <h2 class="h3">어떻게 만들었나요</h2>
          <ul>
            <li><strong>단계 나누기</strong> — 뇌졸중은 기능적 보행 분류(FAC), 척수손상은 국제 신경학적 분류(ISNCSCI·AIS)와 손상 부위, 파킨슨병은 호엔-야 단계를 기준으로 했습니다.</li>
            <li><strong>운동량</strong> — 뇌졸중은 AHA/ASA 운동 권고, 척수손상은 국제 척수손상 운동 지침(2018), 파킨슨병은 APTA 임상진료지침(2022)과 유럽 물리치료 지침(2014)의 범위 안에서 가정용으로 보수적으로 정했습니다.</li>
            <li><strong>혼자 / 보호자와</strong> — 넘어질 위험이 있는 동작은 혼자 할 때 앉아서 하는 대체 동작으로 바꾸었고, 보호자의 역할은 보호자 참여 운동 연구를 참고했습니다.</li>
            <li><strong>한계</strong> — 진료지침은 대부분 치료사가 함께하는 운동을 바탕으로 합니다. 개인의 상태(심장 질환, 골다공증, 통증 등)에 따라 조정이 필요하므로 담당 의료진과 상의해 주세요.</li>
          </ul>
        </div>

        <ol class="refs">${list}</ol>
      </section>`;

    if (focus) {
      const el = document.getElementById("ref-" + focus);
      if (el) { el.scrollIntoView({ block: "center" }); el.focus({ preventScroll: true }); }
    }
  }

  function renderNotFound() {
    app.innerHTML = `<section class="wrap page"><h1 class="page-title">페이지를 찾을 수 없습니다</h1><p><a class="btn btn--solid" href="#/">처음으로 가기</a></p></section>`;
  }

  /* ── 길 찾기 ── */
  function route() {
    const parts = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
    const [page, a, b] = parts;
    let navKey = "";

    if (!page) renderHome();
    else if (page === "c") { renderCondition(a, b); navKey = a; }
    else if (page === "safety") { renderSafety(); navKey = "safety"; }
    else if (page === "evidence") { renderEvidence(a); navKey = "evidence"; }
    else renderNotFound();

    document.querySelectorAll("[data-nav]").forEach((n) => {
      if (n.dataset.nav === navKey) n.setAttribute("aria-current", "page");
      else n.removeAttribute("aria-current");
    });

    const c = page === "c" && CONDITIONS[a];
    document.title = c ? `${c.name} 홈 트레이닝 | 한걸음 홈재활`
      : page === "safety" ? "안전 수칙 | 한걸음 홈재활"
      : page === "evidence" ? "근거 문헌 | 한걸음 홈재활"
      : "한걸음 홈재활";

    if (!(page === "evidence" && a)) {
      // 단계만 바꾼 경우에는 단계 표 위치를 유지합니다
      const pick = document.querySelector(".level-pick");
      if (page === "c" && b && pick && route.lastCond === a) pick.scrollIntoView({ block: "start" });
      else window.scrollTo(0, 0);
    }
    route.lastCond = page === "c" ? a : null;
  }

  window.addEventListener("hashchange", route);
  route();
})();
