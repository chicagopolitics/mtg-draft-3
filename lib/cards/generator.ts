import type { Card } from "./schema";
import { BASIC_LAND_IDS } from "./basics";

export type PackComposition = {
  commons: number;
  uncommons: number;
  rares: number;
  lands: number;
  mythicRate: number;
};

export const STANDARD_BOOSTER: PackComposition = {
  commons: 10,
  uncommons: 3,
  rares: 1,
  lands: 1,
  mythicRate: 1 / 8,
};

export function generatePack(
  set: Card[],
  comp: PackComposition = STANDARD_BOOSTER,
): Card[] {
  const basicLands = set.filter((c) => BASIC_LAND_IDS.has(c.id));
  const nonBasic = set.filter((c) => !BASIC_LAND_IDS.has(c.id));
  const nonLandCommons = nonBasic.filter((c) => c.rarity === "common");
  const uncommons = nonBasic.filter((c) => c.rarity === "uncommon");
  const rares = nonBasic.filter((c) => c.rarity === "rare");
  const mythics = nonBasic.filter((c) => c.rarity === "mythic");
  const lands = basicLands;

  if (nonLandCommons.length === 0) throw new Error("Set has no commons.");
  if (uncommons.length === 0) throw new Error("Set has no uncommons.");
  if (rares.length === 0 && mythics.length === 0)
    throw new Error("Set has no rares or mythics.");
  if (lands.length === 0) throw new Error("Set has no basic lands.");

  const pack: Card[] = [];

  for (let i = 0; i < comp.rares; i++) {
    const rollMythic = Math.random() < comp.mythicRate && mythics.length > 0;
    pack.push(pickOne(rollMythic ? mythics : rares));
  }
  for (let i = 0; i < comp.uncommons; i++) pack.push(pickOne(uncommons));
  for (let i = 0; i < comp.commons; i++) pack.push(pickOne(nonLandCommons));
  for (let i = 0; i < comp.lands; i++) pack.push(pickOne(lands));

  return pack;
}

function pickOne<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}
