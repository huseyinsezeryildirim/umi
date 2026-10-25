// Picks the right download for this computer and makes it the main button.
(async function () {
  const ua = navigator.userAgent;
  let os = "unknown";
  let arch = "";
  const data = navigator.userAgentData;
  if (data && data.getHighEntropyValues) {
    try {
      const v = await data.getHighEntropyValues(["platform", "architecture"]);
      if (v.platform === "macOS") os = "mac";
      else if (v.platform === "Windows") os = "windows";
      else if (v.platform === "Linux") os = "linux";
      else if (v.platform === "Chrome OS") os = "chrome";
      arch = v.architecture || "";
    } catch {}
  }
  if (os === "unknown") {
    if (/CrOS/.test(ua)) os = "chrome";
    else if (/Mac/.test(ua)) os = "mac";
    else if (/Win/.test(ua)) os = "windows";
    else if (/Linux/.test(ua)) os = "linux";
  }
  // Safari doesn't say: Apple silicon is the safe default for new Macs.
  const key = os === "mac" ? (arch === "x86" ? "mac-intel" : "mac-arm") : os;
  const card = document.querySelector(`.card[data-os="${key}"]`);
  const button = document.getElementById("download");
  const detected = document.getElementById("detected");
  const names = { "mac-arm": "Download for Mac", "mac-intel": "Download for Mac (Intel)", windows: "Download for Windows", linux: "Download for Linux", chrome: "Add to Chrome" };
  if (card && button) {
    button.href = card.getAttribute("href");
    button.textContent = names[key];
    card.classList.add("card-you");
    detected.textContent = os === "mac" ? "macOS 13 or later · Apple silicon and Intel" : os === "windows" ? "Windows 10 and 11" : os === "linux" ? "Ubuntu, Fedora, Arch and more" : "Chrome and ChromeOS";
  }
})();
