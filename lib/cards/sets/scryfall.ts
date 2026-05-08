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
 * Scryfall asks for ~10 req/sec with 50–100ms gaps. We sleep this long
 * between batches; combined with sequential set lookups in the library
 * builder, it keeps us well under the rate limit.
 */
const BATCH_DELAY_MS = 120;
const MAX_RETRIES = 3;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * POST a single Scryfall batch with retry on 429 (rate limit) and 5xx
 * (transient server errors). Each retry waits longer; honors the
 * `Retry-After` header when Scryfall provides one.
 */
async function fetchBatchWithRetry(
  identifiers: Array<{ set: string; collector_number: string }>,
): Promise<CollectionResponse | null> {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
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
      if (res.ok) return (await res.json()) as CollectionResponse;

      // 429 / 5xx → wait and retry.
      const retryable = res.status === 429 || res.status >= 500;
      if (!retryable) {
        console.warn(`[scryfall] non-retryable status ${res.status}`);
        return null;
      }
      const retryAfter = parseInt(res.headers.get("retry-after") ?? "", 10);
      const backoff = Number.isFinite(retryAfter)
        ? retryAfter * 1000
        : 500 * Math.pow(2, attempt); // 500, 1000, 2000ms
      console.warn(
        `[scryfall] ${res.status} on attempt ${attempt + 1}, retrying in ${backoff}ms`,
      );
      await sleep(backoff);
    } catch (e) {
      console.warn(
        `[scryfall] fetch error on attempt ${attempt + 1}: ${e instanceof Error ? e.message : String(e)}`,
      );
      await sleep(500 * Math.pow(2, attempt));
    }
  }
  return null;
}

/**
 * Look up Scryfall art_crop URLs for an array of cards by (set code, collector
 * number). Mutates the input cards in place, setting `artUrl` where Scryfall
 * has a match. Returns counts for telemetry.
 *
 * Sleeps between batches and retries on 429/5xx so we don't silently lose
 * art when Scryfall throttles us. Cards still without art after retries
 * fall back to the gradient placeholder.
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

    const body = await fetchBatchWithRetry(identifiers);
    if (body) {
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
    }

    // Inter-batch breath so we stay polite.
    if (i + BATCH_SIZE < lookupable.length) await sleep(BATCH_DELAY_MS);
  }

  return { matched, missing: lookupable.length - matched };
}
