import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { and, asc, eq, isNotNull, isNull } from "drizzle-orm";

import { DeckEditor } from "@/components/DeckEditor";
import type { DeckEditorSubmitInput } from "@/components/DeckEditor";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { deckCards, decks } from "@/lib/db/schema";
import {
  deleteDeck as deleteDeckAction,
  publishDeck as publishDeckAction,
  renameDeck as renameDeckAction,
  updateDeck as updateDeckAction,
} from "@/lib/highlander/actions";

export default async function DeckEditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user?.id) {
    redirect(`/signin?callbackUrl=/profile/decks/${id}`);
  }

  const rows = await db
    .select()
    .from(decks)
    .where(and(eq(decks.id, id), eq(decks.userId, session.user.id)))
    .limit(1);
  if (rows.length === 0) notFound();
  const deck = rows[0];

  // Pull unsigned cards (to render back into the editor textarea) and
  // signed cards (to show read-only beside it).
  const unsignedCards = await db
    .select()
    .from(deckCards)
    .where(and(eq(deckCards.deckId, id), isNull(deckCards.signedByUserId)))
    .orderBy(asc(deckCards.cardName));
  const signedCards = await db
    .select()
    .from(deckCards)
    .where(and(eq(deckCards.deckId, id), isNotNull(deckCards.signedByUserId)))
    .orderBy(asc(deckCards.signedAt));

  // Re-emit the unsigned portion as decklist text. Group by name so the
  // textarea reads naturally rather than listing 17 separate "1 Plains" lines.
  const counts = new Map<string, number>();
  for (const c of unsignedCards) {
    counts.set(c.cardName, (counts.get(c.cardName) ?? 0) + 1);
  }
  const initialDecklist = [...counts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, n]) => `${n} ${name}`)
    .join("\n");

  const isLocked = !!deck.lockedAt;

  async function update(input: DeckEditorSubmitInput) {
    "use server";
    await updateDeckAction({ ...input, id });
  }

  async function publish() {
    "use server";
    await publishDeckAction(id);
  }

  async function rename(name: string) {
    "use server";
    await renameDeckAction(id, name);
  }

  async function remove() {
    "use server";
    await deleteDeckAction(id);
  }

  return (
    <main className="mx-auto max-w-5xl space-y-4 p-6">
      <header className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-bold">
            {isLocked ? "View deck" : "Edit deck"}
          </h1>
          <p className="text-sm text-zinc-500">
            {deck.format} · last updated{" "}
            {new Date(deck.updatedAt).toLocaleString()}
            {isLocked
              ? ` · published ${new Date(deck.lockedAt!).toLocaleDateString()}`
              : ""}
          </p>
        </div>
        <Link
          href="/profile"
          className="text-xs text-zinc-500 underline hover:text-zinc-800 dark:hover:text-zinc-200"
        >
          back to profile
        </Link>
      </header>

      <DeckEditor
        initialName={deck.name}
        initialDecklist={initialDecklist}
        initialSignedCards={signedCards.map((c) => ({
          id: c.id,
          cardName: c.cardName,
          signedByDisplayName: c.signedByDisplayName,
          signedAt: c.signedAt,
        }))}
        submitLabel="save changes"
        onSubmit={update}
        onDelete={remove}
        locked={isLocked}
        wins={deck.wins}
        losses={deck.losses}
        onPublish={isLocked ? undefined : publish}
        onRename={rename}
      />
    </main>
  );
}
