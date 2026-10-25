import { render } from "solid-js/web";
import "@umi/ui/styles.css";
import "./app.css";
import "./recorder/recorder.css";
import { App } from "./App";

/** Which window this is: the library/editor (main) or one of the recording windows. */
const view = new URLSearchParams(location.search).get("view") ?? "main";

// In a plain browser (design reviews, UI tests) a stand-in answers for the Rust side.
const ready = import.meta.env.DEV && !("__TAURI_INTERNALS__" in window) ? import("./dev/mock") : Promise.resolve();

void ready.then(async () => {
  const root = document.getElementById("root")!;
  if (view === "main") return render(() => <App />, root);
  // The screenshot editor is a normal window; the rest float with their own shapes.
  if (view !== "shot") document.documentElement.classList.add("umi-overlay");
  const views = {
    launcher: () => import("./recorder/Launcher").then((m) => m.Launcher),
    bubble: () => import("./recorder/Bubble").then((m) => m.Bubble),
    controls: () => import("./recorder/Controls").then((m) => m.Controls),
    countdown: () => import("./recorder/Countdown").then((m) => m.Countdown),
    area: () => import("./recorder/AreaPicker").then((m) => m.AreaPicker),
    prompter: () => import("./recorder/Prompter").then((m) => m.Prompter),
    ink: () => import("./recorder/Ink").then((m) => m.Ink),
    shot: () => import("./recorder/ScreenshotEditor").then((m) => m.ScreenshotEditor),
  } as const;
  const View = await (views[view as keyof typeof views] ?? views.launcher)();
  render(() => <View />, root);
});
