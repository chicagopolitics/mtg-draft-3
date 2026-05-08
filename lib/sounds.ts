/**
 * Tiny client-side sound system. Plays short .wav cues for game actions.
 * Files are imported (not fetched by URL) so the bundler copies them into
 * the build output and serves them with cache-friendly hashed paths.
 *
 * Mute state lives in localStorage so it survives reloads. Browsers block
 * audio playback until the page has had a user interaction; we lazily
 * create `Audio` elements per cue, which avoids any pre-interaction cost.
 */

import drawCardUrl from "@/lib/Sounds/draw_card.wav";
import playCardUrl from "@/lib/Sounds/play_card.wav";

export type SoundName = "drawCard" | "playCard";

const URLS: Record<SoundName, string> = {
  drawCard: drawCardUrl,
  playCard: playCardUrl,
};

const MUTE_KEY = "mtg-draft-3.sounds.muted";

let muted: boolean | null = null;

function readMuted(): boolean {
  if (muted !== null) return muted;
  if (typeof window === "undefined") return false;
  muted = window.localStorage.getItem(MUTE_KEY) === "1";
  return muted;
}

export function isMuted(): boolean {
  return readMuted();
}

export function setMuted(next: boolean): void {
  muted = next;
  if (typeof window !== "undefined") {
    window.localStorage.setItem(MUTE_KEY, next ? "1" : "0");
  }
}

/**
 * Per-cue Audio elements, lazily constructed on first play. We clone before
 * playing so a rapid sequence of the same sound (e.g., drawing 7 in a row)
 * overlaps cleanly instead of restarting the same element.
 */
const elements = new Map<SoundName, HTMLAudioElement>();

function getElement(name: SoundName): HTMLAudioElement | null {
  if (typeof window === "undefined") return null;
  let el = elements.get(name);
  if (!el) {
    el = new Audio(URLS[name]);
    el.preload = "auto";
    elements.set(name, el);
  }
  return el;
}

/**
 * Play a sound cue. Safe to call before user interaction — the browser may
 * silently block playback, which is fine; subsequent plays succeed once the
 * user has clicked anywhere.
 */
export function play(name: SoundName): void {
  if (typeof window === "undefined") return;
  if (readMuted()) return;
  const base = getElement(name);
  if (!base) return;
  // Clone so concurrent plays don't fight for the same audio element.
  const node = base.cloneNode(true) as HTMLAudioElement;
  node.volume = 0.6;
  void node.play().catch(() => {
    // Autoplay blocked or no codec — fail silently.
  });
}
