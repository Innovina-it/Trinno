import { requireUser } from "@/lib/auth";
import { TopNav } from "@/components/nav/top-nav";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return (
    <>
      <TopNav email={user.email ?? ""} />
      <div className="max-w-6xl mx-auto p-6">{children}</div>
    </>
  );
}
