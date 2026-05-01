import type { Card } from "./schema";

/** Card ids occupying the basic-land slot in a booster pack. */
export const BASIC_LAND_IDS: ReadonlySet<string> = new Set([
  "plains",
  "island",
  "swamp",
  "mountain",
  "forest",
]);

const BASICS_SPEC = [
  { id: "plains", name: "Plains", color: "W" },
  { id: "island", name: "Island", color: "U" },
  { id: "swamp", name: "Swamp", color: "B" },
  { id: "mountain", name: "Mountain", color: "R" },
  { id: "forest", name: "Forest", color: "G" },
] as const;

let cached: Card[] | null = null;

/**
 * Returns the 5 basic lands as Card objects, with Scryfall art_crop URLs
 * fetched from a known set (Tempest) and cached. Falls back to bare cards
 * without art if the lookup fails.
 *
 * Used to fill the basic-land slot when a loaded set (e.g., Apocalypse,
 * Judgment) historically didn't ship with basic lands.
 */
export async function getFallbackBasicLands(): Promise<Card[]> {
  if (cached) return cached;

  const bare: Card[] = BASICS_SPEC.map((s) => ({
    id: s.id,
    name: s.name,
    type: "land",
    subtype: `Basic Land — ${s.name}`,
    colors: [],
    rarity: "common",
    text: `({T}: Add {${s.color}}.)`,
  }));

  try {
    const res = await fetch("https://api.scryfall.com/cards/collection", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": "mtg-draft-3/0.1 (local)",
      },
      body: JSON.stringify({
        identifiers: BASICS_SPEC.map((s) => ({ name: s.name, set: "tmp" })),
      }),
    });
    if (!res.ok) {
      cached = bare;
      return cached;
    }
    const body = (await res.json()) as {
      data?: Array<{ name?: string; image_uris?: { art_crop?: string } }>;
    };
    const byName = new Map<string, string>();
    for (const c of body.data ?? []) {
      if (c.name && c.image_uris?.art_crop) {
        byName.set(c.name, c.image_uris.art_crop);
      }
    }
    cached = bare.map((c) => ({ ...c, artUrl: byName.get(c.name) }));
    return cached;
  } catch {
    cached = bare;
    return cached;
  }
}
