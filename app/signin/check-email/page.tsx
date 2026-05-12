/**
 * "Check your email" landing page after submitting the sign-in form.
 * Auth.js redirects here once the magic link has been queued for delivery.
 */
export default function CheckEmailPage() {
  return (
    <main className="grid min-h-svh place-items-center bg-zinc-50 p-6 dark:bg-zinc-950">
      <div className="max-w-sm space-y-3 rounded-lg border border-zinc-200 bg-white p-6 text-center shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <h1 className="text-xl font-bold">Check your inbox</h1>
        <p className="text-sm text-zinc-500">
          We just emailed you a sign-in link. Click it to finish signing in.
        </p>
        <p className="text-[11px] text-zinc-400">
          Don&apos;t see it? Check your spam folder — the sender is
          <span className="font-mono"> onboarding@resend.dev</span>.
        </p>
      </div>
    </main>
  );
}
