import type { Card, Color, DraftCard } from "../cards/schema";

export type Format = "booster";

export type LobbyConfig = {
  format: Format;
  maxPlayers: number;
  packsPerPlayer: number;
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

export type BattlefieldCard = {
  card: DraftCard;
  tapped: boolean;
  /** instanceId of the parent card this is attached to (e.g., aura on creature). */
  attachedTo?: string | null;
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
};

export type PlayPublicState = {
  seatOrder: string[];
  players: PlayPublicPlayer[];
};

export type PlayPrivateState = {
  hand: DraftCard[];
  /** Owner-only view of own deck, top first. Allows peeking. */
  deck: DraftCard[];
};

export type PlayAction =
  | { type: "draw"; count: number }
  | { type: "mulligan" }
  | { type: "shuffleDeck" }
  | { type: "newGame" }
  | { type: "tap"; instanceId: string; tapped: boolean }
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
};

export const CONFIG_BOUNDS = {
  maxPlayers: { min: 2, max: 8 },
  packsPerPlayer: { min: 1, max: 6 },
} as const;

export type LobbyPhase = "waiting" | "drafting" | "deckbuilding" | "playing";

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
  play: PlayPublicState | null;
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
  | { type: "setReady"; ready: boolean }
  | { type: "startPlay" }
  | { type: "playAction"; action: PlayAction }
  | { type: "setCustomSet"; cards: Card[] | null; name?: string | null };

export type ServerMessage =
  | {
      type: "state";
      state: LobbyState;
      draftPrivate: DraftPrivateState | null;
      deckbuildPrivate: DeckbuildPrivateState | null;
      playPrivate: PlayPrivateState | null;
    }
  | { type: "error"; message: string }
  | { type: "rejected"; reason: "lobby-full" | "lobby-in-progress" };

export function clampConfig(c: LobbyConfig): LobbyConfig {
  const { maxPlayers, packsPerPlayer } = CONFIG_BOUNDS;
  return {
    format: "booster",
    maxPlayers: clamp(c.maxPlayers, maxPlayers.min, maxPlayers.max),
    packsPerPlayer: clamp(
      c.packsPerPlayer,
      packsPerPlayer.min,
      packsPerPlayer.max,
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
