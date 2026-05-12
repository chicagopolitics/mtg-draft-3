import type { Config } from "drizzle-kit";

/**
 * Drizzle Kit config for generating/applying schema migrations to Turso.
 * Run `npx drizzle-kit generate` after schema edits to produce a migration
 * file, then `npx drizzle-kit migrate` to apply it.
 */
export default {
  schema: "./lib/db/schema.ts",
  out: "./drizzle/migrations",
  dialect: "turso",
  dbCredentials: {
    url: process.env.TURSO_DATABASE_URL!,
    authToken: process.env.TURSO_AUTH_TOKEN,
  },
} satisfies Config;
