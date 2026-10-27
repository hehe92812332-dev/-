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
  await ad.goto(U + '/admin', { waitUntil: 'networkidle' }); await ad.click('button:has-text("환전 신청")');
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
  step('크론 실행', cron.includes('"renewed":1') && cron.includes('"settled":1'), cron);
  step('기한 환불', sqlq("select status||'/'||closed_reason from posts where id='p-3'") === 'refunded/no_answer');

  // 11. 데이터 노출 점검
  const snap = await (await pat.request.get(U + '/api/bootstrap')).json();
  const leak = snap.state.users.filter(u => u.id !== 'u-patient' && (u.wallet.cash || u.wallet.earned));
  step('타인 지갑 비노출', leak.length === 0);
  step('평가자 익명', snap.state.ratings.filter(r => r.fromId && r.fromId !== 'u-patient').length === 0);

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
