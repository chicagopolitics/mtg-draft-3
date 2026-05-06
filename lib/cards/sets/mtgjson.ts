import type { Card, CardType, Color, ManaCost, Rarity } from "../schema";
import { manaCost as makeManaCost } from "../schema";

/**
 * Subset of the MTGJSON card shape we actually use. The full schema includes
 * many more fields (artist, borderColor, etc.) we just ignore.
 */
export type MtgJsonCard = {
  name: string;
  number?: string;
  manaCost?: string;
  rarity?: string;
  text?: string;
  flavorText?: string;
  power?: string;
  toughness?: string;
  colors?: string[];
  types?: string[];
  subtypes?: string[];
  supertypes?: string[];
};

export type MtgJsonSet = {
  data?: { cards?: MtgJsonCard[] };
};

const BASIC_LAND_NAMES = new Set([
  "Plains",
  "Island",
  "Swamp",
  "Mountain",
  "Forest",
]);

const SUPPORTED_TYPES: ReadonlyArray<CardType> = [
  "creature",
  "instant",
  "sorcery",
  "enchantment",
  "artifact",
  "land",
];

/**
 * Picks the most "display-relevant" type when a card has multiple. Creature
 * wins because the renderer keys P/T off type === "creature" (Steel Golem,
 * which is "Artifact Creature — Golem" in MTGJSON, must come back as a
 * creature so its 3/4 shows).
 */
const TYPE_PRIORITY: ReadonlyArray<CardType> = [
  "creature",
  "land",
  "artifact",
  "enchantment",
  "instant",
  "sorcery",
];

function pickPrimaryType(types: string[] | undefined): CardType | undefined {
  if (!types || types.length === 0) return undefined;
  const lowered = new Set(types.map((t) => t.toLowerCase()));
  for (const t of TYPE_PRIORITY) {
    if (lowered.has(t)) return t;
  }
  return undefined;
}

/**
 * The slim MTGJSON exports for older sets contain UTF-8 bytes that were
 * misread as Windows-1252 somewhere upstream and re-encoded as UTF-8 — so the
 * em-dash `—` (UTF-8: E2 80 94) shows up as the three-char sequence `â€"`.
 * Reverse it by treating each char as a byte and re-decoding as UTF-8.
 */
const CP1252_HIGH: Record<string, number> = {
  "€": 0x80, "‚": 0x82, "ƒ": 0x83, "„": 0x84,
  "…": 0x85, "†": 0x86, "‡": 0x87, "ˆ": 0x88,
  "‰": 0x89, "Š": 0x8a, "‹": 0x8b, "Œ": 0x8c,
  "Ž": 0x8e, "‘": 0x91, "’": 0x92, "“": 0x93,
  "”": 0x94, "•": 0x95, "–": 0x96, "—": 0x97,
  "˜": 0x98, "™": 0x99, "š": 0x9a, "›": 0x9b,
  "œ": 0x9c, "ž": 0x9e, "Ÿ": 0x9f,
};

// Mojibake fingerprint: U+00E2 followed by U+20AC (â€) is the start of the
// classic CP1252-misread-of-UTF-8 sequence and never occurs in clean text.
const MOJIBAKE_RE = new RegExp(String.fromCodePoint(0x00e2, 0x20ac));

function fixMojibake(s: string | undefined): string | undefined {
  if (!s) return s;
  if (!MOJIBAKE_RE.test(s)) return s;
  try {
    const bytes = Uint8Array.from(s, (c) => {
      const code = c.charCodeAt(0);
      if (code <= 0xff) return code;
      return CP1252_HIGH[c] ?? code & 0xff;
    });
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  } catch {
    return s;
  }
}

/**
 * Convert an MTGJSON set object into our Card[]. Drops cards whose type
 * isn't in our enum (planeswalkers etc. — Tempest has none) and dedupes
 * variant printings by name.
 */
export function convertMtgJsonSet(set: MtgJsonSet, idPrefix: string): Card[] {
  const seen = new Set<string>();
  const out: Card[] = [];
  const cards = set.data?.cards ?? [];
  for (const c of cards) {
    if (!c.name || seen.has(c.name)) continue;
    seen.add(c.name);
    const converted = convertCard(c, idPrefix);
    if (converted) out.push(converted);
  }
  return out;
}

function convertCard(c: MtgJsonCard, idPrefix: string): Card | null {
  const primary = pickPrimaryType(c.types);
  if (!primary || !SUPPORTED_TYPES.includes(primary)) return null;

  const isBasic =
    (c.supertypes ?? []).includes("Basic") && BASIC_LAND_NAMES.has(c.name);
  const id = isBasic ? c.name.toLowerCase() : `${idPrefix}-${slugify(c.name)}`;

  const colors = (c.colors ?? []).filter((x): x is Color =>
    ["W", "U", "B", "R", "G"].includes(x),
  );

  const rawRarity = (c.rarity ?? "common").toLowerCase();
  const rarity: Rarity =
    rawRarity === "mythic"
      ? "mythic"
      : rawRarity === "rare"
        ? "rare"
        : rawRarity === "uncommon"
          ? "uncommon"
          : "common";

  return {
    id,
    name: c.name,
    type: primary,
    subtype: (c.subtypes ?? []).join(" ") || undefined,
    colors,
    manaCost: c.manaCost ? parseManaCost(c.manaCost) : undefined,
    rarity,
    text: fixMojibake(c.text) ?? "",
    flavor: fixMojibake(c.flavorText),
    power: parseStat(c.power),
    toughness: parseStat(c.toughness),
    collectorNumber: c.number,
  };
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

function parseStat(s?: string): number | undefined {
  if (s == null) return undefined;
  const n = parseInt(s, 10);
  return Number.isNaN(n) ? 0 : Math.max(0, n);
}

/**
 * Parse a Scryfall/MTGJSON mana cost string like "{1}{W}{W}" or "{2}{R/G}"
 * into our 6-pip object. Unknown tokens silently ignored.
 */
function parseManaCost(s: string): ManaCost {
  const cost = makeManaCost({});
  const tokens = s.match(/\{[^}]+\}/g) ?? [];
  for (const tok of tokens) {
    const inner = tok.slice(1, -1);
    if (/^\d+$/.test(inner)) {
      cost.generic += parseInt(inner, 10);
    } else if (inner === "X") {
      cost.variable += 1;
    } else if (/^[YZ]$/.test(inner)) {
      // Y/Z (extremely rare, e.g., Unhinged) — treat like X.
      cost.variable += 1;
    } else if (/^[WUBRG]$/.test(inner)) {
      cost[inner as Color] += 1;
    } else if (/^[WUBRG]\/P$/.test(inner)) {
      // Phyrexian — count as the color
      cost[inner[0] as Color] += 1;
    } else if (/^[WUBRG]\/[WUBRG]$/.test(inner)) {
      // Hybrid — count toward the first color (arbitrary)
      cost[inner[0] as Color] += 1;
    } else if (/^\d+\/[WUBRG]$/.test(inner)) {
      // Twobrid (e.g., 2/W) — count toward the color
      cost[inner.slice(2) as Color] += 1;
    }
  }
  return cost;
}
