"use client";

import { useEffect, useState } from "react";

/**
 * Client-side art cache + batching layer for `/api/cards/art`.
 *
 * Cards from the cross-set library and from the WebSocket play stream often
 * arrive without `artUrl` — we fetch their art lazily as components mount.
 * The cache memoizes by `setCode:collectorNumber`, and a small debounce
 * coalesces simultaneous requests across many `useCardArt` hooks into a
 * single batched POST.
 */

type Identifier = { set: string; collectorNumber: string };

const cache = new Map<string, string | null>();
const subscribers = new Map<string, Set<(url: string | null) => void>>();
let pending = new Map<string, Identifier>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let flushing: Promise<void> | null = null;

function cacheKey(set: string, collectorNumber: string): string {
  return `${set.toLowerCase()}:${collectorNumber}`;
}

function notify(key: string, url: string | null): void {
  const subs = subscribers.get(key);
  if (!subs) return;
  for (const cb of subs) cb(url);
}

async function flush(): Promise<void> {
  if (flushing) return flushing;
  const toSend = [...pending.values()];
  pending = new Map();
  flushTimer = null;
  if (toSend.length === 0) return;

  flushing = (async () => {
    try {
      const res = await fetch("/api/cards/art", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          identifiers: toSend.map((id) => ({
            set: id.set,
            collectorNumber: id.collectorNumber,
          })),
        }),
      });
      if (!res.ok) {
        // Mark all requested keys as "miss" so we don't infinitely retry.
        for (const id of toSend) {
          const k = cacheKey(id.set, id.collectorNumber);
          if (!cache.has(k)) cache.set(k, null);
          notify(k, cache.get(k) ?? null);
        }
        return;
      }
      const body = (await res.json()) as { art?: Record<string, string> };
      const art = body.art ?? {};
      for (const id of toSend) {
        const k = cacheKey(id.set, id.collectorNumber);
        const url = art[k] ?? null;
        cache.set(k, url);
        notify(k, url);
      }
    } catch {
      for (const id of toSend) {
        const k = cacheKey(id.set, id.collectorNumber);
        if (!cache.has(k)) cache.set(k, null);
        notify(k, cache.get(k) ?? null);
      }
    }
  })();
  try {
    await flushing;
  } finally {
    flushing = null;
  }
}

function scheduleFlush(): void {
  if (flushTimer) return;
  // 50ms is enough to coalesce simultaneous mounts (a fresh play board often
  // mounts dozens of CompactCards at once) without a noticeable delay.
  flushTimer = setTimeout(() => void flush(), 50);
}

function request(set: string, collectorNumber: string): void {
  const k = cacheKey(set, collectorNumber);
  if (cache.has(k)) return;
  if (pending.has(k)) return;
  pending.set(k, { set, collectorNumber });
  scheduleFlush();
}

/**
 * Returns the art URL for a card by its (setCode, collectorNumber) pair, or
 * null if not yet loaded / not found. Triggers a batched fetch on first call.
 *
 * Pass `skip: true` to opt out of the lookup entirely (useful when the
 * caller already has an artUrl from another source).
 */
export function useCardArt(
  setCode: string | undefined,
  collectorNumber: string | undefined,
  skip = false,
): string | null {
  const key =
    !skip && setCode && collectorNumber
      ? cacheKey(setCode, collectorNumber)
      : null;

  const [url, setUrl] = useState<string | null>(() =>
    key ? (cache.get(key) ?? null) : null,
  );

  useEffect(() => {
    if (!key || !setCode || !collectorNumber) {
      setUrl(null);
      return;
    }
    const cached = cache.get(key);
    if (cached !== undefined) {
      setUrl(cached);
      return;
    }
    setUrl(null);

    const cb = (next: string | null) => setUrl(next);
    let subs = subscribers.get(key);
    if (!subs) {
      subs = new Set();
      subscribers.set(key, subs);
    }
    subs.add(cb);
    request(setCode, collectorNumber);
    return () => {
      subs.delete(cb);
      if (subs.size === 0) subscribers.delete(key);
    };
  }, [key, setCode, collectorNumber]);

  return url;
}
