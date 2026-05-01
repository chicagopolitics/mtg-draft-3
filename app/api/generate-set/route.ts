import { promises as fs } from "node:fs";
import path from "node:path";

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

import { CardSchema } from "@/lib/cards/schema";
import { SET_GENERATION_SYSTEM_PROMPT } from "@/lib/cards/prompt";

const SetSchema = z.object({
  cards: z.array(CardSchema).min(20).max(40),
});

const REQUIRED_LAND_IDS = ["plains", "island", "swamp", "mountain", "forest"];

const cachedKeys: Record<string, string | null | undefined> = {};

async function getEnvKey(name: string): Promise<string | null> {
  if (cachedKeys[name] !== undefined) return cachedKeys[name] ?? null;
  const fromEnv = process.env[name];
  if (fromEnv && fromEnv.length > 0) {
    cachedKeys[name] = fromEnv;
    return fromEnv;
  }
  // Fallback: parent shell may inject empty values that beat .env.local in Next.
  try {
    const content = await fs.readFile(
      path.join(process.cwd(), ".env.local"),
      "utf8",
    );
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`^\\s*${escaped}\\s*=\\s*(.+?)\\s*$`, "m");
    const match = content.match(re);
    if (match && match[1]) {
      cachedKeys[name] = match[1].trim();
      return cachedKeys[name] ?? null;
    }
  } catch {
    // ignore — file might not exist
  }
  cachedKeys[name] = null;
  return null;
}

type FalImage = {
  images?: Array<{ url: string; width?: number; height?: number }>;
};

async function generateArt(
  prompt: string,
  falKey: string,
): Promise<string | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch("https://fal.run/fal-ai/flux/schnell", {
        method: "POST",
        headers: {
          Authorization: `Key ${falKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          prompt,
          image_size: "landscape_4_3",
          num_inference_steps: 4,
          enable_safety_checker: false,
        }),
      });
      if (res.status === 429 && attempt === 0) {
        // Concurrent-limit hit; brief backoff and retry once.
        await new Promise((r) => setTimeout(r, 1500));
        continue;
      }
      if (!res.ok) {
        console.warn(
          `[generate-art] fal.ai ${res.status}: ${(await res.text()).slice(0, 200)}`,
        );
        return null;
      }
      const data = (await res.json()) as FalImage;
      return data.images?.[0]?.url ?? null;
    } catch (e) {
      console.warn(
        `[generate-art] fetch failed: ${e instanceof Error ? e.message : String(e)}`,
      );
      return null;
    }
  }
  return null;
}

/** Run worker over items with at most `concurrency` in flight at once. */
async function pool<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, idx: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const lanes = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (true) {
        const i = next++;
        if (i >= items.length) return;
        results[i] = await worker(items[i], i);
      }
    },
  );
  await Promise.all(lanes);
  return results;
}

export async function POST() {
  const apiKey = await getEnvKey("ANTHROPIC_API_KEY");
  if (!apiKey) {
    return Response.json(
      {
        error:
          "ANTHROPIC_API_KEY is not configured on the server. Add it to .env.local and restart the dev server.",
      },
      { status: 500 },
    );
  }
  const falKey = await getEnvKey("FAL_API_KEY");

  const client = new Anthropic({ apiKey });

  try {
    const response = await client.messages.parse({
      model: "claude-sonnet-4-6",
      max_tokens: 16000,
      thinking: { type: "disabled" },
      output_config: {
        format: zodOutputFormat(SetSchema),
      },
      cache_control: { type: "ephemeral" },
      system: [
        {
          type: "text",
          text: SET_GENERATION_SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [
        {
          role: "user",
          content:
            "Generate a fresh 30-card set following all guidelines. Make it a different vibe from anything generic — dial up the affectionate weirdness.",
        },
      ],
    });

    const data = response.parsed_output;
    if (!data) {
      const textBlock = response.content.find((b) => b.type === "text");
      const rawText = textBlock?.type === "text" ? textBlock.text : "";

      let parseDetail = "";
      let manualSample: unknown = null;
      try {
        const json = JSON.parse(rawText);
        manualSample = Array.isArray((json as { cards?: unknown[] })?.cards)
          ? (json as { cards: unknown[] }).cards[0]
          : json;
        const result = SetSchema.safeParse(json);
        if (!result.success) {
          parseDetail = result.error.issues
            .slice(0, 5)
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join(" | ");
        } else {
          parseDetail = "(zod accepted manually but SDK returned null)";
        }
      } catch (e) {
        parseDetail = `JSON parse failed: ${e instanceof Error ? e.message : String(e)}`;
      }

      console.log("[generate-set] failure diag", {
        stop_reason: response.stop_reason,
        usage: response.usage,
        contentBlockTypes: response.content.map((b) => b.type),
        rawTextLength: rawText.length,
        rawTextHead: rawText.slice(0, 300),
        rawTextTail: rawText.slice(-300),
        parseDetail,
        sampleCard: manualSample,
      });

      return Response.json(
        {
          error: "Model returned no parseable output.",
          stop_reason: response.stop_reason,
          parseDetail,
        },
        { status: 502 },
      );
    }

    // Sanity check distribution and required basic lands.
    const issues: string[] = [];
    const ids = new Set<string>();
    for (const c of data.cards) {
      if (ids.has(c.id)) issues.push(`Duplicate id: ${c.id}`);
      ids.add(c.id);
    }
    for (const landId of REQUIRED_LAND_IDS) {
      if (!ids.has(landId)) issues.push(`Missing basic land id: ${landId}`);
    }

    // Fan out art generation, capped at fal.ai's 10-concurrent limit. Failures
    // degrade gracefully (no artUrl → card falls back to gradient placeholder).
    const artStats = { generated: 0, failed: 0, skipped: 0 };
    if (falKey) {
      const t0 = Date.now();
      const enriched = await pool(data.cards, 8, async (c) => {
        if (!c.artPrompt) {
          artStats.skipped += 1;
          return c;
        }
        const url = await generateArt(c.artPrompt, falKey);
        if (url) artStats.generated += 1;
        else artStats.failed += 1;
        return url ? { ...c, artUrl: url } : c;
      });
      data.cards = enriched;
      console.log(
        `[generate-set] art: ${artStats.generated}/${data.cards.length} ok, ${artStats.failed} failed, ${artStats.skipped} skipped in ${Date.now() - t0}ms`,
      );
    } else {
      issues.push(
        "FAL_API_KEY not configured; cards rendered without art.",
      );
    }

    return Response.json({
      cards: data.cards,
      usage: response.usage,
      art: artStats,
      warnings: issues.length > 0 ? issues : undefined,
    });
  } catch (e) {
    if (e instanceof Anthropic.APIError) {
      return Response.json(
        {
          error: `Anthropic API error (${e.status ?? "unknown"}): ${e.message}`,
        },
        { status: 502 },
      );
    }
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ error: `Generation failed: ${msg}` }, { status: 500 });
  }
}
