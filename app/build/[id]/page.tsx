"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import usePartySocket from "partysocket/react";

import { CardView } from "@/components/Card";
import { DeckStats } from "@/components/DeckStats";
import {
  type BasicLandCounts,
  type ClientMessage,
  type DeckbuildPrivateState,
  type DeckbuildPublicState,
  type LobbyState,
  type ServerMessage,
  MIN_DECK_SIZE,
  ZERO_LANDS,
  isValidLobbyId,
  totalLands,
} from "@/lib/lobby/protocol";
import type { Color, DraftCard } from "@/lib/cards/schema";
import {
  getOrCreatePlayerId,
  getStoredPlayerName,
} from "@/lib/identity";
import { getPartykitHost } from "@/lib/partykit-client";

const COLORS: Color[] = ["W", "U", "B", "R", "G"];
const LAND_LABEL: Record<Color, string> = {
  W: "Plains",
  U: "Island",
  B: "Swamp",
  R: "Mountain",
  G: "Forest",
};
const LAND_TINT: Record<Color, string> = {
  W: "bg-amber-100 text-amber-900",
  U: "bg-sky-100 text-sky-900",
  B: "bg-zinc-300 text-zinc-900",
  R: "bg-rose-200 text-rose-900",
  G: "bg-emerald-200 text-emerald-900",
};

export default function BuildPage() {
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

  return <BuildConnected lobbyId={lobbyId} playerId={playerId} name={name} />;
}

function BuildConnected({
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
  const [priv, setPriv] = useState<DeckbuildPrivateState | null>(null);
  const [error, setError] = useState<string | null>(null);

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
        setPriv(msg.deckbuildPrivate);
        if (msg.state.phase === "waiting") {
          router.push(`/lobby/${lobbyId}`);
        } else if (msg.state.phase === "drafting") {
          router.push(`/draft/${lobbyId}`);
        } else if (msg.state.phase === "matching") {
          router.push(`/match/${lobbyId}`);
        } else if (msg.state.phase === "playing") {
          router.push(`/play/${lobbyId}`);
        }
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

  if (!state || !state.deckbuild || !priv) {
    return <Centered>loading deckbuilder…</Centered>;
  }

  return (
    <Builder
      lobbyId={lobbyId}
      playerId={playerId}
      lobby={state}
      deckbuild={state.deckbuild}
      priv={priv}
      send={send}
      error={error}
    />
  );
}

function Builder({
  lobbyId,
  playerId,
  lobby,
  deckbuild,
  priv,
  send,
  error,
}: {
  lobbyId: string;
  playerId: string;
  lobby: LobbyState;
  deckbuild: DeckbuildPublicState;
  priv: DeckbuildPrivateState;
  send: (msg: ClientMessage) => void;
  error: string | null;
}) {
  const me = lobby.players.find((p) => p.id === playerId);
  const meReady = priv.ready;
  const isAdmin = me?.isAdmin === true;

  const deckSet = useMemo(() => new Set(priv.deck), [priv.deck]);
  const sideboard = priv.pool.filter((c) => !deckSet.has(c.instanceId));
  const inDeck = priv.pool.filter((c) => deckSet.has(c.instanceId));
  const totalDeckSize = priv.deck.length + totalLands(priv.basicLands);
  const meetsMin = totalDeckSize >= MIN_DECK_SIZE;

  function moveToDeck(id: string) {
    if (deckSet.has(id)) return;
    send({ type: "setDeck", deck: [...priv.deck, id] });
  }
  function moveToSideboard(id: string) {
    send({ type: "setDeck", deck: priv.deck.filter((x) => x !== id) });
  }
  function bumpLand(color: Color, delta: number) {
    const next: BasicLandCounts = {
      ...priv.basicLands,
      [color]: Math.max(0, priv.basicLands[color] + delta),
    };
    send({ type: "setBasicLands", counts: next });
  }
  function clearLands() {
    send({ type: "setBasicLands", counts: { ...ZERO_LANDS } });
  }
  function toggleReady() {
    send({ type: "setReady", ready: !meReady });
  }
  function adminStart() {
    send({ type: "startPlay" });
  }
  function moveAllToDeck() {
    send({ type: "setDeck", deck: priv.pool.map((c) => c.instanceId) });
  }
  function clearDeck() {
    send({ type: "setDeck", deck: [] });
  }

  const allReady = deckbuild.players
    .filter((p) => p.connected)
    .every((p) => p.ready);
  const otherCount = deckbuild.players.filter((p) => p.id !== playerId).length;

  return (
    <div className="flex flex-1 flex-col gap-4 bg-zinc-50 p-6 font-sans dark:bg-black">
      <header className="flex items-baseline justify-between border-b border-zinc-200 pb-3 dark:border-zinc-800">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            deckbuilding —{" "}
            <span className="font-mono text-zinc-500">{lobbyId}</span>
          </h1>
          <p className="text-xs text-zinc-500">
            assemble your deck. add basic lands so it can actually function.
            no maximum.
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs text-zinc-500">you</p>
          <p className="text-sm font-medium">{me?.name ?? "—"}</p>
        </div>
      </header>

      <PlayerStrip players={deckbuild.players} youId={playerId} />

      <div className="flex flex-wrap items-center gap-3 text-xs">
        <span
          className={`rounded px-2 py-1 font-mono ${
            meetsMin
              ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300"
              : "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
          }`}
        >
          deck: {totalDeckSize} / {MIN_DECK_SIZE} min
        </span>
        <span className="text-zinc-500">
          {priv.deck.length} drafted + {totalLands(priv.basicLands)} basic lands
        </span>
        <span className="text-zinc-400">
          (pool: {priv.pool.length} cards, sideboard: {sideboard.length})
        </span>
      </div>

      <BasicLandPanel
        counts={priv.basicLands}
        bump={bumpLand}
        clear={clearLands}
      />

      <DeckStats
        cards={inDeck}
        basics={priv.basicLands}
        title="deck stats"
        emptyHint="add cards to your deck to see stats."
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <ZonePanel
          title={`sideboard (${sideboard.length})`}
          subtitle="click a card to add it to your deck"
          actionLabel="add all"
          onAction={moveAllToDeck}
          actionEnabled={sideboard.length > 0}
        >
          {sideboard.length === 0 ? (
            <Empty>everything is in the deck.</Empty>
          ) : (
            <CardGrid
              cards={sideboard}
              onClick={(c) => moveToDeck(c.instanceId)}
            />
          )}
        </ZonePanel>

        <ZonePanel
          title={`maindeck (${inDeck.length})`}
          subtitle="click a card to send it back to the sideboard"
          actionLabel="remove all"
          onAction={clearDeck}
          actionEnabled={inDeck.length > 0}
        >
          {inDeck.length === 0 ? (
            <Empty>your deck is empty. add some picks.</Empty>
          ) : (
            <CardGrid
              cards={inDeck}
              onClick={(c) => moveToSideboard(c.instanceId)}
            />
          )}
        </ZonePanel>
      </div>

      <div className="sticky bottom-2 z-10 flex flex-wrap items-center justify-between gap-3 rounded border border-zinc-200 bg-white/95 p-3 shadow backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/95">
        <button
          onClick={toggleReady}
          className={`rounded px-4 py-2 text-sm font-semibold transition ${
            meReady
              ? "bg-emerald-600 text-white hover:bg-emerald-700"
              : "bg-zinc-200 text-zinc-900 hover:bg-zinc-300 dark:bg-zinc-700 dark:text-zinc-100 dark:hover:bg-zinc-600"
          }`}
        >
          {meReady ? "✓ ready" : "mark ready"}
        </button>
        <p className="flex-1 text-center text-xs text-zinc-500">
          {allReady
            ? `all ${otherCount + 1} players ready.`
            : `waiting on ${
                deckbuild.players.filter(
                  (p) => p.connected && !p.ready,
                ).length
              } to ready up.`}
        </p>
        {isAdmin ? (
          <button
            onClick={adminStart}
            disabled={!allReady}
            title={
              allReady
                ? "Start the game"
                : "Wait until everyone is ready (or click ready yourself)"
            }
            className="rounded bg-zinc-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
          >
            start play
          </button>
        ) : (
          <span className="text-xs text-zinc-400">
            admin will start the game
          </span>
        )}
      </div>

      {error ? (
        <p className="text-center text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function PlayerStrip({
  players,
  youId,
}: {
  players: DeckbuildPublicState["players"];
  youId: string;
}) {
  return (
    <section className="rounded border border-zinc-200 p-3 dark:border-zinc-800">
      <div className="mb-2 text-xs uppercase tracking-wide text-zinc-500">
        players
      </div>
      <ul className="flex flex-wrap gap-2 text-sm">
        {players.map((p) => {
          const isYou = p.id === youId;
          return (
            <li
              key={p.id}
              className={`flex items-center gap-2 rounded px-2 py-1 ${
                isYou
                  ? "bg-emerald-100 dark:bg-emerald-900/40"
                  : "bg-zinc-100 dark:bg-zinc-800"
              } ${!p.connected ? "opacity-50" : ""}`}
            >
              <span className="font-medium">{p.name}</span>
              <span className="font-mono text-[10px] text-zinc-500">
                {p.deckSize} cards
              </span>
              {p.ready ? (
                <span className="rounded-full bg-emerald-500 px-1.5 py-px text-[10px] font-bold text-white">
                  ready
                </span>
              ) : null}
              {!p.connected ? (
                <span className="text-[10px] uppercase text-zinc-500">
                  away
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function BasicLandPanel({
  counts,
  bump,
  clear,
}: {
  counts: BasicLandCounts;
  bump: (color: Color, delta: number) => void;
  clear: () => void;
}) {
  return (
    <section className="rounded border border-zinc-200 p-3 dark:border-zinc-800">
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-xs uppercase tracking-wide text-zinc-500">
          basic lands ({totalLands(counts)} total)
        </h2>
        <button
          onClick={clear}
          disabled={totalLands(counts) === 0}
          className="text-xs text-zinc-500 underline disabled:opacity-30 hover:text-zinc-800 dark:hover:text-zinc-200"
        >
          clear
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {COLORS.map((c) => (
          <div
            key={c}
            className={`flex items-center justify-between gap-2 rounded px-3 py-2 ${LAND_TINT[c]}`}
          >
            <div className="flex flex-col">
              <span className="text-sm font-semibold">{LAND_LABEL[c]}</span>
              <span className="font-mono text-xs opacity-70">
                {counts[c]}
              </span>
            </div>
            <div className="flex gap-1">
              <button
                onClick={() => bump(c, -1)}
                disabled={counts[c] === 0}
                className="h-7 w-7 rounded bg-white/40 font-mono text-sm font-bold hover:bg-white/70 disabled:opacity-30"
                aria-label={`remove ${LAND_LABEL[c]}`}
              >
                −
              </button>
              <button
                onClick={() => bump(c, 1)}
                className="h-7 w-7 rounded bg-white/40 font-mono text-sm font-bold hover:bg-white/70"
                aria-label={`add ${LAND_LABEL[c]}`}
              >
                +
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function ZonePanel({
  title,
  subtitle,
  actionLabel,
  onAction,
  actionEnabled,
  children,
}: {
  title: string;
  subtitle: string;
  actionLabel: string;
  onAction: () => void;
  actionEnabled: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col rounded border border-zinc-200 dark:border-zinc-800">
      <header className="flex items-baseline justify-between border-b border-zinc-200 p-3 dark:border-zinc-800">
        <div>
          <h2 className="text-sm font-semibold">{title}</h2>
          <p className="text-xs text-zinc-500">{subtitle}</p>
        </div>
        <button
          onClick={onAction}
          disabled={!actionEnabled}
          className="text-xs text-zinc-500 underline disabled:opacity-30 hover:text-zinc-800 dark:hover:text-zinc-200"
        >
          {actionLabel}
        </button>
      </header>
      <div className="max-h-[28rem] overflow-y-auto p-3">{children}</div>
    </section>
  );
}

function CardGrid({
  cards,
  onClick,
}: {
  cards: DraftCard[];
  onClick: (card: DraftCard) => void;
}) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-2">
      {cards.map((card) => (
        <button
          key={card.instanceId}
          onClick={() => onClick(card)}
          className="rounded transition hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-emerald-500"
        >
          <CardView card={card} />
        </button>
      ))}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="py-6 text-center text-xs text-zinc-500">{children}</p>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 bg-zinc-50 p-6 text-sm text-zinc-700 dark:bg-black dark:text-zinc-300">
      {children}
    </div>
  );
}
