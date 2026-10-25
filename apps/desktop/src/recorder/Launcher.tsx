import { invoke } from "@tauri-apps/api/core";
import { createResource, createSignal, For, onCleanup, onMount, Show, type JSX } from "solid-js";
import { IconButton, Kbd, Menu, Segmented, Toaster, toast, type MenuEntry } from "@umi/ui";
import { AppWindow, Camera, CameraOff, ChevronDown, Crop, Film, Maximize2, Mic, MicOff, Monitor, MoreHorizontal, ScrollText, ShieldAlert, UserSquare2, Volume2, VolumeX } from "lucide-solid";
import { recorder, type RecordSettings, type Sources, type Target } from "./api";

/** The recorder: what to record, camera, microphone, sound, and Start. */
export function Launcher() {
  let card!: HTMLDivElement;
  const [settings, setSettings] = createSignal<RecordSettings | null>(null);
  const [sources, { refetch }] = createResource(() => recorder.sources());
  const [level, setLevel] = createSignal(0);

  onMount(async () => {
    const s = await recorder.settings();
    setSettings(s);
    void recorder.meter(s.microphone);
    // Fit the window to the card.
    const ro = new ResizeObserver(() => void recorder.resize(360, Math.ceil(card.getBoundingClientRect().height) + 24));
    ro.observe(card);
    const timer = window.setInterval(async () => setLevel((await recorder.status()).level), 80);
    const refresh = () => void refetch();
    window.addEventListener("focus", refresh);
    onCleanup(() => {
      ro.disconnect();
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      void recorder.meter(null);
    });
  });

  const update = (change: (s: RecordSettings) => void) => {
    const next = structuredClone(settings()!);
    change(next);
    setSettings(next);
    void recorder.save(next);
    return next;
  };

  const target = () => settings()?.target;
  const sourceLabel = () => {
    const s = settings();
    if (!s) return "";
    if (s.cameraOnly) return "Camera only";
    const t = target();
    const list = sources();
    if (!t || t.kind === "display") return list?.displays.find((d) => !t || d.id === (t as { id: number }).id)?.name ?? "Full screen";
    if (t.kind === "window") {
      const w = list?.windows.find((x) => x.id === t.id);
      return w ? `${w.app}${w.title ? ` — ${w.title}` : ""}` : "A window";
    }
    return `Area ${Math.round(t.width)}×${Math.round(t.height)}`;
  };
  const sourceIcon = () => (settings()?.cameraOnly ? <UserSquare2 size={18} /> : target()?.kind === "window" ? <AppWindow size={18} /> : target()?.kind === "area" ? <Crop size={18} /> : <Monitor size={18} />);

  const pick = (t: Target | null, cameraOnly = false) =>
    update((s) => {
      s.target = t;
      s.cameraOnly = cameraOnly;
      if (cameraOnly) s.cameraOn = true;
    });

  const sourceMenu = (): MenuEntry[] => {
    const list = sources();
    const entries: MenuEntry[] = [{ kind: "label", label: "Screen" }];
    for (const d of list?.displays ?? []) entries.push({ label: d.name, icon: <Monitor size={15} />, checked: !settings()?.cameraOnly && (target()?.kind ?? "display") === "display" && (!target() || (target() as { id: number }).id === d.id), onSelect: () => pick({ kind: "display", id: d.id }) });
    entries.push({ label: "Select an area…", icon: <Crop size={15} />, onSelect: () => void recorder.show("area") });
    entries.push({ label: "Camera only", icon: <UserSquare2 size={15} />, checked: settings()?.cameraOnly, onSelect: () => pick(null, true) });
    const chosen = target()?.kind === "window" ? list?.windows.find((w) => w.id === (target() as { id: number }).id) : undefined;
    if (chosen) {
      entries.push({ kind: "separator" }, { kind: "label", label: `Size of ${chosen.app}` });
      for (const [w, h, label] of [
        [1280, 720, "1280 × 720 (16:9)"],
        [1920, 1080, "1920 × 1080 (16:9)"],
        [1080, 1350, "1080 × 1350 (4:5)"],
        [720, 1280, "720 × 1280 (9:16)"],
      ] as const) {
        entries.push({
          label,
          icon: <Maximize2 size={15} />,
          onSelect: () =>
            void invoke("resize_app_window", { appName: chosen.app, title: chosen.title, width: w / (list?.displays[0]?.scale ?? 1), height: h / (list?.displays[0]?.scale ?? 1) })
              .then(() => void refetch())
              .catch((e) => toast(String(e))),
        });
      }
    }
    if (list?.windows.length) {
      entries.push({ kind: "separator" }, { kind: "label", label: "Window" });
      for (const w of list.windows.slice(0, 14)) entries.push({ label: `${w.app}${w.title ? ` — ${w.title}` : ""}`, icon: <AppWindow size={15} />, checked: target()?.kind === "window" && (target() as { id: number }).id === w.id, onSelect: () => pick({ kind: "window", id: w.id }) });
    }
    return entries;
  };

  const micMenu = (): MenuEntry[] => [
    {
      label: "No microphone",
      icon: <MicOff size={15} />,
      checked: settings()?.microphone === null,
      onSelect: () => {
        update((s) => (s.microphone = null));
        void recorder.meter(null);
      },
    },
    { kind: "separator" },
    ...(sources()?.microphones ?? []).map((m) => ({
      label: m.name,
      icon: <Mic size={15} />,
      checked: settings()?.microphone === m.id || (settings()?.microphone === "" && m.isDefault),
      onSelect: () => {
        update((s) => (s.microphone = m.id));
        void recorder.meter(m.id);
      },
    })),
  ];
  const micName = () => {
    const id = settings()?.microphone;
    if (id === null) return "No microphone";
    const list = sources()?.microphones ?? [];
    return (list.find((m) => m.id === id) ?? list.find((m) => m.isDefault))?.name ?? "Microphone";
  };

  const toggleCamera = async () => {
    const s = update((x) => (x.cameraOn = !x.cameraOn));
    if (s.cameraOn) await recorder.show("bubble");
    else await recorder.hide("bubble");
  };

  const moreMenu = (): MenuEntry[] => [
    { label: "3-second countdown", checked: settings()?.countdown, onSelect: () => update((s) => (s.countdown = !s.countdown)) },
    { kind: "separator" },
    { kind: "label", label: "Quality" },
    ...(["native", "1080p", "720p"] as const).map((r) => ({ label: r === "native" ? "Native resolution" : r, checked: settings()?.resolution === r, onSelect: () => update((s) => (s.resolution = r)) })),
    ...[60, 30].map((f) => ({ label: `${f} fps`, checked: settings()?.fps === f, onSelect: () => update((s) => (s.fps = f)) })),
    { kind: "separator" },
    { label: "Open library", icon: <Film size={15} />, onSelect: () => void recorder.show("main") },
    { label: "Quit Umi", onSelect: () => void invoke("app_quit") },
  ];

  return (
    <div class="rec-shell">
      <div ref={card} class="rec-card">
        <header class="rec-header">
          <img src="/umi-mark.svg" alt="" class="rec-mark" />
          <strong>Umi</strong>
          <span class="rec-spacer" />
          <IconButton label="Library" size="sm" onClick={() => void recorder.show("main")}>
            <Film size={16} />
          </IconButton>
          <Menu align="end" width={220} entries={moreMenu()} trigger={(open) => <IconButton label="More" size="sm" onClick={open}><MoreHorizontal size={16} /></IconButton>} />
        </header>

        <Show when={sources()?.missingPermission === "screen"}>
          <div class="rec-permission">
            <ShieldAlert size={18} />
            <div>
              <strong>Allow screen recording</strong>
              <p>Turn on Umi in System Settings → Privacy &amp; Security → Screen &amp; System Audio Recording, then reopen Umi.</p>
              <button type="button" onClick={() => void invoke("open_privacy_settings", { kind: "screen" })}>
                Open Settings
              </button>
            </div>
          </div>
        </Show>

        <Show when={settings()}>
          <div class="rec-rows">
            <Menu width={300} entries={sourceMenu()} trigger={(open) => <Row icon={sourceIcon()} title={sourceLabel()} onClick={open} chevron />} />
            <Row icon={settings()!.cameraOn ? <Camera size={18} /> : <CameraOff size={18} />} title={settings()!.cameraOn ? sources()?.cameras.find((c) => c.id === settings()!.camera)?.name ?? sources()?.cameras[0]?.name ?? "Camera" : "No camera"} on={settings()!.cameraOn} onClick={() => void toggleCamera()} toggle />
            <Menu width={300} entries={micMenu()} trigger={(open) => <Row icon={settings()!.microphone === null ? <MicOff size={18} /> : <Mic size={18} />} title={micName()} on={settings()!.microphone !== null} onClick={open} chevron level={settings()!.microphone === null ? undefined : level()} />} />
            <Row icon={settings()!.systemAudio ? <Volume2 size={18} /> : <VolumeX size={18} />} title="Computer sound" on={settings()!.systemAudio} onClick={() => update((s) => (s.systemAudio = !s.systemAudio))} toggle />
            <Row
              icon={<ScrollText size={18} />}
              title="Speaker notes"
              on={settings()!.notesOn}
              onClick={() => {
                const s = update((x) => (x.notesOn = !x.notesOn));
                void (s.notesOn ? recorder.show("prompter") : recorder.hide("prompter"));
              }}
              toggle
            />
          </div>
          <Segmented
            value={settings()!.flow}
            onChange={(v) => update((s) => (s.flow = v))}
            options={[
              { value: "studio", label: "Studio · edit after" },
              { value: "instant", label: "Instant · copy video" },
            ]}
          />
          <button type="button" class="rec-start" onClick={() => void recorder.start()}>
            <i /> Start recording
          </button>
          <Toaster />
          <footer class="rec-footer">
            <span>No time limit · Free forever</span>
            <span>
              <Kbd>⌥⇧L</Kbd> to start
            </span>
          </footer>
        </Show>
      </div>
    </div>
  );
}

function Row(props: { icon: JSX.Element; title: string; on?: boolean; onClick: () => void; chevron?: boolean; toggle?: boolean; level?: number }) {
  return (
    <button type="button" class="rec-row" data-on={props.on === false ? "false" : "true"} onClick={props.onClick}>
      <span class="rec-row__icon">{props.icon}</span>
      <span class="rec-row__title">{props.title}</span>
      <Show when={props.level !== undefined}>
        <span class="rec-meter">
          <For each={[0, 1, 2, 3, 4, 5, 6]}>{(i) => <i data-lit={(props.level ?? 0) * 9 > i ? "true" : "false"} />}</For>
        </span>
      </Show>
      <Show when={props.chevron}>
        <ChevronDown size={15} class="rec-row__chevron" />
      </Show>
      <Show when={props.toggle}>
        <span class="rec-switch" data-on={props.on ? "true" : "false"}>
          <i />
        </span>
      </Show>
    </button>
  );
}

void ({} as Sources);
