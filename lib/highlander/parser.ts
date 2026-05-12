/**
 * Highlander-specific decklist validation. Wraps the standard decklist
 * parser with singleton enforcement: each non-basic card may appear at most
 * once. Basic lands are exempt and can have any quantity.
 *
 * Returns:
 *   - resolved cards (materialized DraftCards, same as parseDecklist)
 *   - warnings: non-blocking issues (unknown card names, etc.)
 *   - errors: blocking issues (singleton violations) — the caller should
 *     refuse to save the deck until these are resolved.
 */

import { BASIC_LAND_IDS } from "@/lib/cards/basics";
import { parseDecklist, type ParsedDecklist } from "@/lib/cards/decklist";
import type { Card } from "@/lib/cards/schema";

export const HIGHLANDER_DECK_SIZE = 100;

export type HighlanderValidation = {
  cards: ParsedDecklist["cards"];
  warnings: string[];
  errors: string[];
  /** Counts of each non-basic card name encountered (for diagnostics). */
  duplicates: Array<{ name: string; count: number }>;
};

export function validateHighlanderDeck(
  text: string,
  library: Card[],
): HighlanderValidation {
  const parsed = parseDecklist(text, library);

  // Count each card's appearances, ignoring basics.
  const counts = new Map<string, number>();
  for (const c of parsed.cards) {
    if (BASIC_LAND_IDS.has(c.id)) continue;
    const key = c.name;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const duplicates: Array<{ name: string; count: number }> = [];
  const errors: string[] = [];
  for (const [name, count] of counts) {
    if (count > 1) {
      duplicates.push({ name, count });
      errors.push(`Singleton violation: ${count}× "${name}" (max 1)`);
    }
  }

  // Deck-size sanity check as a warning — Highlander wants 100, but we
  // don't hard-block at this step. The lobby/match flow can enforce later
  // if you want a strict gate.
  if (parsed.cards.length !== HIGHLANDER_DECK_SIZE) {
    parsed.warnings.push(
      `Deck has ${parsed.cards.length} cards; Highlander expects ${HIGHLANDER_DECK_SIZE}.`,
    );
  }

  return {
    cards: parsed.cards,
    warnings: parsed.warnings,
    errors,
    duplicates,
  };
}
