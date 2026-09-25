import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // Playwright drives the dev server via 127.0.0.1, which Next's dev-only
  // cross-origin guard otherwise treats as a different origin from the
  // server's own `localhost` (blocking HMR and, per observed behaviour,
  // client hydration too). Dev-only — see
  // https://nextjs.org/docs/app/api-reference/config/next-config-js/allowedDevOrigins
  allowedDevOrigins: ["127.0.0.1", "localhost"],
};

export default nextConfig;
