"use client";

import { counterDelta } from "@/lib/lobby/protocol";
import type { Color, DraftCard } from "@/lib/cards/schema";
import { useCardArt } from "@/lib/artCache";

const COLOR_BG: Record<Color, string> = {
  W: "from-amber-50 to-amber-200",
  U: "from-sky-100 to-sky-300",
  B: "from-zinc-300 to-zinc-600",
  R: "from-rose-100 to-rose-400",
  G: "from-emerald-100 to-emerald-400",
};

const FRAME_BG: Record<Color, { from: string; to: string }> = {
  W: { from: "from-yellow-100/70 dark:from-yellow-200/15", to: "to-amber-200/60 dark:to-amber-300/10" },
  U: { from: "from-sky-200/70 dark:from-sky-400/20", to: "to-sky-400/60 dark:to-blue-600/15" },
  B: { from: "from-zinc-400/70 dark:from-zinc-500/30", to: "to-zinc-600/70 dark:to-zinc-800/40" },
  R: { from: "from-rose-200/70 dark:from-rose-400/20", to: "to-red-400/60 dark:to-red-600/15" },
  G: { from: "from-emerald-200/70 dark:from-emerald-400/20", to: "to-green-400/60 dark:to-green-600/15" },
};

function frameClasses(card: DraftCard): string {
  if (card.type === "land" && card.colors.length === 0) {
    return "from-amber-300/50 to-stone-400/60 dark:from-amber-700/15 dark:to-stone-700/20";
  }
  if (card.colors.length === 0) {
    return "from-zinc-200/60 to-zinc-300/60 dark:from-zinc-600/15 dark:to-zinc-700/15";
  }
  if (card.colors.length === 1) {
    const f = FRAME_BG[card.colors[0]];
    return `${f.from} ${f.to}`;
  }
  const a = FRAME_BG[card.colors[0]];
  const b = FRAME_BG[card.colors[card.colors.length - 1]];
  return `${a.from} ${b.to}`;
}

/**
 * A small card preview used for opponent battlefields and pile peeks.
 * Shows name, color tint, and tapped state (rotated 90°).
 */
export function CompactCard({
  card,
  tapped = false,
  onClick,
  onMenu,
  onContextMenu,
  size = "sm",
  className = "",
  style,
  draggable,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
  highlight,
  casterDotClass,
  casterDotLabel,
  counters,
}: {
  card: DraftCard;
  tapped?: boolean;
  /** Counter pile for this battlefield card; modifies P/T and renders chips. */
  counters?: Record<string, number>;
  onClick?: () => void;
  /** When set, renders a small ⋮ icon in the corner that opens secondary actions. */
  onMenu?: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  size?: "xs" | "sm" | "md";
  className?: string;
  style?: React.CSSProperties;
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  onDragEnd?: (e: React.DragEvent) => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent) => void;
  /** When true, draws an emerald drop-target ring (e.g., valid attach target). */
  highlight?: boolean;
  /**
   * Optional small dot in the top-left corner identifying the card's caster.
   * Used in 2HG to distinguish your cards from your teammate's on a shared
   * battlefield. Pass any Tailwind bg-color class string.
   */
  casterDotClass?: string;
  /** Tooltip for the caster dot. */
  casterDotLabel?: string;
}) {
  const dims =
    size === "xs"
      ? "w-20 h-28"
      : size === "sm"
        ? "w-28 h-40"
        : "w-36 h-52";
  const gradient =
    card.colors.length === 0
      ? "from-zinc-200 to-zinc-400 dark:from-zinc-700 dark:to-zinc-900"
      : card.colors.length === 1
        ? COLOR_BG[card.colors[0]]
        : `${COLOR_BG[card.colors[0]].split(" ")[0]} ${
            COLOR_BG[card.colors[card.colors.length - 1]].split(" ")[1]
          }`;

  // Lazy-load art when the card came from the cross-set library (no baked
  // artUrl, but has setCode + collectorNumber for lookup).
  const lazyArt = useCardArt(
    card.setCode,
    card.collectorNumber,
    !!card.artUrl,
  );
  const artUrl = card.artUrl ?? lazyArt;

  const initials = card.name
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");

  const Wrapper = onClick ? "button" : "div";

  return (
    <Wrapper
      onClick={onClick}
      onContextMenu={onContextMenu}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDrop={onDrop}
      style={style}
      className={`${dims} relative flex shrink-0 transform-gpu flex-col rounded bg-white bg-gradient-to-br p-1 text-left text-zinc-900 shadow-sm transition dark:bg-zinc-900 dark:text-zinc-100 ${frameClasses(card)} ${
        highlight
          ? "ring-2 ring-emerald-500"
          : "ring-1 ring-black/10"
      } ${
        tapped ? "rotate-90" : ""
      } ${onClick ? "hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-emerald-500" : ""} ${className}`}
      title={card.name}
    >
      {casterDotClass ? (
        <span
          aria-label={casterDotLabel}
          title={casterDotLabel}
          className={`pointer-events-none absolute left-0.5 top-0.5 z-10 h-2 w-2 rounded-full ring-1 ring-white/70 dark:ring-black/40 ${casterDotClass}`}
        />
      ) : null}
      {onMenu ? (
        <span
          role="button"
          tabIndex={0}
          aria-label="card actions"
          onClick={(e) => {
            e.stopPropagation();
            onMenu();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              e.stopPropagation();
              onMenu();
            }
          }}
          className="absolute right-0.5 top-0.5 z-10 flex h-5 w-5 items-center justify-center rounded-full bg-black/40 text-xs font-bold leading-none text-white opacity-60 transition-opacity hover:bg-black/70 hover:opacity-100 focus:opacity-100 focus:outline-none focus:ring-1 focus:ring-white"
        >
          ⋮
        </span>
      ) : null}
      <div className="truncate text-[11px] font-semibold leading-tight">
        {card.name}
      </div>
      {artUrl ? (
        <div className="mt-1 flex flex-1 overflow-hidden rounded bg-zinc-100 dark:bg-zinc-800">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={artUrl}
            alt={card.name}
            loading="lazy"
            className="h-full w-full object-cover"
          />
        </div>
      ) : (
        <div
          className={`mt-1 flex flex-1 items-center justify-center rounded bg-gradient-to-br ${gradient}`}
        >
          <span className="font-serif text-lg tracking-wider text-black/20 dark:text-white/20">
            {initials}
          </span>
        </div>
      )}
      {(() => {
        if (
          card.type !== "creature" ||
          card.power === undefined ||
          card.toughness === undefined
        ) {
          return null;
        }
        const d = counterDelta(counters);
        const modified = d.power !== 0 || d.toughness !== 0;
        return (
          <div
            className={`mt-1 self-end rounded px-1 font-mono text-[10px] ${
              modified
                ? d.power > 0
                  ? "bg-emerald-600 text-white"
                  : "bg-rose-700 text-white"
                : "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
            }`}
            title={
              modified
                ? `Base ${card.power}/${card.toughness}, modified by counters`
                : undefined
            }
          >
            {card.power + d.power}/{card.toughness + d.toughness}
          </div>
        );
      })()}
      {counters && Object.keys(counters).length > 0 ? (
        <div className="pointer-events-none absolute bottom-0.5 left-0.5 flex max-w-[80%] flex-wrap gap-0.5">
          {Object.entries(counters).map(([kind, n]) => (
            <span
              key={kind}
              className={`rounded px-1 text-[9px] font-bold leading-tight shadow-sm ring-1 ring-black/20 ${counterChipClass(kind)}`}
              title={`${n} ${kind} counter${n === 1 ? "" : "s"}`}
            >
              {kind === "+1/+1"
                ? `+${n}/+${n}`
                : kind === "-1/-1"
                  ? `-${n}/-${n}`
                  : `${kind} ${n}`}
            </span>
          ))}
        </div>
      ) : null}
    </Wrapper>
  );
}

function counterChipClass(kind: string): string {
  if (kind === "+1/+1") return "bg-emerald-500 text-white";
  if (kind === "-1/-1") return "bg-rose-600 text-white";
  if (kind === "loyalty") return "bg-violet-500 text-white";
  if (kind === "charge") return "bg-amber-500 text-white";
  return "bg-zinc-700 text-white";
}
