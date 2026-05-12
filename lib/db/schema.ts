/**
 * Drizzle schema for the Highlander persistence layer.
 *
 * Tables fall into two groups:
 *   - Auth.js tables (`users`, `accounts`, `sessions`, `verificationTokens`)
 *     are the standard adapter shape — we don't touch them directly.
 *   - App tables (`decks`, `deckCards`, `anteHistory`) hold our deck and
 *     ante data, keyed by Auth.js's `users.id`.
 *
 * All ids use `crypto.randomUUID()` strings rather than ints so the schema
 * doesn't depend on auto-increment behavior across libSQL clients.
 */

import { sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

// ── Auth.js tables ────────────────────────────────────────────────────

export const users = sqliteTable("user", {
  id: text("id").primaryKey().notNull(),
  name: text("name"),
  email: text("email").unique(),
  emailVerified: integer("emailVerified", { mode: "timestamp_ms" }),
  image: text("image"),
});

export const accounts = sqliteTable(
  "account",
  {
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("providerAccountId").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (t) => [primaryKey({ columns: [t.provider, t.providerAccountId] })],
);

export const sessions = sqliteTable("session", {
  sessionToken: text("sessionToken").primaryKey(),
  userId: text("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: integer("expires", { mode: "timestamp_ms" }).notNull(),
});

export const verificationTokens = sqliteTable(
  "verificationToken",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: integer("expires", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.identifier, t.token] })],
);

// ── App tables ────────────────────────────────────────────────────────

/** A player's named persistent deck (currently Highlander-only). */
export const decks = sqliteTable(
  "deck",
  {
    id: text("id").primaryKey().notNull(),
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** "highlander" for now; future formats can extend without schema changes. */
    format: text("format").notNull().default("highlander"),
    /**
     * Set when the owner explicitly publishes the deck. Once set, the
     * unsigned card list is frozen — only ante transfers can mutate it.
     * Null means the deck is still a draft and freely editable.
     */
    lockedAt: integer("lockedAt", { mode: "timestamp_ms" }),
    /** Games won while playing with this deck. Incremented by the
     * /api/highlander/record-game endpoint after each game resolves. */
    wins: integer("wins").notNull().default(0),
    /** Games lost while playing with this deck. */
    losses: integer("losses").notNull().default(0),
    createdAt: integer("createdAt", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    updatedAt: integer("updatedAt", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => [index("deck_user_idx").on(t.userId)],
);

/**
 * One row per physical card in a deck. Each card has its own id so it can
 * carry signature metadata across ante transfers (the row moves between
 * decks when an ante resolves; `signedByUserId` and friends are stamped on
 * the row by the loser's identity).
 *
 * Note: this is *not* keyed by (deck, card-name). Highlander explicitly
 * allows multiple copies after winning antes, so we let the same card
 * name appear multiple times.
 */
export const deckCards = sqliteTable(
  "deck_card",
  {
    id: text("id").primaryKey().notNull(),
    deckId: text("deckId")
      .notNull()
      .references(() => decks.id, { onDelete: "cascade" }),
    cardName: text("cardName").notNull(),
    setCode: text("setCode"),
    collectorNumber: text("collectorNumber"),
    /** Snapshot of the loser's display name at sign time, so a deleted user
     * doesn't erase the signature trail. */
    signedByDisplayName: text("signedByDisplayName"),
    signedByUserId: text("signedByUserId").references(() => users.id, {
      onDelete: "set null",
    }),
    signedAt: integer("signedAt", { mode: "timestamp_ms" }),
    addedAt: integer("addedAt", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => [index("deck_card_deck_idx").on(t.deckId)],
);

/** Audit trail of every ante resolution — for "show me my history" UIs and
 * debugging disputes. Independent of deck_cards (which can be edited). */
export const anteHistory = sqliteTable(
  "ante_history",
  {
    id: text("id").primaryKey().notNull(),
    matchId: text("matchId").notNull(),
    gameNumber: integer("gameNumber").notNull(),
    winnerUserId: text("winnerUserId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    loserUserId: text("loserUserId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    cardName: text("cardName").notNull(),
    setCode: text("setCode"),
    collectorNumber: text("collectorNumber"),
    resolvedAt: integer("resolvedAt", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => [
    index("ante_winner_idx").on(t.winnerUserId),
    index("ante_loser_idx").on(t.loserUserId),
  ],
);
