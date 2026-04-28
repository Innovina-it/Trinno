import Link from "next/link";
import { SignupForm } from "@/components/auth/signup-form";

export default function SignupPage() {
  return (
    <main className="min-h-screen grid place-items-center p-6">
      <div className="space-y-6 w-full max-w-sm">
        <h1 className="text-2xl font-semibold">Create your account</h1>
        <SignupForm />
        <p className="text-sm text-muted-foreground">
          Already have an account? <Link href="/login" className="underline">Log in</Link>
        </p>
      </div>
    </main>
  );
}
