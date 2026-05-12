"use server";

/**
 * Server actions for persistent Highlander deck management. All gated by
 * Auth.js — every action confirms a signed-in user before touching the DB.
 *
 * Cards from the live cross-set library are resolved client-side via the
 * existing `/api/cards/library` flow, then passed in here as plain
 * `{ cardName, setCode?, collectorNumber? }` records. We avoid running the
 * library lookup server-side both because the route would block on the
 * library cold-start and because the resolved cards already carry the
 * stable identifying metadata.
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { decks, deckCards } from "@/lib/db/schema";

const CardInputSchema = z.object({
  cardName: z.string().min(1).max(80),
  setCode: z.string().max(8).optional(),
  collectorNumber: z.string().max(16).optional(),
});

const CreateDeckSchema = z.object({
  name: z.string().min(1).max(80),
  cards: z.array(CardInputSchema).max(500),
});

const UpdateDeckSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(80),
  cards: z.array(CardInputSchema).max(500),
});

const RenameSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(80),
});

function newId(): string {
  return crypto.randomUUID();
}

async function requireUserId(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error("Not signed in.");
  }
  return session.user.id;
}

/**
 * Create a new deck and bulk-insert its (unsigned) cards. Redirects to the
 * deck's edit page on success.
 */
export async function createDeck(input: z.infer<typeof CreateDeckSchema>) {
  const userId = await requireUserId();
  const parsed = CreateDeckSchema.parse(input);

  const deckId = newId();
  await db.insert(decks).values({
    id: deckId,
    userId,
    name: parsed.name.trim(),
    format: "highlander",
  });
  if (parsed.cards.length > 0) {
    await db.insert(deckCards).values(
      parsed.cards.map((c) => ({
        id: newId(),
        deckId,
        cardName: c.cardName,
        setCode: c.setCode ?? null,
        collectorNumber: c.collectorNumber ?? null,
      })),
    );
  }
  revalidatePath("/profile");
  redirect(`/profile/decks/${deckId}`);
}

/**
 * Publish a deck — permanently locks the unsigned card list so it can no
 * longer be edited. The only future mutations allowed are ante transfers
 * (cards won or lost via gameplay). Idempotent: calling on an already-
 * published deck is a no-op.
 */
export async function publishDeck(deckId: string) {
  const userId = await requireUserId();
  const rows = await db
    .select({ id: decks.id, lockedAt: decks.lockedAt })
    .from(decks)
    .where(and(eq(decks.id, deckId), eq(decks.userId, userId)))
    .limit(1);
  if (rows.length === 0) throw new Error("Deck not found.");
  if (rows[0].lockedAt) return; // already published
  await db
    .update(decks)
    .set({ lockedAt: new Date(), updatedAt: new Date() })
    .where(eq(decks.id, deckId));
  revalidatePath("/profile");
  revalidatePath(`/profile/decks/${deckId}`);
}

/**
 * Rename a deck. Works on both draft and published decks — the name is
 * always editable (it's cosmetic metadata, not the locked card list).
 */
export async function renameDeck(deckId: string, name: string) {
  const userId = await requireUserId();
  const parsed = RenameSchema.parse({ id: deckId, name });
  await db
    .update(decks)
    .set({ name: parsed.name.trim(), updatedAt: new Date() })
    .where(and(eq(decks.id, parsed.id), eq(decks.userId, userId)));
  revalidatePath("/profile");
  revalidatePath(`/profile/decks/${deckId}`);
}

/**
 * Replace a deck's unsigned cards with the new list. Signed cards (won
 * via ante) are preserved untouched — they're separate rows with
 * `signedByUserId` set.
 *
 * Throws if the deck has been published — use `renameDeck` to update
 * the name on a locked deck.
 */
export async function updateDeck(input: z.infer<typeof UpdateDeckSchema>) {
  const userId = await requireUserId();
  const parsed = UpdateDeckSchema.parse(input);

  // Confirm ownership and check lock.
  const owned = await db
    .select({ id: decks.id, lockedAt: decks.lockedAt })
    .from(decks)
    .where(and(eq(decks.id, parsed.id), eq(decks.userId, userId)))
    .limit(1);
  if (owned.length === 0) throw new Error("Deck not found.");
  if (owned[0].lockedAt) {
    throw new Error(
      "This deck is published — its card list is locked. Use the rename option to change the name.",
    );
  }

  // Replace only unsigned rows. Signed cards (signedByUserId IS NOT NULL)
  // are preserved.
  await db
    .delete(deckCards)
    .where(
      and(eq(deckCards.deckId, parsed.id), isNull(deckCards.signedByUserId)),
    );
  if (parsed.cards.length > 0) {
    await db.insert(deckCards).values(
      parsed.cards.map((c) => ({
        id: newId(),
        deckId: parsed.id,
        cardName: c.cardName,
        setCode: c.setCode ?? null,
        collectorNumber: c.collectorNumber ?? null,
      })),
    );
  }
  await db
    .update(decks)
    .set({ name: parsed.name.trim(), updatedAt: new Date() })
    .where(eq(decks.id, parsed.id));
  revalidatePath("/profile");
  revalidatePath(`/profile/decks/${parsed.id}`);
}

/** Delete a deck (cascades to its deck_cards). */
export async function deleteDeck(deckId: string) {
  const userId = await requireUserId();
  await db
    .delete(decks)
    .where(and(eq(decks.id, deckId), eq(decks.userId, userId)));
  revalidatePath("/profile");
  redirect("/profile");
}
