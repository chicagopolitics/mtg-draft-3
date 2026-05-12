/**
 * POST /api/highlander/record-game
 *
 * Called by PartyKit (server-to-server, no user session) when a Highlander
 * game concludes to increment the per-game W/L counters on each deck.
 *
 * Auth: the caller must supply the INTERNAL_API_KEY environment variable as
 * a Bearer token so this endpoint can't be invoked by clients directly.
 *
 * Body: {
 *   winnerDeckId?: string;   // persistent deck id of the winning player
 *   loserDeckId?:  string;   // persistent deck id of the losing player
 * }
 *
 * Both deck ids are optional — non-Highlander matches or players who never
 * picked a deck are silently skipped. Increments are atomic SQL expressions
 * so concurrent calls don't race.
 *
 * Phase 3 wires up the PartyKit call when a game's currentGameWinner is set.
 */

import { sql } from "drizzle-orm";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/lib/db/client";
import { decks } from "@/lib/db/schema";

const BodySchema = z.object({
  winnerDeckId: z.string().min(1).optional(),
  loserDeckId: z.string().min(1).optional(),
});

export async function POST(request: Request) {
  // Verify the internal key so only PartyKit (or other trusted callers) can
  // hit this endpoint. The key is set in INTERNAL_API_KEY in .env.local and
  // must also be present in the PartyKit project's environment variables.
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

  const { winnerDeckId, loserDeckId } = parsed.data;
  const now = new Date();
  const updates: Promise<unknown>[] = [];

  if (winnerDeckId) {
    updates.push(
      db
        .update(decks)
        .set({ wins: sql`${decks.wins} + 1`, updatedAt: now })
        .where(eq(decks.id, winnerDeckId)),
    );
  }

  if (loserDeckId) {
    updates.push(
      db
        .update(decks)
        .set({ losses: sql`${decks.losses} + 1`, updatedAt: now })
        .where(eq(decks.id, loserDeckId)),
    );
  }

  await Promise.all(updates);
  return Response.json({ ok: true });
}
