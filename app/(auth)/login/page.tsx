import Link from "next/link";
import { LoginForm } from "@/components/auth/login-form";

export default function LoginPage() {
  return (
    <main className="min-h-screen grid place-items-center p-6">
      <div className="space-y-6 w-full max-w-sm">
        <h1 className="text-2xl font-semibold">Welcome back</h1>
        <LoginForm />
        <p className="text-sm text-muted-foreground">
          New here? <Link href="/signup" className="underline">Create an account</Link>
        </p>
      </div>
    </main>
  );
}
