import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

// Tauri serves the dev build from this fixed port.
export default defineConfig({
  plugins: [solid()],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  build: { target: "es2022", sourcemap: false },
});
