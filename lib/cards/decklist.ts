import type { Card, DraftCard } from "./schema";
import { mintDraftCards } from "./schema";

export type ParsedDecklist = {
  /** Materialized cards with unique instanceIds, ready to ship into a Loadout. */
  cards: DraftCard[];
  /** Lines that couldn't be matched to a card in the active set. */
  warnings: string[];
};

/**
 * Parse a pasted decklist (MTGO/Arena style) into materialized cards.
 *
 * Accepted line shapes:
 *   `4 Lightning Bolt`
 *   `4x Lightning Bolt`
 *   `Lightning Bolt`            (treated as 1)
 *   blank lines, or lines beginning with `//`, `#`, `Sideboard`, `Maindeck` → ignored
 *
 * Name matching is case-insensitive and trims punctuation differences. Unknown
 * names produce warnings but don't block — the player still gets a deck of
 * whatever did match.
 */
export function parseDecklist(text: string, set: Card[]): ParsedDecklist {
  const byKey = new Map<string, Card>();
  for (const c of set) byKey.set(normalizeName(c.name), c);

  const cards: Card[] = [];
  const warnings: string[] = [];
  const lines = text.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const trimmed = raw.trim();
    if (!trimmed) continue;
    if (/^(?:\/\/|#)/.test(trimmed)) continue;
    if (/^(sideboard|maindeck|main|deck)\b/i.test(trimmed)) continue;

    const m = trimmed.match(/^(\d+)\s*x?\s+(.+?)\s*(?:\(.+?\)\s*\d*\s*)?$/i);
    let qty = 1;
    let name = trimmed;
    if (m) {
      qty = parseInt(m[1], 10);
      name = m[2];
    } else {
      // No quantity prefix — just a bare name.
      name = trimmed.replace(/\s*\(.+?\)\s*\d*\s*$/, "");
    }

    if (!Number.isFinite(qty) || qty <= 0) {
      warnings.push(`line ${i + 1}: unreadable quantity → "${trimmed}"`);
      continue;
    }
    if (qty > 99) {
      warnings.push(`line ${i + 1}: capped ${qty} → 99 ("${name}")`);
      qty = 99;
    }

    const card = byKey.get(normalizeName(name));
    if (!card) {
      warnings.push(`line ${i + 1}: no card named "${name}" in active set`);
      continue;
    }
    for (let j = 0; j < qty; j++) cards.push(card);
  }

  return { cards: mintDraftCards(cards), warnings };
}

function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‘’']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
