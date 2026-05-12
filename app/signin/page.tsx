/**
 * Sign-in page. Discord OAuth (primary) + magic-link email (secondary).
 *
 * Already-signed-in users get bounced to /profile so they don't re-auth.
 */

import { redirect } from "next/navigation";

import { auth, signIn } from "@/lib/auth";

const ERROR_MESSAGES: Record<string, string> = {
  OAuthCallback: "Discord sign-in failed — check the app's redirect URI.",
  OAuthAccountNotLinked:
    "That Discord account isn't linked to an existing user. Try a different method.",
  Configuration: "Auth configuration error — check server logs.",
  Default: "Something went wrong during sign-in. Please try again.",
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string; error?: string }>;
}) {
  const session = await auth();
  if (session?.user) redirect("/profile");

  const { callbackUrl, error } = await searchParams;

  async function discordSignIn() {
    "use server";
    await signIn("discord", {
      redirectTo: callbackUrl ?? "/profile",
    });
  }

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
      <div className="w-full max-w-sm space-y-5 rounded-lg border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <header>
          <h1 className="text-xl font-bold">Sign in</h1>
          <p className="text-sm text-zinc-500">
            Required for Highlander persistent decks. Other formats don&apos;t
            need an account.
          </p>
        </header>

        {error && (
          <div className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
            {ERROR_MESSAGES[error] ?? ERROR_MESSAGES.Default}
            <span className="block text-xs text-red-500 mt-1">
              Error code: {error}
            </span>
          </div>
        )}

        {/* Discord OAuth — primary */}
        <form action={discordSignIn}>
          <button
            type="submit"
            className="flex w-full items-center justify-center gap-2 rounded bg-[#5865F2] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#4752C4]"
          >
            <svg
              className="h-5 w-5"
              viewBox="0 0 24 24"
              fill="currentColor"
              aria-hidden="true"
            >
              <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.947 2.418-2.157 2.418z" />
            </svg>
            Sign in with Discord
          </button>
        </form>

        {/* Divider */}
        <div className="flex items-center gap-3">
          <div className="h-px flex-1 bg-zinc-200 dark:bg-zinc-700" />
          <span className="text-xs text-zinc-400">or</span>
          <div className="h-px flex-1 bg-zinc-200 dark:bg-zinc-700" />
        </div>

        {/* Email magic link — secondary */}
        <form action={magicLink} className="space-y-3">
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
            className="w-full rounded border border-zinc-300 bg-white px-4 py-2 text-sm font-semibold text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
          >
            email me a sign-in link
          </button>
        </form>

        <p className="text-center text-[11px] text-zinc-500">
          Discord is recommended. Email sign-in is limited to the site
          owner&apos;s address.
        </p>
      </div>
    </main>
  );
}
