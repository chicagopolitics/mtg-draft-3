"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import usePartySocket from "partysocket/react";

import {
  type BestOf,
  type ClientMessage,
  type LobbyState,
  type MatchPairing,
  type ServerMessage,
  isValidLobbyId,
} from "@/lib/lobby/protocol";
import {
  getOrCreatePlayerId,
  getStoredPlayerName,
} from "@/lib/identity";
import { getPartykitHost } from "@/lib/partykit-client";

export default function MatchPage() {
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

  return <MatchConnected lobbyId={lobbyId} playerId={playerId} name={name} />;
}

function MatchConnected({
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
        if (msg.state.phase === "waiting") router.push(`/lobby/${lobbyId}`);
        else if (msg.state.phase === "drafting")
          router.push(`/draft/${lobbyId}`);
        else if (msg.state.phase === "deckbuilding")
          router.push(`/build/${lobbyId}`);
        else if (msg.state.phase === "constructing")
          router.push(`/construct/${lobbyId}`);
        else if (msg.state.phase === "playing")
          router.push(`/play/${lobbyId}`);
      } else if (msg.type === "error") {
        setError(msg.message);
      }
    },
  });

  function send(msg: ClientMessage) {
    socket.send(JSON.stringify(msg));
  }

  if (!state) return <Centered>loading…</Centered>;
  if (state.phase !== "matching") return <Centered>switching…</Centered>;

  return (
    <MatchSetup
      lobby={state}
      playerId={playerId}
      send={send}
      error={error}
    />
  );
}

type DraftPair = {
  /** Each team is an array of player IDs (1 entry = 1v1, 2 entries = 2HG). */
  teams: [string[], string[]];
  bestOf: BestOf;
  startingLife: number;
};

function MatchSetup({
  lobby,
  playerId,
  send,
  error,
}: {
  lobby: LobbyState;
  playerId: string;
  send: (msg: ClientMessage) => void;
  error: string | null;
}) {
  const me = lobby.players.find((p) => p.id === playerId);
  const isAdmin = me?.isAdmin ?? false;

  const eligible = lobby.unpairedPlayerIds;
  const playerById = new Map(lobby.players.map((p) => [p.id, p]));
  const defaultLife = lobby.config.startingLife ?? 20;

  const [pairs, setPairs] = useState<DraftPair[]>([]);

  const usedIds = new Set<string>();
  for (const p of pairs) {
    for (const id of p.teams[0]) usedIds.add(id);
    for (const id of p.teams[1]) usedIds.add(id);
  }
  const available = eligible.filter((id) => !usedIds.has(id));

  function addPair(twoHeaded: boolean) {
    const need = twoHeaded ? 4 : 2;
    if (available.length < need) return;
    const teams: [string[], string[]] = twoHeaded
      ? [[available[0], available[1]], [available[2], available[3]]]
      : [[available[0]], [available[1]]];
    setPairs((ps) => [
      ...ps,
      { teams, bestOf: 1, startingLife: defaultLife },
    ]);
  }

  function removePair(idx: number) {
    setPairs((ps) => ps.filter((_, i) => i !== idx));
  }

  function updatePair(idx: number, patch: Partial<DraftPair>) {
    setPairs((ps) => ps.map((p, i) => (i === idx ? { ...p, ...patch } : p)));
  }

  function startMatches() {
    const pairings: MatchPairing[] = pairs.map((p) => ({
      teams: p.teams,
      bestOf: p.bestOf,
      startingLife: p.startingLife,
    }));
    send({ type: "startMatches", pairings });
  }

  if (!isAdmin) {
    return (
      <Centered>
        <p className="text-lg font-semibold">Waiting for the admin…</p>
        <p className="text-sm text-zinc-500">
          They&apos;re setting up the match pairings.
        </p>
      </Centered>
    );
  }

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-bold">Pair up the players</h1>
        <p className="text-sm text-zinc-500">
          Add 1-on-1 duels or two-headed-giant pods. Anyone you don&apos;t
          include sits this round out — you can re-pair after.
        </p>
      </header>

      {error ? (
        <p className="rounded border border-red-300 bg-red-50 p-2 text-sm text-red-700 dark:border-red-700 dark:bg-red-950 dark:text-red-200">
          {error}
        </p>
      ) : null}

      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
          Pairings
        </h2>
        {pairs.length === 0 ? (
          <p className="text-xs text-zinc-500">No pairings yet.</p>
        ) : null}
        {pairs.map((p, idx) => (
          <PairRow
            key={idx}
            pair={p}
            allEligible={eligible}
            usedIds={usedIds}
            playerById={playerById}
            onChange={(patch) => updatePair(idx, patch)}
            onRemove={() => removePair(idx)}
          />
        ))}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => addPair(false)}
            disabled={available.length < 2}
            className="rounded border border-zinc-400 px-3 py-1 text-sm hover:bg-zinc-100 disabled:opacity-40 dark:hover:bg-zinc-800"
          >
            + Add 1v1
          </button>
          <button
            type="button"
            onClick={() => addPair(true)}
            disabled={available.length < 4}
            className="rounded border border-zinc-400 px-3 py-1 text-sm hover:bg-zinc-100 disabled:opacity-40 dark:hover:bg-zinc-800"
          >
            + Add 2HG (2v2)
          </button>
        </div>
      </section>

      <section className="space-y-1">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
          Sitting out this round ({available.length})
        </h2>
        <p className="text-xs text-zinc-500">
          {available.length === 0
            ? "(none — everyone is paired)"
            : available
                .map((id) => playerById.get(id)?.name ?? id.slice(0, 6))
                .join(", ")}
        </p>
      </section>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={startMatches}
          disabled={pairs.length === 0}
          className="rounded bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-40"
        >
          Start matches
        </button>
      </div>
    </main>
  );
}

function PairRow({
  pair,
  allEligible,
  usedIds,
  playerById,
  onChange,
  onRemove,
}: {
  pair: DraftPair;
  allEligible: string[];
  usedIds: Set<string>;
  playerById: Map<string, { id: string; name: string }>;
  onChange: (patch: Partial<DraftPair>) => void;
  onRemove: () => void;
}) {
  const isTeam = pair.teams[0].length > 1 || pair.teams[1].length > 1;

  function pickerOptions(currentId: string) {
    return allEligible.filter(
      (id) => id === currentId || !usedIds.has(id),
    );
  }

  function setSlot(teamIdx: 0 | 1, slot: 0 | 1, newId: string) {
    const teams: [string[], string[]] = [
      pair.teams[0].slice(),
      pair.teams[1].slice(),
    ];
    teams[teamIdx][slot] = newId;
    onChange({ teams });
  }

  function renderSlot(teamIdx: 0 | 1, slot: 0 | 1) {
    const id = pair.teams[teamIdx][slot];
    if (id === undefined) return null;
    return (
      <select
        key={`${teamIdx}-${slot}`}
        value={id}
        onChange={(e) => setSlot(teamIdx, slot, e.target.value)}
        className="rounded border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-600 dark:bg-zinc-800"
      >
        {pickerOptions(id).map((opt) => (
          <option key={opt} value={opt}>
            {playerById.get(opt)?.name ?? opt.slice(0, 6)}
          </option>
        ))}
      </select>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded border border-zinc-300 p-2 dark:border-zinc-700">
      {isTeam ? (
        <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200">
          2HG
        </span>
      ) : null}

      <div className="flex items-center gap-1">
        {renderSlot(0, 0)}
        {pair.teams[0][1] !== undefined ? (
          <>
            <span className="text-xs text-zinc-500">+</span>
            {renderSlot(0, 1)}
          </>
        ) : null}
      </div>

      <span className="text-sm text-zinc-500">vs</span>

      <div className="flex items-center gap-1">
        {renderSlot(1, 0)}
        {pair.teams[1][1] !== undefined ? (
          <>
            <span className="text-xs text-zinc-500">+</span>
            {renderSlot(1, 1)}
          </>
        ) : null}
      </div>

      <span className="ml-2 text-xs text-zinc-500">Best of</span>
      <select
        value={pair.bestOf}
        onChange={(e) =>
          onChange({ bestOf: Number(e.target.value) as BestOf })
        }
        className="rounded border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-600 dark:bg-zinc-800"
      >
        <option value={1}>1</option>
        <option value={3}>3</option>
        <option value={5}>5</option>
      </select>

      <span className="text-xs text-zinc-500">Life</span>
      <input
        type="number"
        min={1}
        max={99}
        value={pair.startingLife}
        onChange={(e) =>
          onChange({
            startingLife: Math.max(1, Math.min(99, Number(e.target.value) || 1)),
          })
        }
        className="w-16 rounded border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-600 dark:bg-zinc-800"
      />

      <button
        type="button"
        onClick={onRemove}
        className="ml-auto rounded px-2 py-1 text-xs text-red-600 hover:bg-red-50 dark:hover:bg-red-950"
      >
        remove
      </button>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <main className="grid min-h-svh place-items-center p-6 text-center">
      <div className="space-y-2">{children}</div>
    </main>
  );
}
