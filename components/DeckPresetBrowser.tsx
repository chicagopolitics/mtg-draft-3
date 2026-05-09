"use client";

import { useEffect, useMemo, useState } from "react";

export type DeckPreset = {
  id: string;
  name: string;
  creator: string;
  format: string;
  decklist: string;
};

/**
 * Modal picker for curated pre-built decklists from `/api/decks`. Lets the
 * player pick a pro-tour decklist instead of writing one from scratch. When
 * they pick one, `onPick` fires with the cleaned decklist text — the parent
 * decides whether to overwrite the textarea (with a confirm prompt if the
 * user has typed something).
 */
export function DeckPresetBrowser({
  onPick,
  onClose,
}: {
  onPick: (preset: DeckPreset) => void;
  onClose: () => void;
}) {
  const [decks, setDecks] = useState<DeckPreset[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/decks")
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data: { decks: DeckPreset[] }) => {
        if (!cancelled) setDecks(data.decks);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Close on Esc.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const filtered = useMemo(() => {
    if (!decks) return [];
    const q = query.trim().toLowerCase();
    if (!q) return decks;
    return decks.filter((d) =>
      `${d.name} ${d.creator} ${d.format}`.toLowerCase().includes(q),
    );
  }, [decks, query]);

  // Group by format for easier scanning.
  const groupedByFormat = useMemo(() => {
    const groups = new Map<string, DeckPreset[]>();
    for (const d of filtered) {
      const key = d.format || "Other";
      const list = groups.get(key) ?? [];
      list.push(d);
      groups.set(key, list);
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="flex h-full w-full max-w-3xl flex-col overflow-hidden rounded-lg bg-white shadow-2xl dark:bg-zinc-900"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <div>
            <h2 className="text-base font-semibold">Load preset deck</h2>
            <p className="text-xs text-zinc-500">
              Curated pro-tour decklists. Picking one replaces your decklist
              text — you can still edit before locking in.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded px-3 py-1 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            cancel
          </button>
        </header>

        <div className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by deck name, creator, or format…"
            autoFocus
            className="w-full rounded border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800"
          />
        </div>

        <div className="flex-1 overflow-y-auto">
          {error ? (
            <p className="p-6 text-center text-sm text-red-600">
              Couldn&apos;t load decks: {error}
            </p>
          ) : !decks ? (
            <p className="p-6 text-center text-sm text-zinc-500">
              loading decks…
            </p>
          ) : filtered.length === 0 ? (
            <p className="p-6 text-center text-sm text-zinc-500">
              No decks match — try clearing the search.
            </p>
          ) : (
            groupedByFormat.map(([format, list]) => (
              <section key={format} className="border-b border-zinc-100 dark:border-zinc-800">
                <h3 className="bg-zinc-50 px-4 py-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-500 dark:bg-zinc-950">
                  {format} ({list.length})
                </h3>
                <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {list.map((d) => (
                    <li key={d.id}>
                      <button
                        type="button"
                        onClick={() => onPick(d)}
                        className="flex w-full items-center justify-between gap-3 px-4 py-2 text-left hover:bg-emerald-50 dark:hover:bg-emerald-950/40"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold">
                            {d.name}
                          </span>
                          {d.creator ? (
                            <span className="block truncate text-xs text-zinc-500">
                              by {d.creator}
                            </span>
                          ) : null}
                        </span>
                        <span className="shrink-0 rounded bg-emerald-600 px-3 py-1 text-xs font-semibold text-white">
                          load
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
