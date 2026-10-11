// "Orbit" view (user request 2026-09-24). All 26 top-level genres start in the
// middle of the window; click one and it moves to the centre while the others
// drift slowly round it (slow enough to read and click). The chosen family's
// WHOLE tree -- every subgenre, sub-subgenre and so on -- opens around it as a
// radial tree. Faint lines run from tree genres to the other top-level genres
// they also belong to; they are drawn only, and take no part in any layout.
//
// This is a separate view alongside Browse and Network (view.ts lets you pick),
// not a replacement. Nothing here is a force simulation: the tree is a static
// radial layout and the orbit is plain kinematics, so cost is one radial
// layout per family (the largest, Regional Music, is ~620 genres) plus ~26 node
// positions and ~26 paths per frame.
import { hierarchy, tree } from "d3-hierarchy";
import type { AtlasData } from "./data";
import { compareNames } from "./sort";
import { svgEl, showTooltip, hideTooltip } from "../util/dom";

// A wide canvas (user request 2026-09-24: "needs more space ... stretch across the
// whole page"). The view sits full-width with the player and track info below it.
const W = 1200;
const H = 800;
const CX = W / 2;
const CY = H / 2;
const R_TREE = 245; // outer radius of the tree at zoom 1
// The neighbours circle the WHOLE tree on two ellipses (alternating, so labels don't
// collide) -- wider than tall, to use the width. They live in graph space: they scale
// and pan with the tree, so zooming in leaves them behind.
const RINGS = [
  { a: 450, b: 315 },
  { a: 520, b: 355 }, // a + half a label must stay inside the 1200-wide canvas
];
const ORBIT_PERIOD_S = 260; // one full lap; ~11px/s on the outer ellipse
const IDLE_SPACING = 62; // sunflower spacing of the resting cluster
const TRANSITION_S = 0.9;
const FAMILY_R = 18;
const HUB_R = 24;
const MIN_K = 0.6;
const MAX_K = 9;
const FOCUS_K = 3; // zoom used when jumping to a search result
// Clicking a genre flies to it (user, 2026-10-10): centred, close enough to read, with its parent
// chain and its subgenres all on screen. The room reserved at the sides is for the labels, which
// run outwards from their dots.
const PICK_ZOOM_S = 0.85;
const PICK_MIN_K = 2;
const PICK_MAX_K = 7;
const PICK_PAD_X = 200;
const PICK_PAD_Y = 80;
const LABEL_PX = 13.5; // label size at zoom 1 (canvas units; the canvas is scaled to the page)
const LABEL_GROWTH = 0.35; // labels also grow with zoom, as k^0.35 (x1.5 at 9x), rather than staying fixed
const LABEL_CHAR_W = 0.56; // average glyph width / font size, to size a label without measuring it
const LABEL_LINE_H = 1.15; // label height / font size, for the overlap test

export interface OrbitZoom {
  k: number;
  tx: number;
  ty: number;
}
export const IDENTITY_ZOOM: OrbitZoom = { k: 1, tx: 0, ty: 0 };

export interface OrbitOptions {
  hub?: string | null;
  selectedId?: string | null;
  zoom?: OrbitZoom;
  /** Seconds of orbit already elapsed, so a rebuild (e.g. when a new clip starts) doesn't restart the lap. */
  time?: number;
  /** The order of siblings round the tree -- the atlas's sort setting; A-Z if omitted. */
  compare?: (a: string, b: string) => number;
  /** Centre and zoom in on this genre once, when the view is built (a search result). */
  focus?: string | null;
  /** The user picked (or dropped) a hub family. */
  onHubChange?: (family: string | null) => void;
  /** The user clicked a genre in the tree. */
  onSelect?: (id: string) => void;
  /** Do the other genres circle the centre? Off: they keep their places round it, without turning. */
  spin?: boolean;
  onZoomChange?: (zoom: OrbitZoom) => void;
}

export interface OrbitController {
  svg: SVGSVGElement;
  /** Start or stop the orbit turning (the genres stay arranged round the centre either way). */
  setSpin(on: boolean): void;
  /** Step the animation by `dt` seconds (the rAF loop calls this). */
  advance(dt: number): void;
  dispose(): void;
  hub(): string | null;
  elapsed(): number;
}

interface TreeDatum {
  id: string;
  releases: number;
  children?: TreeDatum[];
}

interface Fam {
  id: string;
  index: number;
  g: SVGGElement;
  circle: SVGCircleElement;
  label: SVGTextElement;
  x: number;
  y: number;
}

interface TNode {
  id: string;
  x: number;
  y: number;
  depth: number;
  angle: number;
  gap: number; // tangential room to the nearest sibling ring-mate, in tree px
  base: number; // dot radius in tree px at zoom 1
  releases: number;
  parent: string | null;
  g: SVGGElement;
  circle: SVGCircleElement;
  label: SVGTextElement;
  link: SVGLineElement | null;
  flip: boolean;
}

/** The family's whole primary tree: the family as root, then every genre
 * reachable through primary edges, each exactly once. */
function buildFamilyTree(atlas: AtlasData, family: string, compare: (a: string, b: string) => number): TreeDatum {
  const seen = new Set<string>([family]);
  const releasesOf = (id: string) => atlas.nodesByName.get(id)?.releases ?? 0;
  const make = (id: string): TreeDatum => {
    const node: TreeDatum = { id, releases: releasesOf(id) };
    const kids: TreeDatum[] = [];
    for (const kid of [...(atlas.primaryChildren.get(id) ?? [])].sort(compare)) {
      if (seen.has(kid)) continue;
      seen.add(kid);
      kids.push(make(kid));
    }
    if (kids.length) node.children = kids;
    return node;
  };
  const roots = atlas.roots.get(family) ?? [];
  // Cross-cutting families have themselves as their only "root"; then the
  // top-level genres are simply their primary children.
  const tops = roots.length === 1 && roots[0] === family ? atlas.primaryChildren.get(family) ?? [] : roots;
  const root: TreeDatum = { id: family, releases: releasesOf(family) };
  const kids: TreeDatum[] = [];
  for (const top of [...tops].sort(compare)) {
    if (seen.has(top)) continue;
    seen.add(top);
    kids.push(make(top));
  }
  if (kids.length) root.children = kids;
  return root;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const ease = (p: number) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);
const truncate = (label: string, max: number) => (label.length > max ? label.slice(0, max - 1) + "…" : label);

export function renderOrbitGraph(
  atlas: AtlasData,
  familyColor: Map<string, string>,
  opts: OrbitOptions = {}
): OrbitController {
  const families = atlas.families;
  const colorOf = (id: string) => familyColor.get(id) ?? "var(--series-other)";

  const svg = svgEl("svg", {
    class: "atlas-orbit",
    viewBox: `0 0 ${W} ${H}`,
    role: "group",
    "aria-label": "Top-level genres. Click one to centre it and open its whole tree.",
  });
  const bg = svgEl("rect", { class: "orbit-bg", x: 0, y: 0, width: W, height: H });
  const guides = svgEl("g", { class: "orbit-guides" });
  for (const r of RINGS) guides.appendChild(svgEl("ellipse", { cx: 0, cy: 0, rx: r.a, ry: r.b }));
  const crossG = svgEl("g", { class: "orbit-cross" });
  const selCrossG = svgEl("g", { class: "orbit-cross-sel" });
  const treeG = svgEl("g", { class: "orbit-tree" });
  const treeLinks = svgEl("g", { class: "orbit-tree-links" });
  const treeNodes = svgEl("g", { class: "orbit-tree-nodes" });
  treeG.append(treeLinks, treeNodes);
  const famG = svgEl("g", { class: "orbit-families" });
  svg.append(bg, guides, crossG, treeG, selCrossG, famG);

  // ------------------------------------------------------------ state ----
  let hub: string | null = null;
  let zoom: OrbitZoom = { ...(opts.zoom ?? IDENTITY_ZOOM) };
  let time = opts.time ?? 0;
  let spin = opts.spin ?? true;
  let selectedId: string | null = null;
  let disposed = false;
  let raf = 0;
  let trans: { p: number; from: Map<string, { x: number; y: number }> } | null = null;
  // the camera flight started by clicking a genre: log-zoom and the tree point under the view's centre
  let flight: { p: number; k0: number; k1: number; x0: number; y0: number; x1: number; y1: number } | null = null;
  const tnodes = new Map<string, TNode>();
  const kidsOf = new Map<string, TNode[]>(); // genre -> its subgenres in the drawn tree
  let labelOrder: TNode[] = []; // shallowest first, then most releases: who gets to keep a label
  const crossIds = new Map<string, string[]>(); // other family -> tree genres that also belong to it
  let selLinks: { other: string; el: SVGPathElement }[] = [];

  // -------------------------------------------------------- families ----
  const fams: Fam[] = families.map((id, index) => {
    const g = svgEl("g", { class: "orbit-family", "data-id": id, tabindex: "0", role: "button", "aria-label": id });
    const circle = svgEl("circle", { r: FAMILY_R, fill: colorOf(id), stroke: colorOf(id), "stroke-width": 1.5 });
    const label = svgEl(
      "text",
      { class: "orbit-flabel", "text-anchor": "middle", dy: FAMILY_R + 13 },
      document.createTextNode(truncate(id, 16))
    );
    g.append(circle, label);
    famG.appendChild(g);
    const fam: Fam = { id, index, g, circle, label, x: CX, y: CY };
    const activate = () => chooseHub(hub === id ? null : id);
    g.addEventListener("click", activate);
    g.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        activate();
      }
    });
    g.addEventListener("pointerenter", (e) =>
      showTooltip(e.clientX, e.clientY, [
        { label: id, value: hub === id ? "centred — click to release" : hub ? "click to centre it and open its tree" : "top-level genre — click to open its tree" },
      ])
    );
    g.addEventListener("pointermove", (e) =>
      showTooltip(e.clientX, e.clientY, [
        { label: id, value: hub === id ? "centred — click to release" : hub ? "click to centre it and open its tree" : "top-level genre — click to open its tree" },
      ])
    );
    g.addEventListener("pointerleave", hideTooltip);
    return fam;
  });

  const crossPaths = new Map<string, SVGPathElement>();
  for (const f of fams) {
    const path = svgEl("path", { class: "orbit-cross-path", stroke: colorOf(f.id), fill: "none" });
    crossG.appendChild(path);
    crossPaths.set(f.id, path);
  }

  // ---------------------------------------------------------- targets ----
  function target(f: Fam): { x: number; y: number } {
    if (hub == null) {
      const r = IDLE_SPACING * Math.sqrt(f.index + 0.5);
      const a = f.index * 2.399963; // golden angle: an even sunflower packing
      return { x: CX + r * Math.cos(a), y: CY + r * Math.sin(a) };
    }
    if (f.id === hub) return { x: CX + zoom.tx, y: CY + zoom.ty };
    // One fixed slot per family, so neighbours never shuffle when the hub changes.
    // Positions are in graph space (scaled by the zoom about the hub); the nodes
    // themselves stay one size.
    const a = (f.index / fams.length) * Math.PI * 2 - Math.PI / 2 + (Math.PI * 2 * time) / ORBIT_PERIOD_S;
    const ring = RINGS[f.index % RINGS.length];
    return {
      x: CX + zoom.tx + ring.a * Math.cos(a) * zoom.k,
      y: CY + zoom.ty + ring.b * Math.sin(a) * zoom.k,
    };
  }

  function styleFamilies(): void {
    for (const f of fams) {
      const isHub = f.id === hub;
      f.g.classList.toggle("hub", isHub);
      f.g.setAttribute("aria-pressed", String(isHub));
      f.circle.setAttribute("r", String(isHub ? HUB_R : FAMILY_R));
      f.label.setAttribute("dy", String((isHub ? HUB_R : FAMILY_R) + 13));
    }
    svg.classList.toggle("has-hub", hub != null);
  }

  // ------------------------------------------------------------- tree ----
  function clearTree(): void {
    treeLinks.replaceChildren();
    treeNodes.replaceChildren();
    tnodes.clear();
    kidsOf.clear();
    labelOrder = [];
    crossIds.clear();
    for (const p of crossPaths.values()) {
      p.setAttribute("d", "");
      p.style.strokeOpacity = "";
    }
    selCrossG.replaceChildren();
    selLinks = [];
  }

  function buildTree(family: string): void {
    clearTree();
    const root = hierarchy<TreeDatum>(buildFamilyTree(atlas, family, opts.compare ?? compareNames));
    const maxDepth = Math.max(1, root.height);
    const laid = tree<TreeDatum>()
      .size([Math.PI * 2, 1])
      .separation((a, b) => (a.parent === b.parent ? 1 : 1.5) / Math.max(1, a.depth))(root);
    const rOf = (depth: number) => R_TREE * Math.pow(depth / maxDepth, 0.75);

    // tangential room per node: the gap to its nearest neighbour on the same ring
    const byDepth = new Map<number, { angle: number; id: string }[]>();
    laid.each((d) => {
      const list = byDepth.get(d.depth) ?? [];
      list.push({ angle: d.x, id: d.data.id });
      byDepth.set(d.depth, list);
    });
    const gapOf = new Map<string, number>();
    for (const [depth, list] of byDepth) {
      list.sort((a, b) => a.angle - b.angle);
      list.forEach((item, i) => {
        if (list.length === 1) return gapOf.set(item.id, Infinity);
        const prev = list[(i - 1 + list.length) % list.length].angle;
        const next = list[(i + 1) % list.length].angle;
        const dPrev = (item.angle - prev + Math.PI * 2) % (Math.PI * 2);
        const dNext = (next - item.angle + Math.PI * 2) % (Math.PI * 2);
        gapOf.set(item.id, rOf(depth) * Math.min(dPrev || Math.PI * 2, dNext || Math.PI * 2));
      });
    }

    laid.each((d) => {
      const r = rOf(d.depth);
      const angle = d.x;
      const x = r * Math.cos(angle - Math.PI / 2);
      const y = r * Math.sin(angle - Math.PI / 2);
      const isRoot = d.depth === 0;
      const base = isRoot ? 0 : clamp(2 + Math.log10(d.data.releases + 10) * 0.9, 2.5, 5.5);
      const flip = Math.cos(angle - Math.PI / 2) < 0;
      let link: SVGLineElement | null = null;
      if (d.parent) {
        const pAngle = d.parent.x;
        const pr = rOf(d.parent.depth);
        link = svgEl("line", {
          class: "orbit-tlink",
          x1: pr * Math.cos(pAngle - Math.PI / 2),
          y1: pr * Math.sin(pAngle - Math.PI / 2),
          x2: x,
          y2: y,
          stroke: colorOf(family),
        });
        treeLinks.appendChild(link);
      }
      if (isRoot) return; // the hub itself is drawn as the family node
      const g = svgEl("g", { class: "orbit-tnode", "data-id": d.data.id, transform: `translate(${x},${y})` });
      const circle = svgEl("circle", { r: base, fill: colorOf(family) });
      const label = svgEl("text", { class: "orbit-tlabel", "text-anchor": flip ? "end" : "start" }, document.createTextNode(d.data.id));
      label.style.display = "none";
      g.append(circle, label);
      treeNodes.appendChild(g);
      const tn: TNode = {
        id: d.data.id, x, y, depth: d.depth, angle, gap: gapOf.get(d.data.id) ?? Infinity, base,
        releases: d.data.releases, parent: d.parent && d.parent.depth > 0 ? d.parent.data.id : null,
        g, circle, label, link, flip,
      };
      tnodes.set(tn.id, tn);
      if (tn.parent) kidsOf.set(tn.parent, [...(kidsOf.get(tn.parent) ?? []), tn]);
      g.addEventListener("pointerenter", (e) => tip(e, tn));
      g.addEventListener("pointermove", (e) => tip(e, tn));
      g.addEventListener("pointerleave", hideTooltip);
      // Only the outermost genres in the keyboard order would be unreadable noise;
      // the family nodes and first ring are reachable, deeper ones by pointer.
      if (d.depth === 1) {
        g.setAttribute("tabindex", "0");
        g.setAttribute("role", "button");
        g.setAttribute("aria-label", tn.id);
        g.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            pick(tn.id);
          }
        });
      }
    });

    // lines to the other top-level genres each genre also belongs to (drawn only)
    for (const tn of tnodes.values()) {
      for (const other of atlas.byName.get(tn.id)?.over_genres ?? []) {
        if (other === family || !crossPaths.has(other)) continue;
        const list = crossIds.get(other) ?? [];
        list.push(tn.id);
        crossIds.set(other, list);
      }
    }
    for (const [other, ids] of crossIds) {
      crossPaths.get(other)!.style.strokeOpacity = String(clamp(14 / ids.length, 0.05, 0.25));
    }
    labelOrder = [...tnodes.values()].sort((a, b) => a.depth - b.depth || b.releases - a.releases);
    applyZoom();
  }

  function tip(e: PointerEvent, tn: TNode): void {
    showTooltip(e.clientX, e.clientY, [
      { label: tn.id, value: `${tn.releases.toLocaleString("en-US")} releases · level ${tn.depth}` },
    ]);
  }

  // ------------------------------------------------------------- zoom ----
  /** Two oriented rectangles overlap? (separating-axis test.) */
  interface LabelBox { cx: number; cy: number; ux: number; uy: number; hl: number; hw: number }
  function boxesOverlap(a: LabelBox, b: LabelBox): boolean {
    const dx = b.cx - a.cx;
    const dy = b.cy - a.cy;
    for (const [ax, ay] of [[a.ux, a.uy], [-a.uy, a.ux], [b.ux, b.uy], [-b.uy, b.ux]]) {
      const ra = a.hl * Math.abs(a.ux * ax + a.uy * ay) + a.hw * Math.abs(-a.uy * ax + a.ux * ay);
      const rb = b.hl * Math.abs(b.ux * ax + b.uy * ay) + b.hw * Math.abs(-b.uy * ax + b.ux * ay);
      if (Math.abs(dx * ax + dy * ay) > ra + rb) return false;
    }
    return true;
  }

  /** Positions and sizes that depend on the zoom: the tree group transform, the orbit
   * guides, dot radii, label size, and WHICH labels are shown. Dots grow as sqrt(k) and
   * labels as k^0.35 -- slower than the tree itself, so zooming makes room and reveals
   * more labels rather than only magnifying. A label is shown only if its (rotated)
   * box overlaps no label that has already been given its place: the selected genre and
   * its ancestors first, then shallow before deep, then popular before obscure. */
  function applyZoom(): void {
    const at = `translate(${CX + zoom.tx},${CY + zoom.ty}) scale(${zoom.k})`;
    treeG.setAttribute("transform", at);
    guides.setAttribute("transform", at);
    const k = zoom.k;
    const fontPx = LABEL_PX * clamp(Math.pow(k, LABEL_GROWTH), 0.9, 1.6); // canvas units
    const fontTree = fontPx / k; // the same, inside the scaled tree group
    for (const tn of tnodes.values()) {
      tn.circle.setAttribute("r", String((tn.base / Math.sqrt(k)) * (tn.id === selectedId ? 1.7 : 1)));
    }

    const placed: LabelBox[] = [];
    const shown = new Set<string>();
    const consider = (tn: TNode): void => {
      const gapCanvas = (tn.base / Math.sqrt(k) + 3) * k; // node edge -> start of text
      const sx = CX + zoom.tx + tn.x * k;
      const sy = CY + zoom.ty + tn.y * k;
      const ux = Math.cos(tn.angle - Math.PI / 2);
      const uy = Math.sin(tn.angle - Math.PI / 2);
      const len = (tn.label.textContent?.length ?? 0) * fontPx * LABEL_CHAR_W;
      const box: LabelBox = {
        cx: sx + ux * (gapCanvas + len / 2),
        cy: sy + uy * (gapCanvas + len / 2),
        ux,
        uy,
        hl: len / 2 + 2,
        hw: (fontPx * LABEL_LINE_H) / 2,
      };
      if (tn.id !== selectedId && placed.some((b) => boxesOverlap(box, b))) return;
      placed.push(box);
      shown.add(tn.id);
    };
    // the selected genre and the path down to it keep their labels
    for (let cur = selectedId ? tnodes.get(selectedId) : undefined; cur; cur = cur.parent ? tnodes.get(cur.parent) : undefined) {
      consider(cur);
    }
    // ...then its subgenres, so the neighbourhood you flew to is readable
    for (const kid of selectedId ? kidsOf.get(selectedId) ?? [] : []) if (!shown.has(kid.id)) consider(kid);
    for (const tn of labelOrder) if (!shown.has(tn.id)) consider(tn);

    for (const tn of tnodes.values()) {
      const show = shown.has(tn.id);
      tn.label.style.display = show ? "" : "none";
      if (show) {
        const deg = (tn.angle * 180) / Math.PI - 90 + (tn.flip ? 180 : 0);
        const off = (tn.base / Math.sqrt(k) + 3) * (tn.flip ? -1 : 1);
        tn.label.setAttribute("font-size", String(fontTree));
        tn.label.setAttribute("x", String(off));
        tn.label.setAttribute("dy", String(fontTree * 0.35));
        tn.label.setAttribute("transform", `rotate(${deg})`);
      }
    }
  }

  function setZoom(next: OrbitZoom, notify = true): void {
    zoom = next;
    applyZoom();
    if (notify) opts.onZoomChange?.({ ...zoom });
  }

  /** Where a click on `tn` should leave the camera: it in the middle, and everything that explains
   * it -- its parent and grandparent, down to the hub -- plus its subgenres, all inside the view. */
  function flightTo(tn: TNode): void {
    const near: { x: number; y: number }[] = [];
    const up = tn.parent ? tnodes.get(tn.parent) : undefined;
    near.push(up ? { x: up.x, y: up.y } : { x: 0, y: 0 });
    const up2 = up?.parent ? tnodes.get(up.parent) : undefined;
    if (up && !up2) near.push({ x: 0, y: 0 });
    if (up2) near.push({ x: up2.x, y: up2.y });
    for (const kid of kidsOf.get(tn.id) ?? []) near.push({ x: kid.x, y: kid.y });
    const halfW = Math.max(1, ...near.map((p) => Math.abs(p.x - tn.x)));
    const halfH = Math.max(1, ...near.map((p) => Math.abs(p.y - tn.y)));
    const k1 = clamp(Math.min((W / 2 - PICK_PAD_X) / halfW, (H / 2 - PICK_PAD_Y) / halfH), PICK_MIN_K, PICK_MAX_K);
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setZoom({ k: k1, tx: -tn.x * k1, ty: -tn.y * k1 });
      return;
    }
    flight = { p: 0, k0: zoom.k, k1, x0: -zoom.tx / zoom.k, y0: -zoom.ty / zoom.k, x1: tn.x, y1: tn.y };
  }

  function onWheel(e: WheelEvent): void {
    if (hub == null) return;
    e.preventDefault();
    flight = null;
    const k = clamp(zoom.k * Math.exp(-e.deltaY * 0.0015), MIN_K, MAX_K);
    const p = toSvg(e.clientX, e.clientY);
    const ox = CX + zoom.tx;
    const oy = CY + zoom.ty;
    const ratio = k / zoom.k;
    // keep the point under the cursor fixed
    setZoom({ k, tx: p.x - (p.x - ox) * ratio - CX, ty: p.y - (p.y - oy) * ratio - CY });
  }
  svg.addEventListener("wheel", onWheel, { passive: false });

  function toSvg(cx: number, cy: number): { x: number; y: number } {
    const r = svg.getBoundingClientRect();
    return { x: ((cx - r.left) / r.width) * W, y: ((cy - r.top) / r.height) * H };
  }

  // drag to pan; a press that doesn't move is a click on a tree genre
  let press: { x: number; y: number; id: string | null; tx: number; ty: number; moved: boolean } | null = null;
  svg.addEventListener("pointerdown", (e) => {
    if (hub == null || (e.target as Element).closest(".orbit-family")) return;
    const node = (e.target as Element).closest(".orbit-tnode");
    press = { x: e.clientX, y: e.clientY, id: node?.getAttribute("data-id") ?? null, tx: zoom.tx, ty: zoom.ty, moved: false };
    try {
      svg.setPointerCapture(e.pointerId);
    } catch {
      /* not fatal: panning still works while the pointer stays over the view */
    }
  });
  svg.addEventListener("pointermove", (e) => {
    if (!press) return;
    const scale = W / svg.getBoundingClientRect().width;
    const dx = (e.clientX - press.x) * scale;
    const dy = (e.clientY - press.y) * scale;
    if (!press.moved && Math.hypot(dx, dy) < 4 * scale) return;
    press.moved = true;
    flight = null;
    hideTooltip();
    setZoom({ k: zoom.k, tx: press.tx + dx, ty: press.ty + dy });
  });
  const release = () => {
    const done = press;
    press = null;
    if (done && !done.moved && done.id) pick(done.id);
  };
  svg.addEventListener("pointerup", release);
  svg.addEventListener("pointercancel", () => {
    press = null;
  });

  // -------------------------------------------------------- selection ----
  function setSelected(id: string | null): void {
    selectedId = id;
    for (const tn of tnodes.values()) {
      tn.g.classList.remove("selected", "onpath");
      tn.link?.classList.remove("onpath");
    }
    let cur = id ? tnodes.get(id) : undefined;
    if (cur) cur.g.classList.add("selected");
    while (cur) {
      cur.g.classList.add("onpath");
      cur.link?.classList.add("onpath");
      cur = cur.parent ? tnodes.get(cur.parent) : undefined;
    }
    selCrossG.replaceChildren();
    selLinks = [];
    const chosen = id ? tnodes.get(id) : undefined;
    if (chosen && hub) {
      for (const other of atlas.byName.get(chosen.id)?.over_genres ?? []) {
        if (other === hub || !crossPaths.has(other)) continue;
        const el = svgEl("path", { class: "orbit-cross-sel-path", stroke: colorOf(other), fill: "none" });
        selCrossG.appendChild(el);
        selLinks.push({ other, el });
      }
    }
    applyZoom();
  }

  /** A click on a genre. One that is already open (the selected genre, or one on the path down to it) closes: it and everything
   * below it go, and the chain ends at its parent instead -- the top-level genre, when it was a second-level one (user, 2026-10-11:
   * "clicking a 2nd level genre should close everything but the top-level genre, etc."). The top-level genre itself closes the lot
   * (the hub, below). Any other genre just opens. */
  function pick(id: string): void {
    const tn = tnodes.get(id);
    if (tn?.g.classList.contains("onpath")) {
      const up = tn.parent ? tnodes.get(tn.parent) : undefined;
      if (up) openGenre(up.id);
      else openHub();
      return;
    }
    openGenre(id);
  }

  function openGenre(id: string): void {
    setSelected(id);
    const tn = tnodes.get(id);
    if (tn) flightTo(tn);
    opts.onSelect?.(id);
  }

  /** Nothing below the top-level genre is open: it alone is selected, and the camera goes back to the whole tree. */
  function openHub(): void {
    if (!hub) return;
    setSelected(null);
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) setZoom({ ...IDENTITY_ZOOM });
    else flight = { p: 0, k0: zoom.k, k1: IDENTITY_ZOOM.k, x0: -zoom.tx / zoom.k, y0: -zoom.ty / zoom.k, x1: 0, y1: 0 };
    opts.onSelect?.(hub);
  }

  // -------------------------------------------------------------- hub ----
  function chooseHub(next: string | null): void {
    setHub(next, true);
    opts.onHubChange?.(next);
  }

  function setHub(next: string | null, animate: boolean): void {
    if (animate) {
      const from = new Map<string, { x: number; y: number }>();
      for (const f of fams) from.set(f.id, { x: f.x, y: f.y });
      trans = { p: 0, from };
    }
    hub = next;
    selectedId = null;
    flight = null;
    if (next) {
      zoom = { ...IDENTITY_ZOOM };
      opts.onZoomChange?.({ ...zoom });
      buildTree(next);
    } else {
      clearTree();
    }
    styleFamilies();
  }

  // ----------------------------------------------------------- frames ----
  function crossD(other: string): string {
    const ids = crossIds.get(other);
    const f = fams.find((x) => x.id === other);
    if (!ids || !f || other === hub) return "";
    let d = "";
    const ox = CX + zoom.tx;
    const oy = CY + zoom.ty;
    for (const id of ids) {
      const tn = tnodes.get(id);
      if (!tn) continue;
      d += `M${(ox + tn.x * zoom.k).toFixed(1)} ${(oy + tn.y * zoom.k).toFixed(1)}L${f.x.toFixed(1)} ${f.y.toFixed(1)}`;
    }
    return d;
  }

  function advance(dt: number): void {
    if (spin) time += dt;
    if (flight) {
      flight.p = Math.min(1, flight.p + dt / PICK_ZOOM_S);
      const e = ease(flight.p);
      const k = Math.exp(Math.log(flight.k0) + (Math.log(flight.k1) - Math.log(flight.k0)) * e);
      const x = flight.x0 + (flight.x1 - flight.x0) * e;
      const y = flight.y0 + (flight.y1 - flight.y0) * e;
      if (flight.p >= 1) flight = null;
      setZoom({ k, tx: -x * k, ty: -y * k });
    }
    if (trans) {
      trans.p += dt / TRANSITION_S;
      if (trans.p >= 1) trans = null;
    }
    const e = trans ? ease(trans.p) : 1;
    for (const f of fams) {
      const t = target(f);
      const from = trans?.from.get(f.id);
      f.x = from ? from.x + (t.x - from.x) * e : t.x;
      f.y = from ? from.y + (t.y - from.y) * e : t.y;
      f.g.setAttribute("transform", `translate(${f.x.toFixed(2)},${f.y.toFixed(2)})`);
    }
    if (hub) for (const [other, path] of crossPaths) path.setAttribute("d", crossD(other));
    const chosen = selectedId ? tnodes.get(selectedId) : undefined;
    if (chosen) {
      const sx = CX + zoom.tx + chosen.x * zoom.k;
      const sy = CY + zoom.ty + chosen.y * zoom.k;
      for (const { other, el } of selLinks) {
        const f = fams.find((x) => x.id === other);
        if (f) el.setAttribute("d", `M${sx.toFixed(1)} ${sy.toFixed(1)}L${f.x.toFixed(1)} ${f.y.toFixed(1)}`);
      }
    }
  }

  function loop(now: number): void {
    if (disposed) return;
    if (!svg.isConnected) return dispose();
    advance(Math.min(0.05, (now - last) / 1000));
    last = now;
    raf = requestAnimationFrame(loop);
  }
  let last = performance.now();

  function dispose(): void {
    disposed = true;
    cancelAnimationFrame(raf);
    hideTooltip();
  }

  // ---------------------------------------------------------- start-up ----
  if (opts.hub && families.includes(opts.hub)) {
    hub = opts.hub;
    buildTree(hub);
    if (opts.selectedId) setSelected(opts.selectedId);
    const target = opts.focus ? tnodes.get(opts.focus) : undefined;
    if (target) {
      // put the genre in the middle of the view, close enough to read its neighbours
      const k = clamp(Math.max(zoom.k, FOCUS_K), MIN_K, MAX_K);
      zoom = { k, tx: -target.x * k, ty: -target.y * k };
      opts.onZoomChange?.({ ...zoom });
      applyZoom();
    }
  }
  styleFamilies();
  advance(0);
  raf = requestAnimationFrame(loop);

  return { svg, advance, dispose, hub: () => hub, elapsed: () => time, setSpin: (on) => (spin = on) };
}
