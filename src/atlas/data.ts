// Lazy-loaded data layer for the atlas. genres.json (3.7MB) and graph.json
// (779KB) are only fetched once the Atlas tab is actually opened -- the
// Stats tab never needs either, and loading them eagerly would slow down
// the dashboard's default view for no benefit.
import type { GenreRecord, Graph, GraphNode } from "../types";
import { compareNames } from "./sort";

export interface AtlasData {
  genres: GenreRecord[];
  byName: Map<string, GenreRecord>;
  graph: Graph;
  nodesByName: Map<string, GraphNode>;
  // children[id] = every node reachable as a direct taxonomic child of id --
  // BOTH "primary" and "also" edges (user request 2026-09-23: "choosing a
  // genre should show all connections... aggrotech via both electronic and
  // dance"). Traced a real example before deciding this: Aggrotech's own
  // route from Dance happens to be all-primary (Dance > Electronic Dance
  // Music > EBM > Dark Electro > Aggrotech, since "Electronic Dance Music"
  // and "EBM" are themselves reachable from more than one family's root) --
  // but that's not guaranteed for every cross-family genre, so primary-only
  // traversal would silently strand some of them. Unioning both edge kinds
  // here means a genre with multiple real parents shows up under every one
  // of them when browsing, which is the DAG-native experience.
  children: Map<string, string[]>;
  // primaryChildren: the primary-edges-only subset, used for auto-advance's walk
  // order so each family's sequence stays a clean depth-first pass rather
  // than looping back into genres that live there only via a cross-link.
  primaryChildren: Map<string, string[]>;
  // roots[family] = ids of nodes with no incoming primary edge, grouped by
  // their primary family -- one per family, except "Uncategorised" (27
  // disconnected roots, since it is RYM's catch-all rather than a real tree).
  roots: Map<string, string[]>;
  families: string[]; // ordered by primary genre-count, descending
}

let cached: Promise<AtlasData> | null = null;

export function loadAtlas(): Promise<AtlasData> {
  if (!cached) cached = fetchAtlas();
  return cached;
}

async function fetchAtlas(): Promise<AtlasData> {
  const [genresPayload, graph] = await Promise.all([
    fetch("/data/genres.json").then((r) => r.json()) as Promise<{ genres: GenreRecord[] }>,
    fetch("/data/graph.json").then((r) => r.json()) as Promise<Graph>,
  ]);
  const genres = genresPayload.genres;
  const byName = new Map(genres.map((g) => [g.name, g]));
  const nodesByName = new Map(graph.nodes.map((n) => [n.id, n]));

  const children = new Map<string, string[]>();
  const primaryChildren = new Map<string, string[]>();
  const hasIncomingPrimary = new Set<string>();
  const push = (map: Map<string, string[]>, from: string, to: string) => {
    const list = map.get(from);
    if (list) list.push(to);
    else map.set(from, [to]);
  };
  for (const edge of graph.edges) {
    push(children, edge.from, edge.to); // both "primary" and "also"
    if (edge.kind === "primary") {
      hasIncomingPrimary.add(edge.to);
      push(primaryChildren, edge.from, edge.to);
    }
  }

  const roots = new Map<string, string[]>();
  for (const node of graph.nodes) {
    if (hasIncomingPrimary.has(node.id)) continue;
    const list = roots.get(node.primary);
    if (list) list.push(node.id);
    else roots.set(node.primary, [node.id]);
  }

  const familyCounts = new Map<string, number>();
  for (const g of genres) familyCounts.set(g.primary, (familyCounts.get(g.primary) ?? 0) + 1);
  const families = [...familyCounts.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name);

  return { genres, byName, graph, nodesByName, children, primaryChildren, roots, families };
}

/** Every node reachable under a node (or a family, at the top level), in
 * pre-order (a node before its children) -- the auto-advance walk order. This
 * must include branch nodes, not just leaves: every node is independently
 * selectable/playable (clicking "Acoustic Blues" both plays it AND shows its
 * children), so a leaves-only queue can never contain the branch node the
 * user is actually on, and auto-advance silently stalls the moment someone
 * selects (or auto-advance walks into) anything with children of its own.
 *
 * Walks `primaryChildren` only, not the full (also-inclusive) `children` --
 * auto-advance should move through a family once, depth-first, not loop back
 * into a genre it already played because a cross-link brought it back in.
 * `seen` is a defensive cycle guard: the source taxonomy should be a DAG,
 * but nothing here has proven it has zero cycles, and an infinite recursive
 * walk would hang the tab outright rather than just misbehave. */
export function walkUnder(
  atlas: AtlasData,
  id: string,
  seen: Set<string> = new Set(),
  compare: (a: string, b: string) => number = compareNames
): string[] {
  if (seen.has(id)) return [];
  seen.add(id);
  const out = [id];
  const kids = atlas.primaryChildren.get(id);
  if (kids) for (const kid of [...kids].sort(compare)) out.push(...walkUnder(atlas, kid, seen, compare));
  return out;
}

/** `compare` is the atlas's current sort order (see sort.ts), so the walk follows
 * the order the genres are listed in. */
export function walkFamily(
  atlas: AtlasData,
  family: string,
  compare: (a: string, b: string) => number = compareNames
): string[] {
  const roots = atlas.roots.get(family) ?? [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const root of [...roots].sort(compare)) out.push(...walkUnder(atlas, root, seen, compare));
  return out;
}
