// How genres are ordered (user request 2026-09-24). One setting, used wherever
// the atlas has an order to show: the rows of the List view, the branch order
// round the Orbit tree, and the order auto-advance walks a family in -- so the
// list you are looking at is also the order the music follows.
import type { AtlasData } from "./data";

export type SortKey = "name" | "subgenres" | "releases" | "year";

export const SORT_OPTIONS: { key: SortKey; label: string; note: string }[] = [
  { key: "name", label: "A–Z", note: "" },
  { key: "subgenres", label: "Most subgenres", note: "most subgenres first" },
  { key: "releases", label: "Most releases", note: "most releases first" },
  { key: "year", label: "Oldest first", note: "oldest first" },
];

const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });
export const compareNames = (a: string, b: string): number => collator.compare(a, b);

interface FamilyMetrics {
  size: Map<string, number>; // genres whose primary family this is
  releases: Map<string, number>; // their RYM release counts, summed
  year: Map<string, number>; // the median sampled year of their genres (those that have one)
}
const familyCache = new WeakMap<AtlasData, FamilyMetrics>();

function familyMetrics(atlas: AtlasData): FamilyMetrics {
  let m = familyCache.get(atlas);
  if (!m) {
    m = { size: new Map(), releases: new Map(), year: new Map() };
    const years = new Map<string, number[]>();
    for (const g of atlas.genres) {
      m.size.set(g.primary, (m.size.get(g.primary) ?? 0) + 1);
      m.releases.set(g.primary, (m.releases.get(g.primary) ?? 0) + (g.releases ?? 0));
      if (g.year != null) (years.get(g.primary) ?? years.set(g.primary, []).get(g.primary)!).push(g.year);
    }
    for (const [family, list] of years) {
      list.sort((a, b) => a - b);
      m.year.set(family, list[Math.floor(list.length / 2)]);
    }
    familyCache.set(atlas, m);
  }
  return m;
}

/** The number `id` is sorted by, or null if it has none (those sort last).
 * `family` = `id` is a top-level genre (the first column / the orbiting nodes),
 * whose "subgenres" and "releases" are those of the whole family, and whose
 * year is the median of its genres' sampled years. */
export function sortMetric(atlas: AtlasData, key: SortKey, id: string, family = false): number | null {
  switch (key) {
    case "subgenres":
      return family ? familyMetrics(atlas).size.get(id) ?? 0 : atlas.children.get(id)?.length ?? 0;
    case "releases":
      return family ? familyMetrics(atlas).releases.get(id) ?? 0 : atlas.nodesByName.get(id)?.releases ?? 0;
    case "year":
      return family ? familyMetrics(atlas).year.get(id) ?? null : atlas.byName.get(id)?.year ?? null;
    default:
      return null;
  }
}

/** Order for genre ids under `key`; ties (and A–Z itself) fall back to the name. */
export function makeComparator(atlas: AtlasData, key: SortKey, family = false): (a: string, b: string) => number {
  if (key === "name") return compareNames;
  const largestFirst = key !== "year";
  return (a, b) => {
    const ma = sortMetric(atlas, key, a, family);
    const mb = sortMetric(atlas, key, b, family);
    if (ma !== mb) {
      if (ma === null) return 1;
      if (mb === null) return -1;
      return largestFirst ? mb - ma : ma - mb;
    }
    return compareNames(a, b);
  };
}

const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });

/** A sort metric as a short label for a row ("38", "12.3K", "1977"); "" for nothing to show. */
export function formatMetric(key: SortKey, value: number | null): string {
  if (value === null || (value === 0 && key !== "year")) return "";
  return key === "releases" ? compact.format(value) : String(value);
}
