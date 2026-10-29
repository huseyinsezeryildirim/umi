import { cpSync } from "node:fs";
import { resolve } from "node:path";
import { type Plugin, defineConfig } from "vite";
import solid from "vite-plugin-solid";

/** MediaPipe's runtime (camera background, face framing) goes next to the site build. */
function mediapipe(): Plugin {
  let outDir = "";
  return {
    name: "umi-mediapipe",
    apply: "build",
    configResolved: (c) => void (outDir = resolve(c.root, c.build.outDir)),
    writeBundle() {
      const from = resolve(__dirname, "node_modules/@mediapipe/tasks-vision/wasm");
      for (const f of ["vision_wasm_internal.js", "vision_wasm_internal.wasm", "vision_wasm_nosimd_internal.js", "vision_wasm_nosimd_internal.wasm"])
        cpSync(resolve(from, f), resolve(outDir, "mediapipe", f));
    },
  };
}

// Tauri serves the dev build from this fixed port. The web build (umi.cam/editor) also has the
// player for links made while recording (player.html).
export default defineConfig({
  plugins: [solid(), ...(process.env.VITE_WEB ? [mediapipe()] : [])],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  build: {
    target: "es2022",
    sourcemap: false,
    rollupOptions: process.env.VITE_WEB ? { input: { main: "index.html", player: "player.html" } } : undefined,
  },
});
