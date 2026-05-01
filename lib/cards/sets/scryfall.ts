import type { Card } from "../schema";

type ScryfallCard = {
  collector_number?: string;
  image_uris?: { art_crop?: string };
  card_faces?: Array<{ image_uris?: { art_crop?: string } }>;
};

type CollectionResponse = {
  data?: ScryfallCard[];
  not_found?: unknown[];
};

const ENDPOINT = "https://api.scryfall.com/cards/collection";
const BATCH_SIZE = 75;

/**
 * Look up Scryfall art_crop URLs for an array of cards by (set code, collector
 * number). Mutates the input cards in place, setting `artUrl` where Scryfall
 * has a match. Returns counts for telemetry.
 *
 * Failures are silent — cards without matches keep no artUrl and fall back to
 * the gradient placeholder.
 */
export async function attachScryfallArt(
  setCode: string,
  cards: Card[],
): Promise<{ matched: number; missing: number }> {
  const lowerSet = setCode.toLowerCase();
  const lookupable = cards.filter((c) => c.collectorNumber);
  let matched = 0;

  // Build a map so we can patch back by collector number.
  const byNumber = new Map<string, Card>();
  for (const c of lookupable) {
    if (c.collectorNumber) byNumber.set(c.collectorNumber, c);
  }

  for (let i = 0; i < lookupable.length; i += BATCH_SIZE) {
    const slice = lookupable.slice(i, i + BATCH_SIZE);
    const identifiers = slice.map((c) => ({
      set: lowerSet,
      collector_number: c.collectorNumber!,
    }));

    try {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "User-Agent": "mtg-draft-3/0.1 (local)",
        },
        body: JSON.stringify({ identifiers }),
      });
      if (!res.ok) {
        console.warn(
          `[scryfall] batch ${i}-${i + slice.length} returned ${res.status}`,
        );
        continue;
      }
      const body = (await res.json()) as CollectionResponse;
      for (const sc of body.data ?? []) {
        const num = sc.collector_number;
        if (!num) continue;
        const card = byNumber.get(num);
        if (!card) continue;
        const art =
          sc.image_uris?.art_crop ?? sc.card_faces?.[0]?.image_uris?.art_crop;
        if (art) {
          card.artUrl = art;
          matched += 1;
        }
      }
    } catch (e) {
      console.warn(
        `[scryfall] batch ${i} fetch failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  return { matched, missing: lookupable.length - matched };
}
