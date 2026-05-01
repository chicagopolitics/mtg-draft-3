"use client";

const PLAYER_ID_KEY = "mtg-draft-3:playerId";
const PLAYER_NAME_KEY = "mtg-draft-3:playerName";

export function getOrCreatePlayerId(): string {
  if (typeof window === "undefined") return "";
  let id = window.localStorage.getItem(PLAYER_ID_KEY);
  if (!id) {
    id = generatePlayerId();
    window.localStorage.setItem(PLAYER_ID_KEY, id);
  }
  return id;
}

function generatePlayerId(): string {
  // crypto.randomUUID requires a secure context (HTTPS or localhost).
  // Plain-HTTP LAN testing (e.g., http://192.168.x.x) breaks it on Safari,
  // so we fall back to crypto.getRandomValues, which works everywhere.
  const c = typeof crypto !== "undefined" ? crypto : undefined;
  if (c?.randomUUID) return c.randomUUID();
  if (c?.getRandomValues) {
    const bytes = new Uint8Array(16);
    c.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0"));
    return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex
      .slice(6, 8)
      .join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10, 16).join("")}`;
  }
  return `${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
}

export function getStoredPlayerName(): string {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(PLAYER_NAME_KEY) ?? "";
}

export function setStoredPlayerName(name: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(PLAYER_NAME_KEY, name);
}
