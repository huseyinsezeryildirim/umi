import type { NextConfig } from "next";

// A static site (out/), served by any host — Cloudflare Pages in production.
const config: NextConfig = {
  output: "export",
  images: { unoptimized: true },
  reactStrictMode: true,
  // Lets a phone on the same Wi-Fi open the dev server (http://<this Mac>:3210).
  allowedDevOrigins: ["192.168.*.*", "10.*.*.*", "*.local"],
};

export default config;
