"use client";

import { Fragment, useLayoutEffect, useMemo, useRef, useState } from "react";

import type { Card, Color, ManaCost, Rarity } from "@/lib/cards/schema";

const COLOR_TOKEN: Record<Color, { bg: string; pip: string; label: string }> = {
  W: { bg: "from-amber-50 to-amber-200", pip: "bg-amber-100 text-amber-900", label: "W" },
  U: { bg: "from-sky-100 to-sky-300", pip: "bg-sky-100 text-sky-900", label: "U" },
  B: { bg: "from-zinc-300 to-zinc-600", pip: "bg-zinc-800 text-zinc-100", label: "B" },
  R: { bg: "from-rose-100 to-rose-400", pip: "bg-rose-200 text-rose-900", label: "R" },
  G: { bg: "from-emerald-100 to-emerald-400", pip: "bg-emerald-200 text-emerald-900", label: "G" },
};

/**
 * Color tint overlaid on top of a neutral base. We keep opacity low so the
 * underlying white/dark base shows through — that way "white" reads as cream,
 * not brown, and dark mode stays atmospheric instead of muddy.
 */
const CARD_FRAME: Record<Color, { from: string; to: string }> = {
  // White: warm parchment / pale gold
  W: {
    from: "from-yellow-100/70 dark:from-yellow-200/15",
    to: "to-amber-200/60 dark:to-amber-300/10",
  },
  // Blue: clear sky / deep ocean
  U: {
    from: "from-sky-200/70 dark:from-sky-400/20",
    to: "to-sky-400/60 dark:to-blue-600/15",
  },
  // Black: smoky charcoal
  B: {
    from: "from-zinc-400/70 dark:from-zinc-500/30",
    to: "to-zinc-600/70 dark:to-zinc-800/40",
  },
  // Red: ember / lava
  R: {
    from: "from-rose-200/70 dark:from-rose-400/20",
    to: "to-red-400/60 dark:to-red-600/15",
  },
  // Green: leaf / forest
  G: {
    from: "from-emerald-200/70 dark:from-emerald-400/20",
    to: "to-green-400/60 dark:to-green-600/15",
  },
};

const COLORLESS_FRAME =
  "from-zinc-200/60 to-zinc-300/60 dark:from-zinc-600/15 dark:to-zinc-700/15";

const LAND_FRAME =
  "from-amber-300/50 to-stone-400/60 dark:from-amber-700/15 dark:to-stone-700/20";

/**
 * Returns Tailwind gradient classes that tint the card frame by its color identity.
 * - Single color: solid color gradient
 * - Multicolor: gradient between first and last color (gold-ish blend)
 * - Colorless / artifacts: neutral steel
 * - Lands (no colors): warm stone
 */
function frameGradient(card: Card): string {
  if (card.type === "land" && card.colors.length === 0) return LAND_FRAME;
  if (card.colors.length === 0) return COLORLESS_FRAME;
  if (card.colors.length === 1) {
    const f = CARD_FRAME[card.colors[0]];
    return `${f.from} ${f.to}`;
  }
  const first = CARD_FRAME[card.colors[0]];
  const last = CARD_FRAME[card.colors[card.colors.length - 1]];
  return `${first.from} ${last.to}`;
}

export function cardFrameGradient(card: Card): string {
  return frameGradient(card);
}

const RARITY_RING: Record<Rarity, string> = {
  common: "ring-zinc-400 dark:ring-zinc-600",
  uncommon: "ring-slate-300 dark:ring-slate-400",
  rare: "ring-amber-400 dark:ring-amber-500",
  mythic: "ring-orange-500 dark:ring-orange-400",
};

const RARITY_LABEL: Record<Rarity, string> = {
  common: "C",
  uncommon: "U",
  rare: "R",
  mythic: "M",
};

const RARITY_LABEL_COLOR: Record<Rarity, string> = {
  common: "text-zinc-600",
  uncommon: "text-slate-500",
  rare: "text-amber-600",
  mythic: "text-orange-600",
};

const TEXT_MAX_PX = 12;
const TEXT_MIN_PX = 8;

/**
 * Scryfall hosts the official mana-symbol SVGs at stable URLs. Free to use
 * (per Scryfall API guidelines), no auth required, vector + crisp at any size.
 */
function manaSymbolUrl(symbol: string): string {
  return `https://svgs.scryfall.io/card-symbols/${symbol}.svg`;
}

function ManaSymbol({
  symbol,
  alt,
  title,
}: {
  symbol: string;
  alt: string;
  title?: string;
}) {
  return (
    /* eslint-disable-next-line @next/next/no-img-element */
    <img
      src={manaSymbolUrl(symbol)}
      alt={alt}
      title={title ?? alt}
      width={20}
      height={20}
      loading="lazy"
      className="h-5 w-5 shrink-0 rounded-full shadow-sm ring-1 ring-black/10"
    />
  );
}

const COLOR_NAME: Record<Color, string> = {
  W: "White",
  U: "Blue",
  B: "Black",
  R: "Red",
  G: "Green",
};

function ManaPips({ cost }: { cost: ManaCost }) {
  const elements: React.ReactNode[] = [];

  // {X} first, matching MTG cost ordering: {X}{U}, {X}{X}{R}, etc.
  for (let i = 0; i < (cost.variable ?? 0); i++) {
    elements.push(
      <ManaSymbol key={`x-${i}`} symbol="X" alt="X" title="Variable cost" />,
    );
  }

  if (cost.generic > 0) {
    elements.push(
      <ManaSymbol
        key="generic"
        symbol={String(cost.generic)}
        alt={String(cost.generic)}
        title={`${cost.generic} generic mana`}
      />,
    );
  }

  const colorOrder: Color[] = ["W", "U", "B", "R", "G"];
  for (const c of colorOrder) {
    for (let i = 0; i < cost[c]; i++) {
      elements.push(
        <ManaSymbol
          key={`${c}-${i}`}
          symbol={c}
          alt={c}
          title={COLOR_NAME[c]}
        />,
      );
    }
  }

  return <div className="flex shrink-0 items-center gap-0.5">{elements}</div>;
}

function ArtPlaceholder({ card }: { card: Card }) {
  if (card.artUrl) {
    return (
      <div className="aspect-[4/3] w-full shrink-0 overflow-hidden rounded bg-zinc-100 dark:bg-zinc-800">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={card.artUrl}
          alt={card.name}
          loading="lazy"
          className="h-full w-full object-cover object-top"
        />
      </div>
    );
  }
  let gradient: string;
  if (card.colors.length === 0) {
    gradient = "from-zinc-200 to-zinc-400 dark:from-zinc-700 dark:to-zinc-900";
  } else if (card.colors.length === 1) {
    gradient = COLOR_TOKEN[card.colors[0]].bg;
  } else {
    const a = COLOR_TOKEN[card.colors[0]].bg.split(" ")[0];
    const b = COLOR_TOKEN[card.colors[card.colors.length - 1]].bg.split(" ")[1];
    gradient = `${a} ${b}`;
  }

  return (
    <div
      className={`flex aspect-[4/3] w-full shrink-0 items-center justify-center rounded bg-gradient-to-br ${gradient}`}
    >
      <span className="font-serif text-3xl tracking-wider text-black/20 dark:text-white/20">
        {card.name
          .split(" ")
          .slice(0, 2)
          .map((w) => w[0]?.toUpperCase())
          .join("")}
      </span>
    </div>
  );
}

type RulesToken =
  | { kind: "text"; value: string }
  | { kind: "symbol"; raw: string; file: string };

/** Convert a `{...}` token's inner like "W/U" or "2/W" to Scryfall's filename ("WU", "2W"). */
function symbolFile(inner: string): string {
  return inner.replace(/\//g, "");
}

/** Tokenize MTG rules text, splitting out `{X}`-style symbols from prose. */
function tokenizeRules(text: string): RulesToken[] {
  const out: RulesToken[] = [];
  const re = /\{([^}]+)\}/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) {
      out.push({ kind: "text", value: text.slice(last, m.index) });
    }
    out.push({ kind: "symbol", raw: m[0], file: symbolFile(m[1]) });
    last = re.lastIndex;
  }
  if (last < text.length) out.push({ kind: "text", value: text.slice(last) });
  return out;
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c]!,
  );
}

/** Build an HTML string for a token slice — used only during DOM measurement. */
function tokensToHtml(tokens: RulesToken[]): string {
  return tokens
    .map((t) =>
      t.kind === "text"
        ? escapeHtml(t.value)
        : `<img src="${manaSymbolUrl(t.file)}" alt="${escapeHtml(t.raw)}" class="inline-block align-text-bottom" style="height:1em;width:1em;margin:0 0.05em;" />`,
    )
    .join("");
}

function InlineSymbol({ file, raw }: { file: string; raw: string }) {
  return (
    /* eslint-disable-next-line @next/next/no-img-element */
    <img
      src={manaSymbolUrl(file)}
      alt={raw}
      title={raw}
      className="inline-block align-text-bottom"
      style={{ height: "1em", width: "1em", margin: "0 0.05em" }}
    />
  );
}

/** Builds the HTML used for the off-screen measurement node. */
function buildMeasurementHtml(
  tokens: RulesToken[],
  flavor: string | undefined,
  truncatedSuffix: string,
): string {
  const rules = tokensToHtml(tokens) + truncatedSuffix;
  const flavorPart = flavor
    ? `<p style="margin-top:0.25em;font-style:italic;opacity:0.7">${escapeHtml(flavor)}</p>`
    : "";
  return `<p>${rules}</p>${flavorPart}`;
}

/**
 * Renders MTG rules text with inline mana symbols (parsed from `{X}` tokens),
 * shrinks the font until it fits, then if still overflowing at the minimum
 * size, drops trailing tokens and appends "…".
 *
 * Measurement is done on a separate, React-untouched hidden node — mutating
 * the visible (React-controlled) DOM directly causes reconciliation crashes
 * (Failed to execute 'removeChild' …) when many FitText instances re-render
 * at once, e.g. opening a 90-card sealed pool.
 */
function FitText({ text, flavor }: { text: string; flavor?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const tokens = useMemo(() => tokenizeRules(text), [text]);
  const [px, setPx] = useState(TEXT_MAX_PX);
  const [visibleCount, setVisibleCount] = useState(tokens.length);
  const [truncated, setTruncated] = useState(false);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const measure = measureRef.current;
    if (!container || !measure) return;

    const limit = container.clientHeight;
    if (limit <= 0) return;

    // Step 1: shrink font size until it fits or we hit min.
    let size = TEXT_MAX_PX;
    measure.style.fontSize = `${size}px`;
    measure.innerHTML = buildMeasurementHtml(tokens, flavor, "");
    while (size > TEXT_MIN_PX && measure.scrollHeight > limit) {
      size -= 0.5;
      measure.style.fontSize = `${size}px`;
    }

    // Step 2: if still overflowing at min size, binary-search a token prefix.
    let count = tokens.length;
    let needsTruncate = false;
    if (measure.scrollHeight > limit) {
      needsTruncate = true;
      let lo = 0;
      let hi = tokens.length;
      while (lo < hi) {
        const mid = Math.floor((lo + hi + 1) / 2);
        measure.innerHTML = buildMeasurementHtml(
          tokens.slice(0, mid),
          flavor,
          "…",
        );
        if (measure.scrollHeight <= limit) lo = mid;
        else hi = mid - 1;
      }
      count = lo;
    }

    setPx(size);
    setVisibleCount(count);
    setTruncated(needsTruncate);
  }, [tokens, flavor]);

  return (
    <div
      ref={containerRef}
      className="relative min-h-0 flex-1 overflow-hidden"
    >
      <div style={{ fontSize: `${px}px`, lineHeight: 1.3 }}>
        <p>
          {tokens.slice(0, visibleCount).map((t, i) =>
            t.kind === "text" ? (
              <Fragment key={i}>{t.value}</Fragment>
            ) : (
              <InlineSymbol key={i} file={t.file} raw={t.raw} />
            ),
          )}
          {truncated ? "…" : null}
        </p>
        {flavor ? (
          <p className="mt-1 italic text-zinc-500 dark:text-zinc-400">
            {flavor}
          </p>
        ) : null}
      </div>
      {/*
        Hidden measurement mirror. Has NO React children — innerHTML mutation
        is safe here because React doesn't track anything inside.
      */}
      <div
        ref={measureRef}
        aria-hidden
        className="pointer-events-none invisible absolute left-0 top-0 w-full"
        style={{ lineHeight: 1.3 }}
      />
    </div>
  );
}

export function CardView({ card }: { card: Card }) {
  return (
    <article
      className={`flex h-[22rem] w-60 flex-col gap-2 rounded-lg bg-white bg-gradient-to-br p-3 text-zinc-900 shadow-sm ring-2 dark:bg-zinc-900 dark:text-zinc-100 ${frameGradient(card)} ${RARITY_RING[card.rarity]}`}
    >
      <header className="flex shrink-0 items-center gap-2">
        <h3 className="min-w-0 flex-1 truncate text-sm font-semibold leading-tight">
          {card.name}
        </h3>
        {card.manaCost ? <ManaPips cost={card.manaCost} /> : null}
      </header>

      <ArtPlaceholder card={card} />

      <div className="flex shrink-0 items-center justify-between text-xs">
        <span
          className="truncate text-zinc-700 dark:text-zinc-300"
          title={fullTypeLine(card)}
        >
          {fullTypeLine(card)}
        </span>
        <span
          className={`shrink-0 font-mono font-semibold ${RARITY_LABEL_COLOR[card.rarity]}`}
          title={card.rarity}
        >
          {RARITY_LABEL[card.rarity]}
        </span>
      </div>

      <div className="flex min-h-0 flex-1 flex-col rounded bg-white/85 p-2 leading-snug shadow-inner dark:bg-zinc-900/70">
        <FitText text={card.text} flavor={card.flavor} />
      </div>

      {card.type === "creature" &&
      card.power !== undefined &&
      card.toughness !== undefined ? (
        <div className="shrink-0 self-end rounded bg-zinc-900 px-2 py-0.5 font-mono text-xs text-white dark:bg-zinc-100 dark:text-zinc-900">
          {card.power}/{card.toughness}
        </div>
      ) : null}
    </article>
  );
}

function cardTypeLabel(t: Card["type"]): string {
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/**
 * Returns the canonical type line (e.g., "Artifact Land — Treasure"). Prefers
 * the full `typeLine` from MTGJSON when available; falls back to building one
 * from primary type + subtype for LLM/mock cards.
 */
export function fullTypeLine(card: Card): string {
  if (card.typeLine && card.typeLine.trim()) return card.typeLine;
  const head = cardTypeLabel(card.type);
  return card.subtype ? `${head} — ${card.subtype}` : head;
}
