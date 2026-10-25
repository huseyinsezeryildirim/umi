/** The editor in a browser (umi.cam/app) instead of the desktop app. */
export const onWeb = !!import.meta.env.VITE_WEB;

const agent = navigator.userAgent.toLowerCase();

/** What revealing a file is called on this system. */
export const revealLabel = agent.includes("windows") ? "Show in File Explorer" : agent.includes("mac") ? "Show in Finder" : "Show in folder";
