import { promises as fs } from "node:fs";
import path from "node:path";

import { BASIC_LAND_IDS, getFallbackBasicLands } from "@/lib/cards/basics";
import { convertMtgJsonSet, type MtgJsonSet } from "@/lib/cards/sets/mtgjson";
import type { Card } from "@/lib/cards/schema";

type LibraryResult = {
  cards: Card[];
  totalSetsRead: number;
  totalCardsRead: number;
  uniqueCardCount: number;
};

// In-memory cache. The library is now just JSON parsing (no Scryfall) so the
// build is fast (~1s for ~23 sets). We still cache it because the result is
// stable across requests. Art is fetched lazily client-side via /api/cards/art.
let cached: LibraryResult | null = null;
let inFlight: Promise<LibraryResult> | null = null;

export const dynamic = "force-dynamic";
export const maxDuration = 30;

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
  // (Old expansions often lack basics in MTGJSON.) Fallback basics already
  // carry their own artUrl so they're ready to render without /api/cards/art.
  const hasBasics = unique.some((e) => BASIC_LAND_IDS.has(e.card.id));
  if (!hasBasics) {
    const fallback = await getFallbackBasicLands();
    for (const c of fallback) {
      const key = normalizeName(c.name);
      if (!byName.has(key)) {
        byName.set(key, { card: c, sourceSet: "" });
      }
    }
  }

  const cards = [...byName.values()].map((e) => e.card);
  // Stable sort by name for predictable client-side iteration.
  cards.sort((a, b) => a.name.localeCompare(b.name));

  return {
    cards,
    totalSetsRead: files.length,
    totalCardsRead,
    uniqueCardCount: cards.length,
  };
}

function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‘’']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
