import { promises as fs } from "node:fs";
import path from "node:path";

import { BASIC_LAND_IDS, getFallbackBasicLands } from "@/lib/cards/basics";
import { convertMtgJsonSet, type MtgJsonSet } from "@/lib/cards/sets/mtgjson";
import { attachScryfallArt } from "@/lib/cards/sets/scryfall";
import type { Card } from "@/lib/cards/schema";

type LibraryResult = {
  cards: Card[];
  totalSetsRead: number;
  totalCardsRead: number;
  uniqueCardCount: number;
  artMatched: number;
  artMissing: number;
};

// In-memory cache. The library is heavy to build (90+ files + Scryfall lookups
// for thousands of cards) but stable across requests, so we build once per
// server lifetime.
let cached: LibraryResult | null = null;
let inFlight: Promise<LibraryResult> | null = null;

export const dynamic = "force-dynamic";
// Long route timeout — building the library can take ~30s on cold start
// because of batched Scryfall lookups. Subsequent requests are instant.
export const maxDuration = 60;

export async function GET(req: Request) {
  // ?refresh=1 forces a rebuild — useful when a previous build had Scryfall
  // throttling and you ended up with cards missing art in the cached result.
  const url = new URL(req.url);
  const refresh = url.searchParams.get("refresh") === "1";
  if (refresh) {
    cached = null;
    inFlight = null;
  }

  if (cached) return Response.json(cached);
  if (inFlight) return Response.json(await inFlight);

  inFlight = buildLibrary();
  try {
    const result = await inFlight;
    cached = result;
    return Response.json(result);
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  } finally {
    inFlight = null;
  }
}

async function buildLibrary(): Promise<LibraryResult> {
  const setsDir = path.join(process.cwd(), "Sets");
  const files = (await fs.readdir(setsDir)).filter((f) =>
    f.toLowerCase().endsWith(".json"),
  );

  // Per-set load → flat list of (card, sourceSet) pairs.
  type Entry = { card: Card; sourceSet: string };
  const allEntries: Entry[] = [];
  let totalCardsRead = 0;

  for (const file of files) {
    const code = file.replace(/\.json$/i, "").toUpperCase();
    try {
      const raw = await fs.readFile(path.join(setsDir, file), "utf8");
      const json = JSON.parse(raw.replace(/^﻿/, "")) as MtgJsonSet;
      const cards = convertMtgJsonSet(json, code.toLowerCase());
      totalCardsRead += cards.length;
      for (const c of cards) allEntries.push({ card: c, sourceSet: code });
    } catch (e) {
      console.warn(
        `[library] skipping ${file}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  // Dedupe by normalized name. First wins (per the spec — tiebreaker isn't
  // worth the complexity).
  const byName = new Map<string, Entry>();
  for (const e of allEntries) {
    const key = normalizeName(e.card.name);
    if (!byName.has(key)) byName.set(key, e);
  }
  const unique = [...byName.values()];

  // Inject fallback basic lands if no canonical printings made it through.
  // (Old expansions often lack basics in MTGJSON.)
  const hasBasics = unique.some((e) => BASIC_LAND_IDS.has(e.card.id));
  if (!hasBasics) {
    const fallback = await getFallbackBasicLands();
    for (const c of fallback) {
      const key = normalizeName(c.name);
      if (!byName.has(key)) {
        byName.set(key, { card: c, sourceSet: "" }); // art already attached
      }
    }
  }

  // Group by source set so we can use the existing Scryfall batch lookup
  // (which keys lookups by set code + collector number).
  const groupedBySet = new Map<string, Card[]>();
  for (const { card, sourceSet } of byName.values()) {
    if (!sourceSet) continue; // already has art (e.g., fallback basics)
    if (!groupedBySet.has(sourceSet)) groupedBySet.set(sourceSet, []);
    groupedBySet.get(sourceSet)!.push(card);
  }

  let artMatched = 0;
  let artMissing = 0;
  // Sequential set lookups. Running 23 sets in parallel previously triggered
  // Scryfall rate limiting (HTTP 429), and silent batch failures left whole
  // sets with no art. attachScryfallArt now sleeps between its own batches
  // and retries on 429/5xx — combined with sequencing here, we stay polite.
  const t0 = Date.now();
  for (const [code, cards] of groupedBySet) {
    try {
      const r = await attachScryfallArt(code, cards);
      artMatched += r.matched;
      artMissing += r.missing;
      if (r.missing > 0) {
        console.warn(
          `[library] ${code}: ${r.matched}/${cards.length} matched, ${r.missing} missing`,
        );
      }
    } catch (e) {
      console.warn(
        `[library] art lookup failed for ${code}: ${e instanceof Error ? e.message : String(e)}`,
      );
      artMissing += cards.length;
    }
  }
  console.log(
    `[library] art: ${artMatched} matched, ${artMissing} missing across ${groupedBySet.size} sets in ${Date.now() - t0}ms`,
  );

  const cards = [...byName.values()].map((e) => e.card);
  // Stable sort by name for predictable client-side iteration.
  cards.sort((a, b) => a.name.localeCompare(b.name));

  return {
    cards,
    totalSetsRead: files.length,
    totalCardsRead,
    uniqueCardCount: cards.length,
    artMatched,
    artMissing,
  };
}

function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‘’']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
