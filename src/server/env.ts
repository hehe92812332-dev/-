import "server-only";

/** 서버 환경변수. 없는 값은 사용하는 시점에 명확한 오류를 냅니다. */
export function requireEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`환경변수 ${name}이(가) 설정되지 않았습니다. .env.example을 참고하세요.`);
  return v;
}

export const isProduction = process.env.NODE_ENV === "production";

/** 결제 대행사: toss(실결제/테스트키) 또는 mock(개발용, 운영 환경에서는 사용 불가) */
export function paymentProvider(): "toss" | "mock" {
  const p = process.env.PAYMENTS_PROVIDER ?? (process.env.TOSS_SECRET_KEY ? "toss" : "mock");
  if (p === "mock" && isProduction && process.env.ALLOW_MOCK_PAYMENTS !== "true")
    throw new Error("운영 환경에서는 mock 결제를 사용할 수 없습니다. TOSS_SECRET_KEY를 설정하세요.");
  return p === "toss" ? "toss" : "mock";
}

export const adminEmails = () =>
  (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
