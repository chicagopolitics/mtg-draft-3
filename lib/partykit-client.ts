const PARTYKIT_PORT = 1999;

export function getPartykitHost(): string {
  if (process.env.NEXT_PUBLIC_PARTYKIT_HOST) {
    return process.env.NEXT_PUBLIC_PARTYKIT_HOST;
  }
  if (typeof window !== "undefined") {
    return `${window.location.hostname}:${PARTYKIT_PORT}`;
  }
  return `localhost:${PARTYKIT_PORT}`;
}
