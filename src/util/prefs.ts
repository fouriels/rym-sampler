// Small remembered choices (user request 2026-09-25: "remembering autoplay and sort choices").
// localStorage can be missing or throw (private windows, blocked storage): every read falls
// back to the default and every write is best-effort, so the page works the same without it.
const PREFIX = "rym.";

export function readPref<T>(key: string, fallback: T, isValid: (v: unknown) => v is T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (raw === null) return fallback;
    const value: unknown = JSON.parse(raw);
    return isValid(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

export function writePref(key: string, value: unknown): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* not remembered; nothing else depends on it */
  }
}

export const isBool = (v: unknown): v is boolean => typeof v === "boolean";
