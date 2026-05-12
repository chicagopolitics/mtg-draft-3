/**
 * Singleton Drizzle client over libSQL/Turso.
 *
 * The client is initialised lazily — on the first property access — rather
 * than at module-evaluation time. This matters for two reasons:
 *
 *   1. Next.js's build step ("collecting page data") imports every route
 *      module at build time. If the client threw eagerly, any API route that
 *      touches this module would break the production build unless the Turso
 *      env vars were available at build time (they don't need to be).
 *
 *   2. In local dev you can still boot the Next.js dev server without Turso
 *      credentials; only requests that actually hit a DB route will fail.
 *
 * The exported `db` value is typed as the real Drizzle client, so all
 * call-sites (`db.select()`, `db.insert()`, etc.) continue to work unchanged.
 */

import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";

import * as schema from "./schema";

export type DB = ReturnType<typeof drizzle<typeof schema>>;

let _db: DB | undefined;

function getDb(): DB {
  if (_db) return _db;
  const url = process.env.TURSO_DATABASE_URL;
  if (!url) throw new Error("TURSO_DATABASE_URL is not set");
  _db = drizzle(createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN }), {
    schema,
  });
  return _db;
}

/**
 * Lazily-initialised Drizzle client. Identical API to a direct `drizzle(...)`
 * return value — use `db.select()`, `db.insert()`, etc. as normal.
 */
export const db = new Proxy({} as DB, {
  get(_target, prop: string | symbol) {
    return Reflect.get(getDb(), prop);
  },
});
