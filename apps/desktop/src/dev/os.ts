// The demo's desktop looks like the visitor's computer: Windows (taskbar, tray) on Windows, a Mac
// (menu bar, Dock) everywhere else. `?os=windows` or `?os=mac` picks one (for checking either).
const asked = new URLSearchParams(location.search).get("os");
export const windowsDesk = asked ? asked === "windows" : /Windows/.test(navigator.userAgent);
