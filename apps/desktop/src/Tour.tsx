import { createSignal, For, Show, type JSX } from "solid-js";
import { Button, Dialog } from "@umi/ui";
import { Captions, Circle, Link2, MousePointerClick, Sparkles } from "lucide-solid";
import { pretty } from "./ShortcutsDialog";

const STEPS: { icon: () => JSX.Element; title: string; text: string }[] = [
  { icon: () => <Sparkles size={34} />, title: "Welcome to Umi", text: "Record your screen, camera and voice, and get a polished video without editing for hours. Everything runs on your computer, free." },
  { icon: () => <Circle size={34} fill="#ff4d4d" stroke="none" />, title: "Start a recording", text: `Click the Umi icon in the menu bar (or press ${pretty("Alt+Shift+L")}). Pick the screen, a window or an area, your camera and microphone, then Start.` },
  { icon: () => <MousePointerClick size={34} />, title: "It edits itself", text: "Umi zooms in where you click, smooths your cursor and frames your camera. Change anything later; nothing is baked in." },
  { icon: () => <Captions size={34} />, title: "Captions and cleanup", text: "Get captions in your language, cut the video by deleting words, remove “um”s and background noise in one click." },
  { icon: () => <Link2 size={34} />, title: "Share or export", text: "Export MP4, MOV or GIF up to 4K for free, or share a link with Umi Pro. That's it — happy recording!" },
];

const KEY = "umi.toured";

export function shouldTour() {
  if ((import.meta.env.DEV || import.meta.env.VITE_DEMO) && new URLSearchParams(location.search).has("demo")) return false;
  try {
    return !localStorage.getItem(KEY);
  } catch {
    return false;
  }
}

/** Five short cards, once on first launch (the ? button brings them back). */
export function Tour(props: { open: boolean; onClose: () => void }) {
  const [step, setStep] = createSignal(0);
  const close = () => {
    try {
      localStorage.setItem(KEY, "1");
    } catch {
      // Private storage unavailable: the tour may show again; harmless.
    }
    setStep(0);
    props.onClose();
  };
  const s = () => STEPS[step()];
  return (
    <Dialog open={props.open} onClose={close} width={420}>
      <div class="tour">
        <div class="tour__icon">{s().icon()}</div>
        <h2>{s().title}</h2>
        <p>{s().text}</p>
        <div class="tour__dots">
          <For each={STEPS}>{(_, i) => <i data-on={i() === step() ? "true" : "false"} />}</For>
        </div>
        <div class="tour__actions">
          <Button variant="ghost" onClick={close}>Skip</Button>
          <Show when={step() < STEPS.length - 1} fallback={<Button variant="ink" onClick={close}>Start recording</Button>}>
            <Button variant="ink" onClick={() => setStep(step() + 1)}>
              Next
            </Button>
          </Show>
        </div>
      </div>
    </Dialog>
  );
}
