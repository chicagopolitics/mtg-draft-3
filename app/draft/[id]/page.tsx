"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import usePartySocket from "partysocket/react";

import { CardView } from "@/components/Card";
import { DeckStats } from "@/components/DeckStats";
import {
  type ClientMessage,
  type DraftPrivateState,
  type DraftPublicState,
  type LobbyState,
  type ServerMessage,
  isValidLobbyId,
} from "@/lib/lobby/protocol";
import type { DraftCard } from "@/lib/cards/schema";
import {
  getOrCreatePlayerId,
  getStoredPlayerName,
} from "@/lib/identity";
import { getPartykitHost } from "@/lib/partykit-client";

export default function DraftPage() {
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

  return <DraftConnected lobbyId={lobbyId} playerId={playerId} name={name} />;
}

function DraftConnected({
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
  const [draftPrivate, setDraftPrivate] = useState<DraftPrivateState | null>(
    null,
  );
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
        setDraftPrivate(msg.draftPrivate);
        if (msg.state.phase === "waiting") {
          router.push(`/lobby/${lobbyId}`);
        } else if (msg.state.phase === "deckbuilding") {
          router.push(`/build/${lobbyId}`);
        } else if (msg.state.phase === "constructing") {
          router.push(`/construct/${lobbyId}`);
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
            ? "Draft already in progress."
            : "Lobby is full.",
        );
      }
    },
  });

  function pick(instanceId: string) {
    const msg: ClientMessage = { type: "pick", instanceId };
    socket.send(JSON.stringify(msg));
  }

  if (!state || !state.draft) {
    return <Centered>loading draft…</Centered>;
  }

  return (
    <DraftActive
      lobbyId={lobbyId}
      playerId={playerId}
      draft={state.draft}
      priv={draftPrivate}
      pick={pick}
      error={error}
    />
  );
}

function DraftActive({
  lobbyId,
  playerId,
  draft,
  priv,
  pick,
  error,
}: {
  lobbyId: string;
  playerId: string;
  draft: DraftPublicState;
  priv: DraftPrivateState | null;
  pick: (instanceId: string) => void;
  error: string | null;
}) {
  const me = draft.players.find((p) => p.id === playerId);
  const youHavePicked = priv?.hasPickedThisRotation ?? false;
  const noPackYet = !priv?.currentPack || priv.currentPack.length === 0;

  const passWord = draft.direction === "left" ? "←" : "→";

  return (
    <div className="flex flex-1 flex-col gap-4 bg-zinc-50 p-6 font-sans dark:bg-black">
      <header className="flex items-baseline justify-between border-b border-zinc-200 pb-3 dark:border-zinc-800">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            draft —{" "}
            <span className="font-mono text-zinc-500">{lobbyId}</span>
          </h1>
          <p className="text-xs text-zinc-500">
            round {draft.round} of {draft.totalRounds} · passing {passWord}{" "}
            {draft.direction}
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs text-zinc-500">you</p>
          <p className="text-sm font-medium">{me?.name ?? "—"}</p>
        </div>
      </header>

      <SeatStrip draft={draft} youId={playerId} />

      <section className="flex-1">
        {noPackYet ? (
          <div className="flex h-40 items-center justify-center rounded border border-dashed border-zinc-300 text-sm text-zinc-500 dark:border-zinc-700">
            waiting for the next pack to arrive…
          </div>
        ) : youHavePicked ? (
          <div className="flex h-40 flex-col items-center justify-center gap-1 rounded border border-emerald-300 bg-emerald-50 text-sm text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300">
            <p>pick locked in.</p>
            <p className="text-xs text-emerald-700/70 dark:text-emerald-400/70">
              waiting for{" "}
              {draft.players.filter(
                (p) =>
                  p.hasCurrentPack &&
                  !p.hasPickedThisRotation &&
                  p.id !== playerId,
              ).length}{" "}
              other player(s)…
            </p>
          </div>
        ) : (
          <PackPicker pack={priv!.currentPack!} onPick={pick} />
        )}
      </section>

      <DeckStats
        cards={priv?.picked ?? []}
        title="your pool so far"
        emptyHint="stats will appear once you've drafted a card."
      />

      <PickedPool picked={priv?.picked ?? []} />

      {error ? (
        <p className="text-center text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function SeatStrip({
  draft,
  youId,
}: {
  draft: DraftPublicState;
  youId: string;
}) {
  return (
    <section className="rounded border border-zinc-200 p-3 dark:border-zinc-800">
      <div className="mb-2 text-xs uppercase tracking-wide text-zinc-500">
        seats — passing {draft.direction}
      </div>
      <ol className="flex flex-wrap gap-2 text-sm">
        {draft.players.map((p) => {
          const isYou = p.id === youId;
          const stateLabel = !p.connected
            ? "away"
            : p.hasPickedThisRotation
            ? "picked"
            : p.hasCurrentPack
            ? `picking (${p.currentPackSize})`
            : "no pack";
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
              <span className="font-mono text-[10px] uppercase text-zinc-500">
                {stateLabel}
              </span>
              <span className="font-mono text-[10px] text-zinc-400">
                {p.pickedCount}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function PackPicker({
  pack,
  onPick,
}: {
  pack: DraftCard[];
  onPick: (instanceId: string) => void;
}) {
  return (
    <div>
      <p className="mb-2 text-xs uppercase tracking-wide text-zinc-500">
        click a card to draft it ({pack.length} in pack)
      </p>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-3">
        {pack.map((card) => (
          <button
            key={card.instanceId}
            onClick={() => onPick(card.instanceId)}
            className="rounded transition hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-emerald-500"
          >
            <CardView card={card} />
          </button>
        ))}
      </div>
    </div>
  );
}

function PickedPool({ picked }: { picked: DraftCard[] }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="rounded border border-zinc-200 dark:border-zinc-800">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between p-3 text-xs uppercase tracking-wide text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-900"
      >
        <span>your picks ({picked.length})</span>
        <span>{open ? "▼" : "▶"}</span>
      </button>
      {open ? (
        picked.length === 0 ? (
          <p className="p-3 text-xs text-zinc-500">nothing yet.</p>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(12rem,1fr))] gap-2 p-3">
            {picked.map((card) => (
              <CardView key={card.instanceId} card={card} />
            ))}
          </div>
        )
      ) : null}
    </section>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 bg-zinc-50 p-6 text-sm text-zinc-700 dark:bg-black dark:text-zinc-300">
      {children}
    </div>
  );
}
