/**
 * 화면 점검: 모든 동작을 데스크톱·모바일에서 열어
 * 콘솔 오류, 화면에 찍힌 NaN/undefined, 가로 스크롤, 계산 시간을 확인한다.
 *
 *   node scripts/ui-check.cjs http://localhost:3000
 */
const { chromium, devices } = require("playwright");

(async () => {
  const base = process.argv[2] || "http://localhost:3000";
  const ids = process.argv[3] ? process.argv[3].split(",") : null;
  const b = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"] });
  const problems = [];
  const desk = await b.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = [];
  desk.on("pageerror", (e) => errs.push(e.message));
  desk.on("console", (m) => m.type() === "error" && !/ERR_TUNNEL|Failed to load resource/.test(m.text()) && errs.push(m.text()));
  await desk.goto(`${base}/simulator`, { waitUntil: "load", timeout: 180000 });
  await desk.waitForTimeout(6000);
  const list = ids || (await desk.evaluate(() => [])); // 목록은 화면에서 읽는다
  const names = await desk.locator("aside").first().locator("li button").count();
  const cats = ["웨이트", "스포츠", "체대입시"];
  let checked = 0;
  for (const c of cats) {
    await desk.getByRole("tab", { name: "동작", exact: true }).click();
    await desk.getByRole("tab", { name: c, exact: true }).click();
    const n = await desk.locator("aside").first().locator("li button").count();
    for (let i = 0; i < n; i++) {
      const btn = desk.locator("aside").first().locator("li button").nth(i);
      const label = (await btn.locator("span span").first().textContent()) || "";
      errs.length = 0;
      await btn.click();
      await desk.waitForFunction(() => !document.body.innerText.includes("다시 계산하는 중"), null, { timeout: 30000 }).catch(() => problems.push(`${label}: 계산이 30초 안에 끝나지 않음`));
      await desk.waitForTimeout(1200);
      for (const tab of ["진단", "수치 · 그래프"]) {
        await desk.locator("aside [role=tab]").filter({ hasText: tab }).first().click();
        await desk.waitForTimeout(300);
        const txt = await desk.locator("main, aside").allInnerTexts();
        const joined = txt.join("\n");
        if (/NaN|undefined|Infinity/.test(joined)) problems.push(`${label}/${tab}: 화면에 NaN·undefined 표시`);
      }
      if (errs.length) problems.push(`${label}: 콘솔 오류 ${errs[0]}`);
      checked++;
    }
  }
  void list;
  void names;
  // 모바일
  const ctx = await b.newContext({ ...devices["iPhone 13"] });
  const mob = await ctx.newPage();
  const merr = [];
  mob.on("pageerror", (e) => merr.push(e.message));
  for (const m of ["high-bar-squat", "standing-long-jump", "side-cut", "sit-and-reach", "bench-press"]) {
    await mob.goto(`${base}/simulator?m=${m}`, { waitUntil: "load", timeout: 180000 });
    await mob.waitForTimeout(4000);
    const [sw, iw] = await mob.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    if (sw > iw + 1) problems.push(`모바일 ${m}: 가로 스크롤 ${sw}px > ${iw}px`);
    for (const t of ["체형", "진단", "수치", "동작"]) {
      await mob.getByRole("tab", { name: new RegExp(`^${t}`) }).first().click();
      await mob.waitForTimeout(250);
      const [sw2] = await mob.evaluate(() => [document.documentElement.scrollWidth]);
      if (sw2 > iw + 1) problems.push(`모바일 ${m}/${t}: 가로 스크롤`);
    }
  }
  if (merr.length) problems.push(`모바일 콘솔 오류: ${merr[0]}`);
  console.log(`점검한 동작 ${checked}개`);
  console.log(problems.length ? problems.join("\n") : "문제 없음");
  await b.close();
  process.exit(problems.length ? 1 : 0);
})();
