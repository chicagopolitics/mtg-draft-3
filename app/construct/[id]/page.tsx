"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import usePartySocket from "partysocket/react";

import {
  type ClientMessage,
  type ConstructPrivateState,
  type ConstructPublicState,
  type LobbyState,
  type ServerMessage,
  MIN_DECK_SIZE,
  isValidLobbyId,
} from "@/lib/lobby/protocol";
import { CardBrowser } from "@/components/CardBrowser";
import { parseDecklist } from "@/lib/cards/decklist";
import type { Card } from "@/lib/cards/schema";
import {
  getOrCreatePlayerId,
  getStoredPlayerName,
} from "@/lib/identity";
import { getPartykitHost } from "@/lib/partykit-client";

type CardLibrary = {
  cards: Card[];
  uniqueCardCount: number;
  totalSetsRead: number;
};

/**
 * Quick-and-dirty parse of the textarea into a `name → count` map. Mirrors
 * the loose grammar in `appendCardToDecklist`. Used to display per-card "in
 * deck" badges in the browser without re-parsing through the full pipeline.
 */
function decklistCounts(text: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || /^(?:\/\/|#)/.test(line)) continue;
    const m = line.match(/^(\d+)\s*x?\s+(.+?)\s*$/i);
    let name: string;
    let qty = 1;
    if (m) {
      qty = parseInt(m[1], 10);
      name = m[2];
    } else {
      name = line;
    }
    if (!name || !Number.isFinite(qty)) continue;
    const key = name.toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + qty);
  }
  return counts;
}

/**
 * Increment the existing line for `name` if present (case-insensitive on the
 * card-name portion), otherwise append "1 Name" at the end. Preserves the
 * user's other lines and ordering.
 */
function appendCardToDecklist(text: string, name: string): string {
  const norm = name.trim().toLowerCase();
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(/^(\s*)(\d+)(\s*x?\s+)(.+?)\s*$/i);
    if (m && m[4].trim().toLowerCase() === norm) {
      const newQty = Math.min(99, parseInt(m[2], 10) + 1);
      lines[i] = `${m[1]}${newQty}${m[3]}${m[4]}`;
      return lines.join("\n");
    }
    // Bare-name line "Lightning Bolt" (qty implied 1)
    if (/^\s*[A-Za-z]/.test(line) && line.trim().toLowerCase() === norm) {
      lines[i] = `2 ${line.trim()}`;
      return lines.join("\n");
    }
  }
  // Append, preserving a trailing newline if there is one.
  const trail = text.length > 0 && !text.endsWith("\n") ? "\n" : "";
  return text + trail + `1 ${name}\n`;
}

const SAMPLE_HINT = `4 Lightning Bolt
4 Counterspell
20 Mountain
12 Island
// comments and blank lines are ignored
// Sideboard is also fine — anything you paste below "Sideboard:" is ignored.`;

export default function ConstructPage() {
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
    <ConstructConnected lobbyId={lobbyId} playerId={playerId} name={name} />
  );
}

function ConstructConnected({
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
  const [priv, setPriv] = useState<ConstructPrivateState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [library, setLibrary] = useState<CardLibrary | null>(null);
  const [libraryError, setLibraryError] = useState<string | null>(null);

  // Fetch the cross-set card library once on mount. The browser cache picks
  // it up on subsequent visits.
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
        setPriv(msg.constructPrivate);
        if (msg.state.phase === "waiting") router.push(`/lobby/${lobbyId}`);
        else if (msg.state.phase === "drafting")
          router.push(`/draft/${lobbyId}`);
        else if (msg.state.phase === "deckbuilding")
          router.push(`/build/${lobbyId}`);
        else if (msg.state.phase === "matching")
          router.push(`/match/${lobbyId}`);
        else if (msg.state.phase === "playing")
          router.push(`/play/${lobbyId}`);
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

  if (libraryError) {
    return (
      <Centered>
        <p className="text-sm text-red-600">
          Couldn&apos;t load the card library: {libraryError}
        </p>
      </Centered>
    );
  }
  if (!state || !state.construct || !priv) {
    return <Centered>loading deck builder…</Centered>;
  }
  if (!library) {
    return (
      <Centered>
        <p>building cross-set library…</p>
      </Centered>
    );
  }

  return (
    <Construct
      lobbyId={lobbyId}
      playerId={playerId}
      lobby={state}
      construct={state.construct}
      priv={priv}
      library={library}
      send={send}
      error={error}
    />
  );
}

function Construct({
  lobbyId,
  playerId,
  lobby,
  construct,
  priv,
  library,
  send,
  error,
}: {
  lobbyId: string;
  playerId: string;
  lobby: LobbyState;
  construct: ConstructPublicState;
  priv: ConstructPrivateState;
  library: CardLibrary;
  send: (msg: ClientMessage) => void;
  error: string | null;
}) {
  const me = lobby.players.find((p) => p.id === playerId);
  const isAdmin = me?.isAdmin ?? false;

  // Local state mirrors the server's last echoed decklist; we debounce
  // pushes so each keystroke doesn't fly over the wire.
  const [text, setText] = useState(priv.decklist);
  const [dirty, setDirty] = useState(false);
  const [browserOpen, setBrowserOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // If server sends us a fresh state (e.g., reconnect), accept it unless
  // the user is mid-edit.
  useEffect(() => {
    if (!dirty) setText(priv.decklist);
  }, [priv.decklist, dirty]);

  function pushDecklist(value: string) {
    // Parse client-side against the cross-set library, then ship the
    // materialized cards along with the raw text + warnings.
    const parsed = parseDecklist(value, library.cards);
    send({
      type: "setConstructDeck",
      decklist: value,
      cards: parsed.cards,
      warnings: parsed.warnings,
    });
  }

  function onChange(value: string) {
    setText(value);
    setDirty(true);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      pushDecklist(value);
      setDirty(false);
    }, 350);
  }

  /** Called by the card browser; mutates the textarea text + flushes immediately. */
  function addCardFromBrowser(name: string) {
    const next = appendCardToDecklist(text, name);
    setText(next);
    setDirty(true);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    // Flush sooner than typing — adding a card is an explicit action.
    debounceRef.current = setTimeout(() => {
      pushDecklist(next);
      setDirty(false);
    }, 100);
  }

  function toggleReady() {
    // Flush any pending edits before flipping ready.
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      pushDecklist(text);
      setDirty(false);
    }
    send({ type: "setReady", ready: !priv.ready });
  }

  const allReady =
    construct.players.length > 0 &&
    construct.players.every((p) => p.ready || !p.connected);
  const minMet = priv.deckSize >= MIN_DECK_SIZE;

  return (
    <main className="mx-auto max-w-5xl space-y-4 p-4">
      <header className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-bold">
            Constructed —{" "}
            <span className="font-mono text-zinc-500">{lobbyId}</span>
          </h1>
          <p className="text-sm text-zinc-500">
            Pulling from{" "}
            <span className="font-semibold">{library.uniqueCardCount}</span>{" "}
            unique cards across{" "}
            <span className="font-semibold">{library.totalSetsRead}</span>{" "}
            sets. Paste a decklist below — any printing in the library is fair
            game.
          </p>
        </div>
        <p className="text-sm">{me?.name}</p>
      </header>

      {error ? (
        <p className="rounded border border-red-300 bg-red-50 p-2 text-sm text-red-700 dark:border-red-700 dark:bg-red-950 dark:text-red-200">
          {error}
        </p>
      ) : null}

      <div className="grid gap-4 md:grid-cols-[1fr_18rem]">
        <section>
          <div className="mb-1 flex items-center justify-between">
            <label
              htmlFor="decklist"
              className="text-xs font-semibold uppercase tracking-wide text-zinc-500"
            >
              your decklist
            </label>
            <button
              type="button"
              onClick={() => setBrowserOpen(true)}
              className="rounded border border-zinc-300 px-2 py-1 text-xs font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              browse cards…
            </button>
          </div>
          <textarea
            id="decklist"
            value={text}
            onChange={(e) => onChange(e.target.value)}
            placeholder={SAMPLE_HINT}
            spellCheck={false}
            rows={20}
            className="w-full rounded border border-zinc-300 bg-white p-3 font-mono text-sm leading-relaxed text-zinc-900 placeholder:text-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
          />

          <div className="mt-2 flex items-center gap-3 text-sm">
            <span
              className={`rounded px-2 py-1 font-mono text-xs ${
                minMet
                  ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200"
                  : "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200"
              }`}
            >
              {priv.deckSize} cards{minMet ? "" : ` (min ${MIN_DECK_SIZE})`}
            </span>
            {dirty ? (
              <span className="text-xs text-zinc-500">saving…</span>
            ) : (
              <span className="text-xs text-zinc-500">saved</span>
            )}
            <button
              type="button"
              onClick={toggleReady}
              disabled={!minMet && !priv.ready}
              className={`ml-auto rounded px-3 py-1 text-sm font-semibold ${
                priv.ready
                  ? "bg-zinc-200 text-zinc-800 hover:bg-zinc-300 dark:bg-zinc-700 dark:text-zinc-100 dark:hover:bg-zinc-600"
                  : "bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40"
              }`}
            >
              {priv.ready ? "unready" : "ready"}
            </button>
          </div>

          {priv.warnings.length > 0 ? (
            <div className="mt-3 rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
              <p className="mb-1 font-semibold">
                {priv.warnings.length} parser warning
                {priv.warnings.length === 1 ? "" : "s"}:
              </p>
              <ul className="space-y-0.5 font-mono">
                {priv.warnings.slice(0, 8).map((w, i) => (
                  <li key={i}>• {w}</li>
                ))}
                {priv.warnings.length > 8 ? (
                  <li>…and {priv.warnings.length - 8} more.</li>
                ) : null}
              </ul>
            </div>
          ) : null}
        </section>

        <aside className="space-y-4">
          <section className="rounded border border-zinc-200 p-3 dark:border-zinc-800">
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
              players
            </h2>
            <ul className="space-y-1 text-sm">
              {construct.players.map((p) => (
                <li
                  key={p.id}
                  className="flex items-center justify-between gap-2"
                >
                  <span
                    className={
                      p.connected ? "" : "text-zinc-400 line-through"
                    }
                  >
                    {p.name}
                  </span>
                  <span className="font-mono text-xs text-zinc-500">
                    {p.deckSize} ·{" "}
                    {p.ready ? (
                      <span className="text-emerald-600 dark:text-emerald-400">
                        ready
                      </span>
                    ) : (
                      <span>working…</span>
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
              className="w-full rounded bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-40"
              title={
                allReady
                  ? "Lock in everyone's decks and pair players"
                  : "Waiting for all players to ready up"
              }
            >
              start matches
            </button>
          ) : (
            <p className="text-center text-xs text-zinc-500">
              waiting for the admin to start matches…
            </p>
          )}
        </aside>
      </div>

      {browserOpen ? (
        <CardBrowser
          library={library.cards}
          deckCounts={decklistCounts(text)}
          onAdd={addCardFromBrowser}
          onClose={() => setBrowserOpen(false)}
        />
      ) : null}
    </main>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <main className="grid min-h-svh place-items-center p-6 text-center">
      <div className="space-y-2">{children}</div>
    </main>
  );
}
