import type { NextConfig } from "next";

// A static site (out/), served by any host — Cloudflare Pages in production.
const config: NextConfig = {
  output: "export",
  images: { unoptimized: true },
  reactStrictMode: true,
  // No Next.js badge in the corner while developing (it's never on the live site).
  devIndicators: false,
  // Lets a phone on the same Wi-Fi open the dev server (http://<this Mac>:3210).
  allowedDevOrigins: ["192.168.*.*", "10.*.*.*", "*.local"],
};

export default config;
