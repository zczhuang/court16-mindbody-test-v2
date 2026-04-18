import type { NextConfig } from "next";

const config: NextConfig = {
  // All MindBody calls go server-side. No client-side env vars needed.
  experimental: {
    // reserved
  },
};

export default config;
