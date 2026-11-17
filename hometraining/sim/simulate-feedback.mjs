// 가상 사용자 30만 명 시뮬레이션 (실제 설문이 아닙니다).
// 페르소나 분포(가정값)를 만들고, 현재 사이트의 내용(data.js)과 기능(app.js)을 실제로 검사해
// 각 페르소나가 막히는 지점을 셉니다. 사용: node sim/simulate-feedback.mjs [--json]
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataSrc = fs.readFileSync(path.join(root, "data.js"), "utf8");
const appSrc = fs.readFileSync(path.join(root, "app.js"), "utf8");
const ctx = {};
vm.createContext(ctx);
vm.runInContext(dataSrc + `;this.D={CONDITIONS,MODES,G:typeof GLOSSARY!=="undefined"?GLOSSARY:null,GEAR:typeof GEAR!=="undefined"?GEAR:null};`, ctx);
const { CONDITIONS, MODES, G, GEAR } = ctx.D;

/* ── 사이트에서 실제로 확인하는 기능 ── */
const F = {
  glossary: !!G && /data-term/.test(appSrc),
  tts: /speechSynthesis/.test(appSrc),
  counter: /data-count/.test(appSrc) && /rest-timer|restTimer/.test(appSrc),
  gear: !!GEAR,
  fallCheck: Object.values(CONDITIONS).every((c) => c.quiz.some((q) => q.check) || c.quiz.some((q) => /넘어/.test(q.q))),
  carerBody: MODES.carer.rules.some((r) => /허리/.test(r) && /보호자/.test(r) && /무릎/.test(r)),
  badDay: /bad-day|badDay/.test(appSrc),
  weekLog: /week-log|weekLog/.test(appSrc),
  textSize: /textsize/.test(appSrc),
  pictures: Object.values(CONDITIONS).every((c) => c.levels.every((l) => l.exercises.every((e) => e.fig))),
};

/* ── 내용에서 직접 세는 값 ── */
const JARGON = ["RPE", "FAC", "AIS", "H&Y", "경수", "흉수", "요수", "자율신경 반사부전", "기립성 저혈압", "베타차단제", "경직", "에르고미터", "회전근개", "메트로놈"];
const GEARWORDS = ["밴드", "메트로놈", "보행벨트", "에르고미터", "모래주머니", "심박계", "호흡 훈련기"];
function levelText(c, lv) {
  return JSON.stringify(lv) + " " + c.cautions.join(" ") + " " + c.measureNote;
}
const levelInfo = {};
for (const [id, c] of Object.entries(CONDITIONS)) {
  levelInfo[id] = c.levels.map((lv) => {
    const t = levelText(c, lv);
    return {
      jargon: JARGON.filter((w) => t.includes(w)).length,
      gear: GEARWORDS.filter((w) => t.includes(w)),
      steps: lv.exercises.reduce((n, e) => n + e.alone.steps.length + e.carer.steps.length, 0),
    };
  });
}

/* ── 페르소나 분포 (가정값) ── */
let seed = 20261117;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const pick = (w) => { let r = rnd(), a = 0; for (let i = 0; i < w.length; i++) { a += w[i]; if (r < a) return i; } return w.length - 1; };
const P = {
  cond: [["stroke", .60], ["pd", .25], ["sci", .15]],
  level: { stroke: [.30, .30, .40], sci: [.30, .45, .25], pd: [.45, .35, .20] },
  old: { stroke: .55, pd: .60, sci: .20 },
};

const N = 300000;
const issues = {
  overrated_level: { label: "넘어진 적이 있는데 높은 단계로 안내됨 (안전)", n: 0, fixed: F.fallCheck },
  jargon: { label: "전문용어(RPE, FAC, 경수 등)를 이해하지 못함", n: 0, fixed: F.glossary },
  cant_read: { label: "글을 읽기 어려움 (실어증·시력 저하)", n: 0, fixed: F.tts },
  lose_count: { label: "횟수·버티는 시간·쉬는 시간을 세기 어려움", n: 0, fixed: F.counter },
  no_gear: { label: "필요한 준비물이 없거나 무엇이 필요한지 모름", n: 0, fixed: F.gear },
  carer_back: { label: "보호자(고령 배우자)가 돕다가 허리 부담", n: 0, fixed: F.carerBody },
  bad_day: { label: "컨디션 나쁜 날 얼마나 줄일지 모름", n: 0, fixed: F.badDay },
  no_progress: { label: "한 주 동안 얼마나 했는지 볼 수 없음", n: 0, fixed: F.weekLog },
  small_text: { label: "글자가 작음", n: 0, fixed: F.textSize },
  want_pictures: { label: "동작 그림·영상이 없어 자세를 확신할 수 없음", n: 0, fixed: F.pictures },
};
const hit = (k) => { if (!issues[k].fixed) issues[k].n++; };
const byCond = { stroke: 0, pd: 0, sci: 0 };
let anyBlocked = 0;

for (let i = 0; i < N; i++) {
  const id = P.cond[pick(P.cond.map((x) => x[1]))][0];
  const level = pick(P.level[id]) + 1;
  const info = levelInfo[id][level - 1];
  const carerRole = rnd() < .45;
  const old = rnd() < P.old[id];
  const lowLit = rnd() < (old ? .45 : .15);
  const aphasia = id === "stroke" && rnd() < .25;
  const lowVision = rnd() < (old ? .25 : .08);
  const handImp = rnd() < ({ stroke: [.7, .5, .25], sci: [.95, .2, .3], pd: [.35, .4, .5] }[id][level - 1]);
  const cogImp = rnd() < (id === "pd" ? [.1, .3, .45][level - 1] : id === "stroke" ? .3 : .05);
  const hasBand = rnd() < .3;
  const before = Object.values(issues).reduce((a, x) => a + x.n, 0);

  // 단계 판정: 혼자 걷는다고 답했지만 최근 넘어진 사람
  const topLevel = id === "pd" ? 1 : 3;
  if (level === topLevel && rnd() < (id === "pd" ? .0 : id === "sci" ? .3 : .2)) hit("overrated_level");
  if (id === "pd" && level === 1 && rnd() < .12) hit("overrated_level"); // 동결은 있으나 낙상 없음

  if (info.jargon > 0 && (lowLit || (old && rnd() < .5))) hit("jargon");
  if (aphasia || lowVision || (lowLit && rnd() < .3)) hit("cant_read");
  if (cogImp || (handImp && !carerRole) || (lowVision && rnd() < .5)) hit("lose_count");
  if (info.gear.some((g) => g === "밴드") ? !hasBand : (info.gear.length > 0 && rnd() < .5)) hit("no_gear");
  if (carerRole && rnd() < .5 && level <= 2) hit("carer_back");
  if (rnd() < (id === "pd" ? .45 : .3)) hit("bad_day");
  if (carerRole ? rnd() < .5 : rnd() < .2) hit("no_progress");
  if (lowVision || (old && rnd() < .3)) hit("small_text");
  if (rnd() < (lowLit ? .7 : .45)) hit("want_pictures");

  const after = Object.values(issues).reduce((a, x) => a + x.n, 0);
  if (after > before) { anyBlocked++; byCond[id]++; }
}

const rows = Object.entries(issues).sort((a, b) => b[1].n - a[1].n);
if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ N, features: F, issues: Object.fromEntries(rows.map(([k, v]) => [k, v.n])), anyBlocked }, null, 2));
} else {
  console.log("기능:", Object.entries(F).map(([k, v]) => `${k}=${v ? "O" : "X"}`).join(" "));
  for (const [k, v] of rows) console.log(String(v.n).padStart(7), (v.n / N * 100).toFixed(1).padStart(5) + "%", v.label);
  console.log("하나 이상 막힌 사용자:", anyBlocked, (anyBlocked / N * 100).toFixed(1) + "%");
}
