import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ARTICLE_REWARD_TOKENS } from "@/lib/config";
import * as ledger from "@/lib/ledger";
import { NEWS_LIBRARY } from "@/lib/news-library";
import { addDays, demoArticles, filterArticles, nextFreeDate, scheduleGaps, todayKST } from "@/lib/news";
import { articleInput, type ArticleData } from "@/lib/news-input";
import { db, schema } from "@/server/db";
import { HttpError } from "@/server/errors";
import { approveArticle, getArticle, importLibrary, listArticles, setArticleStatus, submitArticle } from "@/server/news";
import { makeUser, resetDb, wallet } from "./helpers";

const draft: ArticleData = {
  title: "아침마다 뻣뻣한 손가락",
  category: "근골격계",
  bodyPart: "팔꿈치·손목·손",
  summary: "손가락이 걸리듯 펴지지 않는다면 방아쇠수지일 수 있어요.",
  causes: ["손을 반복해서 꽉 쥐는 일"],
  exercises: [{ name: "힘줄 미끄러짐 운동", how: ["주먹을 가볍게 쥐었다 편다"], dose: "10회 × 3세트", caution: undefined }],
  redFlags: ["손가락이 굽은 채로 펴지지 않을 때"],
  emergency: undefined,
  tips: [],
};

describe("건강 소식 규칙", () => {
  it("기본 글 모음은 형식 검사를 모두 통과하고 slug가 겹치지 않는다", () => {
    expect(new Set(NEWS_LIBRARY.map((a) => a.slug)).size).toBe(NEWS_LIBRARY.length);
    for (const { slug: _s, ...a } of NEWS_LIBRARY) expect(articleInput.safeParse(a).success, a.title).toBe(true);
  });

  it("비어 있는 첫 게시일과 빈 날짜를 찾는다", () => {
    expect(nextFreeDate(["2026-03-01", "2026-03-02"], "2026-03-01")).toBe("2026-03-03");
    expect(scheduleGaps(["2026-03-02"], "2026-03-01", 3)).toEqual(["2026-03-01", "2026-03-03"]);
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
  });

  it("한국 시간 자정이 지나면 날짜가 바뀐다", () => {
    expect(todayKST(Date.parse("2026-05-01T14:59:00Z"))).toBe("2026-05-01");
    expect(todayKST(Date.parse("2026-05-01T15:00:00Z"))).toBe("2026-05-02");
  });

  it("데모 모드는 매일 다른 글이 오늘의 글이 되고, 모든 글이 한 번씩 나온다", () => {
    const a = demoArticles(NEWS_LIBRARY, "2026-05-01");
    const b = demoArticles(NEWS_LIBRARY, "2026-05-02");
    expect(a[0].publishOn).toBe("2026-05-01");
    expect(b[0].slug).not.toBe(a[0].slug);
    expect(b[1].slug).toBe(a[0].slug); // 어제 글은 하루 밀려 남음
    expect(new Set(a.map((x) => x.slug)).size).toBe(NEWS_LIBRARY.length);
    const neuro = filterArticles(a, { category: "신경계", limit: 100 });
    expect(neuro.items.every((x) => x.category === "신경계")).toBe(true);
  });

  it("원고료는 치료사의 획득 토큰으로 들어간다", () => {
    const s: ledger.State = { users: [], posts: [], transactions: [], ratings: [], chats: [], reports: [], blocks: [], currentUserId: null };
    const user = { id: "t", name: "t", role: "therapist", avatarColor: "#000", joinedAt: "", wallet: { cash: 0, bonus: 0, earned: 5 } } as never;
    const r = ledger.rewardArticle({ ...s, users: [user] }, "t", 30, "제목");
    expect(r.ok && r.state.users[0].wallet.earned).toBe(35);
    expect(r.ok && r.state.transactions[0].type).toBe("article_reward");
    expect(ledger.rewardArticle({ ...s, users: [user] }, "t", 0, "제목").ok).toBe(false);
  });
});

describe("건강 소식 (실제 PostgreSQL)", () => {
  beforeEach(async () => {
    await resetDb();
    await makeUser("admin");
    await makeUser("t1", { role: "therapist" });
  });
  afterAll(resetDb);

  it("검수 대기 → 승인하면 다음 빈 날짜로 예약되고 원고료·알림이 한 번만 지급된다", async () => {
    const today = todayKST();
    await importLibrary([{ ...NEWS_LIBRARY[0], status: "approved", publishOn: addDays(today, 1), authorName: "편집팀" }]);
    const id = await submitArticle({ id: "t1", name: "김치료" }, draft);
    expect((await listArticles({})).items.some((x) => x.id === id)).toBe(false);

    const r = await approveArticle("admin", id, {});
    expect(r.publishOn).toBe(addDays(today, 2)); // 내일은 이미 찼으므로 모레
    expect((await wallet("t1")).earned).toBe(ARTICLE_REWARD_TOKENS);
    await expect(approveArticle("admin", id, {})).rejects.toBeInstanceOf(HttpError);
    const [{ count }] = await db.execute<{ count: string }>(sql`select count(*) from transactions where type = 'article_reward'`).then((x) => x.rows);
    expect(Number(count)).toBe(1);
    const notes = await db.select().from(schema.notifications).where(eq(schema.notifications.userId, "t1"));
    expect(notes).toHaveLength(1);
  });

  it("동시에 두 번 승인해도 원고료는 한 번만", async () => {
    const id = await submitArticle({ id: "t1", name: "김치료" }, draft);
    const rs = await Promise.allSettled([approveArticle("admin", id, {}), approveArticle("admin", id, {})]);
    expect(rs.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect((await wallet("t1")).earned).toBe(ARTICLE_REWARD_TOKENS);
  });

  it("공개일 전 글은 목록에 없고 작성자·관리자만 미리 볼 수 있다", async () => {
    const today = todayKST();
    await importLibrary(
      NEWS_LIBRARY.slice(0, 15).map((a, i) => ({ ...a, status: "approved" as const, publishOn: addDays(today, 1 - i), authorName: "편집팀" })),
    );
    const first = await listArticles({ limit: 10 });
    expect(first.items).toHaveLength(10);
    expect(first.items[0].publishOn).toBe(today); // 내일 글은 아직 비공개
    const second = await listArticles({ limit: 10, cursor: first.nextCursor });
    expect(second.items).toHaveLength(4);
    expect(second.nextCursor).toBeNull();

    const future = NEWS_LIBRARY[0].slug;
    await expect(getArticle(future, null)).rejects.toBeInstanceOf(HttpError);
    expect((await getArticle(future, { id: "admin", isAdmin: true })).preview).toBe(true);
    const r = await getArticle(NEWS_LIBRARY[1].slug, null);
    expect(r.preview).toBe(false);
    expect(r.related.length).toBeGreaterThan(0);

    const search = await listArticles({ q: "100%_" });
    expect(search.items).toHaveLength(0);
  });

  it("반려하면 작성자에게 사유가 전달되고 원고료는 없다", async () => {
    const id = await submitArticle({ id: "t1", name: "김치료" }, draft);
    await setArticleStatus("admin", id, "rejected", "근거를 보완해 주세요");
    const [a] = await db.select().from(schema.articles).where(eq(schema.articles.id, id));
    expect(a.status).toBe("rejected");
    expect((await wallet("t1")).earned).toBe(0);
    await expect(setArticleStatus("admin", id, "archived", "중단")).rejects.toBeInstanceOf(HttpError);
  });
});
