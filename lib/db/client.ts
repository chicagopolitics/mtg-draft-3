/**
 * Singleton Drizzle client over libSQL/Turso. Lives at module scope so each
 * serverless invocation reuses it (the libSQL client manages its own HTTP
 * connection pool).
 */

import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";

import * as schema from "./schema";

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;

if (!url) {
  throw new Error("TURSO_DATABASE_URL is not set");
}

const client = createClient({ url, authToken });
export const db = drizzle(client, { schema });
export type DB = typeof db;
