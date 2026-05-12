/**
 * Singleton Drizzle client over libSQL/Turso.
 *
 * At build time TURSO_DATABASE_URL is not set, so we fall back to an
 * in-memory SQLite client. This lets DrizzleAdapter (which inspects the
 * db instance at init time to detect the dialect) work during Next.js's
 * "Collecting page data" phase. The in-memory client is never actually
 * queried — at runtime the real Turso URL is always present.
 */

import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";

import * as schema from "./schema";

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;

// At build time TURSO_DATABASE_URL is not set. We fall back to an
// in-memory SQLite client so the drizzle instance is real enough for
// DrizzleAdapter to detect its type. This client is never queried —
// at runtime the real Turso URL is always present.
const client = createClient({ url: url ?? "file::memory:", authToken });
export const db = drizzle(client, { schema });
export type DB = typeof db;
