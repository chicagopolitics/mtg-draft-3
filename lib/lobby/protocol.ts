import type { Card, Color, DraftCard } from "../cards/schema";

export type Format = "booster" | "sealed" | "constructed";

export const FORMAT_LABEL: Record<Format, string> = {
  booster: "Booster Draft",
  sealed: "Sealed",
  constructed: "Constructed",
};

export const FORMAT_DESCRIPTION: Record<Format, string> = {
  booster: "Players take turns picking from rotating packs.",
  sealed: "Each player opens their own packs and builds a deck — no drafting.",
  constructed:
    "Bring your own list. Paste a decklist (4-of allowed) drawn from the active set.",
};

export type LobbyConfig = {
  format: Format;
  maxPlayers: number;
  packsPerPlayer: number;
  /** Default life total seeded into new matches; admin can override per-pairing. */
  startingLife: number;
};

export type DraftDirection = "left" | "right";

/** Public draft state — visible to all players in the lobby. */
export type DraftPublicState = {
  round: number;
  totalRounds: number;
  direction: DraftDirection;
  seatOrder: string[];
  players: Array<{
    id: string;
    name: string;
    pickedCount: number;
    hasPickedThisRotation: boolean;
    hasCurrentPack: boolean;
    currentPackSize: number;
    connected: boolean;
  }>;
  /** "drafting" while picks happen; "complete" when all rounds done. */
  draftPhase: "drafting" | "complete";
};

/** Private draft state — sent only to the recipient. */
export type DraftPrivateState = {
  currentPack: DraftCard[] | null;
  picked: DraftCard[];
  unopenedCount: number;
  hasPickedThisRotation: boolean;
};

/** Counts of basic lands a player adds to their deck. */
export type BasicLandCounts = Record<Color, number>;

export const ZERO_LANDS: BasicLandCounts = {
  W: 0,
  U: 0,
  B: 0,
  R: 0,
  G: 0,
};

export const MIN_DECK_SIZE = 40;

/** Public deckbuilding state — visible to all players. */
export type DeckbuildPublicState = {
  players: Array<{
    id: string;
    name: string;
    deckSize: number;
    ready: boolean;
    connected: boolean;
  }>;
};

/** Private deckbuilding state — sent only to the recipient. */
export type DeckbuildPrivateState = {
  pool: DraftCard[];
  deck: string[];
  basicLands: BasicLandCounts;
  ready: boolean;
};

export type Zone = "deck" | "hand" | "battlefield" | "graveyard" | "exile";
export type ZoneTarget =
  | "deck-top"
  | "deck-bottom"
  | "hand"
  | "battlefield"
  | "graveyard"
  | "exile";

/** Standard counter kinds with quick-action buttons in the UI. */
export const STANDARD_COUNTERS = [
  "+1/+1",
  "-1/-1",
  "+1/+0",
  "+0/+1",
  "loyalty",
  "charge",
] as const;

/**
 * Matches any P/T-modifier counter name like `+1/+1`, `-1/-1`, `+1/+0`,
 * `+0/+1`, `+2/-1`, etc. Captures: power-sign, power-amount, toughness-sign,
 * toughness-amount.
 */
const PT_COUNTER_RE = /^([+-])(\d+)\/([+-])(\d+)$/;

/**
 * Returns the net P/T delta from a card's counter pile. Any counter whose
 * name matches the `+N/+M` pattern (signs and digits in any combo) modifies
 * stats accordingly; non-matching names (loyalty, charge, custom) don't.
 */
export function counterDelta(counters?: Record<string, number>): {
  power: number;
  toughness: number;
} {
  if (!counters) return { power: 0, toughness: 0 };
  let power = 0;
  let toughness = 0;
  for (const [kind, count] of Object.entries(counters)) {
    const m = PT_COUNTER_RE.exec(kind);
    if (!m) continue;
    const pSign = m[1] === "+" ? 1 : -1;
    const pAmt = parseInt(m[2], 10);
    const tSign = m[3] === "+" ? 1 : -1;
    const tAmt = parseInt(m[4], 10);
    if (Number.isFinite(pAmt) && Number.isFinite(tAmt)) {
      power += pSign * pAmt * count;
      toughness += tSign * tAmt * count;
    }
  }
  return { power, toughness };
}

export type BattlefieldCard = {
  card: DraftCard;
  tapped: boolean;
  /** instanceId of the parent card this is attached to (e.g., aura on creature). */
  attachedTo?: string | null;
  /**
   * Counter pile, keyed by canonical kind. Standard kinds:
   *   "+1/+1", "-1/-1", "loyalty", "charge"
   * Anything else is a free-form custom counter (e.g., "poison", "time").
   * Counters are cleared when the card leaves the battlefield.
   */
  counters?: Record<string, number>;
  /**
   * The card's original owner. Only set when the card has been stolen via
   * the steal-request flow — for unstolen cards this is undefined and the
   * "current battlefield" implicitly tells you the owner. When the card
   * leaves the battlefield (graveyard/exile/hand/deck), it routes back to
   * this player's pile so ownership rules are preserved.
   */
  originalOwnerId?: string;
};

export type PlayPublicPlayer = {
  id: string;
  name: string;
  deckSize: number;
  handSize: number;
  battlefield: BattlefieldCard[];
  graveyard: DraftCard[];
  exile: DraftCard[];
  life: number;
  connected: boolean;
  /**
   * When set, the player has chosen to reveal their hand to the table.
   * Stays in sync as they draw/discard. Cleared when they toggle off.
   */
  revealedHand?: DraftCard[];
};

export type PlayPublicState = {
  seatOrder: string[];
  players: PlayPublicPlayer[];
};

export type PlayPrivateState = {
  hand: DraftCard[];
  /** Owner-only view of own deck, top first. Allows peeking. */
  deck: DraftCard[];
  /** Which match the recipient is currently in, or null if not seated. */
  matchId: string | null;
};

export type BestOf = 1 | 3 | 5;

export type MatchPublicState = {
  id: string;
  /** Two teams of 1+ players. Length-1 teams = classic 1v1; length-2 = 2HG. */
  teams: [string[], string[]];
  bestOf: BestOf;
  /** Wins per team. */
  wins: [number, number];
  /** Starting life used at the start of each game in the match. */
  startingLife: number;
  /** Current life pool per team — 2HG teammates share one number. */
  teamLife: [number, number];
  /** Live game state for every player in the match (flat across both teams). */
  players: PlayPublicPlayer[];
  /** Game number within the match (1-based). */
  gameNumber: number;
  status: "active" | "complete";
  /** Index (0 or 1) of the team that won the match, or null while ongoing. */
  matchWinner: number | null;
  /** Index (0 or 1) of the team that won the current game, or null. */
  currentGameWinner: number | null;
  /** Index (0 or 1) of the team whose turn it is. Cosmetic only. */
  currentTurnTeamIdx: number;
  /**
   * Players on the active team who have ended their personal sub-turn.
   * In 2HG the team turn only flips once every member has passed; in 1v1
   * this fills as soon as the single active player passes.
   */
  passedMembers: string[];
  /** Turn number within the current game (1-based). */
  turnNumber: number;
  /**
   * Outstanding cross-team steal requests awaiting confirm/deny from each
   * request's owner. Auto-expire after a short timeout server-side.
   */
  pendingSteals: PendingSteal[];
};

export type MatchPairing = {
  /** Two teams of 1 (1v1) or 2 (2HG) player ids. */
  teams: [string[], string[]];
  bestOf: BestOf;
  /** Starting life pool per team for this match. */
  startingLife: number;
};

/**
 * A pending steal request — the requester wants to take a card from another
 * player's battlefield. Visible to all clients in the match: the card's
 * owner sees a confirm/deny modal, the requester sees a "waiting" status,
 * and other players just see that a steal is pending.
 */
export type PendingSteal = {
  id: string;
  instanceId: string;
  cardName: string;
  requesterId: string;
  requesterName: string;
  ownerId: string;
  ownerName: string;
};

export type PlayAction =
  | { type: "draw"; count: number }
  | { type: "mulligan" }
  | { type: "shuffleDeck" }
  | { type: "newGame" }
  | { type: "tap"; instanceId: string; tapped: boolean }
  | {
      type: "untapAll";
      /** When true, only untaps lands; otherwise untaps every permanent. */
      landsOnly?: boolean;
    }
  | {
      type: "setCounter";
      instanceId: string;
      /** Counter type, e.g., "+1/+1", "-1/-1", "loyalty", or any custom string. */
      kind: string;
      /** Positive = add, negative = remove. Counter is dropped when count <= 0. */
      delta: number;
    }
  | { type: "clearCounters"; instanceId: string }
  | {
      /** Spawn a vanilla creature token on the sender's battlefield. Defaults
       * to a 0/0 colorless "Token" — pump it with counters or rename via the
       * card-action modal as needed. Tokens are valid attach targets like
       * any other creature. */
      type: "createToken";
      name?: string;
      power?: number;
      toughness?: number;
    }
  | {
      /** Ask another player to let you take their battlefield card. Server
       * adds a pending entry, owner gets a modal, then either accept (card
       * moves to sender's battlefield, originalOwnerId stamped) or deny. */
      type: "requestSteal";
      instanceId: string;
    }
  | {
      /** Owner's response to an outstanding steal request. */
      type: "respondSteal";
      stealId: string;
      accept: boolean;
    }
  | {
      /** Toggle whether the sender's hand is broadcast to other players. */
      type: "revealHand";
      revealed: boolean;
    }
  | {
      type: "move";
      instanceId: string;
      from: Zone;
      to: ZoneTarget;
      tapped?: boolean;
      /** When moving onto the battlefield, optionally attach to this card. */
      attachedTo?: string | null;
    }
  | {
      type: "setAttached";
      instanceId: string;
      targetInstanceId: string | null;
    }
  | { type: "adjustLife"; delta: number }
  | { type: "setLife"; value: number };

export const DEFAULT_CONFIG: LobbyConfig = {
  format: "booster",
  maxPlayers: 8,
  packsPerPlayer: 3,
  startingLife: 20,
};

/** Sensible default pack count when switching to a given format. */
export const DEFAULT_PACKS_FOR_FORMAT: Record<Format, number> = {
  booster: 3,
  sealed: 6,
  // Constructed doesn't actually use packs, but the field is kept on
  // LobbyConfig for shape-stability; preserve a sane value.
  constructed: 0,
};

export const CONFIG_BOUNDS = {
  maxPlayers: { min: 2, max: 8 },
  packsPerPlayer: { min: 1, max: 12 },
  startingLife: { min: 1, max: 99 },
} as const;

export type LobbyPhase =
  | "waiting"
  | "drafting"
  | "deckbuilding"
  | "constructing"
  | "matching"
  | "playing";

/** Public construct state — visible to all players. */
export type ConstructPublicState = {
  players: Array<{
    id: string;
    name: string;
    deckSize: number;
    ready: boolean;
    connected: boolean;
  }>;
};

/** Result of parsing one player's pasted decklist against the active set. */
export type ConstructPrivateState = {
  /** The raw text the player has typed (echoed back so reconnects don't lose it). */
  decklist: string;
  /** Total cards in the parsed deck. */
  deckSize: number;
  /** Lines the parser couldn't match against the set. */
  warnings: string[];
  ready: boolean;
};

export type LobbyPlayer = {
  id: string;
  name: string;
  isAdmin: boolean;
  connected: boolean;
};

export type LobbyState = {
  id: string;
  phase: LobbyPhase;
  config: LobbyConfig;
  players: LobbyPlayer[];
  draft: DraftPublicState | null;
  deckbuild: DeckbuildPublicState | null;
  construct: ConstructPublicState | null;
  play: PlayPublicState | null;
  /** When in matching/playing phases, the current set of matches. */
  matches: MatchPublicState[] | null;
  /** IDs of players who have a finished loadout but aren't seated in the current matches (sit-outs). */
  unpairedPlayerIds: string[];
  /** When set, the lobby uses this set for the draft instead of MOCK_SET. */
  customSet: Card[] | null;
  /** Human-readable name of the active custom set (e.g., "Tempest", "Custom (LLM)"). */
  customSetName: string | null;
};

export type ClientMessage =
  | { type: "rename"; name: string }
  | { type: "updateConfig"; config: Partial<LobbyConfig> }
  | { type: "startDraft" }
  | { type: "pick"; instanceId: string }
  | { type: "setDeck"; deck: string[] }
  | { type: "setBasicLands"; counts: BasicLandCounts }
  | {
      type: "setConstructDeck";
      /** Echoed back to clients on reconnect so they don't lose their typing. */
      decklist: string;
      /** Already-resolved cards from the client's cross-set library lookup. */
      cards: DraftCard[];
      /** Parser warnings to surface in the UI. */
      warnings: string[];
    }
  | { type: "setReady"; ready: boolean }
  | { type: "startPlay" }
  | { type: "playAction"; action: PlayAction }
  | { type: "setCustomSet"; cards: Card[] | null; name?: string | null }
  | { type: "startMatches"; pairings: MatchPairing[] }
  | { type: "concedeGame"; matchId: string }
  | { type: "advanceGame"; matchId: string }
  | { type: "passTurn"; matchId: string }
  | { type: "returnToMatching" };

export type ServerMessage =
  | {
      type: "state";
      state: LobbyState;
      draftPrivate: DraftPrivateState | null;
      deckbuildPrivate: DeckbuildPrivateState | null;
      constructPrivate: ConstructPrivateState | null;
      playPrivate: PlayPrivateState | null;
    }
  | { type: "error"; message: string }
  | { type: "rejected"; reason: "lobby-full" | "lobby-in-progress" };

export function clampConfig(c: LobbyConfig): LobbyConfig {
  const { maxPlayers, packsPerPlayer, startingLife } = CONFIG_BOUNDS;
  const format: Format =
    c.format === "sealed" || c.format === "constructed" ? c.format : "booster";
  return {
    format,
    maxPlayers: clamp(c.maxPlayers, maxPlayers.min, maxPlayers.max),
    packsPerPlayer: clamp(
      c.packsPerPlayer,
      packsPerPlayer.min,
      packsPerPlayer.max,
    ),
    startingLife: clamp(
      c.startingLife ?? 20,
      startingLife.min,
      startingLife.max,
    ),
  };
}

export function clampLandCounts(c: BasicLandCounts): BasicLandCounts {
  return {
    W: clamp(c.W ?? 0, 0, 99),
    U: clamp(c.U ?? 0, 0, 99),
    B: clamp(c.B ?? 0, 0, 99),
    R: clamp(c.R ?? 0, 0, 99),
    G: clamp(c.G ?? 0, 0, 99),
  };
}

export function totalLands(c: BasicLandCounts): number {
  return c.W + c.U + c.B + c.R + c.G;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.floor(n)));
}

export function generateLobbyId(): string {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let id = "";
  for (let i = 0; i < 6; i++) {
    id += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return id;
}

export function isValidLobbyId(id: string): boolean {
  return /^[A-Z2-9]{6}$/.test(id);
}
