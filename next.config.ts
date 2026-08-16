import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // feeds.txt is read at runtime with fs, so Next won't trace it automatically.
  // Without this it works locally and 404s on Vercel.
  outputFileTracingIncludes: {
    "/api/cron/daily-brief": ["./feeds.txt", "./notes.txt"],
    "/api/preview": ["./feeds.txt", "./notes.txt"],
  },
};

export default nextConfig;
