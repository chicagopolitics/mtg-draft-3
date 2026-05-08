/**
 * Lazy art lookup endpoint. Clients post a batch of card identifiers and we
 * return a map of art URLs. Each (set, collectorNumber) pair is fetched from
 * Scryfall at most once per process lifetime — we cache the URL (or `null`
 * for misses) in memory so subsequent requests for the same card return
 * instantly.
 *
 * This endpoint replaces the eager Scryfall pass that used to live in
 * /api/cards/library, which was timing out at the Vercel function limit
 * because it tried to fetch art for every card across every set up front.
 */

import { z } from "zod";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const RequestSchema = z.object({
  identifiers: z
    .array(
      z.object({
        set: z.string().min(1).max(8),
        collectorNumber: z.string().min(1).max(16),
      }),
    )
    .max(150),
});

const ENDPOINT = "https://api.scryfall.com/cards/collection";
const SCRYFALL_BATCH = 75;
const BATCH_DELAY_MS = 120;
const MAX_RETRIES = 3;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** key = `${setLowercase}:${collectorNumber}` → resolved art URL or null (miss). */
const cache = new Map<string, string | null>();
/**
 * In-flight requests for a given key, so concurrent callers asking about
 * the same card share a single Scryfall fetch instead of all triggering one.
 */
const inflight = new Map<string, Promise<string | null>>();

type ScryfallCard = {
  collector_number?: string;
  image_uris?: { art_crop?: string };
  card_faces?: Array<{ image_uris?: { art_crop?: string } }>;
};

type CollectionResponse = {
  data?: ScryfallCard[];
  not_found?: Array<{ set?: string; collector_number?: string }>;
};

function cacheKey(set: string, collectorNumber: string): string {
  return `${set.toLowerCase()}:${collectorNumber}`;
}

async function postBatch(
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
      const retryable = res.status === 429 || res.status >= 500;
      if (!retryable) return null;
      const ra = parseInt(res.headers.get("retry-after") ?? "", 10);
      const backoff = Number.isFinite(ra) ? ra * 1000 : 500 * Math.pow(2, attempt);
      await sleep(backoff);
    } catch {
      await sleep(500 * Math.pow(2, attempt));
    }
  }
  return null;
}

async function fetchUncached(
  uncached: Array<{ set: string; collectorNumber: string }>,
): Promise<void> {
  for (let i = 0; i < uncached.length; i += SCRYFALL_BATCH) {
    const slice = uncached.slice(i, i + SCRYFALL_BATCH);
    const body = await postBatch(
      slice.map((s) => ({ set: s.set.toLowerCase(), collector_number: s.collectorNumber })),
    );
    const matched = new Set<string>();
    if (body) {
      for (const sc of body.data ?? []) {
        if (!sc.collector_number) continue;
        // Scryfall's response doesn't echo the requested set on each card,
        // so we match by collector_number against the slice.
        const candidates = slice.filter(
          (s) => s.collectorNumber === sc.collector_number,
        );
        const art =
          sc.image_uris?.art_crop ?? sc.card_faces?.[0]?.image_uris?.art_crop;
        for (const c of candidates) {
          const k = cacheKey(c.set, c.collectorNumber);
          if (matched.has(k)) continue;
          cache.set(k, art ?? null);
          matched.add(k);
        }
      }
    }
    // Anything in this slice that didn't get matched gets a `null` (miss)
    // entry so we don't keep re-fetching it.
    for (const c of slice) {
      const k = cacheKey(c.set, c.collectorNumber);
      if (!matched.has(k) && !cache.has(k)) cache.set(k, null);
    }
    if (i + SCRYFALL_BATCH < uncached.length) await sleep(BATCH_DELAY_MS);
  }
}

export async function POST(req: Request) {
  let parsed;
  try {
    const body = (await req.json()) as unknown;
    parsed = RequestSchema.parse(body);
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "bad request" },
      { status: 400 },
    );
  }

  const result: Record<string, string> = {};
  const uncached: Array<{ set: string; collectorNumber: string }> = [];
  const waitOn: Promise<unknown>[] = [];

  for (const id of parsed.identifiers) {
    const k = cacheKey(id.set, id.collectorNumber);
    if (cache.has(k)) {
      const v = cache.get(k);
      if (v) result[k] = v;
      continue;
    }
    const pending = inflight.get(k);
    if (pending) {
      waitOn.push(
        pending.then((v) => {
          if (v) result[k] = v;
        }),
      );
      continue;
    }
    uncached.push(id);
  }

  if (uncached.length > 0) {
    // Mark each uncached key as in-flight so concurrent requests for the
    // same key wait on a single Scryfall fetch.
    const fetchPromise = (async () => {
      await fetchUncached(uncached);
    })();
    for (const id of uncached) {
      const k = cacheKey(id.set, id.collectorNumber);
      const p = fetchPromise.then(() => cache.get(k) ?? null);
      inflight.set(k, p);
    }
    try {
      await fetchPromise;
    } finally {
      for (const id of uncached) {
        inflight.delete(cacheKey(id.set, id.collectorNumber));
      }
    }
    for (const id of uncached) {
      const k = cacheKey(id.set, id.collectorNumber);
      const v = cache.get(k);
      if (v) result[k] = v;
    }
  }

  if (waitOn.length > 0) await Promise.all(waitOn);

  return Response.json({ art: result });
}
