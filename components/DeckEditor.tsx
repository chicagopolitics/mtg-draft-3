"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { CardBrowser } from "@/components/CardBrowser";
import { DeckPresetBrowser } from "@/components/DeckPresetBrowser";
import {
  HIGHLANDER_DECK_SIZE,
  validateHighlanderDeck,
} from "@/lib/highlander/parser";
import type { Card } from "@/lib/cards/schema";

type SetInfo = { code: string; name: string };
type CardLibrary = { cards: Card[]; sets?: SetInfo[] };

export type DeckEditorSubmitInput = {
  name: string;
  cards: Array<{
    cardName: string;
    setCode?: string;
    collectorNumber?: string;
  }>;
};

/**
 * Shared editor for Highlander decks. Used on the "new deck" and
 * "edit deck" pages. Handles:
 *   - Loading the cross-set library so the card browser and parser work
 *   - Parsing pasted decklists with singleton enforcement
 *   - Listing parser errors (block save) and warnings (informational)
 *   - Disabling Save when the deck is over/under target or has errors
 *
 * The wrapper page supplies `onSubmit` which is the server action to call.
 */
export function DeckEditor({
  initialName = "",
  initialDecklist = "",
  initialSignedCards = [],
  submitLabel,
  onSubmit,
  onDelete,
  locked = false,
  wins,
  losses,
  onPublish,
  onRename,
}: {
  initialName?: string;
  initialDecklist?: string;
  /** Cards previously won via ante; shown read-only beside the editor. */
  initialSignedCards?: Array<{
    id: string;
    cardName: string;
    signedByDisplayName: string | null;
    signedAt: Date | null;
  }>;
  submitLabel: string;
  onSubmit: (input: DeckEditorSubmitInput) => Promise<void>;
  /** Optional delete action shown only for existing decks. */
  onDelete?: () => Promise<void>;
  /**
   * When true the deck is published — the card list textarea is read-only and
   * the save/submit button is hidden. The name is still editable via onRename.
   */
  locked?: boolean;
  /** All-time record to show on published decks. */
  wins?: number;
  losses?: number;
  /** Called to permanently publish (lock) this deck. Only shown when !locked. */
  onPublish?: () => Promise<void>;
  /**
   * Called to rename a published deck (name is always editable even when
   * locked). When omitted the name field is read-only on locked decks.
   */
  onRename?: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState(initialName);
  const [text, setText] = useState(initialDecklist);
  const [library, setLibrary] = useState<CardLibrary | null>(null);
  const [libError, setLibError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [browserOpen, setBrowserOpen] = useState(false);
  const [presetOpen, setPresetOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/cards/library")
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => {
        if (!cancelled) setLibrary(data as CardLibrary);
      })
      .catch((e) => {
        if (!cancelled)
          setLibError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const validation = useMemo(() => {
    if (!library) return null;
    return validateHighlanderDeck(text, library.cards);
  }, [text, library]);

  const totalUnsigned = validation?.cards.length ?? 0;
  const signedCount = initialSignedCards.length;
  const totalCards = totalUnsigned + signedCount;
  const canSubmit =
    !locked &&
    !!validation &&
    validation.errors.length === 0 &&
    name.trim().length > 0 &&
    !submitting;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validation || !canSubmit) return;
    setSubmitting(true);
    setServerError(null);
    try {
      await onSubmit({
        name: name.trim(),
        cards: validation.cards.map((c) => ({
          cardName: c.name,
          setCode: c.setCode ?? undefined,
          collectorNumber: c.collectorNumber ?? undefined,
        })),
      });
      // onSubmit triggers a redirect; if it returns instead, that's the
      // success path for the edit page (revalidatePath fires).
    } catch (err) {
      setServerError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  }

  async function handlePublish() {
    if (!onPublish) return;
    if (
      !confirm(
        "Publish this deck? Once published, the card list is permanently locked — " +
          "only cards won or lost via ante can change it. You can still rename it. Continue?",
      )
    )
      return;
    setPublishing(true);
    setServerError(null);
    try {
      await onPublish();
    } catch (err) {
      setServerError(err instanceof Error ? err.message : String(err));
    } finally {
      setPublishing(false);
    }
  }

  async function handleRename() {
    if (!onRename) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    setRenaming(true);
    setServerError(null);
    try {
      await onRename(trimmed);
    } catch (err) {
      setServerError(err instanceof Error ? err.message : String(err));
    } finally {
      setRenaming(false);
    }
  }

  function appendCard(cardName: string) {
    // Bump count if a "N CardName" line already exists, else append "1 CardName".
    const norm = cardName.trim().toLowerCase();
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const m = line.match(/^(\s*)(\d+)(\s*x?\s+)(.+?)\s*$/i);
      if (m && m[4].trim().toLowerCase() === norm) {
        const newQty = Math.min(99, parseInt(m[2], 10) + 1);
        lines[i] = `${m[1]}${newQty}${m[3]}${m[4]}`;
        setText(lines.join("\n"));
        return;
      }
    }
    const trail = text.length > 0 && !text.endsWith("\n") ? "\n" : "";
    setText(text + trail + `1 ${cardName}\n`);
  }

  function applyPreset(decklistText: string, presetName: string) {
    if (text.trim().length > 0) {
      if (!confirm(`Replace current decklist with "${presetName}"?`)) return;
    }
    setText(decklistText);
    setPresetOpen(false);
  }

  void debounceRef;

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <section>
        <div className="flex items-end gap-2">
          <label className="flex-1 space-y-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
              deck name
            </span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
              required={!locked}
              placeholder="e.g. Mono-Blue Singleton"
              className="w-full rounded border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800"
            />
          </label>
          {/* On published decks show an inline rename button; name is always editable */}
          {locked && onRename ? (
            <button
              type="button"
              onClick={handleRename}
              disabled={renaming || !name.trim()}
              className="mb-0.5 rounded border border-zinc-300 px-3 py-2 text-xs font-medium hover:bg-zinc-100 disabled:opacity-40 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              {renaming ? "saving…" : "rename"}
            </button>
          ) : null}
          {/* Status badge */}
          {locked ? (
            <span className="mb-0.5 shrink-0 rounded bg-emerald-100 px-2 py-1.5 text-xs font-semibold text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200">
              🔒 published
              {wins !== undefined && losses !== undefined ? (
                <span className="ml-1 font-normal text-emerald-700 dark:text-emerald-300">
                  · {wins}W–{losses}L
                </span>
              ) : null}
            </span>
          ) : (
            <span className="mb-0.5 shrink-0 rounded bg-amber-100 px-2 py-1.5 text-xs font-semibold text-amber-800 dark:bg-amber-900/30 dark:text-amber-200">
              draft
            </span>
          )}
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-[1fr_18rem]">
        <section>
          <div className="mb-1 flex items-center justify-between">
            <label className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
              {locked
                ? "decklist (read-only — deck is published)"
                : "decklist (singleton — max 1 of each non-basic)"}
            </label>
            {!locked ? (
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setPresetOpen(true)}
                  className="rounded border border-zinc-300 px-2 py-1 text-xs font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
                >
                  load preset…
                </button>
                <button
                  type="button"
                  onClick={() => setBrowserOpen(true)}
                  className="rounded border border-zinc-300 px-2 py-1 text-xs font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
                >
                  browse cards…
                </button>
              </div>
            ) : null}
          </div>
          <textarea
            value={text}
            onChange={locked ? undefined : (e) => setText(e.target.value)}
            readOnly={locked}
            placeholder={`4 Plains\n1 Counterspell\n1 Lightning Bolt\n...`}
            spellCheck={false}
            rows={20}
            className={`w-full rounded border p-3 font-mono text-sm leading-relaxed placeholder:text-zinc-400 ${
              locked
                ? "border-zinc-200 bg-zinc-50 text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900/50 dark:text-zinc-400"
                : "border-zinc-300 bg-white text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
            }`}
          />

          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
            {!library ? (
              <span className="text-zinc-500">loading library…</span>
            ) : libError ? (
              <span className="text-red-600">library load failed: {libError}</span>
            ) : null}
            <span
              className={`rounded px-2 py-1 font-mono ${
                totalCards === HIGHLANDER_DECK_SIZE
                  ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200"
                  : "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200"
              }`}
            >
              {totalUnsigned}
              {signedCount > 0 ? ` + ${signedCount} signed` : ""} /{" "}
              {HIGHLANDER_DECK_SIZE}
            </span>
            {validation?.errors.length ? (
              <span className="text-red-600 dark:text-red-400">
                {validation.errors.length} singleton{" "}
                {validation.errors.length === 1 ? "error" : "errors"}
              </span>
            ) : null}
          </div>

          {validation?.errors.length ? (
            <div className="mt-2 rounded border border-red-300 bg-red-50 p-2 text-xs text-red-700 dark:border-red-700 dark:bg-red-950 dark:text-red-200">
              <p className="mb-1 font-semibold">
                Fix these before you can save:
              </p>
              <ul className="space-y-0.5 font-mono">
                {validation.errors.map((e, i) => (
                  <li key={i}>• {e}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {validation?.warnings.length ? (
            <div className="mt-2 rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
              <p className="mb-1 font-semibold">
                {validation.warnings.length}{" "}
                {validation.warnings.length === 1 ? "warning" : "warnings"}:
              </p>
              <ul className="space-y-0.5 font-mono">
                {validation.warnings.slice(0, 8).map((w, i) => (
                  <li key={i}>• {w}</li>
                ))}
                {validation.warnings.length > 8 ? (
                  <li>…and {validation.warnings.length - 8} more.</li>
                ) : null}
              </ul>
            </div>
          ) : null}

          {serverError ? (
            <p className="mt-2 rounded border border-red-300 bg-red-50 p-2 text-xs text-red-700 dark:border-red-700 dark:bg-red-950 dark:text-red-200">
              {serverError}
            </p>
          ) : null}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {!locked ? (
              <button
                type="submit"
                disabled={!canSubmit}
                className="rounded bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-40"
              >
                {submitting ? "saving…" : submitLabel}
              </button>
            ) : null}
            {!locked && onPublish ? (
              <button
                type="button"
                onClick={handlePublish}
                disabled={publishing || !name.trim()}
                className="rounded border border-emerald-600 px-4 py-2 text-sm font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-40 dark:border-emerald-500 dark:text-emerald-400 dark:hover:bg-emerald-950/30"
              >
                {publishing ? "publishing…" : "publish deck"}
              </button>
            ) : null}
            {onDelete ? (
              <button
                type="button"
                onClick={async () => {
                  if (!confirm("Delete this deck? This can't be undone.")) {
                    return;
                  }
                  try {
                    await onDelete();
                  } catch (err) {
                    setServerError(
                      err instanceof Error ? err.message : String(err),
                    );
                  }
                }}
                className="text-xs text-red-600 underline hover:text-red-800 dark:hover:text-red-400"
              >
                delete deck
              </button>
            ) : null}
          </div>
        </section>

        <aside className="space-y-3">
          <section className="rounded border border-zinc-200 p-3 dark:border-zinc-800">
            <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">
              signed / won cards ({signedCount})
            </h2>
            {signedCount === 0 ? (
              <p className="text-xs text-zinc-500">
                No won cards yet — win games to get your opponents&apos;
                signed cards added here.
              </p>
            ) : (
              <ul className="space-y-1 text-xs">
                {initialSignedCards.map((c) => (
                  <li
                    key={c.id}
                    className="flex items-center justify-between gap-2 rounded bg-amber-50/50 px-2 py-1 dark:bg-amber-950/30"
                  >
                    <span className="truncate font-medium">{c.cardName}</span>
                    <span className="text-[10px] italic text-zinc-500">
                      signed{" "}
                      {c.signedByDisplayName
                        ? `by ${c.signedByDisplayName}`
                        : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="rounded border border-zinc-200 p-3 text-xs text-zinc-500 dark:border-zinc-800">
            <p className="font-semibold uppercase tracking-wide">Highlander</p>
            <p className="mt-1">
              100-card decks, singleton (1 of each non-basic). Basics — Plains,
              Island, Swamp, Mountain, Forest — can repeat freely. Won cards
              live separately; they aren&apos;t bound by singleton.
            </p>
          </section>
        </aside>
      </div>

      {!locked && browserOpen && library ? (
        <CardBrowser
          library={library.cards}
          sets={library.sets}
          deckCounts={
            new Map(
              (validation?.cards ?? []).reduce((acc, c) => {
                const k = c.name.toLowerCase();
                acc.set(k, (acc.get(k) ?? 0) + 1);
                return acc;
              }, new Map<string, number>()),
            )
          }
          onAdd={(name) => appendCard(name)}
          onClose={() => setBrowserOpen(false)}
        />
      ) : null}

      {!locked && presetOpen ? (
        <DeckPresetBrowser
          onPick={(p) => applyPreset(p.decklist, p.name)}
          onClose={() => setPresetOpen(false)}
        />
      ) : null}
    </form>
  );
}
