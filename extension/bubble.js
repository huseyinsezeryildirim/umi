// The camera bubble inside the recorded tab: an extension page in a round, draggable frame.
(() => {
  if (document.getElementById("umi-bubble")) return;
  const frame = document.createElement("iframe");
  frame.id = "umi-bubble";
  frame.src = chrome.runtime.getURL("camera.html");
  frame.allow = "camera";
  Object.assign(frame.style, {
    position: "fixed", left: "24px", bottom: "24px", width: "200px", height: "200px", border: "0", borderRadius: "50%",
    zIndex: "2147483647", boxShadow: "0 10px 30px rgba(0,0,0,.35), 0 0 0 3px rgba(255,255,255,.9)", cursor: "grab", colorScheme: "normal",
  });
  document.documentElement.appendChild(frame);
  // Drag by the frame's edge (the iframe swallows its own events, so a thin grip sits on top).
  const grip = document.createElement("div");
  Object.assign(grip.style, { position: "fixed", zIndex: "2147483647", width: "200px", height: "200px", borderRadius: "50%", cursor: "grab" });
  const place = () => Object.assign(grip.style, { left: frame.style.left, top: frame.style.top, bottom: frame.style.bottom });
  place();
  grip.id = "umi-bubble-grip";
  document.documentElement.appendChild(grip);
  grip.onpointerdown = (e) => {
    const r = frame.getBoundingClientRect();
    const ox = e.clientX - r.left, oy = e.clientY - r.top;
    grip.setPointerCapture(e.pointerId);
    grip.onpointermove = (m) => {
      Object.assign(frame.style, { left: `${m.clientX - ox}px`, top: `${m.clientY - oy}px`, bottom: "auto" });
      place();
    };
    grip.onpointerup = () => (grip.onpointermove = null);
  };
  const observer = new MutationObserver(() => {
    if (!document.getElementById("umi-bubble")) {
      grip.remove();
      observer.disconnect();
    }
  });
  observer.observe(document.documentElement, { childList: true });
})();
