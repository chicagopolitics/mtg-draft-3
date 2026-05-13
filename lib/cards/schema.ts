import { z } from "zod";

export const ColorSchema = z.enum(["W", "U", "B", "R", "G"]);
export type Color = z.infer<typeof ColorSchema>;

export const RaritySchema = z.enum(["common", "uncommon", "rare", "mythic"]);
export type Rarity = z.infer<typeof RaritySchema>;

export const CardTypeSchema = z.enum([
  "creature",
  "instant",
  "sorcery",
  "enchantment",
  "artifact",
  "land",
]);
export type CardType = z.infer<typeof CardTypeSchema>;

export const ManaCostSchema = z.object({
  generic: z.number().int().min(0).max(20),
  /** Number of {X} variable-cost pips (e.g., {X}{X}{R} = 2). */
  variable: z.number().int().min(0).max(5).default(0),
  W: z.number().int().min(0).max(10),
  U: z.number().int().min(0).max(10),
  B: z.number().int().min(0).max(10),
  R: z.number().int().min(0).max(10),
  G: z.number().int().min(0).max(10),
});
export type ManaCost = z.infer<typeof ManaCostSchema>;

export const CardSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(80),
  type: CardTypeSchema,
  subtype: z.string().max(80).optional(),
  /**
   * Full canonical type line (e.g., "Legendary Artifact Creature — Golem")
   * built from MTGJSON's supertypes + types + subtypes. Falls back to a
   * derived form when omitted (LLM cards / mock set).
   */
  typeLine: z.string().max(120).optional(),
  colors: z.array(ColorSchema).max(5),
  manaCost: ManaCostSchema.optional(),
  rarity: RaritySchema,
  text: z.string().max(600),
  flavor: z.string().max(300).optional(),
  power: z.number().int().min(0).max(99).optional(),
  toughness: z.number().int().min(0).max(99).optional(),
  /** LLM-authored prompt describing what the card art should depict. */
  artPrompt: z.string().max(800).optional(),
  /** URL of the card art; populated server-side after image gen or Scryfall lookup. */
  artUrl: z.string().optional(),
  /** Collector number within a real set (e.g., "1", "247a"). Used as Scryfall lookup key. */
  collectorNumber: z.string().optional(),
  /** Lowercase set code (e.g., "usg", "tmp"). Pairs with collectorNumber for art lookup. */
  setCode: z.string().max(8).optional(),
  /** Human-readable set name (e.g., "Urza's Saga", "Tempest"). */
  setName: z.string().max(80).optional(),
});
export type Card = z.infer<typeof CardSchema>;

export const CardSetSchema = z.array(CardSchema).min(15);
export type CardSet = z.infer<typeof CardSetSchema>;

/** A card minted into a specific draft. instanceId distinguishes copies. */
export const DraftCardSchema = CardSchema.extend({
  instanceId: z.string().min(1).max(64),
});
export type DraftCard = z.infer<typeof DraftCardSchema>;

export function mintDraftCards(cards: Card[]): DraftCard[] {
  return cards.map((c) => ({ ...c, instanceId: mintInstanceId() }));
}

let counter = 0;
function mintInstanceId(): string {
  counter += 1;
  const r = Math.random().toString(36).slice(2, 8);
  return `${Date.now().toString(36)}-${counter.toString(36)}-${r}`;
}

export function manaCost(parts: Partial<ManaCost>): ManaCost {
  return {
    generic: parts.generic ?? 0,
    variable: parts.variable ?? 0,
    W: parts.W ?? 0,
    U: parts.U ?? 0,
    B: parts.B ?? 0,
    R: parts.R ?? 0,
    G: parts.G ?? 0,
  };
}

/**
 * Sum of mana symbols, treating {X} as 0 (its real cost is determined when cast).
 * Used for mana-curve bucketing and sorting.
 */
export function totalManaCost(cost: ManaCost): number {
  return cost.generic + cost.W + cost.U + cost.B + cost.R + cost.G;
}
