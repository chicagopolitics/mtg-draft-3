import { promises as fs } from "node:fs";
import path from "node:path";

import { displaySetName } from "@/lib/cards/sets/registry";

type SetIndexEntry = {
  code: string;
  name: string;
  cardCount: number;
};

let cached: { sets: SetIndexEntry[] } | null = null;

export async function GET() {
  if (cached) return Response.json(cached);

  const setsDir = path.join(process.cwd(), "Sets");
  let files: string[] = [];
  try {
    files = await fs.readdir(setsDir);
  } catch (e) {
    return Response.json(
      { error: `Could not read Sets directory: ${e instanceof Error ? e.message : String(e)}` },
      { status: 500 },
    );
  }

  const jsonFiles = files.filter((f) => f.toLowerCase().endsWith(".json"));
  const entries = await Promise.all(
    jsonFiles.map(async (file): Promise<SetIndexEntry> => {
      const code = file.replace(/\.json$/i, "");
      try {
        const raw = await fs.readFile(path.join(setsDir, file), "utf8");
        const json = JSON.parse(raw.replace(/^﻿/, "")) as {
          data?: { name?: string; cards?: unknown[] };
        };
        return {
          code,
          name: displaySetName(code, json.data?.name),
          cardCount: json.data?.cards?.length ?? 0,
        };
      } catch {
        return { code, name: displaySetName(code), cardCount: 0 };
      }
    }),
  );

  entries.sort((a, b) => a.name.localeCompare(b.name));
  cached = { sets: entries };
  return Response.json(cached);
}
