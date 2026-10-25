import type { NextConfig } from "next";

// A static site (out/), served by any host — Cloudflare Pages in production.
const config: NextConfig = {
  output: "export",
  images: { unoptimized: true },
  reactStrictMode: true,
};

export default config;
