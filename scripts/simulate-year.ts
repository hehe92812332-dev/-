// 1년간 100만 명 사용 시뮬레이션 (행동 기반, 실제 규칙 엔진 ledger.ts 사용)
// 전체의 SAMPLE 비율만 시뮬레이션하고 결과를 100만 명 기준으로 환산합니다.
// 실행: npx tsx scripts/simulate-year.ts [표본비율=0.01] [시드=42]
import {
  ADOPT_DEADLINE_DAYS,
  CATEGORIES,
  MEMBERSHIP_PLANS,
  MIN_WITHDRAW_TOKENS,
  TIERS,
  TOKEN_KRW,
  TOKEN_PACKAGES,
  type Degree,
  type TierId,
} from "../src/lib/config";
import * as ledger from "../src/lib/ledger";
import { temperatureOf } from "../src/lib/manner";
import { tierFor, tierRank } from "../src/lib/tier";
import type { Post, User } from "../src/lib/types";

// ───────────── 개선 반영 여부 ─────────────
// --improved: 알림(1:1 질문 도착 시 치료사가 접속할 확률↑), '내가 답변할 수 있는 질문' 정렬(답변 가능자가 적은 질문 먼저),
//             24시간 무답변 시 '등급 낮추기' 제안 수락을 행동에 반영
const IMPROVED = process.argv.includes("--improved");
const NOTIFIED_ACTIVE = 0.7; // 1:1 질문 알림을 받은 날 접속할 확률
const ACCEPT_LOWER = 0.5; // (자동 낮추기를 끈 질문) 등급 낮추기 제안을 받아들이는 비율
const KEEP_AUTO_LOWER = 0.85; // 질문할 때 '자동 등급 낮추기'(기본 켜짐)를 그대로 두는 비율

// ───────────── 가정 (조정 가능) ─────────────
const TOTAL_USERS = 1_000_000;
const SAMPLE = Number(process.argv.find((a) => /^0?\.\d+$/.test(a)) ?? 0.01);
const THERAPIST_SHARE = 0.03; // 가입자 중 치료사 3% (국내 물리치료사 면허 약 9만 명 중 3만 명 가입 가정)
const ASKING_PATIENT_SHARE = 0.3; // 1년 동안 한 번이라도 질문하는 환자 비율
const QUESTIONS_PER_ASKER = 2.2; // 질문하는 환자 1인당 연간 평균 질문 수 (회원 제외)
const MEMBER_SHARE = { basic: 0.03, premium: 0.007 }; // 질문하는 환자 중 멤버십 가입
const MEMBER_QUESTIONS_PER_MONTH = { basic: 4, premium: 8 };
const DIRECT_SHARE = 0.12; // 1:1 지정 질문 비율
const THERAPIST_ACTIVE_DAY = 0.18; // 치료사가 하루에 접속할 확률
const ANSWERS_PER_ACTIVE_DAY = 1.6; // 접속한 날 평균 답변 수
const ADOPT_PROB_PER_DAY = 0.45; // 답변이 있는 질문을 질문자가 그날 채택할 확률
const RATE_ANSWER = 0.6;
const RATE_ASKER = 0.3;
const TIP_PROB = 0.05;
const REVOKE_PROB = 0.02;
const CHAT_PER_ACTIVE_DAY = 1.5;
// 질문자가 고르는 답변 등급 (가격 민감도)
const TIER_CHOICE: [TierId, number][] = [
  ["rough", 0.05],
  ["pearl", 0.12],
  ["opal", 0.1],
  ["topaz", 0.2],
  ["amethyst", 0.15],
  ["emerald", 0.14],
  ["sapphire", 0.1],
  ["ruby", 0.08],
  ["diamond", 0.06],
];

// ───────────── 난수 (재현 가능) ─────────────
let seed = 42;
const rand = () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
const weighted = <T,>(xs: [T, number][]) => {
  let r = rand() * xs.reduce((s, [, w]) => s + w, 0);
  for (const [x, w] of xs) if ((r -= w) <= 0) return x;
  return xs[xs.length - 1][0];
};
const poisson = (l: number) => {
  let k = 0;
  let p = Math.exp(-l);
  let s = p;
  const u = rand();
  while (u > s) {
    k++;
    p *= l / k;
    s += p;
  }
  return k;
};

// ───────────── 시뮬레이션 시계 ─────────────
const DAY = 86400_000;
const START = Date.UTC(2027, 0, 1);
let simNow = START;
Date.now = () => simNow;

// ───────────── 인구 생성 ─────────────
const nUsers = Math.round(TOTAL_USERS * SAMPLE);
const nTherapists = Math.round(nUsers * THERAPIST_SHARE);
const SCALE = 1 / SAMPLE;

function makeTherapist(i: number): User {
  // 경력: 신규 비중이 높은 분포 (0~30년)
  const years = Math.min(30, Math.floor(-Math.log(1 - rand()) * 6.5));
  const hours = Math.max(0, Math.round(years * (25 + rand() * 30) + (rand() - 0.3) * 120));
  const degree: Degree = rand() < 0.03 + years * 0.006 ? "doctor" : rand() < 0.15 + years * 0.01 ? "master" : "none";
  return {
    id: `t${i}`,
    name: `치료사${i}`,
    role: "therapist",
    avatarColor: "#000",
    joinedAt: new Date(START).toISOString(),
    wallet: { cash: 0, bonus: 0, earned: 0 },
    therapist: {
      licenseVerified: true,
      verification: "approved",
      experienceYears: years,
      educationHours: hours,
      degree,
      hospitalType: "hospital",
      hospitalName: "",
      specialties: [pick([...CATEGORIES]), pick([...CATEGORIES])],
      bio: "",
    },
  };
}

const users: User[] = [];
for (let i = 0; i < nTherapists; i++) users.push(makeTherapist(i));
interface PatientPlan {
  id: string;
  joinDay: number;
  questionDays: number[];
  member?: "basic" | "premium";
}
const plans: PatientPlan[] = [];
for (let i = 0; i < nUsers - nTherapists; i++) {
  // 가입은 1년에 걸쳐 증가 (후반 가입자가 더 많음)
  const joinDay = Math.floor(Math.sqrt(rand()) * 365);
  const id = `p${i}`;
  users.push({ id, name: `환자${i}`, role: "patient", avatarColor: "#000", joinedAt: new Date(START + joinDay * DAY).toISOString(), wallet: { cash: 0, bonus: 0, earned: 0 } });
  const plan: PatientPlan = { id, joinDay, questionDays: [] };
  if (rand() < ASKING_PATIENT_SHARE) {
    const r = rand();
    plan.member = r < MEMBER_SHARE.premium ? "premium" : r < MEMBER_SHARE.premium + MEMBER_SHARE.basic ? "basic" : undefined;
    const n = plan.member
      ? Math.round(MEMBER_QUESTIONS_PER_MONTH[plan.member] * ((365 - joinDay) / 30))
      : Math.max(1, poisson(QUESTIONS_PER_ASKER));
    for (let k = 0; k < n; k++) plan.questionDays.push(joinDay + Math.floor(rand() * (365 - joinDay)));
  }
  plans.push(plan);
}

let s: ledger.State = { users, posts: [], transactions: [], ratings: [], chats: [], reports: [], blocks: [], currentUserId: null };

// 빠른 조회용 (ledger는 불변 배열을 쓰므로 매번 갱신)
const therapists = users.filter((u) => u.therapist);
const tierOf = new Map(therapists.map((t) => [t.id, ledger.userTier(t)!.id]));
// 1:1 지정은 인기(상위 등급·고온도)에 몰림
const popularity = therapists.map((t) => [t.id, 1 + tierRank(tierOf.get(t.id)!) ** 2] as [string, number]);

// ───────────── 지표 ─────────────
const m = {
  purchases: 0,
  purchaseKrw: 0,
  revokes: 0,
  membershipKrw: 0,
  questions: 0,
  directQuestions: 0,
  failedNoBalance: 0,
  postsByTier: new Map<TierId, { total: number; answered: number; refunded: number; firstAnswerDays: number[] }>(),
  directRefunded: 0,
  adoptManual: 0,
  adoptAuto: 0,
  withdrawals: 0,
  withdrawKrw: 0,
  tips: 0,
  ratingsGiven: 0,
  chatsByTier: new Map<TierId, number>(),
  directLoad: new Map<string, number>(),
  peakDailyQuestions: 0,
  lowered: 0,
  peakDailyActions: 0,
};
for (const t of TIERS) m.postsByTier.set(t.id, { total: 0, answered: 0, refunded: 0, firstAnswerDays: [] });

const apply = (r: ledger.Outcome) => {
  if (r.ok) s = r.state;
  return r;
};
const userById = () => new Map(s.users.map((u) => [u.id, u]));

function ensureBalance(uid: string, need: number, member?: "basic" | "premium") {
  const u = s.users.find((x) => x.id === uid)!;
  if (ledger.balanceOf(u) >= need) return true;
  if (member && !u.membership) {
    const plan = MEMBERSHIP_PLANS.find((p) => p.id === member)!;
    apply(ledger.subscribe(s, uid, plan.id, "card"));
    return ledger.balanceOf(s.users.find((x) => x.id === uid)!) >= need;
  }
  // 가장 작은 상품(최소 충전)을 산다
  const pkg = TOKEN_PACKAGES[0];
  if (apply(ledger.purchase(s, uid, pkg.id, "card")).ok) {
    m.purchases++;
    m.purchaseKrw += pkg.price;
  }
  return true;
}

const firstAnswerAt = new Map<string, number>();
const origTier = new Map<string, TierId>(); // 질문할 때 고른 등급 (자동·수동 낮추기 전)
const t0 = performance.now();

for (let day = 0; day < 365; day++) {
  simNow = START + day * DAY + 9 * 3600_000;
  let actions = 0;
  let qToday = 0;

  // 1) 질문 등록
  for (const p of plans) {
    for (const qd of p.questionDays) {
      if (qd !== day) continue;
      const direct = rand() < DIRECT_SHARE;
      const target = weighted(TIER_CHOICE);
      const directTherapistId = direct ? weighted(popularity) : undefined;
      const u = s.users.find((x) => x.id === p.id)!;
      const quote = ledger.quoteQuestion(s, u, { targetTier: target, directTherapistId });
      if (!ensureBalance(p.id, quote.total, p.member)) {
        m.failedNoBalance++;
        continue;
      }
      const r = apply(
        ledger.createPost(s, p.id, {
          board: "patient",
          title: "시뮬레이션 질문입니다",
          body: "시뮬레이션용 본문입니다. 증상과 상황을 충분히 설명합니다.",
          category: pick([...CATEGORIES]),
          targetTier: target,
          directTherapistId,
          autoLower: IMPROVED && rand() < KEEP_AUTO_LOWER,
        }),
      );
      actions++;
      if (!r.ok) {
        m.failedNoBalance++;
        continue;
      }
      qToday++;
      m.questions++;
      const post = s.posts[0];
      origTier.set(post.id, post.targetTier);
      m.postsByTier.get(post.targetTier)!.total++;
      if (direct) {
        m.directQuestions++;
        m.directLoad.set(directTherapistId!, (m.directLoad.get(directTherapistId!) ?? 0) + 1);
      }
      // 일부는 바로 청약철회(미사용 충전분)
      if (rand() < REVOKE_PROB) {
        const tx = s.transactions.find((t) => t.userId === p.id && t.type === "purchase" && ledger.canRevoke(s, t));
        if (tx && apply(ledger.revokePurchase(s, p.id, tx.id)).ok) m.revokes++;
      }
    }
  }
  m.peakDailyQuestions = Math.max(m.peakDailyQuestions, qToday);

  // 2) 치료사 답변 — 자격 되는 열린 질문 중 현상금 높은 순·답변 적은 순으로 고름
  const open = s.posts.filter((p) => p.status === "open");
  const pendingDirect = new Set(open.filter((p) => p.directTherapistId && p.answers.length === 0).map((p) => p.directTherapistId!));
  for (const t of therapists) {
    const activeProb = IMPROVED && pendingDirect.has(t.id) ? NOTIFIED_ACTIVE : THERAPIST_ACTIVE_DAY;
    if (rand() > activeProb) continue;
    const myRank = tierRank(tierOf.get(t.id)!);
    let quota = poisson(ANSWERS_PER_ACTIVE_DAY);
    // 나에게 온 1:1 질문 먼저
    // 화면에 보이는 그 순간의 상태로 고름 (앞 사람이 답한 질문은 답변 수가 늘어 있음)
    const live = new Map(s.posts.filter((p) => p.status === "open").map((p) => [p.id, p]));
    const candidates = [...live.values()]
      .filter(
        (p) =>
          p.authorId !== t.id &&
          (p.directTherapistId ? p.directTherapistId === t.id : tierRank(p.targetTier) <= myRank) &&
          !p.answers.some((a) => a.authorId === t.id) &&
          p.answers.length < 3,
      )
      .sort((a, b) =>
        IMPROVED
          ? // '내가 답변할 수 있는 질문' 화면 정렬: 1:1 → 답변 적은 → 답변 가능자가 적은(높은 등급) → 마감 임박
            Number(!!b.directTherapistId) - Number(!!a.directTherapistId) ||
            a.answers.length - b.answers.length ||
            tierRank(b.targetTier) - tierRank(a.targetTier) ||
            a.expiresAt.localeCompare(b.expiresAt)
          : // 개선 전: 일반 목록(최신순)을 보며 답변
            Number(!!b.directTherapistId) - Number(!!a.directTherapistId) || b.createdAt.localeCompare(a.createdAt),
      );
    for (const p of candidates) {
      if (quota <= 0) break;
      const r = apply(ledger.addAnswer(s, t.id, p.id, "시뮬레이션 답변입니다. 운동 방법과 주의사항을 설명합니다."));
      actions++;
      if (!r.ok) continue;
      quota--;
      if (!firstAnswerAt.has(p.id)) firstAnswerAt.set(p.id, day);
    }
    // 라운지 대화
    const chats = poisson(CHAT_PER_ACTIVE_DAY);
    m.chatsByTier.set(tierOf.get(t.id)!, (m.chatsByTier.get(tierOf.get(t.id)!) ?? 0) + chats);
  }

  // 3) 질문자 채택·평가·팁
  for (const p of s.posts.filter((x) => x.status === "open" && x.answers.length > 0)) {
    if (rand() > ADOPT_PROB_PER_DAY) continue;
    const best = [...p.answers].sort(() => rand() - 0.5)[0];
    if (!apply(ledger.adopt(s, p.authorId, p.id, best.id)).ok) continue;
    m.adoptManual++;
    actions++;
    if (rand() < RATE_ANSWER) {
      const score = weighted<"great" | "good" | "bad">([["great", 0.55], ["good", 0.35], ["bad", 0.1]]);
      if (apply(ledger.rate(s, p.authorId, { postId: p.id, answerId: best.id, score, tags: [] })).ok) m.ratingsGiven++;
    }
    if (rand() < RATE_ASKER && apply(ledger.rate(s, best.authorId, { postId: p.id, score: rand() < 0.9 ? "great" : "good", tags: [] })).ok)
      m.ratingsGiven++;
    if (rand() < TIP_PROB) {
      ensureBalance(p.authorId, 5);
      if (apply(ledger.tip(s, p.authorId, p.id, best.id, 5)).ok) m.tips++;
    }
  }

  // 3-1) 24시간 무답변 질문: 등급 낮추기 제안 → 일부 수락 (두 단계 아래, 최저 원석)
  if (IMPROVED)
    for (const p of s.posts.filter(
      (x) =>
        x.status === "open" &&
        !x.autoLower &&
        !x.directTherapistId &&
        x.answers.length === 0 &&
        x.targetTier !== "rough" &&
        simNow - new Date(x.createdAt).getTime() >= DAY &&
        simNow - new Date(x.createdAt).getTime() < 2 * DAY,
    ))
      if (rand() < ACCEPT_LOWER) {
        const to = TIERS[Math.max(0, tierRank(p.targetTier) - 2)].id;
        if (apply(ledger.lowerTargetTier(s, p.authorId, p.id, to)).ok) m.lowered++;
      }

  // 4) 자정 정산 (크론): 기한 만료 질문, 멤버십 갱신
  simNow = START + (day + 1) * DAY - 1000;
  const before = new Map(s.posts.map((p) => [p.id, p.status]));
  const tiersBefore = new Map(s.posts.filter((p) => p.status === "open").map((p) => [p.id, p.targetTier]));
  s = ledger.sweep(s, simNow);
  for (const p of s.posts) if (tiersBefore.has(p.id) && tiersBefore.get(p.id) !== p.targetTier) m.lowered++;
  for (const p of s.posts) {
    if (before.get(p.id) === "open" && p.status !== "open") {
      if (p.closedReason === "auto_adopt") m.adoptAuto++;
      if (p.status === "refunded" && p.directTherapistId) m.directRefunded++;
    }
  }

  // 5) 치료사 환전 (환전 가능액이 기준 이상이면 신청)
  if (day % 7 === 6)
    for (const t of therapists) {
      const avail = ledger.withdrawable(s, t.id);
      if (avail >= MIN_WITHDRAW_TOKENS && apply(ledger.withdraw(s, t.id, avail, "국민 123456789012")).ok) {
        m.withdrawals++;
        m.withdrawKrw += avail * TOKEN_KRW;
      }
    }
  m.peakDailyActions = Math.max(m.peakDailyActions, actions);
  if (day % 60 === 0) process.stderr.write(`day ${day} posts=${s.posts.length} tx=${s.transactions.length} ${Math.round(performance.now() - t0)}ms\n`);
}

// ───────────── 집계 ─────────────
m.membershipKrw = s.transactions.filter((t) => t.type === "membership").reduce((a, t) => a + (t.krw ?? 0), 0);
for (const p of s.posts) {
  const st = m.postsByTier.get(origTier.get(p.id) ?? p.targetTier)!;
  if (firstAnswerAt.has(p.id)) {
    st.answered++;
    st.firstAnswerDays.push(firstAnswerAt.get(p.id)! - Math.floor((new Date(p.createdAt).getTime() - START) / DAY));
  }
  if (p.status === "refunded") st.refunded++;
}
const um = userById();
const patientsList = s.users.filter((u) => u.role === "patient");
const unused = patientsList.map((u) => u.wallet.cash + u.wallet.bonus).filter((x) => x > 0);
const tEarn = therapists.map((t) => um.get(t.id)!.wallet.earned + -s.transactions.filter((x) => x.userId === t.id && x.type === "withdraw").reduce((a, x) => a + x.tokens, 0));
const tWithdrew = new Set(s.transactions.filter((x) => x.type === "withdraw").map((x) => x.userId));
const stuck = therapists.filter((t) => !tWithdrew.has(t.id) && um.get(t.id)!.wallet.earned > 0).length;
const median = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : 0);
const pct = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(1)}%` : "-");
const scaled = (x: number) => Math.round(x * SCALE).toLocaleString();
const tierCount = new Map<TierId, number>();
for (const t of therapists) tierCount.set(tierOf.get(t.id)!, (tierCount.get(tierOf.get(t.id)!) ?? 0) + 1);
const temps = s.users.filter((u) => s.ratings.some((r) => r.toId === u.id)).map((u) => temperatureOf(s.ratings, u.id));
const hiddenRatings = s.ratings.filter(
  (r) => !s.ratings.some((o) => o.postId === r.postId && o.fromId === r.toId && o.toId === r.fromId) && simNow - new Date(r.createdAt).getTime() < 7 * DAY,
).length;
const directLoads = [...m.directLoad.values()].sort((a, b) => b - a);

const out: string[] = [];
const line = (x = "") => out.push(x);
line(`# 1년 · 100만 명 사용 시뮬레이션 결과 — ${IMPROVED ? "개선 후" : "개선 전"} (표본 ${SAMPLE * 100}% → ×${SCALE} 환산)`);
line();
line(`실행 시간 ${(performance.now() - t0) / 1000 | 0}초 · 표본 회원 ${nUsers.toLocaleString()}명(치료사 ${nTherapists}명)`);
line();
line(`## 규모 (100만 명 환산)`);
line(`- 질문 ${scaled(m.questions)}건 (1:1 ${scaled(m.directQuestions)}건), 답변 ${scaled(s.posts.reduce((a, p) => a + p.answers.length, 0))}건, 거래 기록 ${scaled(s.transactions.length)}건, 평가 ${scaled(m.ratingsGiven)}건`);
line(`- 하루 최대 질문 ${scaled(m.peakDailyQuestions)}건, 하루 최대 쓰기 요청(질문·답변·채택) 약 ${scaled(m.peakDailyActions)}건`);
line(`- 라운지 메시지 연 ${scaled([...m.chatsByTier.values()].reduce((a, b) => a + b, 0))}건`);
line();
line(`## 등급별 답변 현황`);
line(`| 처음 고른 등급 | 치료사 수(환산) | 답변 가능 치료사 | 질문 수 | 답변 받음 | 무답변 환불 | 첫 답변까지(일, 중앙값) |`);
line(`|---|---|---|---|---|---|---|`);
for (const t of TIERS) {
  const st = m.postsByTier.get(t.id)!;
  const eligible = therapists.filter((x) => tierRank(tierOf.get(x.id)!) >= tierRank(t.id)).length;
  line(`| ${t.name} | ${scaled(tierCount.get(t.id) ?? 0)} | ${scaled(eligible)} | ${scaled(st.total)} | ${pct(st.answered, st.total)} | ${pct(st.refunded, st.total)} | ${median(st.firstAnswerDays)} |`);
}
line(`- 1:1 지정 질문 무답변 환불: ${pct(m.directRefunded, m.directQuestions)}`);
line(`- 1:1 질문이 가장 많이 몰린 치료사 상위 1%의 연간 1:1 질문 수: ${directLoads.slice(0, Math.max(1, Math.round(directLoads.length * 0.01))).join(", ")} (표본 기준)`);
line(`- 채택: 질문자 채택 ${pct(m.adoptManual, m.adoptManual + m.adoptAuto)}, 자동 채택 ${pct(m.adoptAuto, m.adoptManual + m.adoptAuto)}`);
const allQ = [...m.postsByTier.values()].reduce((a, x) => a + x.total, 0);
const allRefunded = [...m.postsByTier.values()].reduce((a, x) => a + x.refunded, 0);
line(`- **전체 질문 중 무답변 환불 ${pct(allRefunded, allQ)}**${IMPROVED ? ` (등급 낮추기 ${scaled(m.lowered)}회)` : ""}`);
line();
line(`## 치료사 수익·환전`);
line(`- 연간 획득 토큰 중앙값 ${median(tEarn)}토큰, 상위 10% ${[...tEarn].sort((a, b) => b - a)[Math.floor(tEarn.length * 0.1)]}토큰`);
line(`- 한 번이라도 환전한 치료사 ${pct(tWithdrew.size, therapists.length)}, 수익이 있지만 최소 환전(${MIN_WITHDRAW_TOKENS}토큰) 미달로 묶인 치료사 ${pct(stuck, therapists.length)}`);
line(`- 환전 총액 ${scaled(m.withdrawKrw)}원`);
line();
line(`## 환자 토큰·결제`);
line(`- 충전 ${scaled(m.purchases)}건 / ${scaled(m.purchaseKrw)}원, 멤버십 결제 ${scaled(m.membershipKrw)}원, 결제 취소 ${scaled(m.revokes)}건`);
line(`- 연말 미사용 잔액 보유 환자 ${scaled(unused.length)}명, 1인 중앙값 ${median(unused)}토큰, 총 미사용 잔액 ${scaled(unused.reduce((a, b) => a + b, 0) * TOKEN_KRW)}원`);
const feeTokens =
  s.posts.filter((p) => p.status === "adopted").reduce((a, p) => a + (p.bounty - ledger.rewardAfterFee(p.bounty)), 0) +
  s.transactions.filter((t) => t.type === "tip_sent").reduce((a, t) => a + (-t.tokens - ledger.rewardAfterFee(-t.tokens)), 0);
line(`- 플랫폼 수수료 수입(채택·팁) ${scaled(feeTokens * TOKEN_KRW)}원`);
line(`- 질문자 1인당 평균 질문 ${(m.questions / plans.filter((p) => p.questionDays.length).length).toFixed(1)}건, 질문 1건 평균 비용 ${(s.posts.reduce((a, p) => a + p.bounty, 0) / s.posts.length).toFixed(1)}토큰`);
line();
line(`## 등급 라운지 (100만 명 환산)`);
line(`| 라운지 | 멤버 | 하루 메시지 |`);
line(`|---|---|---|`);
for (const t of [...TIERS].reverse()) line(`| ${t.name} | ${scaled(tierCount.get(t.id) ?? 0)} | ${scaled((m.chatsByTier.get(t.id) ?? 0) / 365)} |`);
line();
line(`## 만족도 온도`);
line(`- 평가를 한 번이라도 받은 회원 ${scaled(temps.length)}명, 온도 중앙값 ${median(temps)}°C, 최고 ${Math.max(...temps)}°C`);
line(`- 연말 기준 아직 블라인드 상태인 평가 ${pct(hiddenRatings, s.ratings.length)}`);
console.log(out.join("\n"));
