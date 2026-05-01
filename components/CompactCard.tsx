import type { Color, DraftCard } from "@/lib/cards/schema";

const COLOR_BG: Record<Color, string> = {
  W: "from-amber-50 to-amber-200",
  U: "from-sky-100 to-sky-300",
  B: "from-zinc-300 to-zinc-600",
  R: "from-rose-100 to-rose-400",
  G: "from-emerald-100 to-emerald-400",
};

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
}: {
  card: DraftCard;
  tapped?: boolean;
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
      className={`${dims} relative flex shrink-0 transform-gpu flex-col rounded bg-white p-1 text-left text-zinc-900 shadow-sm transition dark:bg-zinc-900 dark:text-zinc-100 ${
        highlight
          ? "ring-2 ring-emerald-500"
          : "ring-1 ring-black/10"
      } ${
        tapped ? "rotate-90" : ""
      } ${onClick ? "hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-emerald-500" : ""} ${className}`}
      title={card.name}
    >
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
      {card.artUrl ? (
        <div className="mt-1 flex flex-1 overflow-hidden rounded bg-zinc-100 dark:bg-zinc-800">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={card.artUrl}
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
      {card.type === "creature" &&
      card.power !== undefined &&
      card.toughness !== undefined ? (
        <div className="mt-1 self-end rounded bg-zinc-900 px-1 font-mono text-[10px] text-white dark:bg-zinc-100 dark:text-zinc-900">
          {card.power}/{card.toughness}
        </div>
      ) : null}
    </Wrapper>
  );
}
