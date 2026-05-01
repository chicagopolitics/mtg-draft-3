import { promises as fs } from "node:fs";
import path from "node:path";

import { BASIC_LAND_IDS, getFallbackBasicLands } from "@/lib/cards/basics";
import { convertMtgJsonSet, type MtgJsonSet } from "@/lib/cards/sets/mtgjson";
import { displaySetName } from "@/lib/cards/sets/registry";
import { attachScryfallArt } from "@/lib/cards/sets/scryfall";
import type { Card } from "@/lib/cards/schema";

type LoadedSet = {
  cards: Card[];
  count: number;
  name: string;
  code: string;
  art: { matched: number; missing: number };
};

// Opt out of Next's response cache — our in-memory Map already handles caching,
// and Next's default GET caching held onto pre-fix responses indefinitely.
export const dynamic = "force-dynamic";

const cache = new Map<string, LoadedSet>();

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ code: string }> },
) {
  const { code } = await ctx.params;
  // Sanitize: only A-Z, 0-9, _ — must match a real file in Sets/
  const safe = code.replace(/[^A-Za-z0-9_]/g, "").toUpperCase();
  if (!safe) {
    return Response.json({ error: "Invalid set code" }, { status: 400 });
  }

  const cached = cache.get(safe);
  if (cached) return Response.json(cached);

  const filePath = path.join(process.cwd(), "Sets", `${safe}.json`);
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const json = JSON.parse(raw.replace(/^﻿/, "")) as MtgJsonSet & {
      data?: { name?: string };
    };
    const cards = convertMtgJsonSet(json, safe.toLowerCase());
    const t0 = Date.now();
    const art = await attachScryfallArt(safe, cards);
    console.log(
      `[sets/${safe}] scryfall art: ${art.matched}/${cards.length} matched, ${art.missing} missing in ${Date.now() - t0}ms`,
    );

    // Older expansion sets historically didn't ship with basic lands. Inject
    // fallback basics (with art) so the pack generator's land slot can fill.
    const hasBasics = cards.some((c) => BASIC_LAND_IDS.has(c.id));
    if (!hasBasics) {
      const fallback = await getFallbackBasicLands();
      cards.push(...fallback);
      console.log(
        `[sets/${safe}] injected ${fallback.length} fallback basic lands`,
      );
    }
    const result: LoadedSet = {
      cards,
      count: cards.length,
      name: displaySetName(safe, json.data?.name),
      code: safe,
      art,
    };
    cache.set(safe, result);
    return Response.json(result);
  } catch (e) {
    if (e instanceof Error && "code" in e && (e as { code: string }).code === "ENOENT") {
      return Response.json(
        { error: `Set "${safe}" not found in Sets/.` },
        { status: 404 },
      );
    }
    return Response.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
