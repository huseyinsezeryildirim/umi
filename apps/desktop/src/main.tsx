import { render } from "solid-js/web";
import "@umi/ui/styles.css";
import "./app.css";
import "./recorder/recorder.css";
import { App } from "./App";

/** Which window this is: the library/editor (main) or one of the recording windows. */
const view = new URLSearchParams(location.search).get("view") ?? "main";

// In a plain browser (design reviews, UI tests) a stand-in answers for the Rust side.
// The website's interactive demo is a build of this UI with the same stand-in (VITE_DEMO).
// The web app (umi.cam/editor) is this UI on a browser backend with the same Rust inside.
const ready = import.meta.env.VITE_WEB
  ? import("./web/backend").then((m) => m.installWebBackend())
  : (import.meta.env.DEV || import.meta.env.VITE_DEMO) && !("__TAURI_INTERNALS__" in window)
    ? import("./dev/mock")
    : Promise.resolve();

void ready.then(async () => {
  const root = document.getElementById("root")!;
  // The website demo's Mac desktop, with the tour on top.
  if (view === "desktop" && (import.meta.env.DEV || import.meta.env.VITE_DEMO)) {
    const [{ DesktopDemo }, { Tour }] = await Promise.all([import("./dev/desktop"), import("./dev/tour")]);
    render(
      () => (
        <>
          <DesktopDemo />
          <Tour />
        </>
      ),
      root,
    );
    return;
  }
  if (view === "main") {
    render(() => <App />, root);
    // The website's guided demo.
    if ((import.meta.env.DEV || import.meta.env.VITE_DEMO) && new URLSearchParams(location.search).has("tour")) {
      const { Tour } = await import("./dev/tour");
      const layer = document.createElement("div");
      document.body.append(layer);
      render(() => <Tour />, layer);
    }
    return;
  }
  // The screenshot editor is a normal window; the rest float with their own shapes.
  if (view !== "shot") document.documentElement.classList.add("umi-overlay");
  const views = {
    launcher: () => import("./recorder/Launcher").then((m) => m.Launcher),
    bubble: () => import("./recorder/Bubble").then((m) => m.Bubble),
    camera: () => import("./recorder/CameraMenu").then((m) => m.CameraMenu),
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
