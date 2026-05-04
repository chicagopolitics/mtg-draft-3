"use client";

import { useLayoutEffect, useRef, useState } from "react";

import type { Card, Color, ManaCost, Rarity } from "@/lib/cards/schema";

const COLOR_TOKEN: Record<Color, { bg: string; pip: string; label: string }> = {
  W: { bg: "from-amber-50 to-amber-200", pip: "bg-amber-100 text-amber-900", label: "W" },
  U: { bg: "from-sky-100 to-sky-300", pip: "bg-sky-100 text-sky-900", label: "U" },
  B: { bg: "from-zinc-300 to-zinc-600", pip: "bg-zinc-800 text-zinc-100", label: "B" },
  R: { bg: "from-rose-100 to-rose-400", pip: "bg-rose-200 text-rose-900", label: "R" },
  G: { bg: "from-emerald-100 to-emerald-400", pip: "bg-emerald-200 text-emerald-900", label: "G" },
};

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

function ManaPips({ cost }: { cost: ManaCost }) {
  const pips: { kind: Color | "generic"; count: number }[] = [
    { kind: "generic", count: cost.generic },
    { kind: "W", count: cost.W },
    { kind: "U", count: cost.U },
    { kind: "B", count: cost.B },
    { kind: "R", count: cost.R },
    { kind: "G", count: cost.G },
  ];

  const elements: React.ReactNode[] = [];

  if (cost.generic > 0) {
    elements.push(
      <span
        key="generic"
        className="flex h-5 w-5 items-center justify-center rounded-full bg-zinc-200 text-xs font-semibold text-zinc-800 ring-1 ring-zinc-400"
      >
        {cost.generic}
      </span>,
    );
  }

  for (const { kind, count } of pips) {
    if (kind === "generic") continue;
    for (let i = 0; i < count; i++) {
      const tok = COLOR_TOKEN[kind];
      elements.push(
        <span
          key={`${kind}-${i}`}
          className={`flex h-5 w-5 items-center justify-center rounded-full text-xs font-semibold ring-1 ring-black/10 ${tok.pip}`}
        >
          {tok.label}
        </span>,
      );
    }
  }

  return <div className="flex shrink-0 items-center gap-1">{elements}</div>;
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

/**
 * Shrinks rules + flavor font size until it fits, down to TEXT_MIN_PX. If it
 * still overflows at the minimum size, truncates the rules text with "…" so
 * nothing escapes the card boundary.
 */
function FitText({ text, flavor }: { text: string; flavor?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [px, setPx] = useState(TEXT_MAX_PX);
  const [clipped, setClipped] = useState(text);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const inner = innerRef.current;
    if (!container || !inner) return;

    const rulesEl = inner.querySelector<HTMLElement>("[data-rules]");
    if (!rulesEl) return;

    // Reset to full text for measurement.
    rulesEl.textContent = text;

    // Step 1: shrink font size until it fits or we hit min.
    let size = TEXT_MAX_PX;
    inner.style.fontSize = `${size}px`;
    while (size > TEXT_MIN_PX && inner.scrollHeight > container.clientHeight) {
      size -= 0.5;
      inner.style.fontSize = `${size}px`;
    }
    setPx(size);

    // Step 2: if still overflowing at min size, binary-search a truncation.
    if (inner.scrollHeight > container.clientHeight) {
      let lo = 0;
      let hi = text.length;
      while (lo < hi) {
        const mid = Math.floor((lo + hi + 1) / 2);
        rulesEl.textContent = text.slice(0, mid).trimEnd() + "…";
        if (inner.scrollHeight <= container.clientHeight) {
          lo = mid;
        } else {
          hi = mid - 1;
        }
      }
      const best = text.slice(0, lo).trimEnd() + "…";
      rulesEl.textContent = best;
      setClipped(best);
    } else {
      setClipped(text);
    }
  }, [text, flavor]);

  return (
    <div ref={containerRef} className="min-h-0 flex-1 overflow-hidden">
      <div
        ref={innerRef}
        style={{ fontSize: `${px}px`, lineHeight: 1.25 }}
      >
        <p data-rules>{clipped}</p>
        {flavor ? (
          <p className="mt-1 italic text-zinc-500 dark:text-zinc-400">
            {flavor}
          </p>
        ) : null}
      </div>
    </div>
  );
}

export function CardView({ card }: { card: Card }) {
  return (
    <article
      className={`flex h-[22rem] w-60 flex-col gap-2 rounded-lg bg-white p-3 text-zinc-900 shadow-sm ring-2 dark:bg-zinc-900 dark:text-zinc-100 ${RARITY_RING[card.rarity]}`}
    >
      <header className="flex shrink-0 items-center gap-2">
        <h3 className="min-w-0 flex-1 truncate text-sm font-semibold leading-tight">
          {card.name}
        </h3>
        {card.manaCost ? <ManaPips cost={card.manaCost} /> : null}
      </header>

      <ArtPlaceholder card={card} />

      <div className="flex shrink-0 items-center justify-between text-xs">
        <span className="truncate text-zinc-700 dark:text-zinc-300">
          {card.subtype ?? cardTypeLabel(card.type)}
        </span>
        <span
          className={`shrink-0 font-mono font-semibold ${RARITY_LABEL_COLOR[card.rarity]}`}
          title={card.rarity}
        >
          {RARITY_LABEL[card.rarity]}
        </span>
      </div>

      <div className="flex min-h-0 flex-1 flex-col rounded bg-zinc-50 p-2 leading-snug dark:bg-zinc-800/50">
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
