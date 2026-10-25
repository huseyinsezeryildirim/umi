// Which parts of the recording make it into the video: the trim, minus filler words and long pauses.
import type { Word } from "./look";

export type Range = [number, number];

const FILLERS = new Set(["um", "umm", "uh", "uhm", "uhh", "erm", "er", "ah", "hmm", "hm", "mm", "mhm"]);
const bare = (t: string) => t.toLowerCase().replace(/[^a-z]/g, "");

export const isFiller = (w: Word) => FILLERS.has(bare(w.text));

/** Each filler word, up to the next word so no half-breath is left behind. */
export function fillerCuts(words: Word[]): Range[] {
  return words.flatMap((w, i) => {
    if (!isFiller(w)) return [];
    const next = words[i + 1];
    const end = next && next.start - w.end < 0.4 ? next.start : w.end;
    return [[w.start, end] as Range];
  });
}

/** Silences longer than `longest` seconds, shortened to `keep` seconds. */
export function pauseCuts(words: Word[], longest = 0.9, keep = 0.4): Range[] {
  const spoken = words.filter((w) => !isFiller(w));
  const cuts: Range[] = [];
  for (let i = 1; i < spoken.length; i++) {
    const gap = spoken[i].start - spoken[i - 1].end;
    if (gap > longest) cuts.push([spoken[i - 1].end + keep / 2, spoken[i].start - keep / 2]);
  }
  return cuts;
}

/** The kept stretches of [start, end] once the cuts are taken out, in order. */
export function keptRanges(trim: Range, cuts: Range[]): Range[] {
  const sorted = cuts.map(([a, b]) => [Math.max(a, trim[0]), Math.min(b, trim[1])] as Range).filter(([a, b]) => b - a > 0.02).sort((x, y) => x[0] - y[0]);
  const out: Range[] = [];
  let at = trim[0];
  for (const [a, b] of sorted) {
    if (a > at + 0.02) out.push([at, a]);
    at = Math.max(at, b);
  }
  if (trim[1] > at + 0.02) out.push([at, trim[1]]);
  return out;
}

export const total = (ranges: Range[]) => ranges.reduce((s, [a, b]) => s + b - a, 0);

/** If `time` falls in a cut, where playback should jump to (or null). */
export function skipCut(kept: Range[], time: number): number | null {
  for (const [a, b] of kept) {
    if (time < a) return a;
    if (time < b) return null;
  }
  return null;
}
