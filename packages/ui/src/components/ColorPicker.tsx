import { createEffect, createSignal, on, Show } from "solid-js";

/** "#rrggbb" ↔ hue (0–360), saturation and value (0–1). */
export function hexToHsv(hex: string): [number, number, number] {
  const n = parseInt(hex.replace("#", "").padEnd(6, "0").slice(0, 6), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  let h = 0;
  if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, max ? d / max : 0, max];
}

export function hsvToHex(h: number, s: number, v: number) {
  const f = (k: number) => {
    const x = (k + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(x, 4 - x, 1));
  };
  const c = (x: number) => Math.round(x * 255).toString(16).padStart(2, "0");
  return `#${c(f(5))}${c(f(3))}${c(f(1))}`;
}

/** Accepts "#abc", "abc", "#aabbcc" or "aabbcc"; returns "#aabbcc" or null. */
export function parseHex(text: string) {
  let t = text.trim().replace(/^#/, "").toLowerCase();
  if (/^[0-9a-f]{3}$/.test(t)) t = [...t].map((c) => c + c).join("");
  return /^[0-9a-f]{6}$/.test(t) ? `#${t}` : null;
}

/**
 * A color chip that opens a picker: saturation/brightness area, hue bar and a hex field.
 * `onInput` fires while dragging; `selected` rings the chip like a swatch.
 */
export function ColorPicker(props: { value: string; onInput: (hex: string) => void; selected?: boolean; label?: string }) {
  const [open, setOpen] = createSignal(false);
  const [hsv, setHsv] = createSignal(hexToHsv(props.value));
  const [text, setText] = createSignal(props.value.toUpperCase());
  // Follow outside changes (undo, another swatch) unless they came from here.
  createEffect(
    on(
      () => props.value,
      (v) => {
        if (hsvToHex(...hsv()) !== v.toLowerCase()) setHsv(hexToHsv(v));
        if (parseHex(text()) !== v.toLowerCase()) setText(v.toUpperCase());
      },
    ),
  );
  const emit = (h: number, s: number, v: number) => {
    setHsv([h, s, v]);
    const hex = hsvToHex(h, s, v);
    setText(hex.toUpperCase());
    props.onInput(hex);
  };

  const drag = (el: HTMLElement, e: PointerEvent, apply: (x: number, y: number) => void) => {
    const move = (ev: PointerEvent) => {
      const r = el.getBoundingClientRect();
      apply(Math.min(Math.max((ev.clientX - r.left) / r.width, 0), 1), Math.min(Math.max((ev.clientY - r.top) / r.height, 0), 1));
    };
    move(e);
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <div class="umi-color" data-open={open() ? "true" : "false"}>
      <button
        type="button"
        class="umi-color__chip"
        data-selected={props.selected ? "true" : "false"}
        aria-expanded={open()}
        title={props.label ?? "Custom color"}
        onClick={() => setOpen(!open())}
      >
        <i style={{ background: props.value }} />
        <span>{props.label ?? "Custom"}</span>
        <code>{props.value.toUpperCase()}</code>
      </button>
      <Show when={open()}>
        <div class="umi-color__panel">
          <div
            class="umi-color__area"
            style={{ "background-color": hsvToHex(hsv()[0], 1, 1) }}
            onPointerDown={(e) => drag(e.currentTarget, e, (x, y) => emit(hsv()[0], x, 1 - y))}
          >
            <span class="umi-color__knob" style={{ left: `${hsv()[1] * 100}%`, top: `${(1 - hsv()[2]) * 100}%`, background: props.value }} />
          </div>
          <div class="umi-color__hue" onPointerDown={(e) => drag(e.currentTarget, e, (x) => emit(x * 360, hsv()[1], hsv()[2]))}>
            <span class="umi-color__knob" style={{ left: `${(hsv()[0] / 360) * 100}%`, background: hsvToHex(hsv()[0], 1, 1) }} />
          </div>
          <label class="umi-color__hex">
            <span>Hex</span>
            <input
              value={text()}
              maxLength={7}
              spellcheck={false}
              aria-invalid={parseHex(text()) ? "false" : "true"}
              onInput={(e) => {
                setText(e.currentTarget.value);
                const hex = parseHex(e.currentTarget.value);
                if (hex) {
                  setHsv(hexToHsv(hex));
                  props.onInput(hex);
                }
              }}
              onBlur={() => setText(props.value.toUpperCase())}
              onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
            />
          </label>
        </div>
      </Show>
    </div>
  );
}
