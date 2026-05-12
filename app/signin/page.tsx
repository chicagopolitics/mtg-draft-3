/**
 * Sign-in page. Single form: enter email, get a magic link. Uses Auth.js's
 * server action via the `signIn` helper, which posts to /api/auth and
 * triggers a Resend send.
 *
 * Already-signed-in users get bounced to /profile so they don't re-auth.
 */

import { redirect } from "next/navigation";

import { auth, signIn } from "@/lib/auth";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string }>;
}) {
  const session = await auth();
  if (session?.user) redirect("/profile");

  const { callbackUrl } = await searchParams;

  async function magicLink(formData: FormData) {
    "use server";
    const email = String(formData.get("email") ?? "").trim();
    if (!email) return;
    await signIn("resend", {
      email,
      redirectTo: callbackUrl ?? "/profile",
    });
  }

  return (
    <main className="grid min-h-svh place-items-center bg-zinc-50 p-6 dark:bg-zinc-950">
      <form
        action={magicLink}
        className="w-full max-w-sm space-y-4 rounded-lg border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
      >
        <header>
          <h1 className="text-xl font-bold">Sign in</h1>
          <p className="text-sm text-zinc-500">
            Required for Highlander persistent decks. Other formats don&apos;t
            need an account.
          </p>
        </header>
        <label className="block space-y-1">
          <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
            email
          </span>
          <input
            name="email"
            type="email"
            required
            autoComplete="email"
            placeholder="you@example.com"
            className="w-full rounded border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800"
          />
        </label>
        <button
          type="submit"
          className="w-full rounded bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
        >
          email me a sign-in link
        </button>
        <p className="text-center text-[11px] text-zinc-500">
          We&apos;ll email you a one-click sign-in link. No password to
          remember.
        </p>
      </form>
    </main>
  );
}
