"use client";

/**
 * Highlander deck-picker page.
 *
 * Each player is redirected here from the lobby when the admin starts a
 * Highlander game. They pick one of their saved Highlander decks; the
 * client resolves the card names against the cross-set library (same path
 * as Constructed), mints DraftCards, and ships them to PartyKit via
 * `setHighlanderDeck`. Once all players are ready the admin starts matches.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import usePartySocket from "partysocket/react";

import { getPartykitHost } from "@/lib/partykit-client";
import {
  type ClientMessage,
  type HighlanderPrivateState,
  type HighlanderPublicState,
  type LobbyState,
  type ServerMessage,
  isValidLobbyId,
} from "@/lib/lobby/protocol";
import {
  getOrCreatePlayerId,
  getStoredPlayerName,
} from "@/lib/identity";
import { mintDraftCards } from "@/lib/cards/schema";
import type { Card } from "@/lib/cards/schema";

/** A saved Highlander deck as returned by /api/highlander/decks */
type SavedDeck = {
  id: string;
  name: string;
  format: string;
  updatedAt: string | Date;
  /** null = draft (not playable); set = published timestamp */
  lockedAt: string | null;
  wins: number;
  losses: number;
  cardCount: number;
  cards: Array<{
    cardName: string;
    setCode: string | null;
    collectorNumber: string | null;
  }>;
};

type LibraryCard = Card;

/** Resolve a list of { cardName } records to Card objects from the library. */
function resolveCards(
  deckCards: SavedDeck["cards"],
  library: LibraryCard[],
): Card[] {
  const byName = new Map<string, Card>(
    library.map((c) => [c.name.toLowerCase(), c]),
  );
  const resolved: Card[] = [];
  for (const dc of deckCards) {
    const found = byName.get(dc.cardName.toLowerCase());
    if (found) {
      resolved.push(found);
    } else {
      // Fallback: build a minimal Card so the card still exists in-game
      // even if it doesn't appear in the current library (e.g., a won card
      // from a set not loaded in this session).
      resolved.push({
        id: `hl-${dc.cardName.toLowerCase().replace(/\s+/g, "-")}`,
        name: dc.cardName,
        type: "creature",
        colors: [],
        rarity: "common",
        text: "",
        typeLine: dc.cardName,
        setCode: dc.setCode ?? undefined,
        collectorNumber: dc.collectorNumber ?? undefined,
      });
    }
  }
  return resolved;
}

export default function HighlanderPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const lobbyId = String(params.id ?? "").toUpperCase();

  const [playerId, setPlayerId] = useState("");
  const [name, setName] = useState("");
  const [bootReady, setBootReady] = useState(false);

  useEffect(() => {
    setPlayerId(getOrCreatePlayerId());
    setName(getStoredPlayerName());
    setBootReady(true);
  }, []);

  if (!isValidLobbyId(lobbyId)) {
    return (
      <Centered>
        <p className="text-sm text-red-600">Invalid lobby code: {lobbyId}</p>
        <button onClick={() => router.push("/")} className="text-xs underline">
          back home
        </button>
      </Centered>
    );
  }

  if (!bootReady) return <Centered>preparing…</Centered>;
  if (!name.trim()) {
    return (
      <Centered>
        <p>no player name set.</p>
        <button onClick={() => router.push("/")} className="text-xs underline">
          back home
        </button>
      </Centered>
    );
  }

  return (
    <HighlanderConnected lobbyId={lobbyId} playerId={playerId} name={name} />
  );
}

function HighlanderConnected({
  lobbyId,
  playerId,
  name,
}: {
  lobbyId: string;
  playerId: string;
  name: string;
}) {
  const router = useRouter();
  const [state, setState] = useState<LobbyState | null>(null);
  const [priv, setPriv] = useState<HighlanderPrivateState | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Saved decks fetched from the DB
  const [savedDecks, setSavedDecks] = useState<SavedDeck[] | null>(null);
  const [decksError, setDecksError] = useState<string | null>(null);
  const [notSignedIn, setNotSignedIn] = useState(false);

  // Cross-set library for card resolution
  const [library, setLibrary] = useState<LibraryCard[] | null>(null);
  const [libraryError, setLibraryError] = useState<string | null>(null);

  // Which deck is currently selected (before sending)
  const [selectedDeckId, setSelectedDeckId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  // Debounce ref — not used for typing but kept for API consistency
  void useRef(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/highlander/decks")
      .then(async (r) => {
        if (r.status === 401) {
          if (!cancelled) setNotSignedIn(true);
          return;
        }
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => {
        if (cancelled || !data) return;
        setSavedDecks((data as { decks: SavedDeck[] }).decks);
      })
      .catch((e) => {
        if (!cancelled)
          setDecksError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/cards/library")
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => {
        if (!cancelled) setLibrary((data as { cards: LibraryCard[] }).cards);
      })
      .catch((e) => {
        if (!cancelled)
          setLibraryError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const host = useMemo(() => getPartykitHost(), []);

  const socket = usePartySocket({
    host,
    room: lobbyId,
    query: { p: playerId, n: name },
    onMessage(event) {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }
      if (msg.type === "state") {
        setState(msg.state);
        setPriv(msg.highlanderPrivate);
        // Phase redirects
        const phase = msg.state.phase;
        if (phase === "waiting") router.push(`/lobby/${lobbyId}`);
        else if (phase === "drafting") router.push(`/draft/${lobbyId}`);
        else if (phase === "deckbuilding") router.push(`/build/${lobbyId}`);
        else if (phase === "constructing") router.push(`/construct/${lobbyId}`);
        else if (phase === "matching") router.push(`/match/${lobbyId}`);
        else if (phase === "playing") router.push(`/play/${lobbyId}`);
      } else if (msg.type === "error") {
        setError(msg.message);
      } else if (msg.type === "rejected") {
        setError(
          msg.reason === "lobby-in-progress"
            ? "Game already in progress."
            : "Lobby is full.",
        );
      }
    },
  });

  function send(msg: ClientMessage) {
    socket.send(JSON.stringify(msg));
  }

  async function chooseDeck(deck: SavedDeck) {
    if (!library) return;
    if (!deck.lockedAt) return; // hard gate — should not be reachable via UI
    setSending(true);
    setError(null);
    try {
      const cards = resolveCards(deck.cards, library);
      const minted = mintDraftCards(cards);
      send({
        type: "setHighlanderDeck",
        deckId: deck.id,
        deckName: deck.name,
        cards: minted,
        wins: deck.wins,
        losses: deck.losses,
      });
      setSelectedDeckId(deck.id);
    } finally {
      setSending(false);
    }
  }

  function toggleReady() {
    send({ type: "setReady", ready: !priv?.ready });
  }

  const me = state?.players.find((p) => p.id === playerId);
  const isAdmin = me?.isAdmin ?? false;
  const highlander = state?.highlander;
  const allReady =
    !!highlander &&
    highlander.players.length > 0 &&
    highlander.players.every((p) => p.ready || !p.connected);

  if (notSignedIn) {
    return (
      <Centered>
        <p className="text-sm text-zinc-700 dark:text-zinc-300">
          Highlander requires a saved deck. Sign in to access yours.
        </p>
        <Link
          href={`/signin?callbackUrl=/highlander/${lobbyId}`}
          className="rounded bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
        >
          sign in
        </Link>
        <p className="text-xs text-zinc-500">
          You can still spectate without signing in — just rejoin after signing
          in if you want to play.
        </p>
      </Centered>
    );
  }

  if (decksError) {
    return (
      <Centered>
        <p className="text-sm text-red-600">
          Couldn&apos;t load your decks: {decksError}
        </p>
      </Centered>
    );
  }

  if (!state || !highlander || !priv) {
    return <Centered>connecting…</Centered>;
  }

  if (!savedDecks) {
    return <Centered>loading your decks…</Centered>;
  }

  if (!library && !libraryError) {
    return <Centered>building card library…</Centered>;
  }

  return (
    <main className="mx-auto max-w-5xl space-y-4 p-4">
      <header className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-bold">
            Highlander —{" "}
            <span className="font-mono text-zinc-500">{lobbyId}</span>
          </h1>
          <p className="text-sm text-zinc-500">
            Pick one of your saved 100-card decks to use this game.
          </p>
        </div>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">{me?.name}</p>
      </header>

      {error ? (
        <p className="rounded border border-red-300 bg-red-50 p-2 text-sm text-red-700 dark:border-red-700 dark:bg-red-950 dark:text-red-200">
          {error}
        </p>
      ) : null}
      {libraryError ? (
        <p className="rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
          Library load failed ({libraryError}) — deck cards will use fallback
          definitions and may be missing art.
        </p>
      ) : null}

      <div className="grid gap-4 md:grid-cols-[1fr_18rem]">
        {/* ── Deck picker ── */}
        <section className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
            your decks
          </h2>

          {savedDecks.length === 0 ? (
            <div className="rounded border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500 dark:border-zinc-700">
              <p>No saved Highlander decks.</p>
              <Link
                href="/profile/decks/new"
                target="_blank"
                className="mt-2 inline-block text-xs text-emerald-600 underline hover:text-emerald-700"
              >
                create one in your profile →
              </Link>
            </div>
          ) : (
            <ul className="space-y-2">
              {savedDecks.map((deck) => {
                const isDraft = !deck.lockedAt;
                const isActive = priv.deckId === deck.id;
                return (
                  <li
                    key={deck.id}
                    className={`rounded border transition ${
                      isDraft
                        ? "border-zinc-200 opacity-60 dark:border-zinc-800"
                        : isActive
                        ? "border-emerald-500 bg-emerald-50 dark:border-emerald-600 dark:bg-emerald-950/30"
                        : "border-zinc-200 dark:border-zinc-800"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3 p-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="truncate font-semibold">{deck.name}</p>
                          {isDraft ? (
                            <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
                              draft
                            </span>
                          ) : null}
                        </div>
                        <p className="text-xs text-zinc-500">
                          {deck.cardCount} cards
                          {!isDraft
                            ? ` · ${deck.wins}W–${deck.losses}L`
                            : ""}
                          {" · updated "}
                          {new Date(deck.updatedAt).toLocaleDateString()}
                        </p>
                        {isDraft ? (
                          <p className="mt-0.5 text-xs text-amber-700 dark:text-amber-400">
                            Publish this deck before you can use it in
                            Highlander.{" "}
                            <Link
                              href={`/profile/decks/${deck.id}`}
                              target="_blank"
                              className="underline"
                            >
                              open editor →
                            </Link>
                          </p>
                        ) : null}
                      </div>
                      {!isDraft ? (
                        <button
                          type="button"
                          disabled={sending || !library || isActive}
                          onClick={() => chooseDeck(deck)}
                          className={`shrink-0 rounded px-3 py-1.5 text-xs font-semibold transition ${
                            isActive
                              ? "bg-emerald-500/20 text-emerald-700 dark:text-emerald-300"
                              : "bg-zinc-900 text-white hover:bg-zinc-700 disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
                          }`}
                        >
                          {isActive
                            ? "chosen ✓"
                            : sending && selectedDeckId === deck.id
                            ? "loading…"
                            : "choose"}
                        </button>
                      ) : (
                        <span className="shrink-0 rounded border border-zinc-300 px-3 py-1.5 text-xs text-zinc-400 dark:border-zinc-700">
                          draft
                        </span>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {priv.deckId ? (
            <div className="mt-2 flex items-center gap-3">
              <span className="rounded bg-emerald-100 px-2 py-1 font-mono text-xs text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200">
                {priv.deckSize} cards loaded
              </span>
              <button
                type="button"
                onClick={toggleReady}
                className={`rounded px-3 py-1 text-sm font-semibold transition ${
                  priv.ready
                    ? "bg-zinc-200 text-zinc-800 hover:bg-zinc-300 dark:bg-zinc-700 dark:text-zinc-100 dark:hover:bg-zinc-600"
                    : "bg-emerald-600 text-white hover:bg-emerald-700"
                }`}
              >
                {priv.ready ? "unready" : "ready"}
              </button>
            </div>
          ) : null}

          <p className="text-xs text-zinc-500">
            Don&apos;t see the deck you want?{" "}
            <Link
              href="/profile/decks/new"
              target="_blank"
              className="underline hover:text-zinc-800 dark:hover:text-zinc-200"
            >
              create or edit decks in your profile
            </Link>{" "}
            then refresh this page.
          </p>
        </section>

        {/* ── Players sidebar ── */}
        <aside className="space-y-3">
          <section className="rounded border border-zinc-200 p-3 dark:border-zinc-800">
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
              players
            </h2>
            <ul className="space-y-1 text-sm">
              {highlander.players.map((p) => (
                <li
                  key={p.id}
                  className="flex items-center justify-between gap-2"
                >
                  <span
                    className={p.connected ? "" : "text-zinc-400 line-through"}
                  >
                    {p.name}
                    {p.id === playerId ? (
                      <span className="ml-1 text-xs text-zinc-400">(you)</span>
                    ) : null}
                  </span>
                  <span className="text-right font-mono text-xs text-zinc-500">
                    {p.deckName ? (
                      <>
                        <span className="max-w-[7rem] truncate inline-block align-bottom">
                          {p.deckName}
                        </span>
                        <span className="ml-1 text-zinc-400">
                          {p.wins}W–{p.losses}L
                        </span>
                        {" · "}
                      </>
                    ) : (
                      <span className="italic">picking… · </span>
                    )}
                    {p.ready ? (
                      <span className="text-emerald-600 dark:text-emerald-400">
                        ready
                      </span>
                    ) : (
                      <span>waiting</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          {isAdmin ? (
            <button
              type="button"
              onClick={() => send({ type: "startPlay" })}
              disabled={!allReady}
              title={
                allReady
                  ? "Lock in decks and pair players"
                  : "Waiting for all players to ready up"
              }
              className="w-full rounded bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-40"
            >
              start matches
            </button>
          ) : (
            <p className="text-center text-xs text-zinc-500">
              waiting for the admin to start matches…
            </p>
          )}

          <section className="rounded border border-zinc-200 p-3 text-xs text-zinc-500 dark:border-zinc-800">
            <p className="font-semibold uppercase tracking-wide">Highlander</p>
            <p className="mt-1">
              100-card singleton decks. One copy of each non-basic allowed.
              Basics repeat freely. Won cards are separate from your main deck
              and don&apos;t count against singleton.
            </p>
          </section>
        </aside>
      </div>
    </main>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <main className="grid min-h-svh place-items-center p-6 text-center">
      <div className="space-y-3">{children}</div>
    </main>
  );
}
