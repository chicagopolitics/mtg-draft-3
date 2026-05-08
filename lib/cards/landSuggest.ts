import type { BasicLandCounts } from "../lobby/protocol";
import type { Color, DraftCard } from "./schema";

/**
 * Canonical limited ratio: 17 lands ride alongside 23 nonlands in a 40-card
 * deck, so ~74% of the nonland count's worth of basics is a good starting
 * point. Used to scale recommendations for larger-than-typical decks.
 */
const CANON_LANDS = 17;
const CANON_NONLANDS = 23;

/**
 * Suggest a basic-land split for a deck. Considers:
 *   - **Total card count**: scales lands proportionally to how many cards
 *     the player has chosen, so a 45-card main deck gets a sensible split
 *     instead of 0 (the old behavior).
 *   - **Color**: distributes lands by colored mana pip ratio across the deck.
 *   - **Average CMC**: higher curves get a small land bump per CMC point
 *     above 2.5 (the typical limited-curve baseline).
 *
 * The classic 40-card minimum still acts as a floor — if you have 18
 * nonlands the suggester will still propose 22 basics to hit the minimum,
 * even though the proportional formula would call for fewer.
 *
 * `deck` should be the full current deck list. Drafted lands self-exclude
 * from pip and CMC averaging (they have no `manaCost`) but still count
 * toward the deck-size totals.
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

  const nonlandCount = deck.length;
  if (nonlandCount === 0) return empty;

  // Average CMC across nonbasic spells (cards without manaCost don't count).
  let cmcSum = 0;
  let cmcCount = 0;
  for (const c of deck) {
    if (!c.manaCost) continue;
    const cmc =
      c.manaCost.generic +
      c.manaCost.W +
      c.manaCost.U +
      c.manaCost.B +
      c.manaCost.R +
      c.manaCost.G;
    cmcSum += cmc;
    cmcCount += 1;
  }
  const avgCmc = cmcCount > 0 ? cmcSum / cmcCount : 0;

  // Proportional land target: 17/23 of the deck size, plus a small bump per
  // CMC point above 2.5. The bump scales with deck size so wider decks get
  // proportionally more lands when their curve is heavy.
  const baselineLands = Math.round(
    (nonlandCount * CANON_LANDS) / CANON_NONLANDS,
  );
  const cmcBonus = Math.max(0, avgCmc - 2.5) * (nonlandCount / CANON_NONLANDS);
  const proportional = Math.round(baselineLands + cmcBonus);

  // Floor: hit the deck-size minimum no matter how few nonlands the player
  // has chosen. (Without this, a 10-card deck would get 7 lands and total 17.)
  const minimum = Math.max(0, deckTarget - nonlandCount);
  const totalLands = Math.max(minimum, proportional);
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
