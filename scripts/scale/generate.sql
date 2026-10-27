-- 1년 · 100만 명 규모 데이터 생성 (부하 테스트 전용 DB에서만 실행)
-- 규모는 scripts/simulate-year.ts 결과를 따름
SELECT setseed(0.42);
SET synchronous_commit = off;

-- 회원 100만 (치료사 3만)
INSERT INTO users (id, name, email, role, avatar_color, joined_at, cash, bonus, earned, terms_agreed_at, sensitive_consent_at)
SELECT 'u' || g, '회원' || g, 'u' || g || '@scale.test',
       CASE WHEN g <= 30000 THEN 'therapist' ELSE 'patient' END,
       '#64748b', now() - (random() * interval '365 days'),
       CASE WHEN g > 30000 AND random() < 0.3 THEN (random() * 400)::int ELSE 0 END, 0,
       CASE WHEN g <= 30000 THEN (random() * 300)::int ELSE 0 END, now(), now()
FROM generate_series(1, 1000000) g;

INSERT INTO therapist_profiles (user_id, experience_years, education_hours, degree, hospital_type, hospital_name, specialties, bio, verification, license_number_enc)
SELECT 'u' || g, y, (y * (25 + random() * 30))::int,
       CASE WHEN random() < 0.05 THEN 'doctor' WHEN random() < 0.2 THEN 'master' ELSE 'none' END,
       'hospital', '병원' || g, '["근골격계","통증"]'::jsonb, '소개', 'approved', 'x'
FROM (SELECT g, least(30, floor(-ln(1 - random()) * 6.5))::int AS y FROM generate_series(1, 30000) g) t;

-- 질문 92만 (환자 87만 + 임상 5만)
INSERT INTO posts (id, board, author_id, title, body, category, target_tier, bounty, paid_cash, paid_bonus, paid_earned, status, created_at, expires_at, views)
SELECT 'p' || g,
       CASE WHEN g <= 50000 THEN 'clinical' ELSE 'patient' END,
       CASE WHEN g <= 50000 THEN 'u' || (1 + (random() * 29999)::int) ELSE 'u' || (30001 + (random() * 969999)::int) END,
       (ARRAY['무릎','허리','어깨','목','발목','손목','고관절'])[1 + (random() * 6)::int] || ' 통증 질문 ' || g,
       '증상 설명 본문입니다. 계단을 오를 때 아프고 오래 앉아 있으면 뻐근합니다. 운동 방법이 궁금합니다. ' || md5(g::text),
       (ARRAY['근골격계','신경계','스포츠 재활','소아','심폐','노인·요양','도수치료','운동치료','통증','기타'])[1 + (random() * 9)::int],
       (ARRAY['rough','pearl','opal','topaz','amethyst','emerald','sapphire','ruby','diamond'])[1 + (random() * 8)::int],
       17, 17, 0, 0,
       CASE WHEN random() < 0.03 THEN 'open' WHEN random() < 0.6 THEN 'adopted' ELSE 'refunded' END,
       ts, ts + interval '7 days', (random() * 300)::int
FROM (SELECT g, now() - (random() * interval '365 days') AS ts FROM generate_series(1, 920000) g) t;

-- 답변 80만
INSERT INTO answers (id, post_id, author_id, body, created_at, tips)
SELECT 'a' || g, 'p' || (1 + (random() * 919999)::int), 'u' || (1 + (random() * 29999)::int),
       '답변 본문입니다. 허리 신전 운동과 고관절 스트레칭을 권합니다. ' || md5(g::text), now() - (random() * interval '365 days'), 0
FROM generate_series(1, 800000) g;

INSERT INTO answer_likes (answer_id, user_id)
SELECT DISTINCT 'a' || (1 + (random() * 799999)::int), 'u' || (1 + (random() * 999999)::int) FROM generate_series(1, 1500000)
ON CONFLICT DO NOTHING;

-- 거래 200만
INSERT INTO transactions (id, user_id, type, tokens, memo, created_at)
SELECT 't' || g, 'u' || (1 + (random() * 999999)::int),
       (ARRAY['purchase','ask','reward','refund','tip_sent','tip_received','withdraw'])[1 + (random() * 6)::int],
       (random() * 300)::int - 100, '거래', now() - (random() * interval '365 days')
FROM generate_series(1, 2000000) g;

-- 평가 35만
INSERT INTO ratings (id, from_id, to_id, post_id, answer_id, score, tags, created_at)
SELECT 'r' || g, 'u' || (30001 + (random() * 969999)::int), 'u' || (1 + (random() * 29999)::int), 'p' || (1 + (random() * 919999)::int), 'a' || g,
       (ARRAY['great','great','good','bad'])[1 + (random() * 3)::int], '["설명이 이해하기 쉬워요"]'::jsonb, now() - (random() * interval '365 days')
FROM generate_series(1, 350000) g;

-- 라운지 메시지 300만
INSERT INTO chat_messages (id, room, author_id, body, kind, created_at)
SELECT 'c' || g, (ARRAY['rough','rough','rough','rough','pearl','topaz','opal','amethyst','emerald','sapphire','ruby','diamond'])[1 + (random() * 11)::int],
       'u' || (1 + (random() * 29999)::int), '라운지 메시지 ' || g, 'text', now() - (random() * interval '365 days')
FROM generate_series(1, 3000000) g;

-- 결제 주문 30만
INSERT INTO payment_orders (id, user_id, kind, product_id, amount, status, provider, created_at)
SELECT 'o' || g, 'u' || (30001 + (random() * 969999)::int), 'tokens', 'p300', 30000, 'paid', 'toss', now() - (random() * interval '365 days')
FROM generate_series(1, 300000) g;

ANALYZE;
