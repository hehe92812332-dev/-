import { PostList } from "@/components/PostList";

export const metadata = { title: "환자 Q&A" };

export default function Page() {
  return <PostList board="patient" />;
}
