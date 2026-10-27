import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

// Tauri serves the dev build from this fixed port. The web build (umi.cam/editor) also has the
// player for links made while recording (player.html).
export default defineConfig({
  plugins: [solid()],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  build: {
    target: "es2022",
    sourcemap: false,
    rollupOptions: process.env.VITE_WEB ? { input: { main: "index.html", player: "player.html" } } : undefined,
  },
});
