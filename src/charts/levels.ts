// How deep a genre sits in RYM's tree (user, 2026-09-25: colour the all-genre charts by level).
// Depth is the shortest path from one of RYM's 25 top-level genres, so level 0 is Rock, Pop, Jazz...
// Ordinal data, so one hue in five monotone steps (--level-0..4 in theme.css, validated per theme
// with the dataviz validator's --ordinal checks); level 0 is the most prominent step in every theme.
import { legend } from "./card";

export const LEVELS = ["Top-level genres", "2nd level", "3rd level", "4th level", "5th level or deeper"];

export function levelOf(depth: number | null | undefined): number {
  return Math.min(LEVELS.length - 1, Math.max(0, depth ?? LEVELS.length - 1));
}
export const levelColor = (level: number) => `var(--level-${level})`;
/** "3rd level", in a sentence. */
export const levelPhrase = (level: number) => (level === 0 ? "top-level genre" : LEVELS[level]);

export function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/** One legend entry per level, each with its genre count and the median of `value` at that level. */
export function levelLegend<T>(rows: T[], depthOf: (r: T) => number | null | undefined, valueOf: (r: T) => number, fmt: (v: number) => string): HTMLElement {
  return legend(
    LEVELS.flatMap((label, i) => {
      const at = rows.filter((r) => levelOf(depthOf(r)) === i);
      if (!at.length) return []; // e.g. no top-level genres while they are filtered out
      return [{ label: `${label} (${at.length.toLocaleString("en-US")}) · median ${fmt(median(at.map(valueOf)))}`, color: levelColor(i) }];
    })
  );
}
