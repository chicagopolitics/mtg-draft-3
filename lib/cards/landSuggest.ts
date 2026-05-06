import type { BasicLandCounts } from "../lobby/protocol";
import type { Color, DraftCard } from "./schema";

/**
 * Suggest a basic-land split for a deck under the classic limited heuristic:
 *   - Total basics to add = max(0, deckTarget - currentDeckSize)
 *   - Distributed proportionally to colored mana pips across the deck
 *   - Largest-remainder rounding so the sum exactly matches the target
 *
 * `deck` should be the entire current deck list (drafted nonbasics + drafted
 * lands) — lands lack `manaCost` so they don't skew the pip counts, and we
 * need their seat count to know how many basic-land slots remain.
 *
 * Hybrid pips count toward the first listed color (matches how parseManaCost
 * stored them when the set was loaded). Generic and {X} pips don't influence
 * color, only the total deck count.
 *
 * Returns all-zero when there are no cards yet or no colored pips.
 */
export function suggestLandMix(
  deck: DraftCard[],
  deckTarget: number,
): BasicLandCounts {
  const empty: BasicLandCounts = { W: 0, U: 0, B: 0, R: 0, G: 0 };

  const totalLands = Math.max(0, deckTarget - deck.length);
  if (totalLands === 0) return empty;

  const pips: BasicLandCounts = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  for (const c of deck) {
    if (!c.manaCost) continue;
    pips.W += c.manaCost.W;
    pips.U += c.manaCost.U;
    pips.B += c.manaCost.B;
    pips.R += c.manaCost.R;
    pips.G += c.manaCost.G;
  }

  const totalPips = pips.W + pips.U + pips.B + pips.R + pips.G;
  if (totalPips === 0) return empty;

  // Largest-remainder method: floor each share, then hand out the leftover
  // lands one at a time to whichever color has the biggest fractional part.
  const colors: Color[] = ["W", "U", "B", "R", "G"];
  type Slot = { color: Color; floor: number; remainder: number };
  const slots: Slot[] = colors.map((color) => {
    const exact = (pips[color] / totalPips) * totalLands;
    const floor = Math.floor(exact);
    return { color, floor, remainder: exact - floor };
  });

  const allocated = slots.reduce((s, x) => s + x.floor, 0);
  let leftover = totalLands - allocated;

  // Sort descending by remainder, tie-break by larger original pip count.
  slots.sort(
    (a, b) =>
      b.remainder - a.remainder || pips[b.color] - pips[a.color],
  );
  for (const s of slots) {
    if (leftover <= 0) break;
    s.floor += 1;
    leftover -= 1;
  }

  const out: BasicLandCounts = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  for (const s of slots) out[s.color] = s.floor;
  return out;
}
