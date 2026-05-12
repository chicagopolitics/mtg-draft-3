import Link from "next/link";
import { redirect } from "next/navigation";

import { DeckEditor } from "@/components/DeckEditor";
import { auth } from "@/lib/auth";
import { createDeck } from "@/lib/highlander/actions";

export default async function NewDeckPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/signin?callbackUrl=/profile/decks/new");

  return (
    <main className="mx-auto max-w-5xl space-y-4 p-6">
      <header className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-bold">Create deck</h1>
          <p className="text-sm text-zinc-500">
            Paste a 100-card Highlander decklist, or pick a preset and edit
            from there.
          </p>
        </div>
        <Link
          href="/profile"
          className="text-xs text-zinc-500 underline hover:text-zinc-800 dark:hover:text-zinc-200"
        >
          back to profile
        </Link>
      </header>
      <DeckEditor submitLabel="create deck" onSubmit={createDeck} />
    </main>
  );
}
