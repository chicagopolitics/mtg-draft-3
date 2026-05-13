"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
import {
  isMuted as isSoundMuted,
  play as playSound,
  setMuted as setSoundMuted,
} from "@/lib/sounds";

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
  counters?: Record<string, number>;
};

type DropTarget = "hand" | "battlefield" | "graveyard";

type DragApi = {
  startDrag: (
    from: Zone,
    card: DraftCard,
    ownerId: string,
    e: React.DragEvent,
  ) => void;
  endDrag: () => void;
  isValidDropFor: (target: DropTarget) => boolean;
  handleDrop: (target: DropTarget) => void;
  /** True when the in-flight drag is a valid attach onto this creature. */
  canAttachTo: (target: DraftCard) => boolean;
  /** Drop the in-flight drag onto a battlefield card to attach. */
  handleDropOnCard: (targetInstanceId: string) => void;
};

/** Find a battlefield card on either teammate's side. */
function findOnAllyBattlefield(
  me: PlayPublicPlayer,
  teammate: PlayPublicPlayer | null,
  instanceId: string,
): BattlefieldCard | undefined {
  const onMine = me.battlefield.find((b) => b.card.instanceId === instanceId);
  if (onMine) return onMine;
  return teammate?.battlefield.find((b) => b.card.instanceId === instanceId);
}

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
        } else if (msg.state.phase === "constructing") {
          router.push(`/construct/${lobbyId}`);
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

    // Local-only audio cues — only your own actions ring on your machine.
    // (Opponents' actions ring on their machines.)
    if (action.type === "draw" && action.count > 0) {
      playSound("drawCard");
    } else if (
      action.type === "move" &&
      action.from === "hand" &&
      action.to === "battlefield"
    ) {
      playSound("playCard");
    }
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
                {m.teams[0]
                  .map(
                    (id) =>
                      m.players.find((p) => p.id === id)?.name ?? id.slice(0, 4),
                  )
                  .join(" + ")}{" "}
                <span className="text-zinc-500">vs</span>{" "}
                {m.teams[1]
                  .map(
                    (id) =>
                      m.players.find((p) => p.id === id)?.name ?? id.slice(0, 4),
                  )
                  .join(" + ")}
              </span>
              <span className="font-mono text-xs text-zinc-500">
                Bo{m.bestOf} · game {m.gameNumber}
              </span>
            </div>
            <div className="mt-1 text-xs text-zinc-500">
              {m.status === "complete" && m.matchWinner !== null
                ? `Winner: Team ${m.matchWinner === 0 ? "A" : "B"} (${m.teams[m.matchWinner].map((id) => m.players.find((p) => p.id === id)?.name ?? id.slice(0, 4)).join(" + ")})`
                : `${m.wins[0]} – ${m.wins[1]}`}
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
  // Team derivation: which team am I on, who's my teammate, who are my opponents.
  const myTeamIdx: 0 | 1 = match.teams[0].includes(playerId) ? 0 : 1;
  const oppTeamIdx: 0 | 1 = myTeamIdx === 0 ? 1 : 0;
  const myTeammateId =
    match.teams[myTeamIdx].find((id) => id !== playerId) ?? null;
  const opponentIds = match.teams[oppTeamIdx];

  const myWins = match.wins[myTeamIdx];
  const oppWins = match.wins[oppTeamIdx];
  const winsNeeded = Math.ceil(match.bestOf / 2);
  const allMatches = lobby.matches ?? [];
  const allMatchesComplete = allMatches.every((m) => m.status === "complete");
  const isTwoHeaded = match.teams[0].length > 1 || match.teams[1].length > 1;
  const opponentName = isTwoHeaded
    ? opponentIds
        .map(
          (id) =>
            match.players.find((p) => p.id === id)?.name ?? id.slice(0, 4),
        )
        .join(" + ")
    : (match.players.find((p) => p.id === opponentIds[0])?.name ?? "Opponent");
  void lobbyId;

  const me = play.players.find((p) => p.id === playerId);
  const teammate = myTeammateId
    ? play.players.find((p) => p.id === myTeammateId)
    : null;
  const opponents = play.players.filter((p) => opponentIds.includes(p.id));

  // Whole-table attach index. Auras/equipment may target any creature on the
  // table — opp's Pacifism on your creature, your Control Magic on theirs, etc.
  // Children are rendered next to their parent regardless of who cast them.
  type OwnedBfTable = { b: BattlefieldCard; ownerId: string };
  const allBfWithOwner: OwnedBfTable[] = play.players.flatMap((p) =>
    p.battlefield.map((b) => ({ b, ownerId: p.id })),
  );
  const allFieldIds = new Set(
    allBfWithOwner.map((o) => o.b.card.instanceId),
  );
  const childrenByParent = new Map<string, OwnedBfTable[]>();
  for (const o of allBfWithOwner) {
    if (o.b.attachedTo && allFieldIds.has(o.b.attachedTo)) {
      const list = childrenByParent.get(o.b.attachedTo) ?? [];
      list.push(o);
      childrenByParent.set(o.b.attachedTo, list);
    }
  }
  // Resolve caster identity → small dot color for shared-battlefield UX.
  // Dot color is bound to the player's seat in the match (NOT the viewer),
  // so every player at the table agrees that "Alice = blue, Bob = yellow,
  // Charlie = red, Dave = purple". Hues are picked for maximum cross-color
  // distinguishability — each pair on the wheel is at least 90° apart, and
  // each team gets one warm + one cool to keep within-team contrast high.
  const DOT_PALETTE = [
    { class: "bg-sky-500", name: "blue" }, // team A, seat 0
    { class: "bg-amber-400", name: "yellow" }, // team A, seat 1
    { class: "bg-rose-600", name: "red" }, // team B, seat 0
    { class: "bg-violet-500", name: "purple" }, // team B, seat 1
  ] as const;
  function casterDotFor(ownerId: string): {
    casterDotClass?: string;
    casterDotLabel?: string;
  } {
    if (!isTwoHeaded) {
      // 1v1 — no dots; ally/opp panel borders already convey ownership.
      return {};
    }
    // Slot order matches `[...match.teams[0], ...match.teams[1]]` exactly,
    // and that's the same on every client, so colors are stable across viewers.
    const slots = [...match.teams[0], ...match.teams[1]];
    const slot = slots.indexOf(ownerId);
    if (slot < 0) return {};
    const swatch = DOT_PALETTE[slot] ?? DOT_PALETTE[0];
    const ownerName =
      play.players.find((p) => p.id === ownerId)?.name ?? "?";
    return {
      casterDotClass: swatch.class,
      casterDotLabel: `${ownerName} (${swatch.name})`,
    };
  }

  const [cardAction, setCardAction] = useState<CardActionTarget | null>(null);

  // Turn-pop banner: when the active team flips to mine, show a brief banner.
  // We track the previous turn idx so we don't fire on initial mount, and so
  // the banner doesn't re-trigger on unrelated state updates that re-render.
  // Stays open until the player picks an option or clicks away. No auto-
  // dismiss because there's now a decision to make (untap lands vs all vs
  // skip), and a timeout would race with the player's intent.
  const [showTurnPop, setShowTurnPop] = useState(false);
  const prevTurnRef = useRef<number | null>(null);
  useEffect(() => {
    const prev = prevTurnRef.current;
    prevTurnRef.current = match.currentTurnTeamIdx;
    // Skip the first render — we don't want to greet someone with a banner
    // just because they refreshed during their own turn.
    if (prev === null) return;
    if (
      prev !== match.currentTurnTeamIdx &&
      match.currentTurnTeamIdx === myTeamIdx &&
      match.status === "active" &&
      match.currentGameWinner === null
    ) {
      setShowTurnPop(true);
      // The server auto-draws for every member of the new active team on
      // any turn flip (turnNumber > 1). Mirror that with the local draw
      // sound so the audio matches the visible hand bump.
      if (match.turnNumber > 1) {
        playSound("drawCard");
      }
    }
  }, [match.currentTurnTeamIdx, myTeamIdx, match.status, match.currentGameWinner, match.turnNumber]);
  const [pile, setPile] = useState<PileTarget | null>(null);
  const [peek, setPeek] = useState<PeekTarget | null>(null);
  const [dragging, setDragging] = useState<{
    from: Zone;
    instanceId: string;
    card: DraftCard;
    /** Whose card it is. Used to detect cross-team drags (steals). */
    ownerId: string;
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
    // Counter tweaks are inherently iterative ("+1, +1, +1, then close"),
    // so keep the modal open for them. Every other action is terminal.
    if (action.type === "setCounter" || action.type === "clearCounters") {
      return;
    }
    setCardAction(null);
    setPile(null);
  }

  // Drag-and-drop API for zone moves and aura/equipment attachment.
  function startDrag(
    from: Zone,
    card: DraftCard,
    ownerId: string,
    e: React.DragEvent,
  ) {
    e.dataTransfer.effectAllowed = "move";
    // Some browsers need data set for the drag to take effect.
    e.dataTransfer.setData("text/plain", card.instanceId);
    setDragging({ from, instanceId: card.instanceId, card, ownerId });
  }
  function endDrag() {
    setDragging(null);
  }
  /**
   * True when the dragging card belongs to an opposing-team player. Used
   * to detect cross-team drags that should fire a steal request rather
   * than a regular move.
   */
  function isOppDrag(): boolean {
    if (!dragging) return false;
    if (!isTwoHeaded && dragging.ownerId === playerId) return false;
    const myTeam = match.teams[myTeamIdx];
    return !myTeam.includes(dragging.ownerId);
  }
  function isValidDropFor(target: DropTarget): boolean {
    if (!dragging) return false;
    // Cross-team drag of an opp's battlefield card onto your battlefield
    // is a steal request, not a move.
    if (
      dragging.from === "battlefield" &&
      target === "battlefield" &&
      isOppDrag()
    ) {
      return true;
    }
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
    // Steal request: dropping an opp's battlefield card on your battlefield
    // — server will queue a confirm/deny request to the owner.
    if (
      drag.from === "battlefield" &&
      target === "battlefield" &&
      !match.teams[myTeamIdx].includes(drag.ownerId)
    ) {
      send({ type: "requestSteal", instanceId: drag.instanceId });
      return;
    }
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
    <div className="relative flex h-screen flex-col bg-zinc-100 font-sans dark:bg-black">
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
            {match.ante.length > 0 ? (
              <div className="mt-0.5 flex items-center justify-end gap-1.5 font-mono">
                <span className="font-semibold text-amber-600 dark:text-amber-400">
                  ANTE:
                </span>
                <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
                  {match.ante.find((a) => a.playerId === playerId)?.card.name ??
                    "—"}
                </span>
                <span className="text-zinc-400">vs</span>
                <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
                  {match.ante.find((a) =>
                    match.teams[oppTeamIdx].includes(a.playerId),
                  )?.card.name ?? "—"}
                </span>
              </div>
            ) : null}
          </div>
          {match.status === "active" && match.currentGameWinner === null ? (
            <>
              <div
                className={`rounded px-2 py-1 text-xs font-semibold ${
                  match.currentTurnTeamIdx === myTeamIdx
                    ? "bg-emerald-500 text-white"
                    : "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                }`}
                title={`Turn ${match.turnNumber}`}
              >
                {match.currentTurnTeamIdx === myTeamIdx
                  ? `${isTwoHeaded ? "Your team's" : "Your"} turn (T${match.turnNumber})`
                  : `${opponentName}'s turn (T${match.turnNumber})`}
              </div>
              {(() => {
                const myTurn = match.currentTurnTeamIdx === myTeamIdx;
                const iPassed = match.passedMembers.includes(playerId);
                const teammatePassed =
                  isTwoHeaded &&
                  myTeammateId !== null &&
                  match.passedMembers.includes(myTeammateId);
                return (
                  <>
                    <button
                      type="button"
                      onClick={() =>
                        sendRaw({ type: "passTurn", matchId: match.id })
                      }
                      className={`rounded px-2 py-1 text-xs font-semibold disabled:opacity-40 ${
                        iPassed
                          ? "bg-amber-500 text-white hover:bg-amber-600"
                          : "bg-emerald-600 text-white hover:bg-emerald-700"
                      }`}
                      disabled={!myTurn}
                      title={
                        !myTurn
                          ? "It's not your team's turn"
                          : iPassed
                            ? "Take your turn back"
                            : isTwoHeaded
                              ? "End your sub-turn (team turn ends when teammate also ends)"
                              : "End your turn"
                      }
                    >
                      {iPassed ? "take turn back" : "end my turn"}
                    </button>
                    {isTwoHeaded ? (
                      <span
                        className="text-[10px] text-zinc-500"
                        title="Sub-turn status"
                      >
                        {iPassed ? "✓" : "·"} you
                        {" "}
                        {teammatePassed ? "✓" : "·"} teammate
                      </span>
                    ) : null}
                  </>
                );
              })()}
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

      <div
        className={`flex shrink-0 gap-2 overflow-x-auto border-b bg-white p-2 dark:bg-zinc-950 ${
          isTwoHeaded
            ? "border-rose-300 ring-2 ring-rose-300/30 dark:border-rose-900/60 dark:ring-rose-900/30"
            : "border-zinc-200 dark:border-zinc-800"
        }`}
      >
        {isTwoHeaded ? (
          <div className="flex flex-col items-start gap-1 self-stretch pr-2">
            <span className="rounded bg-rose-500/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-rose-700 dark:text-rose-300">
              opp team
            </span>
            <p className="font-mono text-2xl font-bold text-rose-600 dark:text-rose-400">
              ♥ {match.teamLife[oppTeamIdx]}
            </p>
          </div>
        ) : null}
        {opponents.length === 0 ? (
          <p className="px-2 py-4 text-xs text-zinc-500">
            no opponents at this table.
          </p>
        ) : (
          opponents.map((opp) => (
            <OpponentArea
              key={opp.id}
              player={opp}
              isCurrentTurn={match.currentTurnTeamIdx === oppTeamIdx}
              showLife={!isTwoHeaded}
              childrenByParent={childrenByParent}
              allFieldIds={allFieldIds}
              casterDotFor={casterDotFor}
              dragApi={dragApi}
              onCardPeek={(card, tapped, counters) =>
                setPeek({ card, tapped, counters })
              }
              onPileClick={(zone) => onOpponentPileClick(opp, zone)}
            />
          ))
        )}
      </div>

      {teammate ? (
        <div className="flex shrink-0 items-center gap-3 border-b border-emerald-300 bg-emerald-50/40 px-3 py-1.5 text-xs dark:border-emerald-900/60 dark:bg-emerald-950/20">
          <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
            teammate
          </span>
          <span className="font-semibold">{teammate.name}</span>
          <span className="font-mono text-zinc-500">
            hand {teammate.handSize} · deck {teammate.deckSize} · grave{" "}
            {teammate.graveyard.length} · exile {teammate.exile.length}
          </span>
          {teammate.revealedHand && teammate.revealedHand.length > 0 ? (
            <span className="ml-2 flex items-center gap-1 rounded bg-amber-100/80 px-1 py-0.5 ring-1 ring-amber-300/60 dark:bg-amber-950/50 dark:ring-amber-700/50">
              <span className="text-[10px] font-bold uppercase tracking-wide text-amber-700 dark:text-amber-300">
                revealed
              </span>
              {teammate.revealedHand.map((c) => (
                <CompactCard
                  key={c.instanceId}
                  card={c}
                  size="xs"
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setPeek({ card: c });
                  }}
                />
              ))}
            </span>
          ) : null}
          {!teammate.connected ? (
            <span className="text-amber-600 dark:text-amber-400">away</span>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-1 overflow-hidden">
        <YourArea
          me={me}
          teammate={teammate ?? null}
          priv={priv}
          isCurrentTurn={match.currentTurnTeamIdx === myTeamIdx}
          childrenByParent={childrenByParent}
          allFieldIds={allFieldIds}
          casterDotFor={casterDotFor}
          onCardClick={onYourCardClick}
          onTeammateCardClick={(card, zone) => {
            onYourCardClick(card, zone);
          }}
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
            const bf = findOnAllyBattlefield(
              me,
              teammate ?? null,
              cardAction.card.instanceId,
            );
            return bf?.tapped ?? false;
          })()}
          isAttached={(() => {
            if (cardAction.zone !== "battlefield") return false;
            const bf = findOnAllyBattlefield(
              me,
              teammate ?? null,
              cardAction.card.instanceId,
            );
            return !!bf?.attachedTo;
          })()}
          counters={(() => {
            if (cardAction.zone !== "battlefield") return undefined;
            const bf = findOnAllyBattlefield(
              me,
              teammate ?? null,
              cardAction.card.instanceId,
            );
            return bf?.counters;
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

      {match.status === "active" && match.currentGameWinner !== null ? (
        <ResultOverlay
          title={
            match.currentGameWinner === myTeamIdx
              ? isTwoHeaded
                ? "Your team won the game!"
                : "You won the game!"
              : `${opponentName} won the game.`
          }
          subtitle={`Score: You ${myWins} – ${oppWins} ${opponentName}`}
          actionLabel="Start next game"
          onAction={() => sendRaw({ type: "advanceGame", matchId: match.id })}
          anteWon={
            match.currentGameWinner === myTeamIdx
              ? (match.ante.find((a) =>
                  match.teams[oppTeamIdx].includes(a.playerId),
                )?.card.name ?? null)
              : null
          }
          anteLost={
            match.currentGameWinner !== myTeamIdx
              ? (match.ante.find((a) => a.playerId === playerId)?.card.name ??
                  null)
              : null
          }
        />
      ) : null}

      {match.status === "complete" ? (
        <ResultOverlay
          title={
            match.matchWinner === myTeamIdx
              ? isTwoHeaded
                ? "Your team won the match!"
                : "You won the match!"
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
          anteWon={
            match.matchWinner === myTeamIdx
              ? (match.ante.find((a) =>
                  match.teams[oppTeamIdx].includes(a.playerId),
                )?.card.name ?? null)
              : null
          }
          anteLost={
            match.matchWinner !== myTeamIdx
              ? (match.ante.find((a) => a.playerId === playerId)?.card.name ??
                  null)
              : null
          }
        />
      ) : null}

      {/*
        Turn-pop prompt: an interactive banner that appears when the turn
        flips to you. Offers quick untap shortcuts, plus a click-anywhere
        backdrop that just dismisses without untapping anything.
      */}
      {showTurnPop ? (
        <div
          className="absolute inset-0 z-40 flex items-start justify-center bg-black/30 pt-12"
          onClick={() => setShowTurnPop(false)}
        >
          <div
            className="flex flex-col items-center gap-3 rounded-2xl bg-white p-6 shadow-2xl ring-4 ring-emerald-300/60 dark:bg-zinc-900"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="rounded-full bg-emerald-500 px-6 py-2 text-2xl font-bold tracking-wide text-white">
              {isTwoHeaded ? "YOUR TEAM'S TURN" : "YOUR TURN"}
            </h2>
            <p className="text-xs text-zinc-500">
              Pick an untap option, or click outside to skip.
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  send({ type: "untapAll", landsOnly: true });
                  setShowTurnPop(false);
                }}
                className="rounded bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
              >
                untap lands
              </button>
              <button
                type="button"
                onClick={() => {
                  send({ type: "untapAll" });
                  setShowTurnPop(false);
                }}
                className="rounded bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
              >
                untap all
              </button>
              <button
                type="button"
                onClick={() => setShowTurnPop(false)}
                className="rounded border border-zinc-300 px-4 py-2 text-sm text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                skip
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/*
        Steal request UI: the OWNER of a pending steal sees a modal asking
        them to confirm or deny, while the REQUESTER sees a small status
        chip at the top of the play area saying "waiting for X to confirm".
      */}
      {(() => {
        const stealsForMe = match.pendingSteals.filter(
          (s) => s.ownerId === playerId,
        );
        const myRequests = match.pendingSteals.filter(
          (s) => s.requesterId === playerId,
        );
        return (
          <>
            {stealsForMe.map((s) => (
              <div
                key={s.id}
                className="absolute inset-0 z-50 grid place-items-center bg-black/60 p-4"
              >
                <div className="max-w-sm space-y-3 rounded-2xl bg-white p-6 text-center shadow-xl dark:bg-zinc-900">
                  <h2 className="text-lg font-bold">
                    {s.requesterName} wants to take your{" "}
                    <span className="text-amber-600 dark:text-amber-400">
                      {s.cardName}
                    </span>
                  </h2>
                  <p className="text-xs text-zinc-500">
                    Allowing it moves the card to their battlefield. It will
                    return to your graveyard / hand / etc. when it dies.
                  </p>
                  <div className="flex justify-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        send({
                          type: "respondSteal",
                          stealId: s.id,
                          accept: true,
                        })
                      }
                      className="rounded bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
                    >
                      allow
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        send({
                          type: "respondSteal",
                          stealId: s.id,
                          accept: false,
                        })
                      }
                      className="rounded border border-red-400 px-4 py-2 text-sm font-semibold text-red-600 hover:bg-red-50 dark:hover:bg-red-950"
                    >
                      deny
                    </button>
                  </div>
                </div>
              </div>
            ))}
            {myRequests.length > 0 ? (
              <div className="pointer-events-none absolute left-1/2 top-2 z-30 -translate-x-1/2">
                {myRequests.map((s) => (
                  <div
                    key={s.id}
                    className="rounded-full bg-amber-500/90 px-4 py-1.5 text-xs font-semibold text-white shadow-lg"
                  >
                    waiting for {s.ownerName} to respond to {s.cardName}…
                  </div>
                ))}
              </div>
            ) : null}
          </>
        );
      })()}
    </div>
  );
}

function ResultOverlay({
  title,
  subtitle,
  actionLabel,
  onAction,
  anteWon,
  anteLost,
}: {
  title: string;
  subtitle: string;
  actionLabel: string;
  onAction?: () => void;
  /** Name of the card the viewer won via ante (null if they lost). */
  anteWon?: string | null;
  /** Name of the card the viewer lost via ante (null if they won). */
  anteLost?: string | null;
}) {
  return (
    <div className="absolute inset-0 z-50 grid place-items-center bg-black/60">
      <div className="space-y-3 rounded bg-white p-6 text-center shadow-xl dark:bg-zinc-900">
        <h2 className="text-xl font-bold">{title}</h2>
        <p className="text-sm text-zinc-500">{subtitle}</p>

        {anteWon ? (
          <div className="animate-pulse rounded border border-emerald-400 bg-emerald-50 px-4 py-2 dark:border-emerald-700 dark:bg-emerald-950/40">
            <p className="text-xs font-semibold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
              Ante won
            </p>
            <p className="text-sm font-bold text-emerald-800 dark:text-emerald-200">
              {anteWon}
            </p>
            <p className="text-[10px] text-emerald-600/80 dark:text-emerald-400/60">
              This card has been added to your deck
            </p>
          </div>
        ) : anteLost ? (
          <div className="animate-pulse rounded border border-red-400 bg-red-50 px-4 py-2 dark:border-red-700 dark:bg-red-950/40">
            <p className="text-xs font-semibold uppercase tracking-wide text-red-600 dark:text-red-400">
              Ante lost
            </p>
            <p className="text-sm font-bold text-red-800 dark:text-red-200">
              {anteLost}
            </p>
            <p className="text-[10px] text-red-600/80 dark:text-red-400/60">
              This card has been transferred to your opponent
            </p>
          </div>
        ) : null}

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
  showLife = true,
  childrenByParent,
  allFieldIds,
  casterDotFor,
  dragApi,
  onCardPeek,
  onPileClick,
}: {
  player: PlayPublicPlayer;
  isCurrentTurn?: boolean;
  /** Hide the per-player life display; e.g. 2HG shows team life once at the
   * team-strip level instead of repeating it on each panel. */
  showLife?: boolean;
  /** Whole-table attach index built in PlayBoard. */
  childrenByParent: Map<string, { b: BattlefieldCard; ownerId: string }[]>;
  /** Set of every battlefield instanceId across the table. */
  allFieldIds: Set<string>;
  /** Resolves a casterDot styling for a given owner playerId. */
  casterDotFor: (ownerId: string) => {
    casterDotClass?: string;
    casterDotLabel?: string;
  };
  dragApi: DragApi;
  onCardPeek: (
    card: DraftCard,
    tapped: boolean,
    counters?: Record<string, number>,
  ) => void;
  onPileClick: (zone: "graveyard" | "exile") => void;
}) {
  const lands = player.battlefield.filter((b) => b.card.type === "land");
  // Tops on this opp's battlefield: cards that don't have a parent anywhere.
  // (A card whose parent lives on another zone is still rendered with its
  // parent in that zone, not here.)
  const nonLands = player.battlefield.filter(
    (b) =>
      b.card.type !== "land" &&
      (!b.attachedTo || !allFieldIds.has(b.attachedTo)),
  );
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
        {showLife ? (
          <p className="font-mono text-sm text-rose-600 dark:text-rose-400">
            ♥ {player.life}
          </p>
        ) : null}
      </header>
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-zinc-500">
        <span>hand: {player.handSize}</span>
        <span>·</span>
        <span>deck: {player.deckSize}</span>
        {player.revealedHand ? (
          <>
            <span>·</span>
            <span className="font-bold text-amber-600 dark:text-amber-400">
              hand revealed
            </span>
          </>
        ) : null}
        {!player.connected ? (
          <>
            <span>·</span>
            <span className="text-amber-600 dark:text-amber-400">away</span>
          </>
        ) : null}
      </div>
      {player.revealedHand && player.revealedHand.length > 0 ? (
        <div className="flex flex-wrap gap-1 rounded bg-amber-50/60 p-1 ring-1 ring-amber-300/60 dark:bg-amber-950/30 dark:ring-amber-700/50">
          {player.revealedHand.map((c) => (
            <CompactCard
              key={c.instanceId}
              card={c}
              size="xs"
              onContextMenu={(e) => {
                e.preventDefault();
                onCardPeek(c, false, undefined);
              }}
            />
          ))}
        </div>
      ) : null}
      <div className="flex min-h-24 flex-col gap-2 rounded bg-white p-1 dark:bg-zinc-950">
        {player.battlefield.length === 0 ? (
          <p className="px-2 py-3 text-[10px] text-zinc-400">
            empty battlefield
          </p>
        ) : (
          <>
            {nonLands.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {(() => {
                  // Compact-xs card is w-20 h-28 (80×112). 18px reveals the
                  // name strip on each child stacked above the parent.
                  const offset = 18;
                  return nonLands.map((parent) => {
                    const kids =
                      childrenByParent.get(parent.card.instanceId) ?? [];
                    const isAttachTarget = dragApi.canAttachTo(parent.card);
                    const renderParent = (
                      <CompactCard
                        card={parent.card}
                        tapped={parent.tapped}
                        counters={parent.counters}
                        size="xs"
                        highlight={isAttachTarget}
                        // Allow cross-team drag → triggers a steal request
                        // (server confirms with the owner before moving).
                        draggable
                        onDragStart={(e) =>
                          dragApi.startDrag(
                            "battlefield",
                            parent.card,
                            player.id,
                            e,
                          )
                        }
                        onDragEnd={dragApi.endDrag}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          onCardPeek(
                            parent.card,
                            parent.tapped,
                            parent.counters,
                          );
                        }}
                        onDragOver={(e) => {
                          if (dragApi.canAttachTo(parent.card)) {
                            e.preventDefault();
                            e.stopPropagation();
                          }
                        }}
                        onDrop={(e) => {
                          if (dragApi.canAttachTo(parent.card)) {
                            e.preventDefault();
                            e.stopPropagation();
                            dragApi.handleDropOnCard(parent.card.instanceId);
                          }
                        }}
                      />
                    );
                    if (kids.length === 0) {
                      return (
                        <div key={parent.card.instanceId}>{renderParent}</div>
                      );
                    }
                    const w = 80;
                    const h = 112 + kids.length * offset;
                    return (
                      <div
                        key={parent.card.instanceId}
                        className="relative"
                        style={{ width: w, height: h }}
                      >
                        {kids.map((kid, i) => {
                          const dot = casterDotFor(kid.ownerId);
                          return (
                            <div
                              key={kid.b.card.instanceId}
                              className="absolute left-0"
                              style={{
                                top: i * offset,
                                zIndex: i + 1,
                              }}
                            >
                              <CompactCard
                                card={kid.b.card}
                                tapped={kid.b.tapped}
                                counters={kid.b.counters}
                                size="xs"
                                casterDotClass={dot.casterDotClass}
                                casterDotLabel={dot.casterDotLabel}
                                draggable
                                onDragStart={(e) =>
                                  dragApi.startDrag(
                                    "battlefield",
                                    kid.b.card,
                                    kid.ownerId,
                                    e,
                                  )
                                }
                                onDragEnd={dragApi.endDrag}
                                onContextMenu={(e) => {
                                  e.preventDefault();
                                  onCardPeek(
                                    kid.b.card,
                                    kid.b.tapped,
                                    kid.b.counters,
                                  );
                                }}
                              />
                            </div>
                          );
                        })}
                        <div
                          className="absolute left-0"
                          style={{
                            top: kids.length * offset,
                            zIndex: 1000,
                          }}
                        >
                          {renderParent}
                        </div>
                      </div>
                    );
                  });
                })()}
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
                        draggable
                        onDragStart={(e) =>
                          dragApi.startDrag(
                            "battlefield",
                            b.card,
                            player.id,
                            e,
                          )
                        }
                        onDragEnd={dragApi.endDrag}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          onCardPeek(b.card, b.tapped, b.counters);
                        }}
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
  teammate,
  priv,
  isCurrentTurn = false,
  childrenByParent,
  allFieldIds,
  casterDotFor,
  onCardClick,
  dragApi,
  send,
}: {
  me: PlayPublicPlayer;
  /** Set in 2HG; the teammate's battlefield is merged into the shared zone. */
  teammate?: PlayPublicPlayer | null;
  priv: PlayPrivateState;
  isCurrentTurn?: boolean;
  /** Whole-table attach index; some children may be opp-owned (e.g., their Pacifism on your creature). */
  childrenByParent: Map<string, { b: BattlefieldCard; ownerId: string }[]>;
  allFieldIds: Set<string>;
  casterDotFor: (ownerId: string) => {
    casterDotClass?: string;
    casterDotLabel?: string;
  };
  onCardClick: (card: DraftCard, zone: Zone) => void;
  /** Optional handler for teammate-owned cards (defaults to onCardClick). */
  onTeammateCardClick?: (card: DraftCard, zone: Zone) => void;
  dragApi: DragApi;
  send: (action: PlayAction) => void;
}) {
  const bfHighlight = dragApi.isValidDropFor("battlefield");
  const handHighlight = dragApi.isValidDropFor("hand");

  // Build a combined battlefield (mine + teammate's) tagged with ownership so
  // we can render caster dots and route per-card actions correctly.
  type OwnedBf = { b: BattlefieldCard; ownerId: string; isMine: boolean };
  const combined: OwnedBf[] = [
    ...me.battlefield.map((b) => ({ b, ownerId: me.id, isMine: true })),
    ...(teammate
      ? teammate.battlefield.map((b) => ({
          b,
          ownerId: teammate.id,
          isMine: false,
        }))
      : []),
  ];
  const lands = combined.filter((o) => o.b.card.type === "land");
  // Tops on this team's battlefield: nonland cards that don't have a parent
  // anywhere on the table. (Cards attached to opp creatures are rendered in
  // opp's zone instead.)
  const nonLands = combined.filter(
    (o) =>
      o.b.card.type !== "land" &&
      (!o.b.attachedTo || !allFieldIds.has(o.b.attachedTo)),
  );
  // Group lands by (owner, card-id) so my Mountains stack separately from
  // teammate's Mountains.
  const landGroups = new Map<string, OwnedBf[]>();
  for (const o of lands) {
    const key = `${o.ownerId}:${o.b.card.id}`;
    const group = landGroups.get(key);
    if (group) group.push(o);
    else landGroups.set(key, [o]);
  }

  function renderBattlefieldCard(o: OwnedBf) {
    const isAttachTarget = dragApi.canAttachTo(o.b.card);
    const dot = casterDotFor(o.ownerId);
    return (
      <CompactCard
        card={o.b.card}
        tapped={o.b.tapped}
        counters={o.b.counters}
        size="md"
        casterDotClass={dot.casterDotClass}
        casterDotLabel={dot.casterDotLabel}
        onClick={() =>
          send({
            type: "tap",
            instanceId: o.b.card.instanceId,
            tapped: !o.b.tapped,
          })
        }
        onMenu={() => onCardClick(o.b.card, "battlefield")}
        draggable
        onDragStart={(e) =>
          dragApi.startDrag("battlefield", o.b.card, o.ownerId, e)
        }
        onDragEnd={dragApi.endDrag}
        highlight={isAttachTarget}
        onDragOver={(e) => {
          if (dragApi.canAttachTo(o.b.card)) {
            e.preventDefault();
            e.stopPropagation();
          }
        }}
        onDrop={(e) => {
          if (dragApi.canAttachTo(o.b.card)) {
            e.preventDefault();
            e.stopPropagation();
            dragApi.handleDropOnCard(o.b.card.instanceId);
          }
        }}
      />
    );
  }

  return (
    <div
      // Catch-all drop target: dropping anywhere inside YourArea that isn't a
      // more-specific zone (the hand strip, an attach-target creature) lands
      // on the battlefield. Forgives drops that miss the inner section by a
      // small margin. The hand section calls stopPropagation so it still
      // routes drops there correctly.
      onDragOver={(e) => {
        if (dragApi.isValidDropFor("battlefield")) e.preventDefault();
      }}
      onDrop={(e) => {
        if (!dragApi.isValidDropFor("battlefield")) return;
        e.preventDefault();
        dragApi.handleDrop("battlefield");
      }}
      className={`flex min-w-0 flex-1 flex-col gap-3 overflow-y-auto p-4 ${
        isCurrentTurn ? "ring-4 ring-inset ring-emerald-500/50" : ""
      } ${
        teammate ? "ring-2 ring-inset ring-emerald-300/40" : ""
      }`}
    >
      <section
        // Drop is handled by the YourArea catch-all wrapper above; this
        // section only needs to render the visual highlight.
        className={`flex flex-1 flex-col rounded border-2 border-dashed bg-emerald-50/40 p-2 transition-colors dark:bg-emerald-950/20 ${
          bfHighlight
            ? "border-emerald-500 bg-emerald-100 dark:border-emerald-400 dark:bg-emerald-950/60"
            : "border-emerald-300 dark:border-emerald-900/50"
        }`}
      >
        <p className="mb-1 flex items-center gap-2 text-[10px] uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
          <span>
            {teammate ? "your team's battlefield" : "your battlefield"} (
            {combined.length})
          </span>
          {isCurrentTurn ? (
            <span className="rounded bg-emerald-500 px-1.5 py-0.5 text-[10px] font-bold text-white">
              {teammate ? "your team's turn" : "your turn"}
            </span>
          ) : null}
          {bfHighlight ? <span>· drop here</span> : null}
        </p>
        {combined.length === 0 ? (
          <p className="p-2 text-xs text-zinc-500">empty.</p>
        ) : (
          <div className="flex flex-1 flex-col gap-3">
            {(() => {
              // Render a single parent (with its attached kids stacked above)
              // — used in both 1v1 and the split 2HG layout.
              const renderTop = (parent: OwnedBf) => {
                const kidsRaw =
                  childrenByParent.get(parent.b.card.instanceId) ?? [];
                const kids: OwnedBf[] = kidsRaw.map((k) => ({
                  b: k.b,
                  ownerId: k.ownerId,
                  isMine: k.ownerId === me.id,
                }));
                if (kids.length === 0) {
                  return (
                    <div
                      key={parent.b.card.instanceId}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        onCardClick(parent.b.card, "battlefield");
                      }}
                    >
                      {renderBattlefieldCard(parent)}
                    </div>
                  );
                }
                const offset = 28;
                const w = 144;
                const h = 208 + kids.length * offset;
                return (
                  <div
                    key={parent.b.card.instanceId}
                    className="relative"
                    style={{ width: w, height: h }}
                  >
                    {kids.map((kid, i) => (
                      <div
                        key={kid.b.card.instanceId}
                        className="absolute left-0"
                        style={{ top: i * offset, zIndex: i + 1 }}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          onCardClick(kid.b.card, "battlefield");
                        }}
                      >
                        {renderBattlefieldCard(kid)}
                      </div>
                    ))}
                    <div
                      className="absolute left-0"
                      style={{ top: kids.length * offset, zIndex: 1000 }}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        onCardClick(parent.b.card, "battlefield");
                      }}
                    >
                      {renderBattlefieldCard(parent)}
                    </div>
                  </div>
                );
              };

              const renderLandGroup = (key: string, group: OwnedBf[]) => (
                <div key={key} className="flex items-end">
                  {group.map((o, i) => {
                    const dot = casterDotFor(o.ownerId);
                    return (
                      <CompactCard
                        key={o.b.card.instanceId}
                        card={o.b.card}
                        tapped={o.b.tapped}
                        size="md"
                        casterDotClass={dot.casterDotClass}
                        casterDotLabel={dot.casterDotLabel}
                        style={{ marginLeft: i === 0 ? 0 : "-7rem" }}
                        onClick={() =>
                          send({
                            type: "tap",
                            instanceId: o.b.card.instanceId,
                            tapped: !o.b.tapped,
                          })
                        }
                        onMenu={() =>
                          onCardClick(o.b.card, "battlefield")
                        }
                        onContextMenu={(e) => {
                          e.preventDefault();
                          onCardClick(o.b.card, "battlefield");
                        }}
                        draggable
                        onDragStart={(e) =>
                          dragApi.startDrag(
                            "battlefield",
                            o.b.card,
                            o.ownerId,
                            e,
                          )
                        }
                        onDragEnd={dragApi.endDrag}
                      />
                    );
                  })}
                </div>
              );

              // 2HG: split into "mine" (left) and "teammate" (right) so each
              // player can scan their own side at a glance. 1v1: single
              // column as before.
              if (!teammate) {
                return (
                  <>
                    <div className="flex flex-wrap gap-2">
                      {nonLands.length === 0 ? (
                        <p className="p-2 text-xs italic text-zinc-400">
                          no nonland permanents.
                        </p>
                      ) : (
                        nonLands.map(renderTop)
                      )}
                    </div>
                    {lands.length > 0 ? (
                      <div className="mt-auto border-t border-emerald-200/60 pt-2 dark:border-emerald-900/30">
                        <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
                          {[...landGroups.entries()].map(([k, g]) =>
                            renderLandGroup(k, g),
                          )}
                        </div>
                      </div>
                    ) : null}
                  </>
                );
              }

              const myNonLands = nonLands.filter((o) => o.isMine);
              const teamNonLands = nonLands.filter((o) => !o.isMine);
              const myLandGroups = [...landGroups.entries()].filter(
                ([, g]) => g[0].isMine,
              );
              const teamLandGroups = [...landGroups.entries()].filter(
                ([, g]) => !g[0].isMine,
              );

              return (
                <>
                  <div className="grid flex-1 grid-cols-[1fr_auto_1fr] items-start gap-3">
                    <div className="flex min-w-0 flex-wrap gap-2">
                      {myNonLands.length === 0 ? (
                        <p className="p-2 text-xs italic text-zinc-400">
                          no permanents (yours)
                        </p>
                      ) : (
                        myNonLands.map(renderTop)
                      )}
                    </div>
                    <div
                      aria-hidden
                      className="self-stretch border-l border-emerald-200/60 dark:border-emerald-900/40"
                    />
                    <div className="flex min-w-0 flex-wrap justify-end gap-2">
                      {teamNonLands.length === 0 ? (
                        <p className="p-2 text-xs italic text-zinc-400">
                          no permanents (teammate)
                        </p>
                      ) : (
                        teamNonLands.map(renderTop)
                      )}
                    </div>
                  </div>
                  {lands.length > 0 ? (
                    <div className="mt-auto border-t border-emerald-200/60 pt-2 dark:border-emerald-900/30">
                      <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-3">
                        <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
                          {myLandGroups.map(([k, g]) => renderLandGroup(k, g))}
                        </div>
                        <div
                          aria-hidden
                          className="h-12 self-end border-l border-emerald-200/60 dark:border-emerald-900/40"
                        />
                        <div className="flex flex-wrap items-end justify-end gap-x-6 gap-y-3">
                          {teamLandGroups.map(([k, g]) =>
                            renderLandGroup(k, g),
                          )}
                        </div>
                      </div>
                    </div>
                  ) : null}
                </>
              );
            })()}
          </div>
        )}
      </section>

      {/*
        The hand reserves a fixed slot at the bottom of YourArea (h-32).
        On hover/focus the inner section absolutely overlays upward into the
        battlefield area instead of pushing layout down past the viewport.
        That keeps the bottom of the cards anchored to the screen edge.
      */}
      <div className="relative h-32 shrink-0">
        <section
          onDragOver={(e) => {
            if (dragApi.isValidDropFor("hand")) e.preventDefault();
          }}
          onDrop={(e) => {
            e.preventDefault();
            // Stop bubbling so the YourArea catch-all doesn't also route
            // this drop to the battlefield.
            e.stopPropagation();
            dragApi.handleDrop("hand");
          }}
          className={`group/hand absolute bottom-0 left-0 right-0 z-20 h-32 overflow-hidden rounded border-2 border-dashed bg-sky-50/95 px-2 pb-2 pt-2 transition-[height,padding] duration-300 hover:h-[26rem] hover:pt-12 focus-within:h-[26rem] focus-within:pt-12 dark:bg-sky-950/85 ${
            handHighlight
              ? "border-sky-500 bg-sky-100 dark:border-sky-400 dark:bg-sky-950"
              : "border-sky-300 dark:border-sky-900/70"
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
                  onDragStart={(e) => dragApi.startDrag("hand", c, me.id, e)}
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
        {/*
          Graveyard drop is forgiving: the catch zone extends ~12px above and
          below the visible tile via padding. Visually the tile stays the same
          size; the extra margin just absorbs near-misses.
        */}
        <div
          className="-my-3 py-3"
          onDragOver={(e) => {
            if (dragApi.isValidDropFor("graveyard")) e.preventDefault();
          }}
          onDrop={(e) => {
            if (!dragApi.isValidDropFor("graveyard")) return;
            e.preventDefault();
            e.stopPropagation();
            dragApi.handleDrop("graveyard");
          }}
        >
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
              e.stopPropagation();
              dragApi.handleDrop("graveyard");
            }}
          />
        </div>
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
        handRevealed={!!me.revealedHand}
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
  handRevealed,
  send,
}: {
  deckSize: number;
  handSize: number;
  /** True when the sender has chosen to reveal their hand to the table. */
  handRevealed: boolean;
  send: (action: PlayAction) => void;
}) {
  // Sound mute lives in localStorage, but UtilityButtons needs to re-render
  // when it flips. Mirror the value into local state.
  const [muted, setMuted] = useState(false);
  useEffect(() => setMuted(isSoundMuted()), []);
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
          onClick={() => send({ type: "untapAll", landsOnly: true })}
        >
          untap lands
        </UtilBtn>
        <UtilBtn onClick={() => send({ type: "untapAll" })}>untap all</UtilBtn>
        <UtilBtn
          className="col-span-2"
          onClick={() => send({ type: "createToken" })}
          // Vanilla 0/0 — pump via counters or send to grave when it dies.
        >
          create token (0/0)
        </UtilBtn>
        <UtilBtn
          className={`col-span-2 ${
            handRevealed
              ? "bg-amber-500/20 text-amber-700 dark:text-amber-300"
              : ""
          }`}
          onClick={() => send({ type: "revealHand", revealed: !handRevealed })}
        >
          {handRevealed ? "hide hand" : "reveal hand"}
        </UtilBtn>
        <UtilBtn
          className="col-span-2"
          onClick={() => {
            const next = !muted;
            setSoundMuted(next);
            setMuted(next);
          }}
        >
          {muted ? "unmute sounds" : "mute sounds"}
        </UtilBtn>
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
  counters,
  onClose,
  onAction,
}: {
  target: CardActionTarget;
  ownTapped: boolean;
  isAttached: boolean;
  /** Current counter pile on this card (battlefield only). */
  counters?: Record<string, number>;
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
          {zone === "battlefield" ? (
            <CounterControls
              counters={counters}
              onChange={(kind, delta) =>
                onAction({
                  type: "setCounter",
                  instanceId: card.instanceId,
                  kind,
                  delta,
                })
              }
              onClear={() =>
                onAction({
                  type: "clearCounters",
                  instanceId: card.instanceId,
                })
              }
            />
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

function CounterControls({
  counters,
  onChange,
  onClear,
}: {
  counters?: Record<string, number>;
  onChange: (kind: string, delta: number) => void;
  onClear: () => void;
}) {
  const [customKind, setCustomKind] = useState("");
  const standard: string[] = [
    "+1/+1",
    "-1/-1",
    "+1/+0",
    "+0/+1",
    "loyalty",
    "charge",
  ];
  const has = counters ?? {};
  const otherKinds = Object.keys(has).filter((k) => !standard.includes(k));
  return (
    <div className="rounded border border-zinc-300 p-2 text-xs dark:border-zinc-700">
      <div className="mb-1 flex items-center justify-between">
        <p className="font-semibold uppercase tracking-wide text-zinc-500">
          counters
        </p>
        {Object.keys(has).length > 0 ? (
          <button
            type="button"
            onClick={onClear}
            className="text-[11px] text-zinc-500 underline-offset-2 hover:underline"
          >
            clear all
          </button>
        ) : null}
      </div>
      <div className="space-y-1">
        {standard.map((kind) => (
          <CounterRow
            key={kind}
            kind={kind}
            count={has[kind] ?? 0}
            onAdd={() => onChange(kind, 1)}
            onSub={() => onChange(kind, -1)}
          />
        ))}
        {otherKinds.map((kind) => (
          <CounterRow
            key={kind}
            kind={kind}
            count={has[kind]}
            onAdd={() => onChange(kind, 1)}
            onSub={() => onChange(kind, -1)}
          />
        ))}
      </div>
      <div className="mt-2 flex gap-1">
        <input
          type="text"
          value={customKind}
          onChange={(e) => setCustomKind(e.target.value)}
          placeholder="custom (e.g., poison)"
          maxLength={24}
          className="min-w-0 flex-1 rounded border border-zinc-300 bg-white px-2 py-1 text-xs dark:border-zinc-600 dark:bg-zinc-800"
        />
        <button
          type="button"
          disabled={!customKind.trim()}
          onClick={() => {
            const k = customKind.trim();
            if (!k) return;
            onChange(k, 1);
            setCustomKind("");
          }}
          className="rounded bg-emerald-600 px-2 py-1 text-xs text-white hover:bg-emerald-700 disabled:opacity-40"
        >
          +1
        </button>
      </div>
    </div>
  );
}

function CounterRow({
  kind,
  count,
  onAdd,
  onSub,
}: {
  kind: string;
  count: number;
  onAdd: () => void;
  onSub: () => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="min-w-0 flex-1 truncate font-mono">{kind}</span>
      <button
        type="button"
        onClick={onSub}
        disabled={count === 0}
        className="h-6 w-6 rounded border border-zinc-300 text-xs hover:bg-zinc-100 disabled:opacity-30 dark:border-zinc-700 dark:hover:bg-zinc-800"
      >
        −
      </button>
      <span className="w-6 text-center font-mono">{count}</span>
      <button
        type="button"
        onClick={onAdd}
        className="h-6 w-6 rounded border border-zinc-300 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
      >
        +
      </button>
    </div>
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
  const counterEntries = target.counters
    ? Object.entries(target.counters)
    : [];
  return (
    <ModalShell title={target.card.name} subtitle="opponent card" onClose={onClose}>
      <div className="flex justify-center">
        <CardView card={target.card} />
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-center gap-2 text-xs">
        {target.tapped ? (
          <span className="text-zinc-500">tapped</span>
        ) : null}
        {counterEntries.length > 0 ? (
          <span className="text-zinc-500">counters:</span>
        ) : null}
        {counterEntries.map(([k, n]) => (
          <span
            key={k}
            className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[11px] text-white"
          >
            {k} ×{n}
          </span>
        ))}
      </div>
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
