/**
 * Auth.js v5 setup with magic-link email via Resend.
 *
 * Exports the four canonical hooks (`auth`, `handlers`, `signIn`, `signOut`)
 * so the rest of the app can:
 *   - Gate a route or server action: `const session = await auth();`
 *   - Mount the OAuth callback endpoints from /api/auth/[...nextauth]/route.ts
 *   - Trigger sign-in/-out flows from server actions.
 *
 * The "Resend" provider is built into next-auth (no separate package), but
 * it expects a verified sender domain. We override `from` to use Resend's
 * default `onboarding@resend.dev` so this works without DNS setup.
 */

import { DrizzleAdapter } from "@auth/drizzle-adapter";
import NextAuth from "next-auth";
import Resend from "next-auth/providers/resend";

import { db } from "@/lib/db/client";
import { accounts, sessions, users, verificationTokens } from "@/lib/db/schema";

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
  // We send sessions as opaque tokens stored in the DB so they survive
  // server restarts. (JWT mode is faster but harder to revoke.)
  session: { strategy: "database" },
  providers: [
    Resend({
      apiKey: process.env.RESEND_API_KEY,
      from: "onboarding@resend.dev",
    }),
  ],
  pages: {
    signIn: "/signin",
    verifyRequest: "/signin/check-email",
  },
});
