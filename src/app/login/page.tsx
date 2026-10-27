import Link from "next/link";
import { redirect } from "next/navigation";
import { enabledProviders, signIn } from "@/auth";
import { Logo } from "@/components/Header";

export const metadata = { title: "로그인" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  if (process.env.NEXT_PUBLIC_APP_MODE !== "server") redirect("/signup");
  const { next = "/", error } = await searchParams;
  const redirectTo = next.startsWith("/") && !next.startsWith("//") ? next : "/";

  return (
    <div className="mx-auto flex max-w-sm flex-col items-center px-4 py-16">
      <Logo />
      <h1 className="mt-8 text-2xl font-extrabold tracking-tight">로그인 · 회원가입</h1>
      <p className="mt-2 text-center text-sm text-slate-500">처음이시면 로그인 후 회원 유형을 선택하는 단계로 이어집니다.</p>
      {error && (
        <p className="mt-4 w-full rounded-xl bg-rose-50 px-4 py-3 text-center text-sm text-rose-700">로그인에 실패했어요. 다시 시도해 주세요.</p>
      )}

      <div className="mt-8 w-full space-y-3">
        {enabledProviders.kakao && (
          <form
            action={async () => {
              "use server";
              await signIn("kakao", { redirectTo });
            }}
          >
            <button className="btn w-full !py-3.5 bg-[#FEE500] text-[#191919] hover:brightness-95">카카오로 시작하기</button>
          </form>
        )}
        {enabledProviders.naver && (
          <form
            action={async () => {
              "use server";
              await signIn("naver", { redirectTo });
            }}
          >
            <button className="btn w-full !py-3.5 bg-[#03C75A] text-white hover:brightness-95">네이버로 시작하기</button>
          </form>
        )}
        {!enabledProviders.kakao && !enabledProviders.naver && !enabledProviders.dev && (
          <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
            로그인 수단이 설정되지 않았습니다. AUTH_KAKAO_ID / AUTH_NAVER_ID 환경변수를 설정하세요.
          </p>
        )}
        {enabledProviders.dev && (
          <form
            className="rounded-2xl border border-dashed border-slate-300 p-4"
            action={async (fd: FormData) => {
              "use server";
              await signIn("dev", { email: fd.get("email"), redirectTo });
            }}
          >
            <div className="text-xs font-bold text-slate-500">개발용 로그인 (운영 환경에서는 표시되지 않음)</div>
            <input name="email" type="email" required placeholder="아무 이메일" className="input mt-2" />
            <button className="btn-dark mt-2 w-full">이메일로 로그인</button>
          </form>
        )}
      </div>

      <p className="mt-8 text-center text-xs leading-relaxed text-slate-400">
        로그인하면 <Link href="/terms" className="underline">이용약관</Link>과{" "}
        <Link href="/privacy" className="underline">개인정보 처리방침</Link>에 동의하게 됩니다.
      </p>
    </div>
  );
}
