import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { MobileNav } from "@/components/MobileNav";
import { StoreProvider } from "@/lib/store";
import { SITE } from "@/lib/config";

export const metadata: Metadata = {
  title: { default: `${SITE.name} — ${SITE.tagline}`, template: `%s | ${SITE.name}` },
  description: "물리치료사 임상 토론과 환자 Q&A를 한 곳에서. 경력·학회 교육·학위 기반 보석 등급제와 토큰 보상으로 신뢰할 수 있는 답변을 받으세요.",
};

export const viewport: Viewport = {
  themeColor: "#059673",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <head>
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css"
        />
      </head>
      <body className="min-h-dvh">
        <StoreProvider>
          <Header />
          <main className="pb-24 md:pb-0">{children}</main>
          <Footer />
          <MobileNav />
        </StoreProvider>
      </body>
    </html>
  );
}
