import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["192.168.1.68"],
  turbopack: {
    root: import.meta.dirname,
  },
  // Bundle the Sets/ MTGJSON files into the serverless function tree so
  // /api/sets/[code] can read them at runtime on Vercel.
  outputFileTracingIncludes: {
    "/api/sets/**/*": ["./Sets/**/*.json"],
  },
};

export default nextConfig;
