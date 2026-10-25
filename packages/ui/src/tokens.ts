/** Design tokens for code that needs them as values (canvas drawing, charts). Mirrors tokens.css. */
export const tokens = {
  color: {
    ink: "#0e111e",
    text: "#11121d",
    text2: "#4a4f58",
    text3: "#686b74",
    iceTop: "#f1f7fc",
    iceBottom: "#e1effc",
    track: "#eff0f4",
    accent: "#116ff5",
    accentLight: "#6fb5ef",
    record: "#f0443a",
    trim: "#ffc83d",
    lanes: {
      zoom: "#116ff5",
      scene: "#7a5af8",
      mask: "#e8590c",
      text: "#12b886",
      move: "#f76707",
      media: "#0ca678",
      music: "#d6336c",
      video2: "#116ff5",
      voice: "#0b7285",
    },
  },
  motion: {
    ease: "cubic-bezier(0.22, 1, 0.36, 1)",
    fast: 120,
    normal: 180,
    slow: 280,
  },
} as const;
