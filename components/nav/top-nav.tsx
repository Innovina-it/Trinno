import Link from "next/link";
import { Button } from "@/components/ui/button";
import { logout } from "@/actions/auth";

export function TopNav({ email }: { email: string }) {
  return (
    <header className="border-b">
      <div className="max-w-6xl mx-auto px-4 h-12 flex items-center justify-between">
        <Link href="/" className="font-semibold">Trello Clone</Link>
        <div className="flex items-center gap-3 text-sm">
          <span className="text-muted-foreground">{email}</span>
          <form action={logout}>
            <Button type="submit" variant="ghost" size="sm">Log out</Button>
          </form>
        </div>
      </div>
    </header>
  );
}
