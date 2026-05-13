/**
 * POST /api/highlander/transfer-ante
 *
 * Called by PartyKit (server-to-server) when a Highlander game ends. Transfers
 * the loser's ante card to the winner's deck:
 *   1. Finds a matching deck_card row in the loser's deck
 *   2. Changes its deckId to the winner's deck
 *   3. Stamps signature fields (who lost it, when)
 *   4. Creates an ante_history audit row
 *
 * Auth: requires INTERNAL_API_KEY as Bearer token.
 */

import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/lib/db/client";
import { anteHistory, deckCards, decks } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

const BodySchema = z.object({
  winnerDeckId: z.string().min(1),
  loserDeckId: z.string().min(1),
  cardName: z.string().min(1),
  setCode: z.string().nullable().optional(),
  collectorNumber: z.string().nullable().optional(),
  loserDisplayName: z.string().min(1),
  matchId: z.string().min(1),
  gameNumber: z.number().int().min(1),
});

export async function POST(request: Request) {
  // Verify internal key.
  const internalKey = process.env.INTERNAL_API_KEY;
  if (internalKey) {
    const auth = request.headers.get("authorization") ?? "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (token !== internalKey) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.message }, { status: 400 });
  }

  const {
    winnerDeckId,
    loserDeckId,
    cardName,
    setCode,
    collectorNumber,
    loserDisplayName,
    matchId,
    gameNumber,
  } = parsed.data;

  // Look up both decks' owning userIds (needed for signature + ante_history).
  const [winnerDeck, loserDeck] = await Promise.all([
    db.query.decks.findFirst({
      where: eq(decks.id, winnerDeckId),
      columns: { userId: true },
    }),
    db.query.decks.findFirst({
      where: eq(decks.id, loserDeckId),
      columns: { userId: true },
    }),
  ]);

  if (!winnerDeck || !loserDeck) {
    return Response.json({ error: "Deck not found" }, { status: 404 });
  }

  // Find one matching card row in the loser's deck.
  const card = await db.query.deckCards.findFirst({
    where: and(
      eq(deckCards.deckId, loserDeckId),
      eq(deckCards.cardName, cardName),
    ),
  });

  if (!card) {
    return Response.json(
      { error: "Card not found in loser's deck" },
      { status: 404 },
    );
  }

  const now = new Date();

  // Transfer the card + create audit trail.
  await Promise.all([
    db
      .update(deckCards)
      .set({
        deckId: winnerDeckId,
        signedByDisplayName: loserDisplayName,
        signedByUserId: loserDeck.userId,
        signedAt: now,
      })
      .where(eq(deckCards.id, card.id)),
    db.insert(anteHistory).values({
      id: crypto.randomUUID(),
      matchId,
      gameNumber,
      winnerUserId: winnerDeck.userId,
      loserUserId: loserDeck.userId,
      cardName,
      setCode: setCode ?? undefined,
      collectorNumber: collectorNumber ?? undefined,
      resolvedAt: now,
    }),
  ]);

  return Response.json({ ok: true, transferredCardId: card.id });
}
