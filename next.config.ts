import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["192.168.1.68"],
  turbopack: {
    root: import.meta.dirname,
  },
  // Bundle the Sets/ MTGJSON files and Decks/ MWDECK files into the
  // serverless function tree so routes that read them work at runtime on
  // Vercel.
  outputFileTracingIncludes: {
    "/api/sets/**/*": ["./Sets/**/*.json"],
    "/api/cards/**/*": ["./Sets/**/*.json"],
    "/api/decks/**/*": ["./Decks/**/*.mwDeck"],
  },
};

export default nextConfig;
