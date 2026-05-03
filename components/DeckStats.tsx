import type {
  BasicLandCounts,
} from "@/lib/lobby/protocol";
import {
  type CardType,
  type Color,
  type DraftCard,
  totalManaCost,
} from "@/lib/cards/schema";

const COLOR_ORDER: Color[] = ["W", "U", "B", "R", "G"];
const COLOR_LABEL: Record<Color, string> = {
  W: "White",
  U: "Blue",
  B: "Black",
  R: "Red",
  G: "Green",
};
const COLOR_BAR: Record<Color, string> = {
  W: "bg-amber-300",
  U: "bg-sky-400",
  B: "bg-zinc-700",
  R: "bg-rose-400",
  G: "bg-emerald-500",
};

const TYPE_ORDER: CardType[] = [
  "creature",
  "instant",
  "sorcery",
  "enchantment",
  "artifact",
  "land",
];
const TYPE_LABEL: Record<CardType, string> = {
  creature: "Creature",
  instant: "Instant",
  sorcery: "Sorcery",
  enchantment: "Enchantment",
  artifact: "Artifact",
  land: "Land",
};

const CURVE_BUCKETS = [0, 1, 2, 3, 4, 5, 6] as const;
type CurveBucket = (typeof CURVE_BUCKETS)[number];

/**
 * Compact stats panel: mana curve, type breakdown, color breakdown.
 * Drop in next to the picked-pool / deck list in draft and deckbuild.
 *
 * `cards` is the current deck or picked pool (no basics — those come via `basics`).
 * Multicolor cards count toward each of their colors.
 */
export function DeckStats({
  cards,
  basics,
  title = "Stats",
  emptyHint = "no cards yet.",
}: {
  cards: DraftCard[];
  basics?: BasicLandCounts;
  title?: string;
  emptyHint?: string;
}) {
  const totalCards =
    cards.length + (basics ? sumBasics(basics) : 0);

  if (totalCards === 0) {
    return (
      <section className="rounded border border-zinc-200 p-3 dark:border-zinc-800">
        <h2 className="text-xs uppercase tracking-wide text-zinc-500">
          {title}
        </h2>
        <p className="py-3 text-center text-xs text-zinc-500">{emptyHint}</p>
      </section>
    );
  }

  const curve = computeCurve(cards);
  const types = computeTypes(cards, basics);
  const colors = computeColors(cards, basics);

  return (
    <section className="rounded border border-zinc-200 p-3 dark:border-zinc-800">
      <h2 className="mb-2 text-xs uppercase tracking-wide text-zinc-500">
        {title}
        <span className="ml-2 font-mono normal-case text-zinc-400">
          {totalCards} cards
        </span>
      </h2>
      <div className="grid gap-4 md:grid-cols-3">
        <ManaCurve curve={curve} />
        <TypeBreakdown types={types} total={totalCards} />
        <ColorBreakdown
          colors={colors}
          total={totalCards}
        />
      </div>
    </section>
  );
}

function ManaCurve({ curve }: { curve: Record<CurveBucket, number> }) {
  const max = Math.max(1, ...Object.values(curve));
  // Each unit gets a fixed pixel height so the bar visibly grows per card.
  // Cap at 22px per card so a single tall bucket doesn't dwarf everything else.
  const PER_CARD = Math.max(8, Math.min(22, Math.floor(140 / max)));
  return (
    <div>
      <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
        mana curve (non-land)
      </h3>
      <div className="flex items-end gap-2">
        {CURVE_BUCKETS.map((cmc) => {
          const v = curve[cmc];
          const barHeight = v * PER_CARD;
          const isEmpty = v === 0;
          return (
            <div
              key={cmc}
              className="flex flex-1 flex-col items-stretch gap-1"
              title={`CMC ${cmc === 6 ? "6+" : cmc}: ${v} card${v === 1 ? "" : "s"}`}
            >
              <span
                className={`text-center font-mono text-xs font-semibold ${
                  isEmpty ? "text-zinc-400" : "text-emerald-600 dark:text-emerald-400"
                }`}
              >
                {v}
              </span>
              <div className="relative flex h-[140px] items-end">
                {isEmpty ? (
                  <div className="h-1 w-full rounded bg-zinc-200 dark:bg-zinc-800" />
                ) : (
                  <div
                    className="flex w-full flex-col-reverse gap-px overflow-hidden rounded-t border border-emerald-700/60 bg-emerald-600 dark:border-emerald-300/40 dark:bg-emerald-500"
                    style={{ height: `${barHeight}px` }}
                  >
                    {/* Subtle striping so each card in the bar is countable. */}
                    {Array.from({ length: v }).map((_, i) => (
                      <div
                        key={i}
                        className="w-full bg-white/15"
                        style={{ height: `${PER_CARD - 1}px`, minHeight: 1 }}
                      />
                    ))}
                  </div>
                )}
              </div>
              <span
                className={`text-center font-mono text-[11px] ${
                  isEmpty ? "text-zinc-400" : "text-zinc-700 dark:text-zinc-200"
                }`}
              >
                {cmc === 6 ? "6+" : cmc}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TypeBreakdown({
  types,
  total,
}: {
  types: Record<CardType, number>;
  total: number;
}) {
  return (
    <div>
      <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
        card types
      </h3>
      <ul className="space-y-1">
        {TYPE_ORDER.map((t) => {
          const v = types[t];
          if (v === 0) return null;
          const pct = total > 0 ? (v / total) * 100 : 0;
          return (
            <li key={t} className="flex items-center gap-2 text-xs">
              <span className="w-20 text-zinc-600 dark:text-zinc-300">
                {TYPE_LABEL[t]}
              </span>
              <div className="relative h-2 flex-1 overflow-hidden rounded bg-zinc-200 dark:bg-zinc-800">
                <div
                  className="h-full bg-zinc-500 dark:bg-zinc-400"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span className="w-6 text-right font-mono text-zinc-500">
                {v}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ColorBreakdown({
  colors,
  total,
}: {
  colors: { byColor: Record<Color, number>; colorless: number };
  total: number;
}) {
  return (
    <div>
      <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
        color identity
      </h3>
      <ul className="space-y-1">
        {COLOR_ORDER.map((c) => {
          const v = colors.byColor[c];
          if (v === 0) return null;
          const pct = total > 0 ? (v / total) * 100 : 0;
          return (
            <li key={c} className="flex items-center gap-2 text-xs">
              <span className="w-14 text-zinc-600 dark:text-zinc-300">
                {COLOR_LABEL[c]}
              </span>
              <div className="relative h-2 flex-1 overflow-hidden rounded bg-zinc-200 dark:bg-zinc-800">
                <div
                  className={`h-full ${COLOR_BAR[c]}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span className="w-6 text-right font-mono text-zinc-500">
                {v}
              </span>
            </li>
          );
        })}
        {colors.colorless > 0 ? (
          <li className="flex items-center gap-2 text-xs">
            <span className="w-14 text-zinc-600 dark:text-zinc-300">
              Colorless
            </span>
            <div className="relative h-2 flex-1 overflow-hidden rounded bg-zinc-200 dark:bg-zinc-800">
              <div
                className="h-full bg-zinc-400"
                style={{
                  width: `${
                    total > 0 ? (colors.colorless / total) * 100 : 0
                  }%`,
                }}
              />
            </div>
            <span className="w-6 text-right font-mono text-zinc-500">
              {colors.colorless}
            </span>
          </li>
        ) : null}
      </ul>
      <p className="mt-2 text-[10px] text-zinc-500">
        Multicolor cards count toward each color.
      </p>
    </div>
  );
}

function computeCurve(cards: DraftCard[]): Record<CurveBucket, number> {
  const out: Record<CurveBucket, number> = {
    0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0,
  };
  for (const c of cards) {
    if (c.type === "land") continue;
    const cmc = c.manaCost ? totalManaCost(c.manaCost) : 0;
    const bucket: CurveBucket = (cmc >= 6 ? 6 : cmc) as CurveBucket;
    out[bucket] += 1;
  }
  return out;
}

function computeTypes(
  cards: DraftCard[],
  basics?: BasicLandCounts,
): Record<CardType, number> {
  const out: Record<CardType, number> = {
    creature: 0,
    instant: 0,
    sorcery: 0,
    enchantment: 0,
    artifact: 0,
    land: 0,
  };
  for (const c of cards) out[c.type] += 1;
  if (basics) out.land += sumBasics(basics);
  return out;
}

function computeColors(
  cards: DraftCard[],
  basics?: BasicLandCounts,
): { byColor: Record<Color, number>; colorless: number } {
  const byColor: Record<Color, number> = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  let colorless = 0;
  for (const c of cards) {
    if (c.colors.length === 0) {
      colorless += 1;
    } else {
      for (const col of c.colors) byColor[col] += 1;
    }
  }
  if (basics) {
    for (const col of COLOR_ORDER) byColor[col] += basics[col];
  }
  return { byColor, colorless };
}

function sumBasics(b: BasicLandCounts): number {
  return b.W + b.U + b.B + b.R + b.G;
}
