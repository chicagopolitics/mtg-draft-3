import type * as Party from "partykit/server";

import {
  type Card,
  type Color,
  type DraftCard,
  CardSchema,
  mintDraftCards,
} from "../lib/cards/schema";
import { generatePack } from "../lib/cards/generator";
import { MOCK_SET } from "../lib/cards/mock";
import { z } from "zod";
import {
  type BasicLandCounts,
  type BattlefieldCard,
  type BestOf,
  type ClientMessage,
  type DeckbuildPrivateState,
  type DeckbuildPublicState,
  type DraftDirection,
  type DraftPrivateState,
  type DraftPublicState,
  type LobbyConfig,
  type LobbyPhase,
  type LobbyState,
  type MatchPairing,
  type MatchPublicState,
  type PlayAction,
  type PlayPrivateState,
  type PlayPublicPlayer,
  type ServerMessage,
  type Zone,
  type ZoneTarget,
  DEFAULT_CONFIG,
  ZERO_LANDS,
  clampConfig,
  clampLandCounts,
} from "../lib/lobby/protocol";

const BASIC_LAND_BY_COLOR: Record<Color, string> = {
  W: "plains",
  U: "island",
  B: "swamp",
  R: "mountain",
  G: "forest",
};

const STARTING_HAND = 7;
const STARTING_LIFE = 20;

type Player = {
  id: string;
  name: string;
  isAdmin: boolean;
  connId: string | null;
};

type DraftPlayerState = {
  currentPack: DraftCard[] | null;
  unopenedPacks: DraftCard[][];
  picked: DraftCard[];
  hasPickedThisRotation: boolean;
};

type DraftRuntime = {
  round: number;
  totalRounds: number;
  direction: DraftDirection;
  seatOrder: string[];
  states: Record<string, DraftPlayerState>;
};

type DeckbuildPlayerState = {
  pool: DraftCard[];
  deck: string[];
  basicLands: BasicLandCounts;
  ready: boolean;
};

type DeckbuildRuntime = {
  seatOrder: string[];
  states: Record<string, DeckbuildPlayerState>;
};

type PlayingPlayerState = {
  deck: DraftCard[];
  hand: DraftCard[];
  battlefield: BattlefieldCard[];
  graveyard: DraftCard[];
  exile: DraftCard[];
  life: number;
};

/** A player's finished deckbuild — used to start fresh games of a match. */
type Loadout = {
  /** Cards drafted and chosen for the deck (excludes basics; basics are minted at game start). */
  deckCards: DraftCard[];
  basicLands: BasicLandCounts;
};

type MatchRuntime = {
  id: string;
  playerIds: [string, string];
  bestOf: BestOf;
  wins: Record<string, number>;
  gameNumber: number;
  states: Record<string, PlayingPlayerState>;
  status: "active" | "complete";
  matchWinner: string | null;
  /** When set, the current game has a winner and is awaiting `advanceGame`. */
  currentGameWinner: string | null;
  /** Cosmetic turn pointer; alternates on passTurn / resets on advanceGame. */
  currentTurnPlayerId: string;
  /** Whoever should start the next game (alternates per game). */
  nextGameStarterId: string;
  turnNumber: number;
};

export default class LobbyServer implements Party.Server {
  private players = new Map<string, Player>();
  private connToPlayer = new Map<string, string>();
  private config: LobbyConfig = { ...DEFAULT_CONFIG };
  private phase: LobbyPhase = "waiting";

  private draft: DraftRuntime | null = null;
  private deckbuild: DeckbuildRuntime | null = null;
  /** Loadouts captured at end of deckbuild; used for every game in a player's matches. */
  private loadouts: Record<string, Loadout> | null = null;
  private matches: MatchRuntime[] | null = null;
  private customSet: Card[] | null = null;
  private customSetName: string | null = null;

  constructor(readonly room: Party.Room) {}

  // ---------- connection lifecycle ----------

  onConnect(conn: Party.Connection, ctx: Party.ConnectionContext) {
    const url = new URL(ctx.request.url);
    const playerId = url.searchParams.get("p");
    const requestedName = url.searchParams.get("n")?.slice(0, 24);

    if (!playerId) {
      this.send(conn, { type: "error", message: "missing playerId" });
      conn.close();
      return;
    }

    const existing = this.players.get(playerId);

    if (this.phase !== "waiting" && !existing) {
      this.send(conn, { type: "rejected", reason: "lobby-in-progress" });
      conn.close();
      return;
    }

    if (!existing) {
      const connectedCount = [...this.players.values()].filter((p) => p.connId)
        .length;
      if (connectedCount >= this.config.maxPlayers) {
        this.send(conn, { type: "rejected", reason: "lobby-full" });
        conn.close();
        return;
      }
      const isFirstAdmin = !this.hasAdmin();
      this.players.set(playerId, {
        id: playerId,
        name: requestedName?.trim() || `Guest-${playerId.slice(0, 4)}`,
        isAdmin: isFirstAdmin,
        connId: conn.id,
      });
    } else {
      existing.connId = conn.id;
      if (requestedName?.trim()) existing.name = requestedName.trim();
      if (!this.hasAdmin()) existing.isAdmin = true;
    }

    this.connToPlayer.set(conn.id, playerId);
    this.broadcastState();
  }

  onClose(conn: Party.Connection) {
    const playerId = this.connToPlayer.get(conn.id);
    this.connToPlayer.delete(conn.id);
    if (!playerId) return;
    const player = this.players.get(playerId);
    if (!player) return;
    player.connId = null;

    if (player.isAdmin && this.phase === "waiting") {
      const successor = [...this.players.values()].find(
        (p) => p.connId !== null && p.id !== player.id,
      );
      if (successor) {
        player.isAdmin = false;
        successor.isAdmin = true;
      }
    }

    this.broadcastState();
  }

  // ---------- messages ----------

  onMessage(raw: string, sender: Party.Connection) {
    const playerId = this.connToPlayer.get(sender.id);
    if (!playerId) return;
    const player = this.players.get(playerId);
    if (!player) return;

    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    switch (msg.type) {
      case "rename": {
        const trimmed = msg.name.trim().slice(0, 24);
        if (!trimmed) return;
        player.name = trimmed;
        this.broadcastState();
        return;
      }
      case "updateConfig": {
        if (!player.isAdmin) return;
        if (this.phase !== "waiting") return;
        this.config = clampConfig({ ...this.config, ...msg.config });
        this.broadcastState();
        return;
      }
      case "startDraft": {
        if (!player.isAdmin) return;
        if (this.phase !== "waiting") return;
        const connectedPlayers = [...this.players.values()].filter(
          (p) => p.connId,
        );
        if (connectedPlayers.length < 2) {
          this.send(sender, {
            type: "error",
            message: "Need at least 2 connected players to start.",
          });
          return;
        }
        try {
          this.startDraft(connectedPlayers.map((p) => p.id));
          this.broadcastState();
        } catch (e) {
          this.send(sender, {
            type: "error",
            message: `Couldn't start draft: ${e instanceof Error ? e.message : String(e)}`,
          });
        }
        return;
      }
      case "pick": {
        if (this.phase !== "drafting" || !this.draft) return;
        this.applyPick(playerId, msg.instanceId);
        this.broadcastState();
        return;
      }
      case "setDeck": {
        if (this.phase !== "deckbuilding" || !this.deckbuild) return;
        const dbState = this.deckbuild.states[playerId];
        if (!dbState) return;
        const poolIds = new Set(dbState.pool.map((c) => c.instanceId));
        const validDeck = msg.deck.filter((id) => poolIds.has(id));
        dbState.deck = [...new Set(validDeck)];
        this.broadcastState();
        return;
      }
      case "setBasicLands": {
        if (this.phase !== "deckbuilding" || !this.deckbuild) return;
        const dbState = this.deckbuild.states[playerId];
        if (!dbState) return;
        dbState.basicLands = clampLandCounts(msg.counts);
        this.broadcastState();
        return;
      }
      case "setReady": {
        if (this.phase !== "deckbuilding" || !this.deckbuild) return;
        const dbState = this.deckbuild.states[playerId];
        if (!dbState) return;
        dbState.ready = !!msg.ready;
        this.broadcastState();
        return;
      }
      case "startPlay": {
        if (!player.isAdmin) return;
        if (this.phase !== "deckbuilding" || !this.deckbuild) return;
        this.transitionToMatching();
        this.broadcastState();
        return;
      }
      case "startMatches": {
        if (!player.isAdmin) return;
        if (this.phase !== "matching" || !this.loadouts) return;
        const built = this.buildMatches(msg.pairings);
        if (!built.ok) {
          this.send(sender, { type: "error", message: built.message });
          return;
        }
        this.matches = built.matches;
        this.phase = "playing";
        this.broadcastState();
        return;
      }
      case "playAction": {
        if (this.phase !== "playing" || !this.matches) return;
        const match = this.matches.find((m) =>
          m.playerIds.includes(playerId),
        );
        if (!match) return;
        if (match.status === "complete" || match.currentGameWinner) return;
        if (!match.states[playerId]) return;
        this.applyPlayAction(match, playerId, msg.action);
        this.broadcastState();
        return;
      }
      case "concedeGame": {
        if (this.phase !== "playing" || !this.matches) return;
        const match = this.matches.find((m) => m.id === msg.matchId);
        if (!match) return;
        if (!match.playerIds.includes(playerId)) return;
        if (match.status === "complete" || match.currentGameWinner) return;
        const winner = match.playerIds.find((p) => p !== playerId)!;
        match.currentGameWinner = winner;
        match.wins[winner] = (match.wins[winner] ?? 0) + 1;
        const needed = Math.ceil(match.bestOf / 2);
        if (match.wins[winner] >= needed) {
          match.status = "complete";
          match.matchWinner = winner;
        }
        this.broadcastState();
        return;
      }
      case "advanceGame": {
        if (this.phase !== "playing" || !this.matches || !this.loadouts) return;
        const match = this.matches.find((m) => m.id === msg.matchId);
        if (!match) return;
        if (!match.playerIds.includes(playerId) && !player.isAdmin) return;
        if (match.status === "complete") return;
        if (!match.currentGameWinner) return;
        match.gameNumber += 1;
        match.currentGameWinner = null;
        match.currentTurnPlayerId = match.nextGameStarterId;
        match.nextGameStarterId = match.playerIds.find(
          (p) => p !== match.nextGameStarterId,
        )!;
        match.turnNumber = 1;
        for (const pid of match.playerIds) {
          match.states[pid] = freshGameState(this.loadouts[pid]);
        }
        this.broadcastState();
        return;
      }
      case "passTurn": {
        if (this.phase !== "playing" || !this.matches) return;
        const match = this.matches.find((m) => m.id === msg.matchId);
        if (!match) return;
        if (!match.playerIds.includes(playerId)) return;
        if (match.status === "complete" || match.currentGameWinner) return;
        // Anyone in the pair can pass — usually the active player, but allow either.
        match.currentTurnPlayerId = match.playerIds.find(
          (p) => p !== match.currentTurnPlayerId,
        )!;
        match.turnNumber += 1;
        this.broadcastState();
        return;
      }
      case "returnToMatching": {
        if (!player.isAdmin) return;
        if (this.phase !== "playing" || !this.matches) return;
        this.matches = null;
        this.phase = "matching";
        this.broadcastState();
        return;
      }
      case "setCustomSet": {
        if (!player.isAdmin) return;
        if (this.phase !== "waiting") return;
        if (msg.cards === null) {
          this.customSet = null;
          this.customSetName = null;
          this.broadcastState();
          return;
        }
        const parsed = z.array(CardSchema).min(15).safeParse(msg.cards);
        if (!parsed.success) {
          this.send(sender, {
            type: "error",
            message: "Invalid custom set: " + parsed.error.message.slice(0, 200),
          });
          return;
        }
        this.customSet = parsed.data;
        this.customSetName =
          typeof msg.name === "string" && msg.name.trim()
            ? msg.name.trim().slice(0, 64)
            : null;
        this.broadcastState();
        return;
      }
    }
  }

  // ---------- draft logic ----------

  private startDraft(playerIds: string[]) {
    const seatOrder = shuffle(playerIds);
    const totalRounds = this.config.packsPerPlayer;
    const sourceSet = this.customSet ?? MOCK_SET;
    const states: Record<string, DraftPlayerState> = {};
    for (const pid of seatOrder) {
      const packs: DraftCard[][] = [];
      for (let i = 0; i < totalRounds; i++) {
        packs.push(mintDraftCards(generatePack(sourceSet)));
      }
      states[pid] = {
        currentPack: packs.shift() ?? null,
        unopenedPacks: packs,
        picked: [],
        hasPickedThisRotation: false,
      };
    }
    this.draft = {
      round: 1,
      totalRounds,
      direction: "left",
      seatOrder,
      states,
    };
    this.phase = "drafting";
  }

  private applyPick(playerId: string, instanceId: string) {
    if (!this.draft) return;
    const ps = this.draft.states[playerId];
    if (!ps) return;
    if (!ps.currentPack) return;
    if (ps.hasPickedThisRotation) return;

    const idx = ps.currentPack.findIndex((c) => c.instanceId === instanceId);
    if (idx < 0) return;

    const [card] = ps.currentPack.splice(idx, 1);
    ps.picked.push(card);
    ps.hasPickedThisRotation = true;

    this.tryRotate();
  }

  private tryRotate() {
    if (!this.draft) return;
    const allDone = this.draft.seatOrder.every((pid) => {
      const ps = this.draft!.states[pid];
      return (
        ps.hasPickedThisRotation ||
        !ps.currentPack ||
        ps.currentPack.length === 0
      );
    });
    if (!allDone) return;

    const incoming: Record<string, DraftCard[] | null> = {};
    for (const pid of this.draft.seatOrder) {
      const ps = this.draft.states[pid];
      if (ps.currentPack && ps.currentPack.length > 0) {
        const target = this.nextSeat(pid);
        incoming[target] = ps.currentPack;
      }
    }

    for (const pid of this.draft.seatOrder) {
      const ps = this.draft.states[pid];
      ps.currentPack = incoming[pid] ?? null;
      ps.hasPickedThisRotation = false;
    }

    const roundOver = this.draft.seatOrder.every((pid) => {
      const ps = this.draft!.states[pid];
      return !ps.currentPack || ps.currentPack.length === 0;
    });

    if (roundOver) this.advanceRound();
  }

  private advanceRound() {
    if (!this.draft) return;
    this.draft.round += 1;
    if (this.draft.round > this.draft.totalRounds) {
      this.transitionToDeckbuilding();
      return;
    }
    this.draft.direction = this.draft.direction === "left" ? "right" : "left";
    for (const pid of this.draft.seatOrder) {
      const ps = this.draft.states[pid];
      ps.currentPack = ps.unopenedPacks.shift() ?? null;
      ps.hasPickedThisRotation = false;
    }
  }

  private nextSeat(pid: string): string {
    if (!this.draft) return pid;
    const order = this.draft.seatOrder;
    const idx = order.indexOf(pid);
    const offset = this.draft.direction === "left" ? 1 : -1;
    return order[(idx + offset + order.length) % order.length];
  }

  // ---------- deckbuilding logic ----------

  private transitionToDeckbuilding() {
    if (!this.draft) return;
    const states: Record<string, DeckbuildPlayerState> = {};
    for (const pid of this.draft.seatOrder) {
      const ps = this.draft.states[pid];
      states[pid] = {
        pool: ps.picked,
        deck: [],
        basicLands: { ...ZERO_LANDS },
        ready: false,
      };
    }
    this.deckbuild = { seatOrder: this.draft.seatOrder, states };
    this.draft = null;
    this.phase = "deckbuilding";
  }

  // ---------- matching / playing logic ----------

  private transitionToMatching() {
    if (!this.deckbuild) return;
    const loadouts: Record<string, Loadout> = {};
    for (const pid of this.deckbuild.seatOrder) {
      const db = this.deckbuild.states[pid];
      const poolMap = new Map(db.pool.map((c) => [c.instanceId, c]));
      const drafted: DraftCard[] = [];
      for (const id of db.deck) {
        const c = poolMap.get(id);
        if (c) drafted.push(c);
      }
      loadouts[pid] = {
        deckCards: drafted,
        basicLands: { ...db.basicLands },
      };
    }
    this.loadouts = loadouts;
    this.deckbuild = null;
    this.matches = null;
    this.phase = "matching";
  }

  private buildMatches(
    pairings: MatchPairing[],
  ):
    | { ok: true; matches: MatchRuntime[] }
    | { ok: false; message: string } {
    if (!this.loadouts) return { ok: false, message: "No loadouts." };
    if (pairings.length === 0)
      return { ok: false, message: "Need at least one pairing." };
    const seen = new Set<string>();
    const built: MatchRuntime[] = [];
    for (const p of pairings) {
      const [a, b] = p.playerIds;
      if (a === b) return { ok: false, message: "A player can't face themselves." };
      if (!this.loadouts[a] || !this.loadouts[b])
        return { ok: false, message: "Pairing references unknown player." };
      if (seen.has(a) || seen.has(b))
        return { ok: false, message: "A player appears in two pairings." };
      seen.add(a);
      seen.add(b);
      const bestOf: BestOf = p.bestOf === 1 || p.bestOf === 3 || p.bestOf === 5
        ? p.bestOf
        : 1;
      built.push({
        id: matchId(a, b),
        playerIds: [a, b],
        bestOf,
        wins: { [a]: 0, [b]: 0 },
        gameNumber: 1,
        states: {
          [a]: freshGameState(this.loadouts[a]),
          [b]: freshGameState(this.loadouts[b]),
        },
        status: "active",
        matchWinner: null,
        currentGameWinner: null,
        currentTurnPlayerId: a,
        nextGameStarterId: b,
        turnNumber: 1,
      });
    }
    return { ok: true, matches: built };
  }

  private applyPlayAction(
    match: MatchRuntime,
    playerId: string,
    action: PlayAction,
  ) {
    const ps = match.states[playerId];
    if (!ps) return;

    switch (action.type) {
      case "draw": {
        const count = Math.max(0, Math.min(action.count, ps.deck.length));
        const drawn = ps.deck.splice(0, count);
        ps.hand.push(...drawn);
        return;
      }
      case "mulligan": {
        const newSize = Math.max(0, ps.hand.length - 1);
        ps.deck.push(...ps.hand);
        ps.hand = [];
        shuffleInPlace(ps.deck);
        const drawn = ps.deck.splice(0, Math.min(newSize, ps.deck.length));
        ps.hand.push(...drawn);
        return;
      }
      case "shuffleDeck": {
        shuffleInPlace(ps.deck);
        return;
      }
      case "newGame": {
        const all: DraftCard[] = [
          ...ps.deck,
          ...ps.hand,
          ...ps.battlefield.map((b) => b.card),
          ...ps.graveyard,
          ...ps.exile,
        ];
        ps.deck = all;
        ps.hand = [];
        ps.battlefield = [];
        ps.graveyard = [];
        ps.exile = [];
        ps.life = STARTING_LIFE;
        shuffleInPlace(ps.deck);
        const drawn = ps.deck.splice(
          0,
          Math.min(STARTING_HAND, ps.deck.length),
        );
        ps.hand.push(...drawn);
        return;
      }
      case "tap": {
        const bf = ps.battlefield.find(
          (b) => b.card.instanceId === action.instanceId,
        );
        if (!bf) return;
        bf.tapped = !!action.tapped;
        return;
      }
      case "move": {
        const card = removeFromZone(ps, action.from, action.instanceId);
        if (!card) return;
        placeInZone(
          ps,
          action.to,
          card,
          action.tapped ?? false,
          action.attachedTo ?? null,
        );
        return;
      }
      case "setAttached": {
        const bf = ps.battlefield.find(
          (b) => b.card.instanceId === action.instanceId,
        );
        if (!bf) return;
        if (action.targetInstanceId === action.instanceId) return;
        if (action.targetInstanceId) {
          const target = ps.battlefield.find(
            (b) => b.card.instanceId === action.targetInstanceId,
          );
          if (!target) return;
        }
        bf.attachedTo = action.targetInstanceId ?? null;
        return;
      }
      case "adjustLife": {
        ps.life = clampLife(ps.life + action.delta);
        return;
      }
      case "setLife": {
        ps.life = clampLife(action.value);
        return;
      }
    }
  }

  // ---------- snapshots ----------

  private hasAdmin(): boolean {
    return [...this.players.values()].some((p) => p.isAdmin && p.connId);
  }

  private lobbySnapshot(): LobbyState {
    return {
      id: this.room.id,
      phase: this.phase,
      config: this.config,
      players: [...this.players.values()].map((p) => ({
        id: p.id,
        name: p.name,
        isAdmin: p.isAdmin,
        connected: p.connId !== null,
      })),
      draft: this.draft ? this.draftPublicSnapshot() : null,
      deckbuild: this.deckbuild ? this.deckbuildPublicSnapshot() : null,
      play: null,
      matches: this.matches ? this.matchesPublicSnapshot() : null,
      unpairedPlayerIds: this.unpairedPlayerIds(),
      customSet: this.customSet,
      customSetName: this.customSetName,
    };
  }

  private unpairedPlayerIds(): string[] {
    if (this.phase !== "matching" && this.phase !== "playing") return [];
    if (!this.loadouts) return [];
    const all = Object.keys(this.loadouts);
    const inMatch = new Set<string>();
    if (this.matches) {
      for (const m of this.matches) {
        for (const pid of m.playerIds) inMatch.add(pid);
      }
    }
    return all.filter((p) => !inMatch.has(p));
  }

  private draftPublicSnapshot(): DraftPublicState {
    if (!this.draft) throw new Error("no draft");
    return {
      round: this.draft.round,
      totalRounds: this.draft.totalRounds,
      direction: this.draft.direction,
      seatOrder: this.draft.seatOrder,
      draftPhase: "drafting",
      players: this.draft.seatOrder.map((pid) => {
        const player = this.players.get(pid)!;
        const ps = this.draft!.states[pid];
        return {
          id: pid,
          name: player.name,
          pickedCount: ps.picked.length,
          hasPickedThisRotation: ps.hasPickedThisRotation,
          hasCurrentPack: !!ps.currentPack && ps.currentPack.length > 0,
          currentPackSize: ps.currentPack?.length ?? 0,
          connected: player.connId !== null,
        };
      }),
    };
  }

  private draftPrivateFor(playerId: string): DraftPrivateState | null {
    if (!this.draft) return null;
    const ps = this.draft.states[playerId];
    if (!ps) return null;
    return {
      currentPack: ps.currentPack,
      picked: ps.picked,
      unopenedCount: ps.unopenedPacks.length,
      hasPickedThisRotation: ps.hasPickedThisRotation,
    };
  }

  private deckbuildPublicSnapshot(): DeckbuildPublicState {
    if (!this.deckbuild) throw new Error("no deckbuild");
    const db = this.deckbuild;
    return {
      players: db.seatOrder.map((pid) => {
        const player = this.players.get(pid)!;
        const dbState = db.states[pid];
        const total =
          dbState.deck.length +
          dbState.basicLands.W +
          dbState.basicLands.U +
          dbState.basicLands.B +
          dbState.basicLands.R +
          dbState.basicLands.G;
        return {
          id: pid,
          name: player.name,
          deckSize: total,
          ready: dbState.ready,
          connected: player.connId !== null,
        };
      }),
    };
  }

  private deckbuildPrivateFor(
    playerId: string,
  ): DeckbuildPrivateState | null {
    if (!this.deckbuild) return null;
    const ps = this.deckbuild.states[playerId];
    if (!ps) return null;
    return {
      pool: ps.pool,
      deck: ps.deck,
      basicLands: ps.basicLands,
      ready: ps.ready,
    };
  }

  private matchesPublicSnapshot(): MatchPublicState[] {
    if (!this.matches) return [];
    return this.matches.map((m) => ({
      id: m.id,
      playerIds: m.playerIds,
      bestOf: m.bestOf,
      wins: { ...m.wins },
      gameNumber: m.gameNumber,
      status: m.status,
      matchWinner: m.matchWinner,
      currentGameWinner: m.currentGameWinner,
      currentTurnPlayerId: m.currentTurnPlayerId,
      turnNumber: m.turnNumber,
      players: m.playerIds.map((pid): PlayPublicPlayer => {
        const player = this.players.get(pid)!;
        const ps = m.states[pid];
        return {
          id: pid,
          name: player.name,
          deckSize: ps.deck.length,
          handSize: ps.hand.length,
          battlefield: ps.battlefield,
          graveyard: ps.graveyard,
          exile: ps.exile,
          life: ps.life,
          connected: player.connId !== null,
        };
      }),
    }));
  }

  private playPrivateFor(playerId: string): PlayPrivateState | null {
    if (!this.matches) return null;
    const match = this.matches.find((m) => m.playerIds.includes(playerId));
    if (!match) return null;
    const ps = match.states[playerId];
    if (!ps) return null;
    return { hand: ps.hand, deck: ps.deck, matchId: match.id };
  }

  // ---------- transport ----------

  private send(conn: Party.Connection, msg: ServerMessage) {
    conn.send(JSON.stringify(msg));
  }

  private broadcastState() {
    const lobby = this.lobbySnapshot();
    for (const conn of this.room.getConnections()) {
      const playerId = this.connToPlayer.get(conn.id);
      const msg: ServerMessage = {
        type: "state",
        state: lobby,
        draftPrivate: playerId ? this.draftPrivateFor(playerId) : null,
        deckbuildPrivate: playerId
          ? this.deckbuildPrivateFor(playerId)
          : null,
        playPrivate: playerId ? this.playPrivateFor(playerId) : null,
      };
      conn.send(JSON.stringify(msg));
    }
  }
}

LobbyServer satisfies Party.Worker;

// ---------- helpers ----------

function removeFromZone(
  ps: PlayingPlayerState,
  zone: Zone,
  instanceId: string,
): DraftCard | null {
  if (zone === "battlefield") {
    const idx = ps.battlefield.findIndex(
      (b) => b.card.instanceId === instanceId,
    );
    if (idx < 0) return null;
    const [bf] = ps.battlefield.splice(idx, 1);
    // Anything that was attached to this card becomes loose on the battlefield.
    for (const other of ps.battlefield) {
      if (other.attachedTo === instanceId) other.attachedTo = null;
    }
    return bf.card;
  }
  const arr =
    zone === "deck"
      ? ps.deck
      : zone === "hand"
        ? ps.hand
        : zone === "graveyard"
          ? ps.graveyard
          : ps.exile;
  const idx = arr.findIndex((c) => c.instanceId === instanceId);
  if (idx < 0) return null;
  return arr.splice(idx, 1)[0];
}

function placeInZone(
  ps: PlayingPlayerState,
  target: ZoneTarget,
  card: DraftCard,
  tapped: boolean,
  attachedTo: string | null = null,
) {
  switch (target) {
    case "deck-top":
      ps.deck.unshift(card);
      return;
    case "deck-bottom":
      ps.deck.push(card);
      return;
    case "hand":
      ps.hand.push(card);
      return;
    case "battlefield":
      // Only honor attachedTo if the target card actually exists on the battlefield.
      if (
        attachedTo &&
        ps.battlefield.some((b) => b.card.instanceId === attachedTo)
      ) {
        ps.battlefield.push({ card, tapped, attachedTo });
      } else {
        ps.battlefield.push({ card, tapped });
      }
      return;
    case "graveyard":
      ps.graveyard.push(card);
      return;
    case "exile":
      ps.exile.push(card);
      return;
  }
}

function clampLife(n: number): number {
  return Math.max(-99, Math.min(999, Math.floor(n)));
}

function freshGameState(loadout: Loadout): PlayingPlayerState {
  const lands = mintBasicLands(loadout.basicLands);
  // Re-mint deck cards so a new game gets fresh instanceIds (avoids any stale
  // attachedTo references from prior games and prevents cross-game ID reuse).
  const reminted = mintDraftCards(loadout.deckCards.map(stripInstance));
  const fullDeck = shuffle([...reminted, ...lands]);
  const handSize = Math.min(STARTING_HAND, fullDeck.length);
  const hand = fullDeck.splice(0, handSize);
  return {
    deck: fullDeck,
    hand,
    battlefield: [],
    graveyard: [],
    exile: [],
    life: STARTING_LIFE,
  };
}

function stripInstance(c: DraftCard): Card {
  // mintDraftCards expects raw Card defs; strip instance-specific fields.
  const { instanceId, ...rest } = c;
  void instanceId;
  return rest;
}

function matchId(a: string, b: string): string {
  return `m_${a.slice(0, 4)}-${b.slice(0, 4)}_${Math.random()
    .toString(36)
    .slice(2, 7)}`;
}

function mintBasicLands(counts: BasicLandCounts): DraftCard[] {
  const cards = [];
  const colors: Color[] = ["W", "U", "B", "R", "G"];
  for (const color of colors) {
    const id = BASIC_LAND_BY_COLOR[color];
    const def = MOCK_SET.find((c) => c.id === id);
    if (!def) continue;
    for (let i = 0; i < counts[color]; i++) cards.push(def);
  }
  return mintDraftCards(cards);
}

function shuffle<T>(arr: T[]): T[] {
  const out = arr.slice();
  shuffleInPlace(out);
  return out;
}

function shuffleInPlace<T>(arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}
