// 서버 모드 종단 간 테스트 (실제 DB + mock 결제 + 개발용 로그인)
// 준비: npm run db:migrate && npm run db:seed -- --force, .env.local에 DEV_LOGIN=true·PAYMENTS_PROVIDER=mock·CRON_SECRET 설정 후 npm run dev
// 실행: BASE_URL=http://localhost:3000 node scripts/e2e-server.cjs   (psql, playwright 필요)
const { chromium } = require('playwright');
const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const U = process.env.BASE_URL ?? 'http://localhost:3000';
const DB = process.env.DATABASE_URL ?? 'postgres://ptb:ptb@localhost:5432/ptbridge';
const CRON = process.env.CRON_SECRET ?? 'dev-cron-secret';
const sqlq = (q) => execSync(`psql "${DB}" -tAc "${q.replace(/"/g, '\\"')}"`).toString().trim();
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ptb-e2e-')) + '/';
for (const f of ['license.pdf', 'career.pdf']) fs.writeFileSync(dir + f, '%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
let failed = 0;
/** 조건이 참이 될 때까지 최대 timeout ms 동안 기다림 (개발 서버 첫 컴파일 지연 대비) */
const until = async (fn, timeout = 15000) => {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (fn()) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return fn();
};
async function login(b, email) {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  const p = await ctx.newPage(); p.on('pageerror', e => console.log('  pageerror', e.message));
  await p.goto(U + '/login', { waitUntil: 'networkidle' });
  await p.fill('input[name=email]', email); await p.click('button:has-text("이메일로 로그인")');
  await p.waitForURL(u => !u.pathname.startsWith('/login'), { timeout: 30000 }); await p.waitForLoadState('networkidle');
  return p;
}
const step = (n, ok, extra = '') => {
  if (!ok) failed++;
  console.log(`${ok ? '✅' : '❌'} ${n} ${extra}`);
};
(async () => {
  const b = await chromium.launch();
  // 1. 환자: 충전 (mock PG) → 주문/거래 기록
  const pat = await login(b, 'u-patient@demo.ptbridge');
  const before = sqlq("select cash||','||bonus from users where id='u-patient'");
  await pat.goto(U + '/wallet', { waitUntil: 'networkidle' });
  await pat.click('button:has-text("충전하기")'); await pat.check('input[type=checkbox]'); await pat.click('button:has-text("원 결제하기")');
  await pat.waitForSelector('text=결제가 완료되었어요', { timeout: 20000 }); await pat.click('button:has-text("확인")');
  const after = sqlq("select cash||','||bonus from users where id='u-patient'");
  step('충전 300토큰', before !== after, `${before} -> ${after}, order=${sqlq("select status from payment_orders where user_id='u-patient' order by created_at desc limit 1")}`);
  // 2. 결제 취소(청약철회)
  pat.once('dialog', d => d.accept());
  await pat.locator('button:has-text("결제 취소")').first().click(); await pat.waitForTimeout(1500);
  step('청약철회', sqlq("select status from payment_orders where user_id='u-patient' order by created_at desc limit 1") === 'canceled', `wallet ${sqlq("select cash||','||bonus from users where id='u-patient'")}`);
  // 3. 질문 등록 (개인정보 차단 포함)
  await pat.goto(U + '/qa/new', { waitUntil: 'networkidle' });
  await pat.fill('#title', '허리 통증 E2E 테스트 질문입니다');
  await pat.fill('#body', '오래 앉아 있으면 허리가 아파요. 연락처 010-1234-5678 로 주세요. 어떤 운동이 좋을까요?');
  await pat.click('button:has-text("질문 등록")'); await pat.waitForTimeout(800);
  step('개인정보 차단', (await pat.locator('text=개인정보는 올릴 수 없어요').count()) === 1);
  await pat.fill('#body', '오래 앉아 있으면 허리가 아파요. 사무직이고 하루 10시간 앉아 있습니다. 어떤 운동이 좋을까요?');
  await pat.click('button:has-text("질문 등록")'); await pat.waitForURL(/\/qa\/p-/, { timeout: 15000 });
  const postId = pat.url().split('/').pop();
  step('질문 등록', sqlq(`select bounty from posts where id='${postId}'`) === '17', postId);

  // 4. 신규 치료사 가입 + 서류 업로드 → 심사 대기, 답변 불가
  const nt = await login(b, 'newpt@test.dev');
  await nt.waitForURL(/\/signup/, { timeout: 10000 }).catch(() => {});
  step('온보딩 이동', nt.url().includes('/signup'), nt.url());
  await nt.click('button:has-text("물리치료사")');
  await nt.fill('input[placeholder^="실명"]', '신규치료사');
  await nt.fill('input[placeholder="숫자만 입력"]', '123456');
  const nums = nt.locator('input[type=number]'); await nums.nth(0).fill('6'); await nums.nth(1).fill('320');
  await nt.click('button:text-is("근골격계")');
  await nt.setInputFiles('input[type=file] >> nth=0', dir + 'license.pdf');
  await nt.setInputFiles('input[type=file] >> nth=1', dir + 'career.pdf');
  for (const c of await nt.locator('input[type=checkbox]').all()) await c.check();
  await nt.click('button:has-text("가입하기")'); await nt.waitForURL(/pending/, { timeout: 15000 });
  const newId = sqlq("select id from users where email='newpt@test.dev'");
  step('서류 제출', sqlq(`select verification from therapist_profiles where user_id='${newId}'`) === 'pending', `docs=${sqlq(`select count(*) from credential_documents where user_id='${newId}'`)}`);
  await nt.goto(U + '/qa/' + postId, { waitUntil: 'networkidle' });
  step('심사 전 답변 불가', (await nt.locator('text=서류 심사가 끝나면 답변할 수 있어요').count()) === 1);
  const r = await nt.request.post(U + '/api/actions', { data: { action: 'addAnswer', postId, body: '서버 우회 시도: 심사 전 치료사의 답변입니다. 충분히 길게.' } });
  step('API 우회 차단', !(await r.json()).ok);

  // 5. 관리자 승인 (서류 열람 포함)
  const ad = await login(b, 'admin@ptbridge.dev');
  await ad.goto(U + '/admin', { waitUntil: 'networkidle' });
  await ad.waitForSelector('text=신규치료사');
  const docHref = await ad.locator('a[href^="/api/documents/"]').first().getAttribute('href');
  const docRes = await ad.request.get(U + docHref);
  step('관리자 서류 열람', docRes.ok() && (await docRes.text()).startsWith('%PDF'));
  const patDoc = await pat.request.get(U + docHref);
  step('타인 서류 열람 차단', patDoc.status() === 404);
  ad.once('dialog', d => d.accept());
  await ad.click('button:has-text("승인")');
  step('관리자 승인', await until(() => sqlq(`select verification from therapist_profiles where user_id='${newId}'`) === 'approved'), `log=${sqlq("select action from admin_logs order by created_at desc limit 1")}`);
  await ad.screenshot({ path: dir + 'admin.png', fullPage: true });

  // 6. 승인 후 답변 → 채택 → 보상
  await nt.goto(U + '/qa/' + postId, { waitUntil: 'networkidle' });
  await nt.fill('textarea', '앉아 있는 시간 중간중간 일어나서 허리 신전 운동을 해 주세요. 고관절 굴곡근 스트레칭도 도움이 됩니다.');
  await nt.click('button:has-text("답변 등록")'); await nt.waitForTimeout(1500);
  step('답변 등록', sqlq(`select count(*) from answers where post_id='${postId}'`) === '1');
  await pat.goto(U + '/qa/' + postId, { waitUntil: 'networkidle' });
  await pat.click('button:has-text("이 답변 채택하기")'); await pat.waitForSelector('text=답변은 어땠나요?');
  await pat.click('button:has-text("최고예요")'); await pat.click('button:has-text("평가 보내기")'); await pat.waitForTimeout(1000);
  step('채택+보상', sqlq(`select earned from users where id='${newId}'`) === '14', `rating=${sqlq(`select score from ratings where to_id='${newId}'`)}`);

  // 7. 신고 → 관리자 숨김
  await pat.goto(U + '/qa/p-2', { waitUntil: 'networkidle' });
  await pat.locator('button[aria-label=더보기]').nth(0).click();
  await pat.click('text=신고하기'); await pat.click('text=잘못된 의료 정보');
  await pat.click('button:has-text("신고 접수")'); await pat.waitForTimeout(1000);
  step('신고 접수', sqlq("select count(*) from reports where status='open'") === '1');
  await ad.goto(U + '/admin', { waitUntil: 'networkidle' }); await ad.click('button:has-text("신고")');
  await ad.click('button:has-text("콘텐츠 숨김")'); await ad.waitForTimeout(1500);
  step('신고 처리', sqlq("select status from reports limit 1") === 'resolved');

  // 8. 환전 신청 → 관리자 이체 완료
  const leg = await login(b, 'u-legend@demo.ptbridge');
  await leg.goto(U + '/wallet?tab=withdraw', { waitUntil: 'networkidle' });
  await leg.fill('input[type=number]', '1000'); await leg.fill('input[placeholder^="예) 국민"]', '국민은행 123456-78-901234');
  await leg.click('button:has-text("환전 신청")'); await leg.waitForTimeout(1500);
  step('환전 신청', sqlq("select status from transactions where type='withdraw'") === 'requested', `memo=${sqlq("select memo from transactions where type='withdraw'")}`);
  await ad.goto(U + '/admin', { waitUntil: 'networkidle' }); await ad.click('button:has-text("환전·환불")');
  step('관리자 계좌 확인', (await ad.locator('text=123456-78-901234').count()) === 1);
  ad.once('dialog', d => d.accept()); await ad.click('button:has-text("이체 완료")'); await ad.waitForTimeout(1500);
  step('이체 완료', sqlq("select status from transactions where type='withdraw'") === 'paid');

  // 9. 라운지 실시간(폴링) — 토파즈 두 명
  const t1 = await login(b, 'u-expert@demo.ptbridge'); const t2 = await login(b, 'u-topaz2@demo.ptbridge');
  await t1.goto(U + '/lounge', { waitUntil: 'networkidle' }); await t2.goto(U + '/lounge', { waitUntil: 'networkidle' });
  await t1.fill('textarea', '서버 모드 라운지 테스트 메시지'); await t1.keyboard.press('Enter');
  let got = true; try { await t2.waitForSelector('text=서버 모드 라운지 테스트 메시지', { timeout: 8000 }); } catch { got = false; }
  step('라운지 다른 회원에게 전달', got);
  const legChat = await leg.request.get(U + '/api/chats?after=1970-01-01T00:00:00Z');
  step('다른 등급 대화 비공개', !JSON.stringify(await legChat.json()).includes('라운지 테스트'));

  // 10. 멤버십 (mock 빌링) + 크론 갱신
  await pat.goto(U + '/wallet?tab=membership', { waitUntil: 'networkidle' });
  await pat.locator('button:has-text("구독하기")').first().click(); await pat.check('input[type=checkbox]');
  await pat.click('button:has-text("원 결제하기")'); await pat.waitForSelector('text=결제가 완료되었어요', { timeout: 20000 });
  step('멤버십 가입', sqlq("select membership_plan from users where id='u-patient'") === 'basic');
  sqlq("update users set membership_renews_at = now() - interval '1 minute' where id='u-patient'");
  sqlq(`update posts set expires_at = now() - interval '1 minute' where id='p-3'`);
  const unauth = execSync(`curl -s -o /dev/null -w '%{http_code}' ${U}/api/cron/sweep`).toString();
  const cron = execSync(`curl -s -H 'Authorization: Bearer ${CRON}' ${U}/api/cron/sweep`).toString();
  step('크론 인증', unauth === '401');
  step('크론 실행', cron.includes('"renewed":1') && /"settled":[1-9]/.test(cron), cron);
  step('기한 환불', sqlq("select status||'/'||closed_reason from posts where id='p-3'") === 'refunded/no_answer');

  // 11. 데이터 노출 점검
  const seen = [];
  for (const path of ['/api/feed?board=patient', '/api/therapists?sort=temp', '/api/posts/p-1', '/api/users/u-legend'])
    seen.push(...((await (await pat.request.get(U + path)).json()).users ?? []));
  const leak = seen.filter(u => u.id !== 'u-patient' && (u.wallet.cash || u.wallet.earned || u.membership));
  step('타인 지갑 비노출', seen.length > 5 && leak.length === 0, `확인한 회원 ${seen.length}명`);
  const detail = await (await pat.request.get(U + '/api/posts/p-1')).json();
  step('평가자 익명', (detail.myRatings ?? []).every(r => r.fromId === 'u-patient') && !JSON.stringify(detail.users).includes('fromId'));
  const guestClinical = await (await b.newContext()).request.get(U + '/api/feed?board=clinical');
  step('비회원 임상 토론 차단', guestClinical.status() === 403);

  // 13. (1년 시뮬레이션 후 추가) 알림 · 내가 답변할 수 있는 질문 · 등급 낮추기 · 잔액 환불 · 라운지 채널
  await pat.goto(U + '/', { waitUntil: 'networkidle' });
  const bell = await pat.locator('button[aria-label^="알림"]').getAttribute('aria-label');
  await pat.click('button[aria-label^="알림"]');
  await pat.waitForSelector('text=질문에 새 답변이 달렸어요', { timeout: 10000 }).catch(() => {});
  step('알림 (새 답변)', (await pat.locator('text=질문에 새 답변이 달렸어요').count()) > 0, bell);

  await nt.goto(U + '/qa', { waitUntil: 'networkidle' });
  await nt.click('button:has-text("내가 답변할 수 있는 질문")');
  await nt.waitForTimeout(1500);
  step('내가 답변할 수 있는 질문', (await nt.locator('a[href^="/qa/p-"]').count()) > 0);

  await pat.goto(U + '/qa/new', { waitUntil: 'networkidle' });
  await pat.click('button:has-text("다이아몬드")');
  await pat.fill('#title', '등급 낮추기 테스트 질문입니다');
  await pat.fill('#body', '다이아몬드 등급으로 질문하고 답변이 없을 때 등급을 낮춰 봅니다. 충분히 깁니다.');
  await pat.click('button:has-text("질문 등록")'); await pat.waitForURL(/\/qa\/p-/, { timeout: 15000 });
  const lowId = pat.url().split('/').pop();
  const paid = Number(sqlq(`select bounty from posts where id='${lowId}'`)); // 멤버십 할인 반영된 금액
  await pat.click('button:has-text("답변 등급 낮추기")');
  await pat.locator('button:has-text("에메랄드")').first().click();
  await until(() => sqlq(`select target_tier from posts where id='${lowId}'`) === 'emerald');
  // 할인 비율을 유지한 채 등급 비용 비율만큼 줄어듦 (다이아 50 → 에메랄드 28)
  step('등급 낮추기 + 차액 환불', sqlq(`select target_tier||'/'||bounty from posts where id='${lowId}'`) === `emerald/${Math.round((paid * 28) / 50)}`,
    `${paid} → ${Math.round((paid * 28) / 50)}, 환불 ${sqlq(`select tokens from transactions where post_id='${lowId}' and type='lower_tier'`)}`);

  // 자동 등급 낮추기: 하루가 지난 것으로 바꾸고 크론 실행
  sqlq(`update posts set tier_changed_at = now() - interval '25 hours' where id='${lowId}'`);
  sqlq(`update posts set auto_lower = true where id='${lowId}'`);
  execSync(`curl -s -H 'Authorization: Bearer ${CRON}' ${U}/api/cron/sweep`);
  step('자동 등급 낮추기 (크론)', sqlq(`select target_tier from posts where id='${lowId}'`) === 'amethyst', sqlq(`select title from notifications where link='/qa/${lowId}' order by created_at desc limit 1`));

  await pat.goto(U + '/wallet?tab=withdraw', { waitUntil: 'networkidle' });
  const cashBefore = sqlq("select cash from users where id='u-patient'");
  await pat.fill('input[placeholder^="입금 계좌 (본인 명의)"]', '신한은행 110-123-456789');
  pat.once('dialog', (d) => d.accept());
  await pat.click('button:has-text("환불 신청")');
  await until(() => sqlq("select count(*) from transactions where type='balance_refund'") === '1');
  step('충전 잔액 환불 신청', sqlq("select cash from users where id='u-patient'") === '0', `${cashBefore}토큰 → ${sqlq("select krw from transactions where type='balance_refund'")}원`);
  await ad.goto(U + '/admin', { waitUntil: 'networkidle' }); await ad.click('button:has-text("환전·환불")');
  await ad.waitForSelector('text=충전 잔액 환불');
  ad.once('dialog', (d) => d.accept()); await ad.locator('button:has-text("이체 완료")').first().click();
  await until(() => sqlq("select status from transactions where type='balance_refund'") === 'paid');
  step('잔액 환불 이체 + 알림', sqlq("select status from transactions where type='balance_refund'") === 'paid' && sqlq("select count(*) from notifications where user_id='u-patient' and type='payout'") === '1');

  await t1.goto(U + '/lounge', { waitUntil: 'networkidle' }); await t2.goto(U + '/lounge', { waitUntil: 'networkidle' });
  await t1.click('button:has-text("# 근골격계")');
  await t1.fill('textarea', '근골격계 채널 테스트 메시지'); await t1.keyboard.press('Enter');
  await until(() => sqlq("select count(*) from chat_messages where channel='근골격계'") === '1');
  await t2.waitForSelector('button:has-text("# 근골격계") [aria-label="새 메시지"]', { timeout: 10000 }).catch(() => {});
  const dot = await t2.locator('button:has-text("# 근골격계") [aria-label="새 메시지"]').count();
  await t2.click('button:has-text("# 근골격계")');
  let inChannel = true; try { await t2.waitForSelector('text=근골격계 채널 테스트 메시지', { timeout: 8000 }); } catch { inChannel = false; }
  const leaked = await t2.locator('button:has-text("# 자유")').click().then(() => t2.waitForTimeout(800)).then(() => t2.locator('text=근골격계 채널 테스트 메시지').count());
  step('라운지 채널 분리 + 새 글 표시', inChannel && dot === 1 && leaked === 0, `dot=${dot}`);

  // 11. 건강 소식: 비회원 열람 → 치료사 원고 → 관리자 승인·예약 → 원고료 → 게시일에 공개
  const today = sqlq("select to_char(now() at time zone 'Asia/Seoul','YYYY-MM-DD')");
  const todays = sqlq(`select slug||'|'||title from articles where status='approved' and publish_on<='${today}' order by publish_on desc, id desc limit 1`).split('|');
  const gctx = await b.newContext(); const guest = await gctx.newPage();
  await guest.goto(U + '/news', { waitUntil: 'networkidle' });
  step('건강 소식 오늘의 글', (await guest.locator(`text=${todays[1]}`).count()) > 0 && (await guest.locator('text=오늘의 건강 정보').count()) > 0, todays[0]);
  await guest.goto(U + '/news/' + todays[0], { waitUntil: 'networkidle' });
  step('건강 소식 상세 (비회원)', (await guest.locator('text=이럴 땐 병원에 가 보세요').count()) === 1 && (await guest.locator('text=치료사에게 질문하기').count()) === 1,
    `views=${sqlq(`select views from articles where slug='${todays[0]}'`)}`);
  await guest.goto(U + '/', { waitUntil: 'networkidle' });
  step('홈 오늘의 건강 정보', await guest.locator(`a[href="/news/${todays[0]}"]`).count() > 0);
  const patNews = await pat.request.post(U + '/api/news', { data: { title: '환자가 쓴 원고 테스트' } });
  step('환자 원고 차단', patNews.status() === 403);
  await t1.goto(U + '/news/write', { waitUntil: 'networkidle' });
  await t1.fill('input[placeholder^="예: 아침마다"]', '손목이 시큰할 때 E2E 원고');
  const ta = t1.locator('textarea');
  await ta.nth(0).fill('컴퓨터 작업이 많은 분들의 손목 통증 원인과 운동을 정리했어요.');
  await ta.nth(1).fill('마우스를 오래 쥐는 자세\n손목을 꺾은 채 타자 치기');
  await t1.fill('input[placeholder="운동 이름"]', '손목 굽힘근 스트레칭');
  await t1.fill('input[placeholder^="횟수"]', '20초 × 3회');
  await ta.nth(2).fill('팔을 앞으로 뻗는다\n반대손으로 손가락을 몸쪽으로 당긴다');
  await ta.nth(3).fill('밤에 손이 저려 깰 때\n엄지 쪽 근육이 마를 때');
  await t1.click('button:has-text("검수 요청하기")');
  await t1.waitForSelector('text=원고를 보냈어요', { timeout: 15000 }).catch(() => {});
  const art = sqlq("select id||'|'||slug||'|'||status from articles where title='손목이 시큰할 때 E2E 원고'").split('|');
  step('치료사 원고 제출', art[2] === 'review', art[0]);
  const futureGuest = await gctx.request.get(U + '/api/news/' + art[1]);
  step('검수 전 비공개', futureGuest.status() === 404);
  const earnedBefore = Number(sqlq("select earned from users where id='u-expert'"));
  await ad.goto(U + '/admin', { waitUntil: 'networkidle' }); await ad.click('button:has-text("건강 소식")');
  await ad.waitForSelector('text=손목이 시큰할 때 E2E 원고');
  const nextFree = await ad.locator('input[type=date]').first().inputValue();
  await ad.click('button:has-text("승인하고 예약")');
  await until(() => sqlq(`select status from articles where id='${art[0]}'`) === 'approved');
  step('관리자 승인·예약 + 원고료', sqlq(`select publish_on from articles where id='${art[0]}'`) === nextFree &&
    Number(sqlq("select earned from users where id='u-expert'")) === earnedBefore + 30 &&
    sqlq("select count(*) from notifications where user_id='u-expert' and type='article'") === '1', `publish_on=${nextFree}`);
  step('게시일 전 비공개', (await gctx.request.get(U + '/api/news/' + art[1])).status() === 404);
  sqlq(`update articles set publish_on='${today}' where id='${art[0]}'`);
  const pub = await gctx.request.get(U + '/api/news/' + art[1]);
  step('게시일에 공개', pub.ok() && (await pub.json()).article.authorName.includes('물리치료사'));
  await gctx.close();

  // 12. 회원 탈퇴 → 개인정보 삭제, 재로그인 세션 무효
  await nt.goto(U + '/account', { waitUntil: 'networkidle' });
  await nt.fill('input.input', '탈퇴합니다'); await nt.click('button:has-text("회원 탈퇴")');
  await nt.waitForURL(u => u.pathname === '/', { timeout: 15000 });
  step('회원 탈퇴', sqlq(`select coalesce(email,'null')||'/'||name||'/'||(deleted_at is not null) from users where id='${newId}'`) === 'null/탈퇴한 회원/true',
    `docs=${sqlq(`select count(*) from credential_documents where user_id='${newId}'`)}`);
  await b.close();
  console.log(failed ? `\n${failed}개 실패` : '\n모두 통과');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
