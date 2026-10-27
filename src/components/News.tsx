"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AlertTriangle, ArrowRight, Brain, CalendarDays, CheckCircle2, Dumbbell, Eye, Lightbulb, Newspaper, PenSquare, Phone, Search, Siren, Stethoscope } from "lucide-react";
import { BODY_PARTS, NEWS_CATEGORIES, todayKST, type ArticleSummary } from "@/lib/news";
import { useArticle, useNews, useTodayArticle } from "@/lib/news-client";
import { userTier, useStore } from "@/lib/store";
import { Notice } from "./ui";

const fmtDay = (ymd: string | null) => {
  if (!ymd) return "";
  const [y, m, d] = ymd.split("-").map(Number);
  const w = "일월화수목금토"[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${m}월 ${d}일 (${w})`;
};

const CAT_STYLE: Record<string, string> = {
  근골격계: "bg-sky-100 text-sky-700",
  신경계: "bg-violet-100 text-violet-700",
};

function CategoryChip({ category, bodyPart }: { category: string; bodyPart: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs">
      <span className={`rounded-full px-2 py-0.5 font-bold ${CAT_STYLE[category] ?? "bg-slate-100 text-slate-600"}`}>{category}</span>
      <span className="chip !py-0.5">{bodyPart}</span>
    </span>
  );
}

const STATUS_LABEL: Record<string, [string, string]> = {
  review: ["검수 대기", "bg-amber-100 text-amber-800"],
  approved: ["승인", "bg-brand-50 text-brand-700"],
  rejected: ["보완 필요", "bg-rose-100 text-rose-700"],
  archived: ["게시 중단", "bg-slate-100 text-slate-500"],
};

export function NewsCard({ a, showStatus }: { a: ArticleSummary; showStatus?: boolean }) {
  const scheduled = a.status === "approved" && a.publishOn && a.publishOn > todayKST();
  return (
    <Link href={`/news/${a.slug}`} className="card group flex flex-col p-5 transition hover:-translate-y-0.5 hover:shadow-md">
      <div className="flex items-center gap-2">
        <CategoryChip category={a.category} bodyPart={a.bodyPart} />
        {showStatus && (
          <span className={`ml-auto rounded-full px-2 py-0.5 text-[11px] font-bold ${STATUS_LABEL[a.status][1]}`}>
            {scheduled ? `${fmtDay(a.publishOn)} 게시 예정` : STATUS_LABEL[a.status][0]}
          </span>
        )}
      </div>
      <h3 className="mt-3 line-clamp-2 text-base font-bold leading-snug group-hover:text-brand-700">{a.title}</h3>
      <p className="mt-1.5 line-clamp-2 text-sm leading-relaxed text-slate-500">{a.summary}</p>
      {showStatus && a.status === "rejected" && a.reviewNote && <p className="mt-2 text-xs text-rose-600">검수 의견: {a.reviewNote}</p>}
      <div className="mt-auto flex items-center gap-3 pt-4 text-xs text-slate-400">
        <span>{fmtDay(a.publishOn)}</span>
        <span className="truncate">{a.authorName}</span>
        {!showStatus && (
          <span className="ml-auto inline-flex items-center gap-1">
            <Eye className="size-3.5" />
            {a.views.toLocaleString()}
          </span>
        )}
      </div>
    </Link>
  );
}

/** 홈 화면용: 오늘의 건강 정보 */
export function TodayHealthCard() {
  const { article, loading } = useTodayArticle();
  if (loading && !article) return <div className="card h-40 animate-pulse bg-slate-100" />;
  if (!article) return null;
  return (
    <Link href={`/news/${article.slug}`} className="card group relative block overflow-hidden p-6 transition hover:shadow-md md:p-8">
      <div className="absolute -right-10 -top-10 size-40 rounded-full bg-brand-50" aria-hidden />
      <div className="relative">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-ink px-3 py-1 text-xs font-bold text-white">
            <Newspaper className="size-3.5" /> 오늘의 건강 정보
          </span>
          <CategoryChip category={article.category} bodyPart={article.bodyPart} />
        </div>
        <h3 className="mt-4 text-xl font-extrabold leading-snug tracking-tight group-hover:text-brand-700 md:text-2xl">{article.title}</h3>
        <p className="mt-2 line-clamp-2 max-w-2xl text-slate-500">{article.summary}</p>
        <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm font-semibold text-slate-600">
          <span className="inline-flex items-center gap-1.5"><Brain className="size-4 text-slate-400" />원인</span>
          <span className="inline-flex items-center gap-1.5"><Dumbbell className="size-4 text-slate-400" />집에서 하는 운동</span>
          <span className="inline-flex items-center gap-1.5"><Stethoscope className="size-4 text-slate-400" />병원에 가야 할 때</span>
          <span className="ml-auto inline-flex items-center gap-1 text-brand-700">
            읽어 보기 <ArrowRight className="size-4 transition group-hover:translate-x-0.5" />
          </span>
        </div>
      </div>
    </Link>
  );
}

export function NewsHome() {
  const { currentUser } = useStore();
  const isTherapist = !!currentUser && !!userTier(currentUser);
  const [category, setCategory] = useState<string>("전체");
  const [bodyPart, setBodyPart] = useState<string>("전체");
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setQuery(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);
  const filtered = category !== "전체" || bodyPart !== "전체" || query.length >= 2;
  const news = useNews({
    category: category === "전체" ? undefined : category,
    bodyPart: bodyPart === "전체" ? undefined : bodyPart,
    q: query.length >= 2 ? query : undefined,
  });
  const [hero, ...rest] = news.items;

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 md:py-12">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight md:text-3xl">건강 소식</h1>
          <p className="mt-2 text-slate-500">매일 한 편, 근골격계·신경계 질환의 원인과 집에서 할 수 있는 운동, 병원에 가야 하는 신호를 정리해 드려요.</p>
        </div>
        {isTherapist && (
          <Link href="/news/write" className="btn-ghost shrink-0">
            <PenSquare className="size-4" /> 원고 보내기
          </Link>
        )}
      </div>

      {!filtered && hero && (
        <Link href={`/news/${hero.slug}`} className="group mt-8 block overflow-hidden rounded-3xl bg-gradient-to-br from-ink to-slate-700 p-6 text-white md:p-10">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 font-bold">
              <CalendarDays className="size-3.5" /> {fmtDay(hero.publishOn)} 오늘의 건강 정보
            </span>
            <span className="rounded-full bg-white/15 px-2.5 py-1 font-semibold">{hero.category} · {hero.bodyPart}</span>
          </div>
          <h2 className="mt-5 max-w-3xl text-2xl font-extrabold leading-snug tracking-tight md:text-4xl">{hero.title}</h2>
          <p className="mt-3 max-w-2xl text-white/75">{hero.summary}</p>
          <span className="mt-6 inline-flex items-center gap-1 font-semibold text-brand-200">
            자세히 읽기 <ArrowRight className="size-4 transition group-hover:translate-x-0.5" />
          </span>
        </Link>
      )}

      <div className="mt-8 flex flex-col gap-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
          <input className="input !pl-10" placeholder="증상이나 질환명으로 찾기 (예: 허리, 어지럼, 손저림)" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="flex gap-2">
          {["전체", ...NEWS_CATEGORIES].map((c) => (
            <button
              key={c}
              onClick={() => setCategory(c)}
              className={`shrink-0 rounded-full px-3.5 py-1.5 text-sm font-semibold transition ${
                category === c ? "bg-ink text-white" : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"
              }`}
            >
              {c}
            </button>
          ))}
        </div>
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
          {["전체", ...BODY_PARTS].map((b) => (
            <button
              key={b}
              onClick={() => setBodyPart(b)}
              className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold transition ${
                bodyPart === b ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              {b === "전체" ? "모든 부위" : b}
            </button>
          ))}
        </div>
      </div>

      {news.error && <p className="mt-6 text-sm text-rose-600">{news.error}</p>}
      <div className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {(filtered ? news.items : rest).map((a) => (
          <NewsCard key={a.id} a={a} />
        ))}
      </div>
      {!news.loading && news.items.length === 0 && (
        <div className="card mt-6 px-6 py-14 text-center text-slate-500">
          조건에 맞는 글이 아직 없어요.{" "}
          <Link href="/qa/new" className="font-semibold text-brand-700 underline underline-offset-4">
            치료사에게 직접 물어보기
          </Link>
        </div>
      )}
      {news.hasMore && (
        <div className="mt-8 text-center">
          <button className="btn-ghost" disabled={news.loading} onClick={news.loadMore}>
            {news.loading ? "불러오는 중…" : "지난 글 더 보기"}
          </button>
        </div>
      )}
      <p className="mt-10 text-center text-xs text-slate-400">건강 소식은 일반적인 건강 정보이며 진단이나 치료를 대신하지 않아요.</p>
    </div>
  );
}

function Section({ icon: Icon, title, tone = "slate", children }: { icon: typeof Brain; title: string; tone?: "slate" | "rose"; children: React.ReactNode }) {
  return (
    <section className="mt-10">
      <h2 className={`flex items-center gap-2 text-lg font-extrabold ${tone === "rose" ? "text-rose-700" : ""}`}>
        <span className={`grid size-8 place-items-center rounded-xl ${tone === "rose" ? "bg-rose-100" : "bg-brand-50"}`}>
          <Icon className={`size-4 ${tone === "rose" ? "text-rose-600" : "text-brand-600"}`} />
        </span>
        {title}
      </h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function ArticleView({ slug }: { slug: string }) {
  const { article: a, related, preview, error, loading } = useArticle(slug);
  if (loading) return <div className="mx-auto max-w-3xl px-4 py-12"><div className="card h-96 animate-pulse bg-slate-100" /></div>;
  if (!a)
    return (
      <div className="mx-auto max-w-3xl px-4 py-12">
        <Notice tone="error">{error ?? "글을 찾을 수 없습니다."}</Notice>
        <Link href="/news" className="btn-ghost mt-4">건강 소식으로</Link>
      </div>
    );
  return (
    <article className="mx-auto max-w-3xl px-4 py-8 md:py-12">
      <Link href="/news" className="text-sm font-semibold text-slate-400 hover:text-ink">← 건강 소식</Link>
      {preview && (
        <div className="mt-4">
          <Notice>아직 공개되지 않은 글이에요 ({STATUS_LABEL[a.status][0]}{a.publishOn ? ` · ${fmtDay(a.publishOn)} 게시 예정` : ""}). 작성자와 관리자만 볼 수 있어요.</Notice>
        </div>
      )}
      <div className="mt-5"><CategoryChip category={a.category} bodyPart={a.bodyPart} /></div>
      <h1 className="mt-3 text-2xl font-extrabold leading-snug tracking-tight md:text-3xl">{a.title}</h1>
      <div className="mt-3 flex flex-wrap gap-x-3 text-sm text-slate-400">
        <span>{fmtDay(a.publishOn)}</span>
        <span>{a.authorName}</span>
        {!preview && <span>조회 {a.views.toLocaleString()}</span>}
      </div>
      <p className="mt-6 rounded-2xl bg-slate-100 p-5 leading-relaxed text-slate-700">{a.summary}</p>

      {a.emergency?.length ? (
        <div className="mt-6 rounded-2xl border-2 border-rose-300 bg-rose-50 p-5">
          <p className="flex items-center gap-2 font-extrabold text-rose-700">
            <Siren className="size-5" /> 이런 증상은 바로 119
          </p>
          <ul className="mt-3 space-y-1.5 text-sm text-rose-800">
            {a.emergency.map((x) => (
              <li key={x} className="flex gap-2"><span aria-hidden>•</span>{x}</li>
            ))}
          </ul>
          <a href="tel:119" className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-rose-600 px-4 py-2 text-sm font-bold text-white">
            <Phone className="size-4" /> 119 전화하기
          </a>
        </div>
      ) : null}

      <Section icon={Brain} title="왜 생길까요">
        <ul className="space-y-2.5">
          {a.causes.map((c) => (
            <li key={c} className="flex gap-2.5 leading-relaxed text-slate-700">
              <CheckCircle2 className="mt-1 size-4 shrink-0 text-brand-500" />{c}
            </li>
          ))}
        </ul>
      </Section>

      <Section icon={Dumbbell} title="집에서 해 보는 운동">
        <div className="space-y-4">
          {a.exercises.map((e, i) => (
            <div key={e.name} className="card p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="font-bold"><span className="mr-1.5 text-brand-600">{i + 1}.</span>{e.name}</h3>
                <span className="rounded-lg bg-brand-50 px-2.5 py-1 text-xs font-bold text-brand-700">{e.dose}</span>
              </div>
              <ol className="mt-3 space-y-1.5 text-sm leading-relaxed text-slate-600">
                {e.how.map((h, j) => (
                  <li key={j} className="flex gap-2"><span className="font-semibold text-slate-400">{j + 1})</span>{h}</li>
                ))}
              </ol>
              {e.caution && (
                <p className="mt-3 flex gap-1.5 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  <AlertTriangle className="size-3.5 shrink-0 translate-y-0.5" />{e.caution}
                </p>
              )}
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-slate-400">운동 중 통증이 심해지거나 저림이 퍼지면 멈추고 전문가와 상의하세요.</p>
      </Section>

      <Section icon={Stethoscope} title="이럴 땐 병원에 가 보세요" tone="rose">
        <ul className="space-y-2 rounded-2xl border border-rose-200 bg-white p-5">
          {a.redFlags.map((r) => (
            <li key={r} className="flex gap-2.5 text-sm leading-relaxed text-slate-700">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-rose-500" />{r}
            </li>
          ))}
        </ul>
      </Section>

      {a.tips.length > 0 && (
        <Section icon={Lightbulb} title="생활 속 수칙">
          <ul className="grid gap-2 sm:grid-cols-2">
            {a.tips.map((t) => (
              <li key={t} className="rounded-xl bg-white p-3.5 text-sm leading-relaxed text-slate-700 ring-1 ring-slate-200">{t}</li>
            ))}
          </ul>
        </Section>
      )}

      <div className="mt-12 flex flex-col items-start gap-4 rounded-3xl bg-brand-50 p-6 sm:flex-row sm:items-center">
        <div className="flex-1">
          <p className="font-extrabold">내 증상에 맞는 운동이 궁금하다면</p>
          <p className="mt-1 text-sm text-slate-600">면허 인증된 물리치료사에게 내 상황을 직접 물어보세요.</p>
        </div>
        <Link href="/qa/new" className="btn-primary shrink-0">치료사에게 질문하기</Link>
      </div>

      <p className="mt-6 text-xs leading-relaxed text-slate-400">
        이 글은 일반적인 건강 정보이며 개인의 진단·치료를 대신하지 않아요. 증상이 계속되거나 위의 신호가 있으면 의료기관을 찾아 주세요.
      </p>

      {related.length > 0 && (
        <section className="mt-12">
          <h2 className="text-lg font-extrabold">함께 읽으면 좋은 글</h2>
          <div className="mt-4 grid gap-4 md:grid-cols-3">
            {related.map((r) => (
              <NewsCard key={r.id} a={r} />
            ))}
          </div>
        </section>
      )}
    </article>
  );
}
