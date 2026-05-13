"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useCardArt } from "@/lib/artCache";
import type { Card, CardType, Color } from "@/lib/cards/schema";

const COLORS: Color[] = ["W", "U", "B", "R", "G"];
const COLOR_LABEL: Record<Color, string> = {
  W: "White",
  U: "Blue",
  B: "Black",
  R: "Red",
  G: "Green",
};
const TYPES: CardType[] = [
  "creature",
  "instant",
  "sorcery",
  "enchantment",
  "artifact",
  "land",
];

const PAGE_SIZE = 200;

function manaSymbolUrl(symbol: string): string {
  return `https://svgs.scryfall.io/card-symbols/${symbol}.svg`;
}

function symbolFile(inner: string): string {
  return inner.replace(/\//g, "");
}

/** Parse the card's manaCost object back into the icon list shown in rows. */
function manaPipsForRow(card: Card): { file: string; raw: string }[] {
  const cost = card.manaCost;
  if (!cost) return [];
  const out: { file: string; raw: string }[] = [];
  for (let i = 0; i < (cost.variable ?? 0); i++) {
    out.push({ file: "X", raw: "{X}" });
  }
  if (cost.generic > 0) {
    out.push({ file: String(cost.generic), raw: `{${cost.generic}}` });
  }
  for (const c of COLORS) {
    for (let i = 0; i < cost[c]; i++) out.push({ file: c, raw: `{${c}}` });
  }
  return out;
}

function totalManaCost(card: Card): number {
  const c = card.manaCost;
  if (!c) return 0;
  return c.generic + c.W + c.U + c.B + c.R + c.G;
}

function cardMatchesColors(card: Card, picked: Set<Color>): boolean {
  if (picked.size === 0) return true;
  // "Colorless" handled separately by checking card.colors.length === 0.
  // Here we keep it as: card must have at least one of the picked colors,
  // AND no colors outside the picked set (within-colors filter, like Scryfall's c<= behavior).
  if (card.colors.length === 0) return picked.has("C" as Color); // never true; explicit colorless toggle handled in caller
  for (const c of card.colors) if (!picked.has(c)) return false;
  return card.colors.some((c) => picked.has(c));
}

export function CardBrowser({
  library,
  deckCounts,
  onAdd,
  onClose,
}: {
  library: Card[];
  /** Lookup of how many of each card name are currently in the decklist. */
  deckCounts: Map<string, number>;
  onAdd: (cardName: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [pickedColors, setPickedColors] = useState<Set<Color>>(new Set());
  const [includeColorless, setIncludeColorless] = useState(false);
  const [pickedTypes, setPickedTypes] = useState<Set<CardType>>(new Set());
  const [revealed, setRevealed] = useState<string | null>(null);
  const [justAddedId, setJustAddedId] = useState<string | null>(null);

  function handleAdd(card: Card) {
    onAdd(card.name);
    // Pulse the row for ~500ms; clearing prior timer if user adds rapidly.
    setJustAddedId(card.id);
  }
  // Auto-clear the pulse a moment after the most recent add.
  useEffect(() => {
    if (!justAddedId) return;
    const t = setTimeout(() => setJustAddedId(null), 500);
    return () => clearTimeout(t);
  }, [justAddedId]);

  // Close on escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const result: Card[] = [];
    for (const c of library) {
      if (q && !c.name.toLowerCase().includes(q)) continue;
      if (pickedTypes.size > 0 && !pickedTypes.has(c.type)) continue;

      // Color filter:
      // - If user has chosen any colors, the card must fit within those colors
      //   (or be colorless if "include colorless" is on).
      // - If no colors chosen, everything passes.
      if (pickedColors.size > 0 || includeColorless) {
        const isColorless = c.colors.length === 0;
        if (isColorless) {
          if (!includeColorless) continue;
        } else if (pickedColors.size === 0) {
          // user only checked colorless — exclude colored cards
          continue;
        } else {
          // card must be a subset of pickedColors
          let ok = true;
          for (const cc of c.colors) {
            if (!pickedColors.has(cc)) {
              ok = false;
              break;
            }
          }
          if (!ok) continue;
        }
      }

      result.push(c);
    }
    return result;
  }, [library, query, pickedTypes, pickedColors, includeColorless]);

  // Reset visible count when filters change.
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [query, pickedTypes, pickedColors, includeColorless]);

  const hasMore = visibleCount < filtered.length;
  const visible = filtered.slice(0, visibleCount);

  // IntersectionObserver: load more when sentinel scrolls into view.
  const loadMore = useCallback(() => {
    setVisibleCount((prev) => Math.min(prev + PAGE_SIZE, filtered.length));
  }, [filtered.length]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) loadMore();
      },
      { rootMargin: "200px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [loadMore]);

  function toggleColor(c: Color) {
    setPickedColors((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next;
    });
  }

  function toggleType(t: CardType) {
    setPickedTypes((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });
  }

  function clearFilters() {
    setQuery("");
    setPickedColors(new Set());
    setIncludeColorless(false);
    setPickedTypes(new Set());
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="flex h-full w-full max-w-4xl flex-col overflow-hidden rounded-lg bg-white shadow-2xl dark:bg-zinc-900"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <div>
            <h2 className="text-base font-semibold">Browse cards</h2>
            <p className="text-xs text-zinc-500">
              {library.length.toLocaleString()} unique cards · click + to add to
              your deck
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded px-3 py-1 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            done
          </button>
        </header>

        <div className="space-y-2 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name…"
            autoFocus
            className="w-full rounded border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800"
          />
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-zinc-500">Colors:</span>
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => toggleColor(c)}
                className={`flex items-center gap-1 rounded border px-2 py-0.5 ${
                  pickedColors.has(c)
                    ? "border-emerald-500 bg-emerald-500/15"
                    : "border-zinc-300 dark:border-zinc-700"
                }`}
                title={COLOR_LABEL[c]}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={manaSymbolUrl(c)}
                  alt={c}
                  className="h-4 w-4"
                  loading="lazy"
                />
                {COLOR_LABEL[c]}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setIncludeColorless((x) => !x)}
              className={`rounded border px-2 py-0.5 ${
                includeColorless
                  ? "border-emerald-500 bg-emerald-500/15"
                  : "border-zinc-300 dark:border-zinc-700"
              }`}
            >
              Colorless
            </button>
            <span className="ml-3 text-zinc-500">Types:</span>
            {TYPES.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => toggleType(t)}
                className={`rounded border px-2 py-0.5 capitalize ${
                  pickedTypes.has(t)
                    ? "border-emerald-500 bg-emerald-500/15"
                    : "border-zinc-300 dark:border-zinc-700"
                }`}
              >
                {t}
              </button>
            ))}
            <button
              type="button"
              onClick={clearFilters}
              className="ml-auto text-zinc-500 underline-offset-2 hover:underline"
            >
              clear
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {visible.length === 0 ? (
            <p className="p-8 text-center text-sm text-zinc-500">
              No cards match. Try loosening filters.
            </p>
          ) : (
            <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {visible.map((c) => (
                <CardRow
                  key={c.id}
                  card={c}
                  revealed={revealed === c.id}
                  count={deckCounts.get(c.name.toLowerCase()) ?? 0}
                  pulse={justAddedId === c.id}
                  onReveal={() =>
                    setRevealed((cur) => (cur === c.id ? null : c.id))
                  }
                  onAdd={() => handleAdd(c)}
                />
              ))}
            </ul>
          )}
          {hasMore ? (
            <div
              ref={sentinelRef}
              className="border-t border-zinc-200 p-3 text-center text-xs text-zinc-500 dark:border-zinc-800"
            >
              Showing {visible.length} of {filtered.length} matches — scroll for
              more
            </div>
          ) : filtered.length > 0 ? (
            <p className="border-t border-zinc-200 p-3 text-center text-xs text-zinc-500 dark:border-zinc-800">
              {filtered.length} card{filtered.length !== 1 ? "s" : ""} shown
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function CardRow({
  card,
  revealed,
  count,
  pulse,
  onReveal,
  onAdd,
}: {
  card: Card;
  revealed: boolean;
  count: number;
  pulse: boolean;
  onReveal: () => void;
  onAdd: () => void;
}) {
  const pips = manaPipsForRow(card);
  const cmc = totalManaCost(card);
  return (
    <li className="flex flex-col">
      <div
        className={`flex items-center gap-3 px-4 py-2 transition-colors duration-500 ${
          pulse
            ? "bg-emerald-100 dark:bg-emerald-900/40"
            : count > 0
              ? "bg-emerald-50/50 dark:bg-emerald-950/20"
              : ""
        }`}
      >
        <button
          type="button"
          onClick={onReveal}
          className="min-w-0 flex-1 truncate text-left text-sm hover:underline"
          title="Show art"
        >
          {card.name}
        </button>
        <div className="flex shrink-0 items-center gap-0.5">
          {pips.map((p, i) => (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              key={i}
              src={manaSymbolUrl(p.file)}
              alt={p.raw}
              className="h-4 w-4"
              loading="lazy"
            />
          ))}
        </div>
        <span className="shrink-0 text-xs capitalize text-zinc-500">
          {card.subtype ?? card.type}
        </span>
        {card.type === "creature" &&
        card.power !== undefined &&
        card.toughness !== undefined ? (
          <span className="shrink-0 font-mono text-xs text-zinc-500">
            {card.power}/{card.toughness}
          </span>
        ) : (
          <span className="shrink-0 font-mono text-xs text-zinc-400">
            cmc {cmc}
          </span>
        )}
        {count > 0 ? (
          <span
            className={`shrink-0 rounded-full px-2 py-0.5 font-mono text-xs font-bold transition-transform ${
              pulse
                ? "scale-125 bg-emerald-500 text-white"
                : "bg-emerald-200 text-emerald-900 dark:bg-emerald-800 dark:text-emerald-100"
            }`}
            title={`${count} in deck`}
          >
            ×{count}
          </span>
        ) : null}
        <button
          type="button"
          onClick={onAdd}
          className={`ml-1 shrink-0 rounded px-2 py-1 text-xs font-semibold text-white transition ${
            pulse
              ? "scale-95 bg-emerald-500"
              : "bg-emerald-600 hover:bg-emerald-700"
          }`}
          title={`Add 1 ${card.name} to deck`}
        >
          + add
        </button>
      </div>
      {revealed ? (
        <div className="flex gap-3 border-t border-zinc-100 bg-zinc-50 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-950/50">
          <RevealedArt card={card} />
          <div className="min-w-0 flex-1 space-y-1 text-xs leading-snug">
            <p className="whitespace-pre-line">{card.text}</p>
            {card.flavor ? (
              <p className="italic text-zinc-500">{card.flavor}</p>
            ) : null}
          </div>
        </div>
      ) : null}
    </li>
  );
}

/**
 * Renders the card art when a row is expanded. Uses the lazy art cache so
 * the cross-set library (which omits artUrls to keep the build fast) gets
 * its art fetched on demand. The placeholder reads "loading" when we have
 * a lookup key (setCode + collectorNumber); "no art available" is reserved
 * for cards we genuinely can't look up (LLM-generated, custom).
 */
function RevealedArt({ card }: { card: Card }) {
  const lazyArt = useCardArt(
    card.setCode,
    card.collectorNumber,
    !!card.artUrl,
  );
  const artUrl = card.artUrl ?? lazyArt;
  const lookupable = !!card.setCode && !!card.collectorNumber;
  if (artUrl) {
    return (
      /* eslint-disable-next-line @next/next/no-img-element */
      <img
        src={artUrl}
        alt={card.name}
        loading="lazy"
        className="h-32 w-auto rounded shadow"
      />
    );
  }
  return (
    <div className="grid h-32 w-44 place-items-center rounded bg-zinc-200 text-xs text-zinc-500 dark:bg-zinc-800">
      {lookupable ? "loading art…" : "no art available"}
    </div>
  );
}
