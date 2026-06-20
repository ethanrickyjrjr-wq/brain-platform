import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { isSafeReturnPath } from "@/lib/safe-return";
import { LoginForm } from "./login-form";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const supabase = createClient(await cookies());
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { next } = await searchParams;
  // Same-origin guard (rejects `//evil.com`); `startsWith("/")` alone is an open redirect.
  const redirectTo = isSafeReturnPath(next) ? next : "/";

  if (user) {
    redirect(redirectTo);
  }

  return (
    <div className="flex h-full flex-1 items-center justify-center bg-zinc-50 px-6 font-sans dark:bg-black">
      <main className="w-full max-w-sm rounded-2xl border border-black/[.08] bg-white p-8 dark:border-white/[.145] dark:bg-zinc-950">
        <h1 className="text-2xl font-semibold tracking-tight text-black dark:text-zinc-50">
          Sign in
        </h1>
        <p className="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
          Enter your email. We&rsquo;ll send you a sign-in code.
        </p>
        <LoginForm next={redirectTo} />
      </main>
    </div>
  );
}
