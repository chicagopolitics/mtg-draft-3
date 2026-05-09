import type * as Party from "partykit/server";

import {
  type Card,
  type Color,
  type DraftCard,
  CardSchema,
  DraftCardSchema,
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
  type ConstructPrivateState,
  type ConstructPublicState,
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

type ConstructPlayerState = {
  decklist: string;
  /** Materialized & minted cards from the most recent successful parse. */
  cards: DraftCard[];
  warnings: string[];
  ready: boolean;
};

type ConstructRuntime = {
  seatOrder: string[];
  states: Record<string, ConstructPlayerState>;
};

type PlayingPlayerState = {
  deck: DraftCard[];
  hand: DraftCard[];
  battlefield: BattlefieldCard[];
  graveyard: DraftCard[];
  exile: DraftCard[];
  /** When true, the player's hand is broadcast in the public snapshot. */
  handRevealed?: boolean;
};

/** A player's finished deckbuild — used to start fresh games of a match. */
type Loadout = {
  /** Cards drafted and chosen for the deck (excludes basics; basics are minted at game start). */
  deckCards: DraftCard[];
  basicLands: BasicLandCounts;
  /**
   * Basic-land Card definitions captured from the active set, keyed by color.
   * Carries the Scryfall art the set had loaded — without this, basics minted
   * for a player's deck fall back to the artless MOCK_SET defs.
   */
  basicLandDefs?: Partial<Record<Color, Card>>;
};

type MatchRuntime = {
  id: string;
  /** Two teams of 1+ players (1v1 = length 1; 2HG = length 2). */
  teams: [string[], string[]];
  bestOf: BestOf;
  wins: [number, number];
  startingLife: number;
  teamLife: [number, number];
  gameNumber: number;
  /** Per-player game state — hand, deck, battlefield, etc. Life lives on the team. */
  states: Record<string, PlayingPlayerState>;
  status: "active" | "complete";
  /** Index (0/1) of the team that won the match. */
  matchWinner: number | null;
  /** Index (0/1) of the team that won the current game. */
  currentGameWinner: number | null;
  /** Index (0/1) of the team whose turn it is. */
  currentTurnTeamIdx: number;
  /** Players on the active team who've already ended their sub-turn. */
  passedMembers: string[];
  /** Index (0/1) of the team that should start the next game. */
  nextGameStarterTeamIdx: number;
  turnNumber: number;
};

export default class LobbyServer implements Party.Server {
  private players = new Map<string, Player>();
  private connToPlayer = new Map<string, string>();
  /**
   * Pending admin-handoff timers, keyed by playerId of the admin that just
   * disconnected. If they reconnect before the timer fires (e.g., the user
   * just navigated from /draft to /build, briefly closing the WebSocket),
   * we cancel the handoff and they keep admin. Without this, every page
   * navigation would transfer admin to whoever stayed put.
   */
  private pendingAdminHandoffs = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();
  private config: LobbyConfig = { ...DEFAULT_CONFIG };
  private phase: LobbyPhase = "waiting";

  private draft: DraftRuntime | null = null;
  private deckbuild: DeckbuildRuntime | null = null;
  private construct: ConstructRuntime | null = null;
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
      // Admin sticks to one player. New joiners are admin only when no admin
      // exists at all (including disconnected) — this prevents a flood of
      // admins when the original admin's tab is briefly absent.
      const isFirstAdmin = !this.anyAdminExists();
      this.players.set(playerId, {
        id: playerId,
        name: requestedName?.trim() || `Guest-${playerId.slice(0, 4)}`,
        isAdmin: isFirstAdmin,
        connId: conn.id,
      });
    } else {
      existing.connId = conn.id;
      if (requestedName?.trim()) existing.name = requestedName.trim();
      // If a handoff was pending for this player (they were admin and just
      // briefly disconnected), cancel it — their reconnect "won the race."
      const pending = this.pendingAdminHandoffs.get(playerId);
      if (pending) {
        clearTimeout(pending);
        this.pendingAdminHandoffs.delete(playerId);
      }
      // Reconnects do NOT auto-promote. Admin status is sticky across the
      // session — a successor is only chosen in onClose when the admin leaves.
      if (!this.anyAdminExists()) existing.isAdmin = true;
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

    // When the admin leaves, defer the handoff for a few seconds. Page
    // navigation (e.g., /lobby → /draft → /build) closes and reopens the
    // WebSocket within ~100-500ms; an immediate handoff would transfer admin
    // to whichever player happened not to be navigating.
    if (player.isAdmin) {
      // Replace any prior timer for this same player.
      const prior = this.pendingAdminHandoffs.get(playerId);
      if (prior) clearTimeout(prior);
      const timer = setTimeout(() => {
        this.pendingAdminHandoffs.delete(playerId);
        const stillAdmin = this.players.get(playerId);
        if (!stillAdmin || !stillAdmin.isAdmin) return;
        if (stillAdmin.connId !== null) return; // they came back
        const successor = [...this.players.values()].find(
          (p) => p.connId !== null && p.id !== playerId,
        );
        if (successor) {
          stillAdmin.isAdmin = false;
          successor.isAdmin = true;
          this.broadcastState();
        }
      }, 8000);
      this.pendingAdminHandoffs.set(playerId, timer);
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
          const ids = connectedPlayers.map((p) => p.id);
          if (this.config.format === "sealed") {
            this.startSealed(ids);
          } else if (this.config.format === "constructed") {
            this.startConstructed(ids);
          } else {
            this.startDraft(ids);
          }
          this.broadcastState();
        } catch (e) {
          this.send(sender, {
            type: "error",
            message: `Couldn't start: ${e instanceof Error ? e.message : String(e)}`,
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
      case "setConstructDeck": {
        if (this.phase !== "constructing" || !this.construct) return;
        const cs = this.construct.states[playerId];
        if (!cs) return;
        // Constructed pulls from a cross-set library that lives in Next.js,
        // so the client resolves the decklist locally and ships us the
        // materialized cards. We just validate shape + cap counts.
        const text = msg.decklist.slice(0, 20000);
        const parsed = z
          .array(DraftCardSchema)
          .max(500)
          .safeParse(msg.cards ?? []);
        if (!parsed.success) {
          this.send(sender, {
            type: "error",
            message: "Invalid deck payload",
          });
          return;
        }
        const warnings = (msg.warnings ?? [])
          .filter((w) => typeof w === "string")
          .slice(0, 50)
          .map((w) => w.slice(0, 200));
        cs.decklist = text;
        cs.cards = parsed.data;
        cs.warnings = warnings;
        cs.ready = false;
        this.broadcastState();
        return;
      }
      case "setReady": {
        if (this.phase === "deckbuilding" && this.deckbuild) {
          const dbState = this.deckbuild.states[playerId];
          if (!dbState) return;
          dbState.ready = !!msg.ready;
          this.broadcastState();
          return;
        }
        if (this.phase === "constructing" && this.construct) {
          const cs = this.construct.states[playerId];
          if (!cs) return;
          // Ready only allowed if the deck is non-empty.
          if (msg.ready && cs.cards.length === 0) return;
          cs.ready = !!msg.ready;
          this.broadcastState();
          return;
        }
        return;
      }
      case "startPlay": {
        if (!player.isAdmin) return;
        if (this.phase === "deckbuilding" && this.deckbuild) {
          this.transitionToMatching();
          this.broadcastState();
          return;
        }
        if (this.phase === "constructing" && this.construct) {
          this.transitionToMatchingFromConstruct();
          this.broadcastState();
          return;
        }
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
        const match = this.matches.find(
          (m) => this.teamOf(m, playerId) >= 0,
        );
        if (!match) return;
        if (match.status === "complete" || match.currentGameWinner !== null)
          return;
        if (!match.states[playerId]) return;
        this.applyPlayAction(match, playerId, msg.action);
        this.broadcastState();
        return;
      }
      case "concedeGame": {
        if (this.phase !== "playing" || !this.matches) return;
        const match = this.matches.find((m) => m.id === msg.matchId);
        if (!match) return;
        const teamIdx = this.teamOf(match, playerId);
        if (teamIdx < 0) return;
        if (match.status === "complete" || match.currentGameWinner !== null)
          return;
        const winnerIdx = teamIdx === 0 ? 1 : 0;
        match.currentGameWinner = winnerIdx;
        match.wins[winnerIdx] += 1;
        const needed = Math.ceil(match.bestOf / 2);
        if (match.wins[winnerIdx] >= needed) {
          match.status = "complete";
          match.matchWinner = winnerIdx;
        }
        this.broadcastState();
        return;
      }
      case "advanceGame": {
        if (this.phase !== "playing" || !this.matches || !this.loadouts) return;
        const match = this.matches.find((m) => m.id === msg.matchId);
        if (!match) return;
        const inMatch = this.teamOf(match, playerId) >= 0;
        if (!inMatch && !player.isAdmin) return;
        if (match.status === "complete") return;
        if (match.currentGameWinner === null) return;
        match.gameNumber += 1;
        match.currentGameWinner = null;
        match.currentTurnTeamIdx = match.nextGameStarterTeamIdx;
        match.nextGameStarterTeamIdx =
          match.nextGameStarterTeamIdx === 0 ? 1 : 0;
        match.turnNumber = 1;
        match.passedMembers = [];
        match.teamLife = [match.startingLife, match.startingLife];
        for (const pid of [...match.teams[0], ...match.teams[1]]) {
          match.states[pid] = freshGameState(this.loadouts[pid]);
        }
        this.broadcastState();
        return;
      }
      case "passTurn": {
        if (this.phase !== "playing" || !this.matches) return;
        const match = this.matches.find((m) => m.id === msg.matchId);
        if (!match) return;
        const senderTeam = this.teamOf(match, playerId);
        if (senderTeam < 0) return;
        if (match.status === "complete" || match.currentGameWinner !== null)
          return;
        // Only members of the *active* team can pass — the inactive team
        // doesn't have anything to pass on.
        if (senderTeam !== match.currentTurnTeamIdx) return;

        // Toggle this player's passed flag. Letting them un-pass keeps the
        // UX forgiving (misclick recovery) and matches the "End my turn /
        // Take turn back" idiom.
        const idx = match.passedMembers.indexOf(playerId);
        if (idx >= 0) match.passedMembers.splice(idx, 1);
        else match.passedMembers.push(playerId);

        // Once every member of the active team has passed, flip teams.
        const activeTeam = match.teams[match.currentTurnTeamIdx];
        const allPassed = activeTeam.every((pid) =>
          match.passedMembers.includes(pid),
        );
        if (allPassed) {
          match.currentTurnTeamIdx =
            match.currentTurnTeamIdx === 0 ? 1 : 0;
          match.passedMembers = [];
          match.turnNumber += 1;
          // Auto-draw at the start of the new active team's turn — every
          // turn after the first one. (Game 1, turn 1's starting player
          // doesn't draw; that's handled by the fact that we don't draw
          // here on game start, only on flip.)
          for (const pid of match.teams[match.currentTurnTeamIdx]) {
            const ps = match.states[pid];
            if (!ps || ps.deck.length === 0) continue;
            const drawn = ps.deck.splice(0, 1);
            ps.hand.push(...drawn);
          }
        }
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

  /**
   * Constructed: skip drafting and deckbuilding's pool/picker entirely.
   * Players paste a decklist in the constructing phase; admin starts matches
   * once everyone is ready.
   */
  private startConstructed(playerIds: string[]) {
    const seatOrder = shuffle(playerIds);
    const states: Record<string, ConstructPlayerState> = {};
    for (const pid of seatOrder) {
      states[pid] = { decklist: "", cards: [], warnings: [], ready: false };
    }
    this.construct = { seatOrder, states };
    this.phase = "constructing";
  }

  /**
   * Sealed: skip drafting entirely. Each player opens `packsPerPlayer` packs
   * straight into their deckbuild pool. No pick rotation, no shared packs.
   */
  private startSealed(playerIds: string[]) {
    const seatOrder = shuffle(playerIds);
    const sourceSet = this.customSet ?? MOCK_SET;
    const states: Record<string, DeckbuildPlayerState> = {};
    for (const pid of seatOrder) {
      const pool: DraftCard[] = [];
      for (let i = 0; i < this.config.packsPerPlayer; i++) {
        pool.push(...mintDraftCards(generatePack(sourceSet)));
      }
      states[pid] = {
        pool,
        deck: [],
        basicLands: { ...ZERO_LANDS },
        ready: false,
      };
    }
    this.deckbuild = { seatOrder, states };
    this.phase = "deckbuilding";
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
    const sourceSet = this.customSet ?? MOCK_SET;
    const basicDefs = basicLandDefsFromSet(sourceSet);
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
        basicLandDefs: basicDefs,
      };
    }
    this.loadouts = loadouts;
    this.deckbuild = null;
    this.matches = null;
    this.phase = "matching";
  }

  /**
   * Constructed → matching. The pasted/parsed deck is the entire loadout —
   * basics are written into the decklist itself, so basicLands is zeroed.
   */
  private transitionToMatchingFromConstruct() {
    if (!this.construct) return;
    const loadouts: Record<string, Loadout> = {};
    for (const pid of this.construct.seatOrder) {
      const cs = this.construct.states[pid];
      loadouts[pid] = {
        deckCards: cs.cards,
        basicLands: { ...ZERO_LANDS },
      };
    }
    this.loadouts = loadouts;
    this.construct = null;
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
      const teams = p.teams;
      if (
        !Array.isArray(teams) ||
        teams.length !== 2 ||
        !Array.isArray(teams[0]) ||
        !Array.isArray(teams[1])
      ) {
        return { ok: false, message: "Pairing must have two teams." };
      }
      if (teams[0].length === 0 || teams[1].length === 0) {
        return { ok: false, message: "Each team needs at least one player." };
      }
      if (teams[0].length > 2 || teams[1].length > 2) {
        return { ok: false, message: "Teams cap at 2 players (2HG)." };
      }
      const allPlayers = [...teams[0], ...teams[1]];
      const distinct = new Set(allPlayers);
      if (distinct.size !== allPlayers.length) {
        return { ok: false, message: "A player appears twice in a pairing." };
      }
      for (const pid of allPlayers) {
        if (!this.loadouts[pid])
          return { ok: false, message: "Pairing references unknown player." };
        if (seen.has(pid))
          return { ok: false, message: "A player appears in two pairings." };
        seen.add(pid);
      }
      const bestOf: BestOf =
        p.bestOf === 1 || p.bestOf === 3 || p.bestOf === 5 ? p.bestOf : 1;
      const startingLife = clamp(
        Math.floor(p.startingLife ?? this.config.startingLife),
        1,
        99,
      );
      const states: Record<string, PlayingPlayerState> = {};
      for (const pid of allPlayers) {
        states[pid] = freshGameState(this.loadouts[pid]);
      }
      built.push({
        id: matchId(allPlayers[0], allPlayers[allPlayers.length - 1]),
        teams: [teams[0].slice(), teams[1].slice()],
        bestOf,
        wins: [0, 0],
        startingLife,
        teamLife: [startingLife, startingLife],
        gameNumber: 1,
        states,
        status: "active",
        matchWinner: null,
        currentGameWinner: null,
        currentTurnTeamIdx: 0,
        passedMembers: [],
        nextGameStarterTeamIdx: 1,
        turnNumber: 1,
      });
    }
    return { ok: true, matches: built };
  }

  /** Returns the team index (0 or 1) for a player in a match, or -1 if not on either. */
  private teamOf(match: MatchRuntime, playerId: string): number {
    if (match.teams[0].includes(playerId)) return 0;
    if (match.teams[1].includes(playerId)) return 1;
    return -1;
  }

  private applyPlayAction(
    match: MatchRuntime,
    playerId: string,
    action: PlayAction,
  ) {
    const senderTeamIdx = this.teamOf(match, playerId);
    if (senderTeamIdx < 0) return;
    const myState = match.states[playerId];
    if (!myState) return;
    const teammates = match.teams[senderTeamIdx];

    /** Find which player on the sender's team owns the given battlefield card. */
    const findBattlefieldOwner = (instanceId: string): string | null => {
      for (const tid of teammates) {
        const ts = match.states[tid];
        if (ts?.battlefield.some((b) => b.card.instanceId === instanceId)) {
          return tid;
        }
      }
      return null;
    };

    /** Find which player anywhere in the match owns the given battlefield card. */
    const findBattlefieldOwnerAnywhere = (
      instanceId: string,
    ): string | null => {
      for (const tid of [...match.teams[0], ...match.teams[1]]) {
        const ts = match.states[tid];
        if (ts?.battlefield.some((b) => b.card.instanceId === instanceId)) {
          return tid;
        }
      }
      return null;
    };

    /**
     * Clear any `attachedTo` references in the entire match that point to the
     * given instanceId (the card just left a battlefield, so every aura/equip
     * targeting it is now hanging in the air).
     */
    const scrubAttachedTo = (instanceId: string): void => {
      for (const tid of [...match.teams[0], ...match.teams[1]]) {
        const ts = match.states[tid];
        if (!ts) continue;
        for (const bf of ts.battlefield) {
          if (bf.attachedTo === instanceId) bf.attachedTo = null;
        }
      }
    };

    switch (action.type) {
      case "draw": {
        // Always your own deck.
        const count = Math.max(0, Math.min(action.count, myState.deck.length));
        const drawn = myState.deck.splice(0, count);
        myState.hand.push(...drawn);
        return;
      }
      case "mulligan": {
        const ps = myState;
        const newSize = Math.max(0, ps.hand.length - 1);
        ps.deck.push(...ps.hand);
        ps.hand = [];
        shuffleInPlace(ps.deck);
        const drawn = ps.deck.splice(0, Math.min(newSize, ps.deck.length));
        ps.hand.push(...drawn);
        return;
      }
      case "shuffleDeck": {
        shuffleInPlace(myState.deck);
        return;
      }
      case "newGame": {
        // Reset only the sender's pool — newGame is per-player. Team life is
        // reset by `advanceGame` handler at the match level.
        const ps = myState;
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
        shuffleInPlace(ps.deck);
        const drawn = ps.deck.splice(
          0,
          Math.min(STARTING_HAND, ps.deck.length),
        );
        ps.hand.push(...drawn);
        return;
      }
      case "tap": {
        // Allow tapping any teammate's card on the shared battlefield.
        const ownerId = findBattlefieldOwner(action.instanceId);
        if (!ownerId) return;
        const bf = match.states[ownerId].battlefield.find(
          (b) => b.card.instanceId === action.instanceId,
        );
        if (!bf) return;
        bf.tapped = !!action.tapped;
        return;
      }
      case "untapAll": {
        // Only untaps the *sender's* permanents — teammates untap their own.
        // (Real Magic's untap step is per-player; this matches that intuition.)
        for (const bf of myState.battlefield) {
          if (action.landsOnly && bf.card.type !== "land") continue;
          bf.tapped = false;
        }
        return;
      }
      case "setCounter": {
        const ownerId = findBattlefieldOwner(action.instanceId);
        if (!ownerId) return;
        const bf = match.states[ownerId].battlefield.find(
          (b) => b.card.instanceId === action.instanceId,
        );
        if (!bf) return;
        const kind = action.kind.trim().slice(0, 24);
        if (!kind) return;
        if (!bf.counters) bf.counters = {};
        const next = (bf.counters[kind] ?? 0) + action.delta;
        if (next <= 0) {
          delete bf.counters[kind];
          if (Object.keys(bf.counters).length === 0) bf.counters = undefined;
        } else {
          bf.counters[kind] = Math.min(99, next);
        }
        return;
      }
      case "clearCounters": {
        const ownerId = findBattlefieldOwner(action.instanceId);
        if (!ownerId) return;
        const bf = match.states[ownerId].battlefield.find(
          (b) => b.card.instanceId === action.instanceId,
        );
        if (!bf) return;
        bf.counters = undefined;
        return;
      }
      case "revealHand": {
        // Toggle on the sender's own state only — you can't reveal your
        // teammate's hand for them.
        myState.handRevealed = !!action.revealed;
        return;
      }
      case "move": {
        // For battlefield-sourced moves, find the owner among teammates and
        // operate on their state. For hand-sourced moves, only the sender's
        // own hand is valid (private zone).
        let ownerId = playerId;
        if (action.from === "battlefield") {
          const o = findBattlefieldOwner(action.instanceId);
          if (!o) return;
          ownerId = o;
        }
        const ownerState = match.states[ownerId];
        const card = removeFromZone(ownerState, action.from, action.instanceId);
        if (!card) return;

        // If the card just left a battlefield anywhere in the match, scrub
        // every other card's attachedTo that pointed at it — including
        // cross-team auras (e.g., your Pacifism on opp's creature that they
        // just bounced).
        if (action.from === "battlefield") {
          scrubAttachedTo(action.instanceId);
        }

        // Validate cross-team attachedTo when placing back on a battlefield.
        let validatedAttach: string | null = null;
        if (action.to === "battlefield" && action.attachedTo) {
          if (findBattlefieldOwnerAnywhere(action.attachedTo)) {
            validatedAttach = action.attachedTo;
          }
        }

        placeInZone(
          ownerState,
          action.to,
          card,
          action.tapped ?? false,
          validatedAttach,
        );
        return;
      }
      case "setAttached": {
        // Source aura must belong to the sender's team (you can't move an
        // opponent's enchantment around).
        const ownerId = findBattlefieldOwner(action.instanceId);
        if (!ownerId) return;
        const ownerState = match.states[ownerId];
        const bf = ownerState.battlefield.find(
          (b) => b.card.instanceId === action.instanceId,
        );
        if (!bf) return;
        if (action.targetInstanceId === action.instanceId) return;
        if (action.targetInstanceId) {
          // Target can be on ANY battlefield in the match — your Pacifism
          // can land on the opponent's creature.
          const targetOwner = findBattlefieldOwnerAnywhere(
            action.targetInstanceId,
          );
          if (!targetOwner) return;
        }
        bf.attachedTo = action.targetInstanceId ?? null;
        return;
      }
      case "adjustLife": {
        match.teamLife[senderTeamIdx] = clampLife(
          match.teamLife[senderTeamIdx] + action.delta,
        );
        return;
      }
      case "setLife": {
        match.teamLife[senderTeamIdx] = clampLife(action.value);
        return;
      }
    }
  }

  // ---------- snapshots ----------

  private hasAdmin(): boolean {
    return [...this.players.values()].some((p) => p.isAdmin && p.connId);
  }

  /** True if any player carries the admin flag, even if currently disconnected. */
  private anyAdminExists(): boolean {
    return [...this.players.values()].some((p) => p.isAdmin);
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
      construct: this.construct ? this.constructPublicSnapshot() : null,
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
        for (const pid of m.teams[0]) inMatch.add(pid);
        for (const pid of m.teams[1]) inMatch.add(pid);
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

  private constructPublicSnapshot(): ConstructPublicState {
    if (!this.construct) throw new Error("no construct");
    const ct = this.construct;
    return {
      players: ct.seatOrder.map((pid) => {
        const player = this.players.get(pid)!;
        const cs = ct.states[pid];
        return {
          id: pid,
          name: player.name,
          deckSize: cs.cards.length,
          ready: cs.ready,
          connected: player.connId !== null,
        };
      }),
    };
  }

  private constructPrivateFor(
    playerId: string,
  ): ConstructPrivateState | null {
    if (!this.construct) return null;
    const cs = this.construct.states[playerId];
    if (!cs) return null;
    return {
      decklist: cs.decklist,
      deckSize: cs.cards.length,
      warnings: cs.warnings,
      ready: cs.ready,
    };
  }

  private matchesPublicSnapshot(): MatchPublicState[] {
    if (!this.matches) return [];
    return this.matches.map((m) => {
      const allPids = [...m.teams[0], ...m.teams[1]];
      return {
        id: m.id,
        teams: [m.teams[0].slice(), m.teams[1].slice()],
        bestOf: m.bestOf,
        wins: [m.wins[0], m.wins[1]] as [number, number],
        startingLife: m.startingLife,
        teamLife: [m.teamLife[0], m.teamLife[1]] as [number, number],
        gameNumber: m.gameNumber,
        status: m.status,
        matchWinner: m.matchWinner,
        currentGameWinner: m.currentGameWinner,
        currentTurnTeamIdx: m.currentTurnTeamIdx,
        passedMembers: m.passedMembers.slice(),
        turnNumber: m.turnNumber,
        players: allPids.map((pid): PlayPublicPlayer => {
          const player = this.players.get(pid)!;
          const ps = m.states[pid];
          const teamIdx = this.teamOf(m, pid);
          return {
            id: pid,
            name: player.name,
            deckSize: ps.deck.length,
            handSize: ps.hand.length,
            battlefield: ps.battlefield,
            graveyard: ps.graveyard,
            exile: ps.exile,
            life: m.teamLife[teamIdx], // shared with teammate in 2HG
            connected: player.connId !== null,
            // Revealed hands snap to whatever's in `ps.hand` at broadcast time,
            // so drawing/discarding while revealed stays in sync.
            revealedHand: ps.handRevealed ? ps.hand : undefined,
          };
        }),
      };
    });
  }

  private playPrivateFor(playerId: string): PlayPrivateState | null {
    if (!this.matches) return null;
    const match = this.matches.find(
      (m) => this.teamOf(m, playerId) >= 0,
    );
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
        constructPrivate: playerId ? this.constructPrivateFor(playerId) : null,
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

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function freshGameState(loadout: Loadout): PlayingPlayerState {
  const lands = mintBasicLands(loadout.basicLands, loadout.basicLandDefs);
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

function mintBasicLands(
  counts: BasicLandCounts,
  defs?: Partial<Record<Color, Card>>,
): DraftCard[] {
  const cards: Card[] = [];
  const colors: Color[] = ["W", "U", "B", "R", "G"];
  for (const color of colors) {
    // Prefer the active-set definition (carries Scryfall art); fall back to
    // MOCK_SET only if the active set didn't ship with this basic.
    const def =
      defs?.[color] ??
      MOCK_SET.find((c) => c.id === BASIC_LAND_BY_COLOR[color]);
    if (!def) continue;
    for (let i = 0; i < counts[color]; i++) cards.push(def);
  }
  return mintDraftCards(cards);
}

/** Build a color → basic-land-Card map from the active set, falling back to MOCK_SET. */
function basicLandDefsFromSet(set: Card[]): Partial<Record<Color, Card>> {
  const out: Partial<Record<Color, Card>> = {};
  const colors: Color[] = ["W", "U", "B", "R", "G"];
  for (const color of colors) {
    const id = BASIC_LAND_BY_COLOR[color];
    out[color] = set.find((c) => c.id === id);
  }
  return out;
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
