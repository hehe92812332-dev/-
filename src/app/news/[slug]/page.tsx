import { ArticleView } from "@/components/News";

export const metadata = { title: "건강 소식" };

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <ArticleView slug={slug} />;
}
