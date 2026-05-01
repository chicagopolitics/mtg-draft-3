/**
 * Friendly display names for sets whose JSON files don't include a top-level
 * `data.name`. The slim MTGJSON exports for older sets (Tempest, etc.) omit
 * metadata; for those we fall back to this table, then to the bare code.
 */
export const KNOWN_SET_NAMES: Record<string, string> = {
  TMP: "Tempest",
  ODY: "Odyssey",
  TOR: "Torment",
  JUD: "Judgment",
  ONS: "Onslaught",
  INV: "Invasion",
  PCY: "Prophecy",
  NEM: "Nemesis",
  APC: "Apocalypse",
  MRD: "Mirrodin",
  DST: "Darksteel",
  "5DN": "Fifth Dawn",
  RAV: "Ravnica: City of Guilds",
  UDS: "Urza's Destiny",
  UNH: "Unhinged",
};

export function displaySetName(
  code: string,
  metaName?: string | null,
): string {
  if (metaName && metaName.trim()) return metaName;
  return KNOWN_SET_NAMES[code.toUpperCase()] ?? code.toUpperCase();
}
