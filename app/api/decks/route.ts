import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * Lists curated pre-built decklists found in the project's `Decks/` folder.
 * Files are in MagicWorkstation (`.mwDeck`) format — comment headers carry
 * NAME / CREATOR / FORMAT metadata, card lines look like `4 [TE] Ancient
 * Tomb`, and `SB:`-prefixed lines are the sideboard. We strip set hints
 * and sideboard, leaving the player a `4 Ancient Tomb` style decklist they
 * can paste-edit and resolve against the cross-set library on submit.
 */

type DeckEntry = {
  /** Filename without extension; stable id for the picker. */
  id: string;
  name: string;
  creator: string;
  format: string;
  /** Cleaned decklist text suitable for our parseDecklist helper. */
  decklist: string;
};

let cached: { decks: DeckEntry[] } | null = null;

export const dynamic = "force-dynamic";

export async function GET() {
  if (cached) return Response.json(cached);

  const dir = path.join(process.cwd(), "Decks");
  let files: string[] = [];
  try {
    files = await fs.readdir(dir);
  } catch {
    cached = { decks: [] };
    return Response.json(cached);
  }

  const decks: DeckEntry[] = [];
  for (const file of files) {
    if (!/\.mwdeck$/i.test(file)) continue;
    try {
      const raw = await fs.readFile(path.join(dir, file), "utf8");
      const cleaned = raw.replace(/^﻿/, ""); // strip BOM if present
      const parsed = parseMwDeck(cleaned);
      const id = file.replace(/\.mwdeck$/i, "");
      decks.push({
        id,
        name: parsed.name || prettifyId(id),
        creator: parsed.creator,
        format: parsed.format,
        decklist: parsed.decklist,
      });
    } catch (e) {
      console.warn(
        `[decks] skipping ${file}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
  decks.sort((a, b) => a.name.localeCompare(b.name));
  cached = { decks };
  return Response.json(cached);
}

function parseMwDeck(text: string): {
  name: string;
  creator: string;
  format: string;
  decklist: string;
} {
  let name = "";
  let creator = "";
  let format = "";
  const out: string[] = [];

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;

    // Comment lines may carry metadata.
    const meta = line.match(/^\/\/\s*(NAME|CREATOR|FORMAT)\s*:\s*(.+)$/i);
    if (meta) {
      const key = meta[1].toUpperCase();
      const val = meta[2].trim();
      if (key === "NAME") name = val;
      else if (key === "CREATOR") creator = val.replace(/_/g, " ");
      else if (key === "FORMAT") format = val;
      continue;
    }
    if (line.startsWith("//")) continue;

    // Sideboard lines: we don't model a separate sideboard, drop them.
    if (/^SB:/i.test(line)) continue;

    // Strip set hints like `[TE]` or `[6E]` so the rest matches our parser.
    const stripped = line
      .replace(/\s*\[[A-Z0-9]+\]\s*/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (stripped) out.push(stripped);
  }

  return { name, creator, format, decklist: out.join("\n") };
}

/** Filename → "Standard Abducted Drake by Dirk Baberowski" */
function prettifyId(id: string): string {
  return id.replace(/_/g, " ");
}
