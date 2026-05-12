"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import {
  generateLobbyId,
  isValidLobbyId,
} from "@/lib/lobby/protocol";
import {
  getOrCreatePlayerId,
  getStoredPlayerName,
  setStoredPlayerName,
} from "@/lib/identity";

export default function Home() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getOrCreatePlayerId();
    const stored = getStoredPlayerName();
    if (stored) setName(stored);
  }, []);

  function persistName(): string {
    const trimmed = name.trim();
    setStoredPlayerName(trimmed);
    return trimmed;
  }

  function onCreate() {
    setError(null);
    persistName();
    const id = generateLobbyId();
    router.push(`/lobby/${id}`);
  }

  function onJoin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const code = joinCode.trim().toUpperCase();
    if (!isValidLobbyId(code)) {
      setError("Lobby code must be 6 characters, A–Z (no I/L/O) and 2–9.");
      return;
    }
    persistName();
    router.push(`/lobby/${code}`);
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center bg-zinc-50 p-6 font-sans dark:bg-black">
      <main className="flex w-full max-w-md flex-col gap-6">
        <header className="space-y-1 text-center">
          <h1 className="text-3xl font-semibold tracking-tight">mtg-draft-3</h1>
          <p className="text-sm text-zinc-500">
            Draft and play with weird, freshly-baked cards.
          </p>
        </header>

        <section className="space-y-2">
          <label className="text-sm text-zinc-600 dark:text-zinc-400">
            your name
          </label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Wizard of Tuesdays"
            maxLength={24}
            className="w-full rounded border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
        </section>

        <section className="grid gap-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500">
            create a lobby
          </h2>
          <p className="text-xs text-zinc-500">
            You'll be the admin. Share the lobby code with up to 7 others.
          </p>
          <button
            onClick={onCreate}
            disabled={!name.trim()}
            className="w-full rounded bg-zinc-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
          >
            create lobby
          </button>
        </section>

        <section className="grid gap-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500">
            join a lobby
          </h2>
          <form onSubmit={onJoin} className="grid gap-3">
            <input
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
              placeholder="ABCDEF"
              maxLength={6}
              className="w-full rounded border border-zinc-300 bg-white px-3 py-2 text-center font-mono text-lg tracking-[0.3em] uppercase dark:border-zinc-700 dark:bg-zinc-900"
            />
            <button
              type="submit"
              disabled={!name.trim() || joinCode.length !== 6}
              className="w-full rounded border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-900 disabled:opacity-40 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
            >
              join lobby
            </button>
          </form>
        </section>

        {error ? (
          <p className="text-center text-xs text-red-600 dark:text-red-400">
            {error}
          </p>
        ) : null}

        <p className="text-center text-xs text-zinc-400">
          <a className="underline" href="/cards-preview">
            preview the mock card set →
          </a>
        </p>
        <p className="text-center text-xs text-zinc-400">
          <a className="underline" href="/profile">
            sign in for Highlander persistent decks →
          </a>
        </p>
      </main>
    </div>
  );
}
