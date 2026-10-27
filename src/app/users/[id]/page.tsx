import { UserProfile } from "@/components/UserProfile";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <UserProfile id={id} />;
}
