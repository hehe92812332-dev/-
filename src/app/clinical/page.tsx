import { PostList } from "@/components/PostList";

export const metadata = { title: "임상 토론" };

export default function Page() {
  return <PostList board="clinical" />;
}
