export function compact(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1).replace(/\.0$/, "") + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(n >= 10_000 ? 0 : 1).replace(/\.0$/, "") + "K";
  return String(n);
}

export function commas(n: number): string {
  return n.toLocaleString("en-US");
}

export function pct(n: number, digits = 1): string {
  return `${n.toFixed(digits)}%`;
}

export function minutesLabel(min: number): string {
  if (min < 1) return `${Math.round(min * 60)}s`;
  const whole = Math.floor(min);
  const secs = Math.round((min - whole) * 60);
  return secs ? `${whole}m ${secs}s` : `${whole}m`;
}

// Was a hand-maintained ~94-country lookup table that silently fell back to
// the raw 2-letter code for anything it didn't list -- 45 of the 139 codes
// actually in the data (user request 2026-09-23: full names, not codes).
// Intl.DisplayNames covers every current ISO 3166-1 region natively and
// can't go stale the way a hand list does; only MusicBrainz's own
// non-ISO/retired codes need an explicit override.
const REGION_DISPLAY = (() => {
  try {
    return new Intl.DisplayNames(["en"], { type: "region" });
  } catch {
    return null;
  }
})();

const COUNTRY_NAME_OVERRIDES: Record<string, string> = {
  XE: "Europe", // MusicBrainz pseudo-code for a pan-European release
  XW: "Worldwide", // MusicBrainz pseudo-code for a worldwide release
  YU: "Yugoslavia", // retired ISO code, still appears on older releases
};

export function countryName(code: string): string {
  if (COUNTRY_NAME_OVERRIDES[code]) return COUNTRY_NAME_OVERRIDES[code];
  try {
    return REGION_DISPLAY?.of(code) ?? code;
  } catch {
    return code;
  }
}

// Countries whose names take "the" in a sentence ("by an artist from the United States").
const TAKES_THE = new Set(["United States", "United Kingdom", "United Arab Emirates", "Netherlands", "Philippines", "Bahamas", "Gambia", "Czech Republic"]);
export const withThe = (name: string): string => (TAKES_THE.has(name) ? `the ${name}` : name);

// Country sources that are inferences (from the genre's name, or a sentence read out of a
// Discogs profile) rather than a database field about the artist -- shown as "inferred"
// everywhere so the two never blur.
export const INFERRED_COUNTRY_SOURCES = new Set(["genre_release_agreement", "genre_implied", "discogs_profile"]);
