// Prototype (user request 2026-09-23): "a big, draggable net with nodes for
// genres and lines connecting them" -- as an alternative to the semantic-zoom
// bubble pack, not a replacement (see view.ts's rationale for why the bubble
// pack exists: the full 2,613-node/4,118-edge graph would be an unreadable,
// slow hairball at that scale). Scoped to one genre's immediate neighbourhood
// (direct parents + direct children), with all 26 over-genres always present.
// Nothing is pinned (user request 2026-09-24): every node, the over-genres
// included, floats under loose physics -- pushing each other apart, but all
// drawn gently towards the middle of the window. Dragging a node pushes its
// neighbours around and it drifts back when let go.
//
// Every over-genre node is always present and never recentres the whole graph when
// clicked (user request 2026-09-23, after testing: clicking "Regional Music"
// while looking at Byzantine Music threw away Byzantine Music's own
// neighbourhood entirely, which felt like losing your place). Instead a
// family click PEEKS at that family's own top-level genres, added into the
// same live graph without disturbing the base neighbourhood.
//
// The peek is a CHAIN (user request 2026-09-24): clicking a genre inside it
// opens that genre's own subgenres while everything above it stays open, so
// family -> subgenre -> sub-subgenre stays visible as one path. Each level
// has at most one open branch -- opening a sibling (or a different family)
// closes only that sibling's branch and everything below it.
import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCenter,
  forceCollide,
  forceX,
  forceY,
  type SimulationNodeDatum,
  type Simulation,
  type ForceLink,
} from "d3-force";
import type { AtlasData } from "./data";
import { svgEl, showTooltip, hideTooltip } from "../util/dom";

type NodeKind = "center" | "parent" | "child" | "family" | "peek";

interface NetNode extends SimulationNodeDatum {
  id: string;
  kind: NodeKind;
  releases: number;
  peekedFrom?: string; // for "peek" nodes: which family node spawned them
  labelSide?: "top" | "right" | "bottom" | "left";
}

interface NetLink {
  source: string;
  target: string;
  kind: "parent" | "child" | "family" | "peek";
}

function linkKey(source: string | NetNode, target: string | NetNode): string {
  const id = (endpoint: string | NetNode) => typeof endpoint === "string" ? endpoint : endpoint.id;
  return `${id(source)}␟${id(target)}`;
}

/** Every over-genre is a node, even before a genre is selected. For a selected
 * genre, add its direct parents, direct children and membership links to all
 * of its families, however many taxonomy hops away they are. */
function buildNeighbourhood(
  atlas: AtlasData,
  centerId: string | null,
  maxPerGroup: number
): { nodes: NetNode[]; links: NetLink[] } {
  const record = centerId ? atlas.byName.get(centerId) : null;
  const nodes = new Map<string, NetNode>();
  const links: NetLink[] = [];
  const linkKeys = new Set<string>();
  const addLink = (source: string, target: string, kind: NetLink["kind"]) => {
    const key = linkKey(source, target);
    if (linkKeys.has(key)) return;
    linkKeys.add(key);
    links.push({ source, target, kind });
  };
  const releasesOf = (id: string) => atlas.nodesByName.get(id)?.releases ?? 0;

  if (centerId) nodes.set(centerId, { id: centerId, kind: "center", releases: releasesOf(centerId) });
  for (const fam of atlas.families) {
    if (!nodes.has(fam)) nodes.set(fam, { id: fam, kind: "family", releases: releasesOf(fam) });
  }
  if (!record || !centerId) return { nodes: [...nodes.values()], links };

  for (const p of record.parents) {
    const isFamily = atlas.families.includes(p);
    if (!nodes.has(p)) nodes.set(p, { id: p, kind: isFamily ? "family" : "parent", releases: releasesOf(p) });
    addLink(p, centerId, "parent");
  }

  const kids = (atlas.children.get(centerId) ?? [])
    .map((id) => ({ id, releases: releasesOf(id) }))
    .sort((a, b) => b.releases - a.releases)
    .slice(0, maxPerGroup);
  for (const k of kids) {
    if (!nodes.has(k.id)) nodes.set(k.id, { id: k.id, kind: "child", releases: k.releases });
    addLink(centerId, k.id, "child");
  }

  // Membership links are only drawn for this genre's actual families.
  for (const fam of record.over_genres) {
    if (fam === centerId) continue; // the family IS this genre (a top-level root)
    if (!nodes.has(fam)) nodes.set(fam, { id: fam, kind: "family", releases: releasesOf(fam) });
    addLink(fam, centerId, "family"); // no-op if already linked as a direct parent
  }

  return { nodes: [...nodes.values()], links };
}

/** Where each over-genre STARTS: spread round an ellipse so the layout opens
 * evenly. It is only a starting position -- nothing is pinned to it. */
function familyStart(index: number, count: number, width: number, height: number): { x: number; y: number } {
  const angle = (index / count) * Math.PI * 2 - Math.PI / 2;
  return { x: width / 2 + Math.cos(angle) * (width / 2 - 110), y: height / 2 + Math.sin(angle) * (height / 2 - 80) };
}

// Room left at the frame's edges for labels.
const EDGE_X = 60;
const EDGE_TOP = 34;
const EDGE_BOTTOM = 46;

const PULL: Record<NodeKind, number> = { center: 0.28, family: 0.06, parent: 0.03, child: 0.03, peek: 0.04 };
const PULL_OPEN = 0.16;
const PULL_ORBIT = 0.045;

function truncate(label: string, max: number): string {
  return label.length > max ? label.slice(0, max - 1) + "…" : label;
}

function clientToSvgPoint(svg: SVGSVGElement, clientX: number, clientY: number): { x: number; y: number } {
  const ctm = svg.getScreenCTM();
  if (!ctm) return { x: clientX, y: clientY };
  const pt = svg.createSVGPoint();
  pt.x = clientX;
  pt.y = clientY;
  const p = pt.matrixTransform(ctm.inverse());
  return { x: p.x, y: p.y };
}

export interface NetworkGraphOptions {
  width?: number;
  height?: number;
  maxPerGroup?: number;
  maxPeek?: number;
  /** The open chain to restore (family first), so a recentre or re-render
   * doesn't collapse a path the user opened. */
  initialChain?: string[];
  onChainChange?: (chain: string[]) => void;
  /** A genre inside the chain was clicked: select/play it WITHOUT re-rendering
   * (a re-render would recentre the graph and lose the layout). */
  onSelect?: (id: string) => void;
}

export function renderNetworkGraph(
  atlas: AtlasData,
  familyColor: Map<string, string>,
  centerId: string | null,
  onNavigate: (id: string) => void,
  opts: NetworkGraphOptions = {}
): SVGSVGElement {
  const width = opts.width ?? 760;
  const height = opts.height ?? 620;
  const maxPeek = opts.maxPeek ?? 12;
  const { nodes, links } = buildNeighbourhood(atlas, centerId, opts.maxPerGroup ?? 10);
  const familyIds = new Set(atlas.families);
  atlas.families.forEach((id, index) => {
    const node = nodes.find((n) => n.id === id);
    if (!node || node.kind === "center") return;
    const start = familyStart(index, atlas.families.length, width, height);
    node.x = start.x;
    node.y = start.y;
  });
  const center = nodes.find((n) => n.kind === "center");
  if (center) {
    center.x = width / 2;
    center.y = height / 2;
  }

  const svg = svgEl("svg", {
    class: "atlas-net",
    viewBox: `0 0 ${width} ${height}`,
    role: "img",
    "aria-label": centerId
      ? `${centerId}, its immediate neighbourhood and all ${atlas.families.length} over-genres`
      : `All ${atlas.families.length} over-genres. Click one to see its top-level genres.`,
  });

  const nodeR = (n: NetNode) =>
    n.kind === "center" ? 30 : n.kind === "family" ? 18 : Math.min(20, 8 + Math.log10(n.releases + 10) * 4);
  const nodeFill = (n: NetNode): string => {
    if (n.kind === "center") return "var(--series-1)";
    if (n.kind === "family") return familyColor.get(n.id) ?? "var(--series-other)";
    return "var(--surface-1)";
  };
  const nodeStroke = (n: NetNode): string => {
    if (n.kind === "family") return nodeFill(n);
    if (n.kind === "peek" && n.peekedFrom) return familyColor.get(n.peekedFrom) ?? "var(--text-secondary)";
    return "var(--text-secondary)";
  };
  const nodeFillOpacity = (n: NetNode) => (n.kind === "parent" || n.kind === "child" || n.kind === "peek" ? "1" : "0.88");
  const linkClass = (kind: NetLink["kind"]) => "atlas-net-link" + (kind === "family" ? " family" : kind === "peek" ? " peek" : "");

  // The open family > subgenre > ... path (see "open chain" below). Declared up here because
  // the centring force reads it when the simulation initialises.
  const openChain: string[] = [];

  const groupById = new Map<string, SVGGElement>();
  const linkElByKey = new Map<string, SVGLineElement>();

  const linkForce = forceLink<NetNode, NetLink & { source: NetNode; target: NetNode }>([] as any)
    .id((d: any) => d.id)
    .distance((l: any) => (l.kind === "family" ? 170 : l.kind === "peek" ? 78 : 95))
    .strength((l: any) => (l.kind === "peek" ? 0.6 : 0.7));

  // The family you opened (and the genres below it) become the hub: drawn firmly to
  // the middle so the other over-genres give way around it instead of being
  // shoved to one side. d3 re-reads this whenever the node set changes.
  const pull = (d: NetNode): number => {
    if (openChain.includes(d.id)) return PULL_OPEN;
    // While a chain is open the other over-genres orbit it rather than
    // crowding into it.
    return d.kind === "family" && openChain.length ? PULL_ORBIT : PULL[d.kind];
  };

  const simulation: Simulation<NetNode, undefined> = forceSimulation<NetNode>([])
    .force("link", linkForce as unknown as ForceLink<NetNode, any>)
    .force(
      "charge",
      forceManyBody<NetNode>().strength((d) =>
        d.kind === "center" ? -420 : d.kind === "family" ? -100 : d.kind === "peek" ? -230 : -260
      )
    )
    // Everything is drawn gently towards the middle of the window; the
    // selected genre most firmly, over-genres loosely, chain genres barely
    // (their links to the node they hang from already hold them).
    .force("x", forceX<NetNode>(width / 2).strength((d) => pull(d)))
    .force("y", forceY<NetNode>(height / 2).strength((d) => pull(d)))
    .force("center", forceCenter(width / 2, height / 2))
    // Over-genre labels sit under the node, so give them a wider berth.
    .force(
      "collide",
      forceCollide<NetNode>().radius((d) => nodeR(d) + (d.kind === "peek" ? 20 : d.kind === "family" ? 26 : 16))
    );

  // d3 stops the simulation by itself once it has cooled; this is only a
  // safety net (e.g. a pointer that never reports its release), re-armed on
  // every restart so it can't freeze a layout that is still settling.
  let stopTimer = 0;
  function scheduleStop(): void {
    window.clearTimeout(stopTimer);
    stopTimer = window.setTimeout(() => simulation.stop(), 12000);
  }
  function syncSimulation(): void {
    simulation.nodes(nodes);
    linkForce.links(links as any);
    simulation.alpha(0.85).restart();
    scheduleStop();
  }

  function tipRows(n: NetNode) {
    let kindLabel: string;
    if (n.kind === "center") kindLabel = familyIds.has(n.id) ? "this genre and over-genre (click to peek)" : "this genre";
    else if (familyIds.has(n.id)) kindLabel = "over-genre (click to peek)";
    else if (chainLevelOf(n.id) !== null) kindLabel = "genre in the open chain — click to play it and open its subgenres";
    else kindLabel = n.kind === "parent" ? "parent — click to recentre on it" : "child — click to recentre on it";
    return [{ label: n.id, value: kindLabel }];
  }

  function attachNodeHandlers(g: SVGGElement, n: NetNode): void {
    let moved = false;
    let dragging = false;
    g.addEventListener("pointerenter", (e) => showTooltip(e.clientX, e.clientY, tipRows(n)));
    g.addEventListener("pointermove", (e) => {
      if (!dragging) showTooltip(e.clientX, e.clientY, tipRows(n));
    });
    g.addEventListener("pointerleave", () => {
      if (!dragging) hideTooltip();
    });
    g.addEventListener("pointerdown", (e) => {
      dragging = true;
      moved = false;
      try {
        g.setPointerCapture(e.pointerId);
      } catch {
        /* not fatal -- see below */
      }
      simulation.alphaTarget(0.3).restart();
      n.fx = n.x;
      n.fy = n.y;
      hideTooltip();
    });
    g.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      moved = true;
      const p = clientToSvgPoint(svg, e.clientX, e.clientY);
      n.fx = p.x;
      n.fy = p.y;
    });
    const activate = () => {
      if (familyIds.has(n.id)) {
        toggleOpen(n.id);
      } else if (chainLevelOf(n.id) !== null) {
        // A genre hanging off the open chain -- whatever else it is on screen (a
        // subgenre made by the chain, or also a child/parent of the centre): play
        // it, close whatever its siblings had open, and open its own subgenres.
        if (opts.onSelect) opts.onSelect(n.id);
        else onNavigate(n.id);
        markSelected(n.id);
        toggleOpen(n.id);
      } else if (n.kind === "center") {
        return; // the genre already at the centre, with nothing open around it
      } else {
        // Leaving the chain: recentre on it, and let the old chain's subgenres go
        // rather than reappear around a genre they have nothing to do with.
        openChain.length = 0;
        opts.onChainChange?.([]);
        onNavigate(n.id);
      }
    };
    const endDrag = () => {
      if (!dragging) return;
      dragging = false;
      simulation.alphaTarget(0);
      scheduleStop();
      // Let go and the node rejoins the physics (it used to stay pinned where
      // dropped): neighbours keep pushing it, and it drifts back towards the
      // middle of the window.
      n.fx = null;
      n.fy = null;
      if (!moved) activate();
    };
    g.addEventListener("pointerup", endDrag);
    g.addEventListener("pointercancel", endDrag);
    g.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        activate();
      }
    });
  }

  function addNodeEl(n: NetNode): void {
    const g = svgEl("g", {
      class: "atlas-net-node" + (n.kind === "center" ? " center" : "") + (familyIds.has(n.id) ? " family" : ""),
      "data-id": n.id,
      tabindex: "0",
      role: "button",
      "aria-label": n.id,
      ...(familyIds.has(n.id) ? { "aria-pressed": "false" } : {}),
    });
    const circle = svgEl("circle", {
      r: String(nodeR(n)),
      fill: nodeFill(n),
      stroke: nodeStroke(n),
      "stroke-width": n.kind === "center" ? "3" : "1.5",
      "fill-opacity": nodeFillOpacity(n),
    });
    g.appendChild(circle);
    const label = svgEl(
      "text",
      {
        class: "atlas-net-label",
        "text-anchor": n.labelSide === "left" ? "start" : n.labelSide === "right" ? "end" : "middle",
        dx: n.labelSide === "left" ? String(nodeR(n) + 8) : n.labelSide === "right" ? String(-nodeR(n) - 8) : "0",
        dy: n.labelSide === "top" ? String(-nodeR(n) - 8) : n.labelSide === "left" || n.labelSide === "right" ? "4" : String(nodeR(n) + 14),
        "font-size": n.kind === "center" ? "13" : "11",
      },
      document.createTextNode(truncate(n.id, n.kind === "center" ? 24 : n.kind === "family" ? 14 : 18))
    );
    g.appendChild(label);
    if (n.x != null && n.y != null) g.setAttribute("transform", `translate(${n.x},${n.y})`);
    attachNodeHandlers(g, n);
    svg.appendChild(g);
    groupById.set(n.id, g);
  }

  function addLinkEl(l: NetLink): void {
    const el = svgEl("line", { class: linkClass(l.kind) });
    svg.insertBefore(el, svg.firstChild); // links stay behind nodes
    linkElByKey.set(linkKey(l.source as string, l.target as string), el);
  }

  for (const n of nodes) addNodeEl(n);
  for (const l of links) addLinkEl(l);
  syncSimulation();

  // ------------------------------------------------------- open chain -----
  // openChain[0] is a family; openChain[i] is a child of openChain[i-1].

  function childrenOf(id: string, level: number): string[] {
    if (level === 0) {
      // A family: its top-level genres. For cross-cutting families the only
      // "root" is the family itself, so fall back to its primary children.
      const roots = atlas.roots.get(id) ?? [];
      return roots.length === 1 && roots[0] === id ? atlas.primaryChildren.get(id) ?? [] : roots;
    }
    return atlas.children.get(id) ?? []; // primary + also, like Browse view
  }

  /** The level `id` sits at below the open chain (a child of openChain[i] is at level
   * i + 1), or null if it is not one of their subgenres. Worked out from the taxonomy,
   * not from how the node was created: a subgenre of the open chain can also be on
   * screen as a child or parent of the centre, and must behave the same either way.
   * The deepest match wins, so drilling on keeps the whole chain above it open. */
  function chainLevelOf(id: string): number | null {
    for (let i = openChain.length - 1; i >= 0; i--) {
      if (childrenOf(openChain[i], i).includes(id)) return i + 1;
    }
    return null;
  }

  /** Close the chain from `index` down: remove the subgenres each of those
   * open nodes added (the nodes themselves stay -- they are siblings). */
  function removeNodes(removed: Set<string>, alsoLinksFrom: Set<string> = new Set()): void {
    for (const id of removed) {
      groupById.get(id)?.remove();
      groupById.delete(id);
    }
    for (let i = links.length - 1; i >= 0; i--) {
      const l = links[i];
      const src = typeof l.source === "string" ? l.source : (l.source as unknown as NetNode).id;
      const tgt = typeof l.target === "string" ? l.target : (l.target as unknown as NetNode).id;
      if (removed.has(src) || removed.has(tgt) || (l.kind === "peek" && alsoLinksFrom.has(src))) {
        linkElByKey.get(linkKey(src, tgt))?.remove();
        linkElByKey.delete(linkKey(src, tgt));
        links.splice(i, 1);
      }
    }
    for (let i = nodes.length - 1; i >= 0; i--) {
      if (removed.has(nodes[i].id)) nodes.splice(i, 1);
    }
  }

  function collapseFrom(index: number): void {
    const closing = new Set(openChain.splice(index));
    if (closing.size === 0) return;
    // everything the closing genres opened, including centre-neighbourhood nodes they adopted
    const removed = new Set(nodes.filter((n) => n.peekedFrom && closing.has(n.peekedFrom)).map((n) => n.id));
    removeNodes(removed, closing);
  }

  /** The centre genre's own parents and children are what is shown until you start
   * opening things. From then on only the open chain is (an accordion: clicking a
   * genre closes everything except the path down to it), so the old neighbourhood
   * goes -- except nodes the chain has adopted, and the centre itself while it is
   * part of the chain. A centre that is also an over-genre stays, as a plain one. */
  function releaseNeighbourhood(): void {
    if (!centerId || openChain.length === 0) return;
    const centreOpen = openChain.includes(centerId);
    const centreKept = centreOpen || chainLevelOf(centerId) !== null;
    const stale = new Set<string>();
    if (!centreOpen) {
      for (const n of nodes) if ((n.kind === "child" || n.kind === "parent") && !n.peekedFrom) stale.add(n.id);
    }
    const centre = nodes.find((n) => n.kind === "center");
    if (centre && !centreKept) {
      if (familyIds.has(centerId)) {
        groupById.get(centre.id)?.remove(); // redrawn below as an ordinary over-genre
        centre.kind = "family";
        addNodeEl(centre);
      } else {
        stale.add(centre.id);
      }
    }
    removeNodes(stale);
  }

  function expand(id: string, level: number): void {
    const anchor = nodes.find((n) => n.id === id);
    const kids = childrenOf(id, level)
      .filter((cid) => cid !== id)
      .map((cid) => ({ id: cid, releases: atlas.nodesByName.get(cid)?.releases ?? 0 }))
      .sort((a, b) => b.releases - a.releases)
      .slice(0, maxPeek);
    for (const k of kids) {
      const existing = nodes.find((n) => n.id === k.id);
      if (!existing) {
        const n: NetNode = { id: k.id, kind: "peek", releases: k.releases, peekedFrom: id };
        n.x = (anchor?.x ?? width / 2) + (Math.random() - 0.5) * 20;
        n.y = (anchor?.y ?? height / 2) + (Math.random() - 0.5) * 20;
        nodes.push(n);
        addNodeEl(n);
      } else if ((existing.kind === "child" || existing.kind === "parent") && !existing.peekedFrom) {
        // already on screen as the centre's neighbour: the chain owns it from now, so
        // closing this genre closes it (it used to stay, which read as "not closing")
        existing.peekedFrom = id;
      }
      // Draw the edge even when the child is already on screen (the centre,
      // a parent, another family) so the chain reads as a connected path.
      if (!linkElByKey.has(linkKey(id, k.id))) {
        const l: NetLink = { source: id, target: k.id, kind: "peek" };
        links.push(l);
        addLinkEl(l);
      }
    }
    openChain.push(id);
  }

  function syncOpenState(): void {
    for (const [id, g] of groupById) {
      const open = openChain.includes(id);
      g.classList.toggle("open", open);
      if (g.hasAttribute("aria-pressed") || open) g.setAttribute("aria-pressed", String(open));
    }
  }

  /** Click on a family or a chain genre: open it (closing whatever sibling
   * branch was open at its level), or close it if it was the open one. */
  function toggleOpen(id: string): void {
    const node = nodes.find((n) => n.id === id);
    if (!node) return;
    const level = familyIds.has(id) ? 0 : chainLevelOf(id) ?? 0;
    const wasOpen = openChain[level] === id;
    collapseFrom(level);
    if (!wasOpen && childrenOf(id, level).length > 0) expand(id, level);
    releaseNeighbourhood();
    syncOpenState();
    syncSimulation();
    opts.onChainChange?.([...openChain]);
  }

  function markSelected(id: string): void {
    for (const [nid, g] of groupById) g.classList.toggle("selected", nid === id);
  }

  // Restore a chain from a previous render, stopping at the first link that
  // no longer holds (e.g. the genre was capped out of the visible children).
  for (const [level, id] of (opts.initialChain ?? []).entries()) {
    const node = nodes.find((n) => n.id === id);
    // A chain genre may now be on screen in another role (e.g. as a parent of
    // the new centre), so test the taxonomy, not how the node was created.
    const linked = level === 0 ? familyIds.has(id) : childrenOf(openChain[level - 1], level - 1).includes(id);
    if (!node || !linked || childrenOf(id, level).length === 0) break;
    expand(id, level);
  }
  syncOpenState();
  if (openChain.length) syncSimulation();

  simulation.on("tick", () => {
    for (const l of links) {
      const source = l.source as unknown as NetNode;
      const target = l.target as unknown as NetNode;
      const el = linkElByKey.get(linkKey(source.id, target.id));
      if (!el) continue;
      el.setAttribute("x1", String(source.x ?? 0));
      el.setAttribute("y1", String(source.y ?? 0));
      el.setAttribute("x2", String(target.x ?? 0));
      el.setAttribute("y2", String(target.y ?? 0));
    }
    for (const n of nodes) {
      // A hard edge for a soft system: nothing may float off the frame.
      if (n.fx == null && n.x != null) n.x = Math.max(EDGE_X, Math.min(width - EDGE_X, n.x));
      if (n.fy == null && n.y != null) n.y = Math.max(EDGE_TOP, Math.min(height - EDGE_BOTTOM, n.y));
      groupById.get(n.id)?.setAttribute("transform", `translate(${n.x ?? 0},${n.y ?? 0})`);
    }
  });

  return svg;
}
