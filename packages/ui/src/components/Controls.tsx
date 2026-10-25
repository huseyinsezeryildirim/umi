import { createEffect, createSignal, For, onMount, Show, type JSX } from "solid-js";

// ───── Switch ─────

export function Switch(props: { checked: boolean; onChange: (v: boolean) => void; label?: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={props.checked}
      aria-label={props.label}
      class="umi-switch"
      data-on={props.checked ? "true" : "false"}
      disabled={props.disabled}
      onClick={() => props.onChange(!props.checked)}
    />
  );
}

/** A label with a switch on the right (inspector row). */
export function SwitchRow(props: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <div style={{ display: "flex", "align-items": "center", gap: "12px" }}>
      <div style={{ flex: 1, "min-width": 0 }}>
        <div style={{ "font-size": "var(--umi-text-md)", color: "var(--umi-text)" }}>{props.label}</div>
        <Show when={props.hint}>
          <div class="umi-section__hint">{props.hint}</div>
        </Show>
      </div>
      <Switch checked={props.checked} onChange={props.onChange} label={props.label} />
    </div>
  );
}

// ───── Slider ─────

export interface SliderProps {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onInput: (v: number) => void;
  /** Called when a drag starts / ends (group the drag into one undo step). */
  onGestureStart?: () => void;
  onGestureEnd?: () => void;
  label?: string;
  disabled?: boolean;
}

export function Slider(props: SliderProps) {
  const min = () => props.min ?? 0;
  const max = () => props.max ?? 1;
  const [dragging, setDragging] = createSignal(false);
  let el!: HTMLDivElement;
  const fraction = () => Math.min(Math.max((props.value - min()) / (max() - min() || 1), 0), 1);

  const valueAt = (clientX: number) => {
    const r = el.getBoundingClientRect();
    let v = min() + ((clientX - r.left) / r.width) * (max() - min());
    if (props.step) v = Math.round(v / props.step) * props.step;
    return Math.min(Math.max(v, min()), max());
  };
  const down = (e: PointerEvent) => {
    if (props.disabled) return;
    el.setPointerCapture(e.pointerId);
    setDragging(true);
    props.onGestureStart?.();
    props.onInput(valueAt(e.clientX));
  };
  const move = (e: PointerEvent) => dragging() && props.onInput(valueAt(e.clientX));
  const up = () => {
    if (!dragging()) return;
    setDragging(false);
    props.onGestureEnd?.();
  };
  const key = (e: KeyboardEvent) => {
    const step = props.step ?? (max() - min()) / 100;
    const big = e.shiftKey ? 10 : 1;
    if (e.key === "ArrowRight" || e.key === "ArrowUp") props.onInput(Math.min(props.value + step * big, max()));
    else if (e.key === "ArrowLeft" || e.key === "ArrowDown") props.onInput(Math.max(props.value - step * big, min()));
    else return;
    e.preventDefault();
  };

  return (
    <div
      ref={el}
      class="umi-slider"
      role="slider"
      tabIndex={0}
      aria-label={props.label}
      aria-valuemin={min()}
      aria-valuemax={max()}
      aria-valuenow={props.value}
      data-dragging={dragging() ? "true" : "false"}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onKeyDown={key}
    >
      <div class="umi-slider__track">
        <div class="umi-slider__fill" style={{ width: `${fraction() * 100}%` }} />
      </div>
      <div class="umi-slider__thumb" style={{ left: `${fraction() * 100}%` }} />
    </div>
  );
}

/** A labeled slider with its formatted value (inspector row). */
export function SliderField(props: SliderProps & { label: string; format?: (v: number) => string }) {
  return (
    <div>
      <div class="umi-field-row">
        <span>{props.label}</span>
        <span class="umi-field-row__value">{props.format ? props.format(props.value) : props.value.toFixed(2)}</span>
      </div>
      <Slider {...props} />
    </div>
  );
}

// ───── Segmented ─────

export interface SegmentOption<T> {
  value: T;
  label?: string;
  icon?: JSX.Element;
  title?: string;
}

/** A segmented picker whose white pill slides to the selection. */
export function Segmented<const T>(props: { options: SegmentOption<T>[]; value: T; onChange: (v: T) => void; label?: string }) {
  let root!: HTMLDivElement;
  const [pill, setPill] = createSignal({ left: 3, width: 0 });
  const measure = () => {
    const index = props.options.findIndex((o) => o.value === props.value);
    const item = root?.querySelectorAll<HTMLElement>(".umi-segmented__item")[index];
    if (item) setPill({ left: item.offsetLeft, width: item.offsetWidth });
  };
  onMount(() => {
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(root);
  });
  createEffect(() => {
    void props.value;
    void props.options.length;
    queueMicrotask(measure);
  });
  return (
    <div ref={root} class="umi-segmented" role="radiogroup" aria-label={props.label}>
      <div class="umi-segmented__pill" style={{ left: `${pill().left}px`, width: `${pill().width}px`, opacity: pill().width ? 1 : 0 }} />
      <For each={props.options}>
        {(o) => (
          <button
            type="button"
            role="radio"
            aria-checked={o.value === props.value}
            title={o.title}
            class="umi-segmented__item"
            data-selected={o.value === props.value ? "true" : "false"}
            onClick={() => props.onChange(o.value)}
          >
            {o.icon}
            <Show when={o.label}>{o.label}</Show>
          </button>
        )}
      </For>
    </div>
  );
}

// ───── Tabs ─────

export function Tabs<T extends string>(props: { tabs: { id: T; icon: JSX.Element; label: string }[]; value: T; onChange: (v: T) => void }) {
  let root!: HTMLDivElement;
  const [ind, setInd] = createSignal({ left: 4, width: 0 });
  const measure = () => {
    const index = props.tabs.findIndex((t) => t.id === props.value);
    const tab = root?.querySelectorAll<HTMLElement>(".umi-tabs__tab")[index];
    if (tab) setInd({ left: tab.offsetLeft, width: tab.offsetWidth });
  };
  onMount(() => {
    measure();
    new ResizeObserver(measure).observe(root);
  });
  createEffect(() => {
    void props.value;
    queueMicrotask(measure);
  });
  return (
    <div ref={root} class="umi-tabs" role="tablist">
      <div class="umi-tabs__indicator" style={{ left: `${ind().left}px`, width: `${ind().width}px`, opacity: ind().width ? 1 : 0 }} />
      <For each={props.tabs}>
        {(t) => (
          <button
            type="button"
            role="tab"
            aria-selected={t.id === props.value}
            aria-label={t.label}
            title={t.label}
            class="umi-tabs__tab"
            data-selected={t.id === props.value ? "true" : "false"}
            onClick={() => props.onChange(t.id)}
          >
            {t.icon}
          </button>
        )}
      </For>
    </div>
  );
}

// ───── Section, text field, kbd, badge, swatch, progress ─────

export function Section(props: { title: string; icon?: JSX.Element; hint?: string; children: JSX.Element; actions?: JSX.Element }) {
  return (
    <section class="umi-section">
      <div class="umi-section__title">
        {props.icon}
        <span style={{ flex: 1 }}>{props.title}</span>
        {props.actions}
      </div>
      {props.children}
      <Show when={props.hint}>
        <div class="umi-section__hint">{props.hint}</div>
      </Show>
    </section>
  );
}

export function TextField(props: JSX.InputHTMLAttributes<HTMLInputElement>) {
  return <input class="umi-input" {...props} />;
}

export function Kbd(props: { children: JSX.Element }) {
  return <kbd class="umi-kbd">{props.children}</kbd>;
}

export function Badge(props: { children: JSX.Element }) {
  return <span class="umi-badge">{props.children}</span>;
}

export function Swatch(props: { background: string; selected?: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      class="umi-swatch"
      aria-label={props.label}
      title={props.label}
      data-selected={props.selected ? "true" : "false"}
      style={{ background: props.background }}
      onClick={props.onClick}
    />
  );
}

export function Progress(props: { value: number }) {
  return (
    <div class="umi-progress" role="progressbar" aria-valuenow={Math.round(props.value * 100)} aria-valuemin={0} aria-valuemax={100}>
      <div class="umi-progress__bar" style={{ width: `${Math.min(Math.max(props.value, 0), 1) * 100}%` }} />
    </div>
  );
}

export function Spinner() {
  return <div class="umi-spinner" role="status" aria-label="Loading" />;
}
