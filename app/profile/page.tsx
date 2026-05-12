/**
 * Profile / decks landing page. Gated behind sign-in. Shows the player's
 * persistent Highlander decks and lets them create new ones.
 *
 * This is the v1 shell — the actual deck-CRUD UI (paste decklist, edit,
 * delete) lands in phase 2.
 */

import Link from "next/link";
import { redirect } from "next/navigation";
import { desc, eq } from "drizzle-orm";

import { auth, signOut } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { decks } from "@/lib/db/schema";

export default async function ProfilePage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/signin?callbackUrl=/profile");
  }

  const myDecks = await db
    .select()
    .from(decks)
    .where(eq(decks.userId, session.user.id))
    .orderBy(desc(decks.updatedAt));

  async function doSignOut() {
    "use server";
    await signOut({ redirectTo: "/" });
  }

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6">
      <header className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-bold">Your decks</h1>
          <p className="text-sm text-zinc-500">
            Signed in as{" "}
            <span className="font-mono">{session.user.email}</span>.
          </p>
        </div>
        <div className="flex items-center gap-4">
          <Link
            href="/"
            className="text-xs text-zinc-500 underline hover:text-zinc-800 dark:hover:text-zinc-200"
          >
            ← lobbies
          </Link>
          <form action={doSignOut}>
            <button
              type="submit"
              className="text-xs text-zinc-500 underline hover:text-zinc-800 dark:hover:text-zinc-200"
            >
              sign out
            </button>
          </form>
        </div>
      </header>

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
            highlander decks
          </h2>
          <Link
            href="/profile/decks/new"
            className="rounded bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"
          >
            + new deck
          </Link>
        </div>
        {myDecks.length === 0 ? (
          <p className="rounded border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500 dark:border-zinc-700">
            No decks yet. Build one to play Highlander with your friends.
          </p>
        ) : (
          <ul className="space-y-2">
            {myDecks.map((d) => (
              <li
                key={d.id}
                className="rounded border border-zinc-200 dark:border-zinc-800"
              >
                <Link
                  href={`/profile/decks/${d.id}`}
                  className="flex items-center justify-between gap-3 p-3 hover:bg-zinc-50 dark:hover:bg-zinc-900"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-semibold">{d.name}</p>
                      {d.lockedAt ? (
                        <span className="shrink-0 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300">
                          published
                        </span>
                      ) : (
                        <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
                          draft
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-zinc-500">
                      {d.format} · {d.wins}W–{d.losses}L · updated{" "}
                      {new Date(d.updatedAt).toLocaleDateString()}
                    </p>
                  </div>
                  <span className="text-xs text-zinc-400">
                    {d.lockedAt ? "view →" : "edit →"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
