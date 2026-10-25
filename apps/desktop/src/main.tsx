import { render } from "solid-js/web";
import "@umi/ui/styles.css";
import "./app.css";
import { App } from "./App";

// In a plain browser (design reviews, UI tests) a stand-in answers for the Rust side.
const ready = import.meta.env.DEV && !("__TAURI_INTERNALS__" in window) ? import("./dev/mock") : Promise.resolve();
void ready.then(() => render(() => <App />, document.getElementById("root")!));
