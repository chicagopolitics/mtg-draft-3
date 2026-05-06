"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import usePartySocket from "partysocket/react";

import { getPartykitHost } from "@/lib/partykit-client";
import {
  type ClientMessage,
  type Format,
  type LobbyState,
  type ServerMessage,
  CONFIG_BOUNDS,
  DEFAULT_PACKS_FOR_FORMAT,
  FORMAT_DESCRIPTION,
  FORMAT_LABEL,
  isValidLobbyId,
} from "@/lib/lobby/protocol";

function startButtonLabel(format: Format): string {
  if (format === "sealed") return "open sealed pools";
  if (format === "constructed") return "open deck builders";
  return "start draft";
}

function startButtonHint(format: Format): string {
  if (format === "sealed") return "Open sealed pools";
  if (format === "constructed") return "Send everyone to the constructed builder";
  return "Start the draft";
}
import type { Card } from "@/lib/cards/schema";
import {
  getOrCreatePlayerId,
  getStoredPlayerName,
  setStoredPlayerName,
} from "@/lib/identity";

type Status = "init" | "connecting" | "open" | "closed" | "rejected";

export default function LobbyPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = String(params.id ?? "").toUpperCase();

  const [playerId, setPlayerId] = useState<string>("");
  const [name, setName] = useState<string>("");
  const [bootReady, setBootReady] = useState(false);

  useEffect(() => {
    setPlayerId(getOrCreatePlayerId());
    setName(getStoredPlayerName() || "");
    setBootReady(true);
  }, []);

  if (!isValidLobbyId(id)) {
    return (
      <Centered>
        <p className="text-sm text-red-600">Invalid lobby code: {id}</p>
        <button
          onClick={() => router.push("/")}
          className="text-xs underline"
        >
          back home
        </button>
      </Centered>
    );
  }

  if (!bootReady) {
    return <Centered>preparing…</Centered>;
  }

  if (!name.trim()) {
    return <NameGate onSubmit={(n) => setName(n)} />;
  }

  return (
    <LobbyConnected
      lobbyId={id}
      playerId={playerId}
      name={name}
      setName={setName}
    />
  );
}

function NameGate({ onSubmit }: { onSubmit: (name: string) => void }) {
  const [draft, setDraft] = useState("");
  return (
    <Centered>
      <h2 className="text-lg font-semibold">pick a name</h2>
      <form
        className="flex w-full max-w-xs gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const t = draft.trim();
          if (!t) return;
          setStoredPlayerName(t);
          onSubmit(t);
        }}
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={24}
          placeholder="Wizard of Tuesdays"
          className="flex-1 rounded border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        />
        <button
          type="submit"
          disabled={!draft.trim()}
          className="rounded bg-zinc-900 px-3 py-2 text-sm text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
        >
          enter
        </button>
      </form>
    </Centered>
  );
}

function LobbyConnected({
  lobbyId,
  playerId,
  name,
  setName,
}: {
  lobbyId: string;
  playerId: string;
  name: string;
  setName: (n: string) => void;
}) {
  const router = useRouter();
  const [state, setState] = useState<LobbyState | null>(null);
  const [status, setStatus] = useState<Status>("connecting");
  const [error, setError] = useState<string | null>(null);
  const [shareCopied, setShareCopied] = useState(false);
  const [genStatus, setGenStatus] = useState<"idle" | "generating">("idle");
  const [genError, setGenError] = useState<string | null>(null);
  const [genWarnings, setGenWarnings] = useState<string[] | null>(null);
  const [genCost, setGenCost] = useState<{
    llmUsd: number;
    artUsd: number;
    inputTokens: number;
    cacheCreate: number;
    cacheRead: number;
    outputTokens: number;
    artGenerated: number;
    artFailed: number;
  } | null>(null);
  const [availableSets, setAvailableSets] = useState<
    Array<{ code: string; name: string; cardCount: number }>
  >([]);
  const [selectedSetCode, setSelectedSetCode] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/sets")
      .then((r) => r.json())
      .then(
        (body: {
          sets?: Array<{ code: string; name: string; cardCount: number }>;
        }) => {
          if (cancelled) return;
          if (body.sets) setAvailableSets(body.sets);
        },
      )
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const host = useMemo(() => getPartykitHost(), []);

  const socket = usePartySocket({
    host,
    room: lobbyId,
    query: { p: playerId, n: name },
    onOpen() {
      setStatus("open");
      setError(null);
    },
    onClose() {
      setStatus((prev) => (prev === "rejected" ? prev : "closed"));
    },
    onMessage(event) {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }
      if (msg.type === "state") {
        setState(msg.state);
        if (msg.state.phase === "drafting") {
          router.push(`/draft/${lobbyId}`);
        } else if (msg.state.phase === "deckbuilding") {
          router.push(`/build/${lobbyId}`);
        } else if (msg.state.phase === "constructing") {
          router.push(`/construct/${lobbyId}`);
        } else if (msg.state.phase === "matching") {
          router.push(`/match/${lobbyId}`);
        } else if (msg.state.phase === "playing") {
          router.push(`/play/${lobbyId}`);
        }
      } else if (msg.type === "error") {
        setError(msg.message);
      } else if (msg.type === "rejected") {
        setStatus("rejected");
        setError(
          msg.reason === "lobby-full"
            ? "Lobby is full."
            : "Draft already in progress.",
        );
      }
    },
  });

  function send(msg: ClientMessage) {
    socket.send(JSON.stringify(msg));
  }

  function onRename() {
    const trimmed = name.trim();
    if (!trimmed) return;
    setStoredPlayerName(trimmed);
    send({ type: "rename", name: trimmed });
  }

  const me = state?.players.find((p) => p.id === playerId) ?? null;
  const connectedCount = state?.players.filter((p) => p.connected).length ?? 0;
  const canStart = !!me?.isAdmin && connectedCount >= 2;

  function copyShare() {
    if (typeof window === "undefined") return;
    const url = `${window.location.origin}/lobby/${lobbyId}`;
    navigator.clipboard?.writeText(url).then(() => {
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 1500);
    });
  }

  async function generateCustomSet() {
    setGenStatus("generating");
    setGenError(null);
    setGenWarnings(null);
    setGenCost(null);
    try {
      const res = await fetch("/api/generate-set", { method: "POST" });
      const body = (await res.json()) as {
        cards?: Card[];
        error?: string;
        warnings?: string[];
        usage?: {
          input_tokens?: number;
          cache_creation_input_tokens?: number;
          cache_read_input_tokens?: number;
          output_tokens?: number;
        };
        art?: { generated: number; failed: number; skipped: number };
      };
      if (!res.ok || !body.cards) {
        setGenError(body.error ?? `Server returned ${res.status}.`);
        setGenStatus("idle");
        return;
      }
      send({
        type: "setCustomSet",
        cards: body.cards,
        name: "Custom (LLM)",
      });
      if (body.warnings && body.warnings.length > 0) {
        setGenWarnings(body.warnings);
      }
      if (body.usage) {
        const u = body.usage;
        const inputTokens = u.input_tokens ?? 0;
        const cacheCreate = u.cache_creation_input_tokens ?? 0;
        const cacheRead = u.cache_read_input_tokens ?? 0;
        const outputTokens = u.output_tokens ?? 0;
        // Sonnet 4.6 pricing per million tokens.
        const llmUsd =
          (inputTokens * 3 +
            cacheCreate * 3.75 +
            cacheRead * 0.3 +
            outputTokens * 15) /
          1_000_000;
        // fal.ai Flux Schnell: $0.003/MP. landscape_4_3 (1024x768) = 0.786 MP.
        const artGenerated = body.art?.generated ?? 0;
        const artFailed = body.art?.failed ?? 0;
        const artUsd = artGenerated * 0.786 * 0.003;
        setGenCost({
          llmUsd,
          artUsd,
          inputTokens,
          cacheCreate,
          cacheRead,
          outputTokens,
          artGenerated,
          artFailed,
        });
      }
      setGenStatus("idle");
    } catch (e) {
      setGenError(e instanceof Error ? e.message : String(e));
      setGenStatus("idle");
    }
  }

  function clearCustomSet() {
    setGenWarnings(null);
    send({ type: "setCustomSet", cards: null });
  }

  // Fetch the list of available real sets once on mount.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/sets")
      .then((r) => r.json())
      .then((body: { sets?: Array<{ code: string; name: string; cardCount: number }> }) => {
        if (cancelled) return;
        if (body.sets) setAvailableSets(body.sets);
      })
      .catch(() => {
        // ignore — endpoint may not be ready in some environments
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function loadRealSet(code: string) {
    if (!code) return;
    setGenStatus("generating");
    setGenError(null);
    setGenWarnings(null);
    setGenCost(null);
    try {
      const res = await fetch(`/api/sets/${encodeURIComponent(code)}`);
      const body = (await res.json()) as {
        cards?: Card[];
        error?: string;
        count?: number;
        name?: string;
        code?: string;
      };
      if (!res.ok || !body.cards) {
        setGenError(body.error ?? `Server returned ${res.status}.`);
        setGenStatus("idle");
        return;
      }
      send({ type: "setCustomSet", cards: body.cards, name: body.name });
      setGenStatus("idle");
    } catch (e) {
      setGenError(e instanceof Error ? e.message : String(e));
      setGenStatus("idle");
    }
  }

  if (status === "rejected") {
    return (
      <Centered>
        <p className="text-sm text-red-600">{error}</p>
        <button
          onClick={() => router.push("/")}
          className="text-xs underline"
        >
          back home
        </button>
      </Centered>
    );
  }

  return (
    <div className="flex flex-1 flex-col items-center bg-zinc-50 p-6 font-sans dark:bg-black">
      <main className="flex w-full max-w-2xl flex-col gap-4">
        <header className="flex items-baseline justify-between border-b border-zinc-200 pb-3 dark:border-zinc-800">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">
              lobby{" "}
              <span className="font-mono text-zinc-500">{lobbyId}</span>
            </h1>
            <button
              onClick={copyShare}
              className="text-xs text-zinc-500 underline hover:text-zinc-800 dark:hover:text-zinc-200"
            >
              {shareCopied ? "copied!" : "copy share link"}
            </button>
          </div>
          <span
            className={`text-xs font-mono ${
              status === "open"
                ? "text-emerald-600 dark:text-emerald-400"
                : "text-amber-600 dark:text-amber-400"
            }`}
          >
            {status}
          </span>
        </header>

        <section className="flex items-center gap-2">
          <label className="text-sm text-zinc-600 dark:text-zinc-400">
            you:
          </label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={onRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                onRename();
                (e.target as HTMLInputElement).blur();
              }
            }}
            maxLength={24}
            className="flex-1 rounded border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
          {me?.isAdmin ? (
            <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">
              admin
            </span>
          ) : null}
        </section>

        <section className="rounded border border-zinc-200 p-3 dark:border-zinc-800">
          <div className="mb-2 flex items-baseline justify-between text-xs uppercase tracking-wide text-zinc-500">
            <span>
              players ({connectedCount}/{state?.config.maxPlayers ?? "…"})
            </span>
          </div>
          <ul className="flex flex-wrap gap-2 text-sm">
            {state?.players.map((p) => (
              <li
                key={p.id}
                className={`flex items-center gap-1 rounded-full px-2 py-0.5 ${
                  p.id === playerId
                    ? "bg-emerald-100 dark:bg-emerald-900/40"
                    : "bg-zinc-100 dark:bg-zinc-800"
                } ${!p.connected ? "opacity-40" : ""}`}
              >
                <span>{p.name}</span>
                {p.isAdmin ? (
                  <span className="text-[10px] font-mono uppercase text-amber-700 dark:text-amber-300">
                    admin
                  </span>
                ) : null}
                {!p.connected ? (
                  <span className="text-[10px] font-mono uppercase text-zinc-500">
                    away
                  </span>
                ) : null}
              </li>
            ))}
            {!state ? <li className="text-zinc-500">connecting…</li> : null}
          </ul>
        </section>

        <section className="rounded border border-zinc-200 p-3 dark:border-zinc-800">
          <div className="mb-2 flex items-baseline justify-between">
            <h2 className="text-xs uppercase tracking-wide text-zinc-500">
              card set {me?.isAdmin ? "" : "(admin only)"}
            </h2>
            <span className="font-mono text-[11px] text-zinc-500">
              {state?.customSet
                ? `${state.customSetName ?? "custom"} · ${state.customSet.length} cards`
                : "mock set (30 hand-curated)"}
            </span>
          </div>
          {state?.customSet ? (
            <div className="mb-2 max-h-24 overflow-y-auto rounded bg-zinc-50 p-2 text-[11px] dark:bg-zinc-800/50">
              {(() => {
                const rarityOrder = { mythic: 0, rare: 1, uncommon: 2, common: 3 };
                const sorted = [...state.customSet].sort((a, b) => {
                  // Lands always last regardless of rarity
                  if (a.type === "land" && b.type !== "land") return 1;
                  if (b.type === "land" && a.type !== "land") return -1;
                  return rarityOrder[a.rarity] - rarityOrder[b.rarity];
                });
                const counts = state.customSet.reduce(
                  (acc, c) => {
                    if (c.type === "land") acc.land += 1;
                    else acc[c.rarity] += 1;
                    return acc;
                  },
                  { mythic: 0, rare: 0, uncommon: 0, common: 0, land: 0 },
                );
                return (
                  <>
                    <p className="text-zinc-500">
                      breakdown: {counts.mythic}M · {counts.rare}R ·{" "}
                      {counts.uncommon}U · {counts.common}C · {counts.land}L
                    </p>
                    <p className="mt-1 text-zinc-500">preview (first 8):</p>
                    <ul className="mt-1 grid grid-cols-2 gap-x-2">
                      {sorted.slice(0, 8).map((c) => (
                        <li key={c.id} className="truncate">
                          <span
                            className={`mr-1 font-mono text-[9px] uppercase ${
                              c.type === "land"
                                ? "text-zinc-400"
                                : c.rarity === "mythic"
                                ? "text-orange-600"
                                : c.rarity === "rare"
                                ? "text-amber-600"
                                : c.rarity === "uncommon"
                                ? "text-slate-500"
                                : "text-zinc-500"
                            }`}
                          >
                            {c.type === "land" ? "L" : c.rarity[0].toUpperCase()}
                          </span>
                          {c.name}
                        </li>
                      ))}
                    </ul>
                  </>
                );
              })()}
            </div>
          ) : null}
          {me?.isAdmin ? (
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={generateCustomSet}
                disabled={genStatus === "generating"}
                className="rounded bg-purple-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-purple-700 disabled:opacity-50"
              >
                {genStatus === "generating"
                  ? "generating… (15-40s)"
                  : state?.customSet
                  ? "regenerate custom set"
                  : "generate custom set (LLM)"}
              </button>
              <div className="flex items-center gap-1">
                <select
                  value={selectedSetCode}
                  onChange={(e) => setSelectedSetCode(e.target.value)}
                  disabled={genStatus === "generating" || availableSets.length === 0}
                  className="rounded border border-zinc-300 bg-white px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-900"
                >
                  <option value="">
                    {availableSets.length === 0
                      ? "no sets found"
                      : "pick a real set…"}
                  </option>
                  {availableSets.map((s) => (
                    <option key={s.code} value={s.code}>
                      {s.name} ({s.code} · {s.cardCount})
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => loadRealSet(selectedSetCode)}
                  disabled={genStatus === "generating" || !selectedSetCode}
                  className="rounded bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                  load
                </button>
              </div>
              {state?.customSet ? (
                <button
                  onClick={clearCustomSet}
                  disabled={genStatus === "generating"}
                  className="text-xs text-zinc-500 underline hover:text-zinc-800 dark:hover:text-zinc-200"
                >
                  clear (revert to mock)
                </button>
              ) : null}
              <span className="ml-auto text-[10px] text-zinc-400">
                Sonnet 4.6 · Flux Schnell
              </span>
            </div>
          ) : (
            <p className="text-xs text-zinc-500">
              admin can generate a custom card set with Claude before the
              draft.
            </p>
          )}
          {genCost ? (
            <div className="mt-2 rounded bg-zinc-100 p-2 font-mono text-[10px] text-zinc-600 dark:bg-zinc-800/60 dark:text-zinc-400">
              <p>
                last run cost{" "}
                <span className="font-semibold text-zinc-800 dark:text-zinc-200">
                  ${(genCost.llmUsd + genCost.artUsd).toFixed(4)}
                </span>{" "}
                = ${genCost.llmUsd.toFixed(4)} text + $
                {genCost.artUsd.toFixed(4)} art
              </p>
              <p className="mt-1 text-zinc-500">
                tokens: in {genCost.inputTokens}
                {genCost.cacheCreate > 0
                  ? ` + ${genCost.cacheCreate} cache-write`
                  : ""}
                {genCost.cacheRead > 0
                  ? ` + ${genCost.cacheRead} cache-read`
                  : ""}
                {" → out "}
                {genCost.outputTokens}
              </p>
              <p className="text-zinc-500">
                art: {genCost.artGenerated} generated
                {genCost.artFailed > 0
                  ? `, ${genCost.artFailed} failed (gradient fallback)`
                  : ""}
              </p>
            </div>
          ) : null}
          {genError ? (
            <p className="mt-2 rounded bg-red-50 p-2 text-xs text-red-700 dark:bg-red-900/30 dark:text-red-300">
              {genError}
            </p>
          ) : null}
          {genWarnings ? (
            <p className="mt-2 rounded bg-amber-50 p-2 text-xs text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
              warnings: {genWarnings.join("; ")}
            </p>
          ) : null}
        </section>

        <section className="rounded border border-zinc-200 p-3 dark:border-zinc-800">
          <h2 className="mb-2 text-xs uppercase tracking-wide text-zinc-500">
            settings {me?.isAdmin ? "" : "(admin only)"}
          </h2>

          <div className="mb-3">
            <p className="mb-1 text-xs text-zinc-500">format</p>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(FORMAT_LABEL) as Format[]).map((f) => {
                const active = (state?.config.format ?? "booster") === f;
                return (
                  <button
                    key={f}
                    type="button"
                    disabled={!me?.isAdmin}
                    onClick={() =>
                      send({
                        type: "updateConfig",
                        config: {
                          format: f,
                          packsPerPlayer: DEFAULT_PACKS_FOR_FORMAT[f],
                        },
                      })
                    }
                    className={`rounded border px-3 py-1 text-sm transition ${
                      active
                        ? "border-emerald-500 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                        : "border-zinc-300 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
                    } disabled:cursor-not-allowed disabled:opacity-40`}
                  >
                    {FORMAT_LABEL[f]}
                  </button>
                );
              })}
            </div>
            <p className="mt-1 text-[11px] text-zinc-500">
              {FORMAT_DESCRIPTION[
                (state?.config.format ?? "booster") as Format
              ]}
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <ConfigSlider
              label="max players"
              value={state?.config.maxPlayers ?? 8}
              min={CONFIG_BOUNDS.maxPlayers.min}
              max={CONFIG_BOUNDS.maxPlayers.max}
              disabled={!me?.isAdmin}
              onChange={(v) =>
                send({ type: "updateConfig", config: { maxPlayers: v } })
              }
            />
            {(state?.config.format ?? "booster") !== "constructed" ? (
              <ConfigSlider
                label={
                  (state?.config.format ?? "booster") === "sealed"
                    ? "packs per player (sealed pool)"
                    : "packs per player (draft rounds)"
                }
                value={state?.config.packsPerPlayer ?? 3}
                min={CONFIG_BOUNDS.packsPerPlayer.min}
                max={CONFIG_BOUNDS.packsPerPlayer.max}
                disabled={!me?.isAdmin}
                onChange={(v) =>
                  send({ type: "updateConfig", config: { packsPerPlayer: v } })
                }
              />
            ) : null}
            <ConfigSlider
              label="starting life (per team — 30 is typical for 2HG)"
              value={state?.config.startingLife ?? 20}
              min={CONFIG_BOUNDS.startingLife.min}
              max={CONFIG_BOUNDS.startingLife.max}
              disabled={!me?.isAdmin}
              onChange={(v) =>
                send({ type: "updateConfig", config: { startingLife: v } })
              }
            />
          </div>
        </section>

        {me?.isAdmin ? (
          <button
            onClick={() => send({ type: "startDraft" })}
            disabled={!canStart}
            className="rounded bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-40"
            title={
              canStart
                ? startButtonHint(state?.config.format ?? "booster")
                : "Need at least 2 connected players"
            }
          >
            {startButtonLabel(state?.config.format ?? "booster")}
          </button>
        ) : (
          <p className="text-center text-xs text-zinc-500">
            waiting for the admin to start…
          </p>
        )}

        {error ? (
          <p className="text-center text-xs text-red-600 dark:text-red-400">
            {error}
          </p>
        ) : null}
      </main>
    </div>
  );
}

function ConfigSlider({
  label,
  value,
  min,
  max,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  disabled: boolean;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs">
      <span className="flex items-center justify-between text-zinc-600 dark:text-zinc-400">
        <span>{label}</span>
        <span className="font-mono text-zinc-900 dark:text-zinc-100">
          {value}
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="accent-emerald-600 disabled:opacity-50"
      />
    </label>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 bg-zinc-50 p-6 text-sm text-zinc-700 dark:bg-black dark:text-zinc-300">
      {children}
    </div>
  );
}
