/**
 * GET /api/highlander/decks
 *
 * Returns the signed-in user's Highlander decks with all their card
 * records (both unsigned and signed). The client uses this to drive the
 * deck-picker in the lobby's Highlander phase: it resolves each cardName
 * against the cross-set library, mints DraftCards, and sends them to
 * PartyKit via `setHighlanderDeck`.
 *
 * Auth-gated — returns 401 when no session is found.
 */

import { desc, eq } from "drizzle-orm";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { deckCards, decks } from "@/lib/db/schema";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }
  const userId = session.user.id;

  const userDecks = await db
    .select()
    .from(decks)
    .where(eq(decks.userId, userId))
    .orderBy(desc(decks.updatedAt));

  const result = await Promise.all(
    userDecks.map(async (deck) => {
      const cards = await db
        .select({
          cardName: deckCards.cardName,
          setCode: deckCards.setCode,
          collectorNumber: deckCards.collectorNumber,
        })
        .from(deckCards)
        .where(eq(deckCards.deckId, deck.id));
      return {
        id: deck.id,
        name: deck.name,
        format: deck.format,
        updatedAt: deck.updatedAt,
        cardCount: cards.length,
        cards,
      };
    }),
  );

  return Response.json({ decks: result });
}
