"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import usePartySocket from "partysocket/react";

import { CardView } from "@/components/Card";
import { CompactCard } from "@/components/CompactCard";
import {
  type BattlefieldCard,
  type ClientMessage,
  type LobbyState,
  type MatchPublicState,
  type PlayAction,
  type PlayPrivateState,
  type PlayPublicPlayer,
  type PlayPublicState,
  type ServerMessage,
  type Zone,
  type ZoneTarget,
  isValidLobbyId,
} from "@/lib/lobby/protocol";
import type { DraftCard } from "@/lib/cards/schema";
import {
  getOrCreatePlayerId,
  getStoredPlayerName,
} from "@/lib/identity";
import { getPartykitHost } from "@/lib/partykit-client";

type CardActionTarget = {
  card: DraftCard;
  zone: Zone;
};

type PileTarget = {
  zone: "deck" | "graveyard" | "exile";
  ownerId: string;
  ownerName: string;
};

type PeekTarget = {
  card: DraftCard;
  tapped?: boolean;
};

type DropTarget = "hand" | "battlefield" | "graveyard";

type DragApi = {
  startDrag: (from: Zone, card: DraftCard, e: React.DragEvent) => void;
  endDrag: () => void;
  isValidDropFor: (target: DropTarget) => boolean;
  handleDrop: (target: DropTarget) => void;
  /** True when the in-flight drag is a valid attach onto this creature. */
  canAttachTo: (target: DraftCard) => boolean;
  /** Drop the in-flight drag onto a battlefield card to attach. */
  handleDropOnCard: (targetInstanceId: string) => void;
};

function isValidDropMove(from: Zone, to: DropTarget): boolean {
  if (from === to) return false;
  if (from === "hand") return to === "battlefield" || to === "graveyard";
  if (from === "battlefield") return to === "hand" || to === "graveyard";
  return false;
}

export default function PlayPage() {
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

  return <PlayConnected lobbyId={lobbyId} playerId={playerId} name={name} />;
}

function PlayConnected({
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
  const [priv, setPriv] = useState<PlayPrivateState | null>(null);
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
        setPriv(msg.playPrivate);
        if (msg.state.phase === "waiting") {
          router.push(`/lobby/${lobbyId}`);
        } else if (msg.state.phase === "drafting") {
          router.push(`/draft/${lobbyId}`);
        } else if (msg.state.phase === "deckbuilding") {
          router.push(`/build/${lobbyId}`);
        } else if (msg.state.phase === "matching") {
          router.push(`/match/${lobbyId}`);
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

  function send(action: PlayAction) {
    const msg: ClientMessage = { type: "playAction", action };
    socket.send(JSON.stringify(msg));
  }

  function sendRaw(msg: ClientMessage) {
    socket.send(JSON.stringify(msg));
  }

  if (!state) return <Centered>loading play table…</Centered>;
  if (!state.matches || state.matches.length === 0) {
    return <Centered>setting up matches…</Centered>;
  }

  const myMatch = priv?.matchId
    ? state.matches.find((m) => m.id === priv.matchId)
    : null;
  const isAdmin = state.players.find((p) => p.id === playerId)?.isAdmin ?? false;

  if (!myMatch) {
    return (
      <SpectatorView
        state={state}
        playerId={playerId}
        isAdmin={isAdmin}
        onReturn={() => sendRaw({ type: "returnToMatching" })}
      />
    );
  }
  if (!priv) return <Centered>loading hand…</Centered>;

  const synthetic: PlayPublicState = {
    seatOrder: myMatch.players.map((p) => p.id),
    players: myMatch.players,
  };

  return (
    <PlayBoard
      lobbyId={lobbyId}
      playerId={playerId}
      lobby={state}
      play={synthetic}
      priv={priv}
      match={myMatch}
      isAdmin={isAdmin}
      send={send}
      sendRaw={sendRaw}
      error={error}
    />
  );
}

function SpectatorView({
  state,
  playerId,
  isAdmin,
  onReturn,
}: {
  state: LobbyState;
  playerId: string;
  isAdmin: boolean;
  onReturn: () => void;
}) {
  const matches = state.matches ?? [];
  const allComplete = matches.every((m) => m.status === "complete");
  const me = state.players.find((p) => p.id === playerId);
  return (
    <main className="mx-auto max-w-3xl space-y-4 p-6">
      <h1 className="text-2xl font-bold">
        {me?.name ? `${me.name}, you're` : "You're"} sitting this round out
      </h1>
      <ul className="space-y-2">
        {matches.map((m) => (
          <li
            key={m.id}
            className="rounded border border-zinc-300 p-3 text-sm dark:border-zinc-700"
          >
            <div className="flex items-center justify-between">
              <span>
                {m.players[0].name} <span className="text-zinc-500">vs</span>{" "}
                {m.players[1].name}
              </span>
              <span className="font-mono text-xs text-zinc-500">
                Bo{m.bestOf} · game {m.gameNumber}
              </span>
            </div>
            <div className="mt-1 text-xs text-zinc-500">
              {m.status === "complete"
                ? `Winner: ${m.players.find((p) => p.id === m.matchWinner)?.name ?? "?"}`
                : `${m.wins[m.players[0].id] ?? 0} – ${m.wins[m.players[1].id] ?? 0}`}
            </div>
          </li>
        ))}
      </ul>
      {isAdmin && allComplete ? (
        <button
          type="button"
          onClick={onReturn}
          className="rounded bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
        >
          Re-pair players
        </button>
      ) : (
        <p className="text-xs text-zinc-500">
          Waiting for active matches to finish.
        </p>
      )}
    </main>
  );
}

function PlayBoard({
  lobbyId,
  playerId,
  lobby,
  play,
  priv,
  match,
  isAdmin,
  send,
  sendRaw,
  error,
}: {
  lobbyId: string;
  playerId: string;
  lobby: LobbyState;
  play: PlayPublicState;
  priv: PlayPrivateState;
  match: MatchPublicState;
  isAdmin: boolean;
  send: (action: PlayAction) => void;
  sendRaw: (msg: ClientMessage) => void;
  error: string | null;
}) {
  const opponentId = match.playerIds.find((id) => id !== playerId) ?? "";
  const myWins = match.wins[playerId] ?? 0;
  const oppWins = match.wins[opponentId] ?? 0;
  const winsNeeded = Math.ceil(match.bestOf / 2);
  const allMatches = lobby.matches ?? [];
  const allMatchesComplete = allMatches.every((m) => m.status === "complete");
  const opponentName =
    match.players.find((p) => p.id === opponentId)?.name ?? "Opponent";
  void lobbyId;
  const me = play.players.find((p) => p.id === playerId);
  const opponents = play.players.filter((p) => p.id !== playerId);

  const [cardAction, setCardAction] = useState<CardActionTarget | null>(null);
  const [pile, setPile] = useState<PileTarget | null>(null);
  const [peek, setPeek] = useState<PeekTarget | null>(null);
  const [dragging, setDragging] = useState<{
    from: Zone;
    instanceId: string;
    card: DraftCard;
  } | null>(null);

  if (!me) return <Centered>not seated at this table.</Centered>;

  function onYourCardClick(card: DraftCard, zone: Zone) {
    setCardAction({ card, zone });
  }
  function onYourPileClick(zone: PileTarget["zone"]) {
    setPile({ zone, ownerId: playerId, ownerName: me!.name });
  }
  function onOpponentPileClick(p: PlayPublicPlayer, zone: PileTarget["zone"]) {
    if (zone === "deck") return; // can't peek opponent decks
    setPile({ zone, ownerId: p.id, ownerName: p.name });
  }

  function performAndClose(action: PlayAction) {
    send(action);
    setCardAction(null);
    setPile(null);
  }

  // Drag-and-drop API for zone moves and aura/equipment attachment.
  function startDrag(from: Zone, card: DraftCard, e: React.DragEvent) {
    e.dataTransfer.effectAllowed = "move";
    // Some browsers need data set for the drag to take effect.
    e.dataTransfer.setData("text/plain", card.instanceId);
    setDragging({ from, instanceId: card.instanceId, card });
  }
  function endDrag() {
    setDragging(null);
  }
  function isValidDropFor(target: DropTarget): boolean {
    if (!dragging) return false;
    if (dragging.from === target) return false;
    if (dragging.from === "hand")
      return target === "battlefield" || target === "graveyard";
    if (dragging.from === "battlefield")
      return target === "hand" || target === "graveyard";
    return false;
  }
  function handleDrop(target: DropTarget) {
    const drag = dragging;
    setDragging(null);
    if (!drag) return;
    if (!isValidDropMove(drag.from, target)) return;
    send({
      type: "move",
      instanceId: drag.instanceId,
      from: drag.from,
      to: target,
    });
  }
  function canAttachTo(target: DraftCard): boolean {
    if (!dragging) return false;
    if (dragging.instanceId === target.instanceId) return false;
    // Source must be a card that attaches to creatures.
    if (dragging.card.type !== "enchantment" && dragging.card.type !== "artifact") {
      return false;
    }
    // Target must be a creature.
    if (target.type !== "creature") return false;
    // Source must come from hand or battlefield.
    if (dragging.from !== "hand" && dragging.from !== "battlefield") return false;
    return true;
  }
  function handleDropOnCard(targetInstanceId: string) {
    const drag = dragging;
    setDragging(null);
    if (!drag) return;
    if (drag.instanceId === targetInstanceId) return;
    if (drag.from === "hand") {
      send({
        type: "move",
        instanceId: drag.instanceId,
        from: "hand",
        to: "battlefield",
        attachedTo: targetInstanceId,
      });
    } else if (drag.from === "battlefield") {
      send({
        type: "setAttached",
        instanceId: drag.instanceId,
        targetInstanceId,
      });
    }
  }
  const dragApi: DragApi = {
    startDrag,
    endDrag,
    isValidDropFor,
    handleDrop,
    canAttachTo,
    handleDropOnCard,
  };

  return (
    <div className="flex h-screen flex-col bg-zinc-100 font-sans dark:bg-black">
      <header className="flex shrink-0 items-baseline justify-between border-b border-zinc-200 bg-white px-4 py-2 dark:border-zinc-800 dark:bg-zinc-950">
        <div>
          <h1 className="text-base font-semibold tracking-tight">
            play —{" "}
            <span className="font-mono text-zinc-500">{lobbyId}</span>
          </h1>
          <p className="text-[11px] text-zinc-500">
            tap your cards/piles for actions · opponent zones are read-only
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right text-xs text-zinc-600 dark:text-zinc-400">
            <div className="font-mono">
              vs {opponentName} · Bo{match.bestOf} · game {match.gameNumber}
            </div>
            <div className="font-mono">
              You {myWins} – {oppWins} {opponentName} (first to {winsNeeded})
            </div>
          </div>
          {match.status === "active" && !match.currentGameWinner ? (
            <>
              <div
                className={`rounded px-2 py-1 text-xs font-semibold ${
                  match.currentTurnPlayerId === playerId
                    ? "bg-emerald-500 text-white"
                    : "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                }`}
                title={`Turn ${match.turnNumber}`}
              >
                {match.currentTurnPlayerId === playerId
                  ? `Your turn (T${match.turnNumber})`
                  : `${opponentName}'s turn (T${match.turnNumber})`}
              </div>
              <button
                type="button"
                onClick={() =>
                  sendRaw({ type: "passTurn", matchId: match.id })
                }
                className="rounded bg-emerald-600 px-2 py-1 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-40"
                disabled={match.currentTurnPlayerId !== playerId}
                title={
                  match.currentTurnPlayerId === playerId
                    ? "End your turn"
                    : "It's not your turn"
                }
              >
                Pass turn
              </button>
              <button
                type="button"
                onClick={() => {
                  if (confirm("Concede this game?")) {
                    sendRaw({ type: "concedeGame", matchId: match.id });
                  }
                }}
                className="rounded border border-red-400 px-2 py-1 text-xs text-red-600 hover:bg-red-50 dark:hover:bg-red-950"
              >
                Concede game
              </button>
            </>
          ) : null}
          <p className="text-sm font-medium">{me.name}</p>
        </div>
      </header>

      <div className="flex shrink-0 gap-2 overflow-x-auto border-b border-zinc-200 bg-white p-2 dark:border-zinc-800 dark:bg-zinc-950">
        {opponents.length === 0 ? (
          <p className="px-2 py-4 text-xs text-zinc-500">
            no opponents at this table.
          </p>
        ) : (
          opponents.map((opp) => (
            <OpponentArea
              key={opp.id}
              player={opp}
              isCurrentTurn={match.currentTurnPlayerId === opp.id}
              onCardPeek={(card, tapped) => setPeek({ card, tapped })}
              onPileClick={(zone) => onOpponentPileClick(opp, zone)}
            />
          ))
        )}
      </div>

      <div className="flex flex-1 overflow-hidden">
        <YourArea
          me={me}
          priv={priv}
          isCurrentTurn={match.currentTurnPlayerId === playerId}
          onCardClick={onYourCardClick}
          dragApi={dragApi}
          send={send}
        />
        <Sidebar
          me={me}
          send={send}
          onPileClick={onYourPileClick}
          dragApi={dragApi}
        />
      </div>

      {cardAction ? (
        <CardActionModal
          target={cardAction}
          ownTapped={(() => {
            if (cardAction.zone !== "battlefield") return false;
            const bf = me.battlefield.find(
              (b) => b.card.instanceId === cardAction.card.instanceId,
            );
            return bf?.tapped ?? false;
          })()}
          isAttached={(() => {
            if (cardAction.zone !== "battlefield") return false;
            const bf = me.battlefield.find(
              (b) => b.card.instanceId === cardAction.card.instanceId,
            );
            return !!bf?.attachedTo;
          })()}
          onClose={() => setCardAction(null)}
          onAction={performAndClose}
        />
      ) : null}

      {pile ? (
        <PileModal
          pile={pile}
          self={me}
          opponents={opponents}
          priv={priv}
          isOwn={pile.ownerId === playerId}
          onClose={() => setPile(null)}
          onAction={performAndClose}
          onPeek={(card) => setPeek({ card })}
        />
      ) : null}

      {peek ? (
        <PeekModal target={peek} onClose={() => setPeek(null)} />
      ) : null}

      {error ? (
        <p className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded bg-red-100 px-3 py-1 text-xs text-red-700 dark:bg-red-900/40 dark:text-red-300">
          {error}
        </p>
      ) : null}

      {match.status === "active" && match.currentGameWinner ? (
        <ResultOverlay
          title={
            match.currentGameWinner === playerId
              ? "You won the game!"
              : `${opponentName} won the game.`
          }
          subtitle={`Score: You ${myWins} – ${oppWins} ${opponentName}`}
          actionLabel="Start next game"
          onAction={() => sendRaw({ type: "advanceGame", matchId: match.id })}
        />
      ) : null}

      {match.status === "complete" ? (
        <ResultOverlay
          title={
            match.matchWinner === playerId
              ? "You won the match!"
              : `${opponentName} won the match.`
          }
          subtitle={`Final: You ${myWins} – ${oppWins} ${opponentName}`}
          actionLabel={
            isAdmin && allMatchesComplete
              ? "Re-pair players"
              : isAdmin
                ? "Waiting for other matches…"
                : "Waiting for other matches…"
          }
          onAction={
            isAdmin && allMatchesComplete
              ? () => sendRaw({ type: "returnToMatching" })
              : undefined
          }
        />
      ) : null}
    </div>
  );
}

function ResultOverlay({
  title,
  subtitle,
  actionLabel,
  onAction,
}: {
  title: string;
  subtitle: string;
  actionLabel: string;
  onAction?: () => void;
}) {
  return (
    <div className="absolute inset-0 z-50 grid place-items-center bg-black/60">
      <div className="space-y-3 rounded bg-white p-6 text-center shadow-xl dark:bg-zinc-900">
        <h2 className="text-xl font-bold">{title}</h2>
        <p className="text-sm text-zinc-500">{subtitle}</p>
        {onAction ? (
          <button
            type="button"
            onClick={onAction}
            className="rounded bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
          >
            {actionLabel}
          </button>
        ) : (
          <p className="text-xs text-zinc-400">{actionLabel}</p>
        )}
      </div>
    </div>
  );
}

function OpponentArea({
  player,
  isCurrentTurn = false,
  onCardPeek,
  onPileClick,
}: {
  player: PlayPublicPlayer;
  isCurrentTurn?: boolean;
  onCardPeek: (card: DraftCard, tapped: boolean) => void;
  onPileClick: (zone: "graveyard" | "exile") => void;
}) {
  const lands = player.battlefield.filter((b) => b.card.type === "land");
  const nonLands = player.battlefield.filter((b) => b.card.type !== "land");
  const landGroups = new Map<string, typeof lands>();
  for (const b of lands) {
    const key = b.card.id;
    const group = landGroups.get(key);
    if (group) group.push(b);
    else landGroups.set(key, [b]);
  }
  return (
    <section
      className={`flex min-w-0 flex-1 flex-col gap-1 rounded border bg-zinc-50 p-2 dark:bg-zinc-900 ${
        isCurrentTurn
          ? "border-emerald-500 ring-2 ring-emerald-500/40"
          : "border-zinc-200 dark:border-zinc-800"
      } ${!player.connected ? "opacity-60" : ""}`}
    >
      <header className="flex items-baseline gap-3">
        <p className="text-sm font-semibold">{player.name}</p>
        {isCurrentTurn ? (
          <span className="rounded bg-emerald-500 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
            their turn
          </span>
        ) : null}
        <p className="font-mono text-sm text-rose-600 dark:text-rose-400">
          ♥ {player.life}
        </p>
      </header>
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-zinc-500">
        <span>hand: {player.handSize}</span>
        <span>·</span>
        <span>deck: {player.deckSize}</span>
        {!player.connected ? (
          <>
            <span>·</span>
            <span className="text-amber-600 dark:text-amber-400">away</span>
          </>
        ) : null}
      </div>
      <div className="flex min-h-24 flex-col gap-2 rounded bg-white p-1 dark:bg-zinc-950">
        {player.battlefield.length === 0 ? (
          <p className="px-2 py-3 text-[10px] text-zinc-400">
            empty battlefield
          </p>
        ) : (
          <>
            {nonLands.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {nonLands.map((b) => (
                  <CompactCard
                    key={b.card.instanceId}
                    card={b.card}
                    tapped={b.tapped}
                    size="xs"
                    onClick={() => onCardPeek(b.card, b.tapped)}
                  />
                ))}
              </div>
            ) : null}
            {lands.length > 0 ? (
              <div
                className={`flex flex-wrap items-end gap-x-3 gap-y-2 ${
                  nonLands.length > 0
                    ? "mt-auto border-t border-zinc-200/60 pt-1 dark:border-zinc-800/60"
                    : ""
                }`}
              >
                {[...landGroups.entries()].map(([groupKey, group]) => (
                  <div key={groupKey} className="flex items-end">
                    {group.map((b, i) => (
                      <CompactCard
                        key={b.card.instanceId}
                        card={b.card}
                        tapped={b.tapped}
                        size="xs"
                        style={{ marginLeft: i === 0 ? 0 : "-3.5rem" }}
                        onClick={() => onCardPeek(b.card, b.tapped)}
                      />
                    ))}
                  </div>
                ))}
              </div>
            ) : null}
          </>
        )}
      </div>
      <div className="flex gap-1">
        <PileChip
          label="grave"
          count={player.graveyard.length}
          topCard={player.graveyard[player.graveyard.length - 1]}
          onClick={() =>
            player.graveyard.length > 0 ? onPileClick("graveyard") : null
          }
        />
        <PileChip
          label="exile"
          count={player.exile.length}
          topCard={player.exile[player.exile.length - 1]}
          onClick={() =>
            player.exile.length > 0 ? onPileClick("exile") : null
          }
        />
      </div>
    </section>
  );
}

function PileChip({
  label,
  count,
  topCard,
  onClick,
}: {
  label: string;
  count: number;
  topCard: DraftCard | undefined;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={count === 0}
      className="flex w-36 items-center gap-1 rounded bg-white p-1 text-left text-xs disabled:opacity-50 hover:bg-zinc-50 dark:bg-zinc-950 dark:hover:bg-zinc-900"
    >
      <div className="flex flex-col">
        <span className="text-[10px] uppercase text-zinc-500">{label}</span>
        <span className="font-mono text-xs">{count}</span>
      </div>
      {topCard ? (
        <span className="ml-auto truncate text-[11px] text-zinc-700 dark:text-zinc-300">
          {topCard.name}
        </span>
      ) : null}
    </button>
  );
}

function YourArea({
  me,
  priv,
  isCurrentTurn = false,
  onCardClick,
  dragApi,
  send,
}: {
  me: PlayPublicPlayer;
  priv: PlayPrivateState;
  isCurrentTurn?: boolean;
  onCardClick: (card: DraftCard, zone: Zone) => void;
  dragApi: DragApi;
  send: (action: PlayAction) => void;
}) {
  const bfHighlight = dragApi.isValidDropFor("battlefield");
  const handHighlight = dragApi.isValidDropFor("hand");

  const lands = me.battlefield.filter((b) => b.card.type === "land");
  const nonLands = me.battlefield.filter((b) => b.card.type !== "land");
  const landGroups = new Map<string, typeof lands>();
  for (const b of lands) {
    const key = b.card.id;
    const group = landGroups.get(key);
    if (group) group.push(b);
    else landGroups.set(key, [b]);
  }

  function renderBattlefieldCard(b: BattlefieldCard) {
    const isAttachTarget = dragApi.canAttachTo(b.card);
    return (
      <CompactCard
        card={b.card}
        tapped={b.tapped}
        size="md"
        onClick={() =>
          send({
            type: "tap",
            instanceId: b.card.instanceId,
            tapped: !b.tapped,
          })
        }
        onMenu={() => onCardClick(b.card, "battlefield")}
        draggable
        onDragStart={(e) => dragApi.startDrag("battlefield", b.card, e)}
        onDragEnd={dragApi.endDrag}
        highlight={isAttachTarget}
        onDragOver={(e) => {
          if (dragApi.canAttachTo(b.card)) {
            e.preventDefault();
            e.stopPropagation();
          }
        }}
        onDrop={(e) => {
          if (dragApi.canAttachTo(b.card)) {
            e.preventDefault();
            e.stopPropagation();
            dragApi.handleDropOnCard(b.card.instanceId);
          }
        }}
      />
    );
  }

  return (
    <div
      className={`flex min-w-0 flex-1 flex-col gap-3 overflow-y-auto p-4 ${
        isCurrentTurn ? "ring-4 ring-inset ring-emerald-500/50" : ""
      }`}
    >
      <section
        onDragOver={(e) => {
          if (dragApi.isValidDropFor("battlefield")) e.preventDefault();
        }}
        onDrop={(e) => {
          e.preventDefault();
          dragApi.handleDrop("battlefield");
        }}
        className={`flex flex-1 flex-col rounded border-2 border-dashed bg-emerald-50/40 p-2 transition-colors dark:bg-emerald-950/20 ${
          bfHighlight
            ? "border-emerald-500 bg-emerald-100 dark:border-emerald-400 dark:bg-emerald-950/60"
            : "border-emerald-300 dark:border-emerald-900/50"
        }`}
      >
        <p className="mb-1 flex items-center gap-2 text-[10px] uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
          <span>your battlefield ({me.battlefield.length})</span>
          {isCurrentTurn ? (
            <span className="rounded bg-emerald-500 px-1.5 py-0.5 text-[10px] font-bold text-white">
              your turn
            </span>
          ) : null}
          {bfHighlight ? <span>· drop here</span> : null}
        </p>
        {me.battlefield.length === 0 ? (
          <p className="p-2 text-xs text-zinc-500">empty.</p>
        ) : (
          <div className="flex flex-1 flex-col gap-3">
            <div className="flex flex-wrap gap-2">
              {nonLands.length === 0 ? (
                <p className="p-2 text-xs text-zinc-400 italic">
                  no nonland permanents.
                </p>
              ) : (
                (() => {
                  const fieldIds = new Set(
                    nonLands.map((b) => b.card.instanceId),
                  );
                  const childrenByParent = new Map<string, BattlefieldCard[]>();
                  for (const b of nonLands) {
                    if (b.attachedTo && fieldIds.has(b.attachedTo)) {
                      const list =
                        childrenByParent.get(b.attachedTo) ?? [];
                      list.push(b);
                      childrenByParent.set(b.attachedTo, list);
                    }
                  }
                  const tops = nonLands.filter(
                    (b) =>
                      !b.attachedTo || !fieldIds.has(b.attachedTo),
                  );
                  return tops.map((parent) => {
                    const kids =
                      childrenByParent.get(parent.card.instanceId) ?? [];
                    if (kids.length === 0) {
                      return (
                        <div
                          key={parent.card.instanceId}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            onCardClick(parent.card, "battlefield");
                          }}
                        >
                          {renderBattlefieldCard(parent)}
                        </div>
                      );
                    }
                    // Stack: parent on top, attached cards offset down-right behind.
                    const offset = 24;
                    const w = 144 + kids.length * offset;
                    const h = 208 + kids.length * offset;
                    return (
                      <div
                        key={parent.card.instanceId}
                        className="relative"
                        style={{ width: w, height: h }}
                      >
                        {kids.map((kid, i) => (
                          <div
                            key={kid.card.instanceId}
                            className="absolute"
                            style={{
                              top: (i + 1) * offset,
                              left: (i + 1) * offset,
                              zIndex: i + 1,
                            }}
                            onContextMenu={(e) => {
                              e.preventDefault();
                              onCardClick(kid.card, "battlefield");
                            }}
                          >
                            {renderBattlefieldCard(kid)}
                          </div>
                        ))}
                        <div
                          className="absolute left-0 top-0"
                          style={{ zIndex: 100 }}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            onCardClick(parent.card, "battlefield");
                          }}
                        >
                          {renderBattlefieldCard(parent)}
                        </div>
                      </div>
                    );
                  });
                })()
              )}
            </div>

            {lands.length > 0 ? (
              <div className="mt-auto border-t border-emerald-200/60 pt-2 dark:border-emerald-900/30">
                <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
                  {[...landGroups.entries()].map(([groupKey, group]) => (
                    <div key={groupKey} className="flex items-end">
                      {group.map((b, i) => (
                        <CompactCard
                          key={b.card.instanceId}
                          card={b.card}
                          tapped={b.tapped}
                          size="md"
                          style={{ marginLeft: i === 0 ? 0 : "-7rem" }}
                          onClick={() =>
                            send({
                              type: "tap",
                              instanceId: b.card.instanceId,
                              tapped: !b.tapped,
                            })
                          }
                          onMenu={() => onCardClick(b.card, "battlefield")}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            onCardClick(b.card, "battlefield");
                          }}
                          draggable
                          onDragStart={(e) =>
                            dragApi.startDrag("battlefield", b.card, e)
                          }
                          onDragEnd={dragApi.endDrag}
                        />
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        )}
      </section>

      <section
        onDragOver={(e) => {
          if (dragApi.isValidDropFor("hand")) e.preventDefault();
        }}
        onDrop={(e) => {
          e.preventDefault();
          dragApi.handleDrop("hand");
        }}
        className={`group/hand h-32 overflow-hidden rounded border-2 border-dashed bg-sky-50/40 px-2 pb-2 pt-2 transition-[height,padding] duration-300 hover:h-[28rem] hover:pt-12 focus-within:h-[28rem] focus-within:pt-12 dark:bg-sky-950/20 ${
          handHighlight
            ? "border-sky-500 bg-sky-100 dark:border-sky-400 dark:bg-sky-950/60"
            : "border-sky-300 dark:border-sky-900/50"
        }`}
      >
        <p className="mb-1 text-[10px] uppercase tracking-wide text-sky-700 dark:text-sky-400">
          your hand ({priv.hand.length})
          {handHighlight ? " · drop here" : ""}
        </p>
        {priv.hand.length === 0 ? (
          <p className="p-2 text-xs text-zinc-500">empty.</p>
        ) : (
          <div className="flex items-start">
            {priv.hand.map((c, i) => (
              <button
                key={c.instanceId}
                onClick={() => onCardClick(c, "hand")}
                draggable
                onDragStart={(e) => dragApi.startDrag("hand", c, e)}
                onDragEnd={dragApi.endDrag}
                style={{ marginLeft: i === 0 ? 0 : "-10rem" }}
                className="relative shrink-0 rounded transition-transform duration-150 hover:z-20 hover:-translate-y-8 hover:drop-shadow-2xl focus:z-20 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              >
                <CardView card={c} />
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function Sidebar({
  me,
  send,
  onPileClick,
  dragApi,
}: {
  me: PlayPublicPlayer;
  send: (action: PlayAction) => void;
  onPileClick: (zone: "deck" | "graveyard" | "exile") => void;
  dragApi: DragApi;
}) {
  const graveHighlight = dragApi.isValidDropFor("graveyard");

  return (
    <aside className="flex w-56 shrink-0 flex-col gap-3 overflow-y-auto border-l border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950">
      <LifeCounter
        life={me.life}
        onAdjust={(delta) => send({ type: "adjustLife", delta })}
        onSet={(value) => send({ type: "setLife", value })}
      />
      <div className="flex flex-col gap-2">
        <PileTile
          label="deck"
          count={me.deckSize}
          onClick={() => onPileClick("deck")}
        />
        <PileTile
          label="graveyard"
          count={me.graveyard.length}
          topCard={me.graveyard[me.graveyard.length - 1]}
          onClick={() => onPileClick("graveyard")}
          highlight={graveHighlight}
          onDragOver={(e) => {
            if (dragApi.isValidDropFor("graveyard")) e.preventDefault();
          }}
          onDrop={(e) => {
            e.preventDefault();
            dragApi.handleDrop("graveyard");
          }}
        />
        <PileTile
          label="exile"
          count={me.exile.length}
          topCard={me.exile[me.exile.length - 1]}
          onClick={() => onPileClick("exile")}
        />
      </div>
      <UtilityButtons
        deckSize={me.deckSize}
        handSize={me.handSize}
        send={send}
      />
    </aside>
  );
}

function PileTile({
  label,
  count,
  topCard,
  onClick,
  highlight,
  onDragOver,
  onDrop,
}: {
  label: string;
  count: number;
  topCard?: DraftCard;
  onClick?: () => void;
  highlight?: boolean;
  onDragOver?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent) => void;
}) {
  return (
    <button
      onClick={onClick}
      onDragOver={onDragOver}
      onDrop={onDrop}
      className={`flex w-full items-center gap-2 rounded border bg-white px-2 py-1.5 text-left transition-colors dark:bg-zinc-900 ${
        highlight
          ? "border-emerald-500 bg-emerald-50 ring-2 ring-emerald-300 dark:border-emerald-400 dark:bg-emerald-950/40"
          : "border-zinc-300 hover:border-zinc-400 dark:border-zinc-700 dark:hover:border-zinc-500"
      }`}
    >
      <span className="w-16 shrink-0 text-[10px] uppercase tracking-wide text-zinc-500">
        {label}
      </span>
      <span className="w-7 shrink-0 text-right font-mono text-base">
        {count}
      </span>
      {topCard ? (
        <span className="ml-auto truncate text-[11px] text-zinc-700 dark:text-zinc-300">
          {topCard.name}
        </span>
      ) : (
        <span className="ml-auto text-[11px] text-zinc-400">empty</span>
      )}
    </button>
  );
}

function LifeCounter({
  life,
  onAdjust,
  onSet,
}: {
  life: number;
  onAdjust: (delta: number) => void;
  onSet: (value: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(life));
  return (
    <div className="flex w-full flex-col items-stretch gap-1 rounded border border-rose-300 bg-rose-50 p-2 dark:border-rose-900/50 dark:bg-rose-950/40">
      <span className="text-[10px] uppercase tracking-wide text-rose-700 dark:text-rose-400">
        life
      </span>
      <div className="flex items-center gap-2">
        {editing ? (
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value.replace(/[^\d-]/g, ""))}
            onBlur={() => {
              onSet(Number(draft) || 0);
              setEditing(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                onSet(Number(draft) || 0);
                setEditing(false);
              }
            }}
            autoFocus
            className="w-20 rounded border px-1 font-mono text-2xl"
          />
        ) : (
          <button
            onClick={() => {
              setDraft(String(life));
              setEditing(true);
            }}
            className="font-mono text-3xl font-semibold text-rose-700 dark:text-rose-300"
          >
            {life}
          </button>
        )}
      </div>
      <div className="grid grid-cols-4 gap-1 text-xs">
        <LifeBtn onClick={() => onAdjust(-5)}>-5</LifeBtn>
        <LifeBtn onClick={() => onAdjust(-1)}>-1</LifeBtn>
        <LifeBtn onClick={() => onAdjust(1)}>+1</LifeBtn>
        <LifeBtn onClick={() => onAdjust(5)}>+5</LifeBtn>
      </div>
    </div>
  );
}

function LifeBtn({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className="rounded bg-white py-1 font-mono hover:bg-rose-100 dark:bg-zinc-900 dark:hover:bg-rose-900/30"
    >
      {children}
    </button>
  );
}

function UtilityButtons({
  deckSize,
  handSize,
  send,
}: {
  deckSize: number;
  handSize: number;
  send: (action: PlayAction) => void;
}) {
  return (
    <div className="flex flex-col gap-1 rounded border border-zinc-300 bg-white p-2 dark:border-zinc-700 dark:bg-zinc-900">
      <span className="text-[10px] uppercase tracking-wide text-zinc-500">
        actions
      </span>
      <div className="grid grid-cols-2 gap-1 text-xs">
        <UtilBtn
          onClick={() => send({ type: "draw", count: 1 })}
          disabled={deckSize === 0}
        >
          draw 1
        </UtilBtn>
        <UtilBtn
          onClick={() => send({ type: "draw", count: 7 })}
          disabled={deckSize === 0}
        >
          draw 7
        </UtilBtn>
        <UtilBtn
          onClick={() => send({ type: "mulligan" })}
          disabled={handSize === 0}
        >
          mulligan
        </UtilBtn>
        <UtilBtn onClick={() => send({ type: "shuffleDeck" })}>shuffle</UtilBtn>
        <UtilBtn
          className="col-span-2"
          onClick={() => {
            if (confirm("Reset all zones, shuffle, draw 7?")) {
              send({ type: "newGame" });
            }
          }}
        >
          new game
        </UtilBtn>
      </div>
    </div>
  );
}

function UtilBtn({
  onClick,
  disabled,
  className = "",
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`rounded bg-zinc-100 px-2 py-1 hover:bg-zinc-200 disabled:opacity-40 dark:bg-zinc-800 dark:hover:bg-zinc-700 ${className}`}
    >
      {children}
    </button>
  );
}

// ---------- modals ----------

function CardActionModal({
  target,
  ownTapped,
  isAttached,
  onClose,
  onAction,
}: {
  target: CardActionTarget;
  ownTapped: boolean;
  isAttached: boolean;
  onClose: () => void;
  onAction: (action: PlayAction) => void;
}) {
  const { card, zone } = target;

  const moves: { label: string; to: ZoneTarget; tapped?: boolean }[] = (() => {
    switch (zone) {
      case "hand":
        return [
          { label: "play (untapped)", to: "battlefield", tapped: false },
          { label: "play tapped", to: "battlefield", tapped: true },
          { label: "discard", to: "graveyard" },
          { label: "exile", to: "exile" },
          { label: "to top of deck", to: "deck-top" },
          { label: "to bottom of deck", to: "deck-bottom" },
        ];
      case "battlefield":
        return [
          { label: "to graveyard", to: "graveyard" },
          { label: "to exile", to: "exile" },
          { label: "to hand", to: "hand" },
          { label: "to top of deck", to: "deck-top" },
          { label: "to bottom of deck", to: "deck-bottom" },
        ];
      case "graveyard":
        return [
          { label: "to hand", to: "hand" },
          { label: "to battlefield", to: "battlefield" },
          { label: "to exile", to: "exile" },
          { label: "to top of deck", to: "deck-top" },
          { label: "to bottom of deck", to: "deck-bottom" },
        ];
      case "exile":
        return [
          { label: "to hand", to: "hand" },
          { label: "to battlefield", to: "battlefield" },
          { label: "to graveyard", to: "graveyard" },
          { label: "to top of deck", to: "deck-top" },
          { label: "to bottom of deck", to: "deck-bottom" },
        ];
      case "deck":
        return [
          { label: "to hand", to: "hand" },
          { label: "to battlefield", to: "battlefield" },
          { label: "to graveyard", to: "graveyard" },
          { label: "to exile", to: "exile" },
        ];
    }
  })();

  return (
    <ModalShell title={card.name} subtitle={`from ${zone}`} onClose={onClose}>
      <div className="grid gap-3 sm:grid-cols-[18rem_1fr]">
        <div className="flex justify-center">
          <CardView card={card} />
        </div>
        <div className="flex flex-col gap-2">
          {zone === "battlefield" ? (
            <ActionBtn
              primary
              onClick={() =>
                onAction({
                  type: "tap",
                  instanceId: card.instanceId,
                  tapped: !ownTapped,
                })
              }
            >
              {ownTapped ? "untap" : "tap"}
            </ActionBtn>
          ) : null}
          {zone === "battlefield" && isAttached ? (
            <ActionBtn
              onClick={() =>
                onAction({
                  type: "setAttached",
                  instanceId: card.instanceId,
                  targetInstanceId: null,
                })
              }
            >
              detach
            </ActionBtn>
          ) : null}
          {moves.map((m) => (
            <ActionBtn
              key={m.label}
              onClick={() =>
                onAction({
                  type: "move",
                  instanceId: card.instanceId,
                  from: zone,
                  to: m.to,
                  tapped: m.tapped,
                })
              }
            >
              {m.label}
            </ActionBtn>
          ))}
        </div>
      </div>
    </ModalShell>
  );
}

function PileModal({
  pile,
  self,
  opponents,
  priv,
  isOwn,
  onClose,
  onAction,
  onPeek,
}: {
  pile: PileTarget;
  self: PlayPublicPlayer;
  opponents: PlayPublicPlayer[];
  priv: PlayPrivateState;
  isOwn: boolean;
  onClose: () => void;
  onAction: (action: PlayAction) => void;
  onPeek: (card: DraftCard) => void;
}) {
  const opp = opponents.find((p) => p.id === pile.ownerId);
  const cards: DraftCard[] = (() => {
    if (pile.zone === "deck") {
      return isOwn ? priv.deck : [];
    }
    if (isOwn) {
      return pile.zone === "graveyard" ? self.graveyard : self.exile;
    }
    if (!opp) return [];
    return pile.zone === "graveyard" ? opp.graveyard : opp.exile;
  })();

  const title = `${pile.ownerName}'s ${pile.zone}${
    pile.zone === "deck" && !isOwn ? " (hidden)" : ""
  }`;
  const subtitle =
    pile.zone === "deck" && isOwn
      ? `${cards.length} cards · top first · only you can see this`
      : `${cards.length} cards`;

  return (
    <ModalShell title={title} subtitle={subtitle} onClose={onClose}>
      {isOwn && pile.zone === "deck" ? (
        <div className="mb-3 flex flex-wrap gap-2">
          <ActionBtn onClick={() => onAction({ type: "draw", count: 1 })}>
            draw 1
          </ActionBtn>
          <ActionBtn onClick={() => onAction({ type: "shuffleDeck" })}>
            shuffle
          </ActionBtn>
          {cards[0] ? (
            <ActionBtn
              onClick={() =>
                onAction({
                  type: "move",
                  instanceId: cards[0].instanceId,
                  from: "deck",
                  to: "graveyard",
                })
              }
            >
              mill top
            </ActionBtn>
          ) : null}
        </div>
      ) : null}

      {cards.length === 0 ? (
        <p className="py-6 text-center text-xs text-zinc-500">empty.</p>
      ) : (
        <div className="grid max-h-[60vh] grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-2 overflow-y-auto">
          {cards.map((c) => (
            <button
              key={c.instanceId}
              onClick={() => {
                if (isOwn) {
                  // For your own pile, open a sub-action picker
                  onAction({
                    type: "move",
                    instanceId: c.instanceId,
                    from: pile.zone,
                    to: "hand",
                  });
                } else {
                  onPeek(c);
                }
              }}
              className="rounded transition hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-emerald-500"
            >
              <CardView card={c} />
            </button>
          ))}
        </div>
      )}
      {isOwn && cards.length > 0 ? (
        <p className="mt-3 text-center text-[11px] text-zinc-500">
          click any card to send it to your hand · for other moves use the
          card actions
        </p>
      ) : null}
    </ModalShell>
  );
}

function PeekModal({
  target,
  onClose,
}: {
  target: PeekTarget;
  onClose: () => void;
}) {
  return (
    <ModalShell title={target.card.name} subtitle="opponent card" onClose={onClose}>
      <div className="flex justify-center">
        <CardView card={target.card} />
      </div>
      {target.tapped ? (
        <p className="mt-3 text-center text-xs text-zinc-500">tapped</p>
      ) : null}
    </ModalShell>
  );
}

function ModalShell({
  title,
  subtitle,
  onClose,
  children,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-3xl overflow-hidden rounded-lg bg-white shadow-2xl dark:bg-zinc-950"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-zinc-200 p-3 dark:border-zinc-800">
          <div>
            <h2 className="text-base font-semibold">{title}</h2>
            {subtitle ? (
              <p className="text-xs text-zinc-500">{subtitle}</p>
            ) : null}
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            aria-label="close"
          >
            ✕
          </button>
        </header>
        <div className="overflow-y-auto p-4">{children}</div>
      </div>
    </div>
  );
}

function ActionBtn({
  primary,
  onClick,
  children,
}: {
  primary?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded px-3 py-2 text-sm font-medium transition ${
        primary
          ? "bg-emerald-600 text-white hover:bg-emerald-700"
          : "bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700"
      }`}
    >
      {children}
    </button>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 bg-zinc-50 p-6 text-sm text-zinc-700 dark:bg-black dark:text-zinc-300">
      {children}
    </div>
  );
}
