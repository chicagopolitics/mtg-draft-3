/**
 * Auth.js catch-all handler. Mounts magic-link callbacks, session endpoint,
 * sign-in/-out routes under /api/auth/*.
 */
import { handlers } from "@/lib/auth";

export const { GET, POST } = handlers;
