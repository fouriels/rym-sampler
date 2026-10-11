// A beeswarm: one dot per item on a log axis, dots stacked vertically only as far as needed not to
// touch. Built for "releases per genre", where a bar chart can show 20 genres but a swarm shows all
// 2,613 and how thin the long tail is. Picking (the nearest dot to the pointer, arrow keys along the
// dots) lives in dots.ts, shared with the track-length dot histogram.
// swarmLayout() is shared with the hero image (hero/main.ts), so the picture and the chart agree.
//
// update(filter) (user, 2026-10-10: "exclude top-level genres", with the dots visibly moving): the
// chart re-lays itself out for just the items the filter keeps -- the axis is re-fitted to them, the
// stacks re-packed -- and every dot, gridline, the median line and the callout glide to their new
// places; dots that drop out fade where they stand. The picture's height is fixed from the full
// layout (a subset only ever stretches the axis, which can only loosen the stacking), so nothing
// below the chart jumps.
import { svgEl } from "../util/dom";
import { commas } from "../util/format";
import { attachDotPicking } from "./dots";

/** The vertical offset of every value, in input order. `xOf` is the axis, `gap` the centre-to-centre distance. */
export function swarmLayout(values: number[], xOf: (v: number) => number, gap: number): number[] {
  const order = values.map((_, i) => i).sort((a, b) => values[a] - values[b] || a - b);
  const placed: { x: number; y: number }[] = [];
  const out = new Array<number>(values.length).fill(0);
  for (const i of order) {
    const gx = xOf(values[i]);
    const blocked = placed
      .filter((p) => Math.abs(p.x - gx) < gap)
      .map((p) => {
        const dy = Math.sqrt(Math.max(0, gap * gap - (gx - p.x) ** 2));
        return [p.y - dy, p.y + dy] as const;
      });
    const candidates = [0, ...blocked.flatMap((b) => [b[0], b[1]])].sort((a, b) => Math.abs(a) - Math.abs(b));
    const y = candidates.find((c) => blocked.every((b) => c <= b[0] + 1e-6 || c >= b[1] - 1e-6)) ?? 0;
    placed.push({ x: gx, y });
    out[i] = y;
  }
  return out;
}

export interface SwarmItem {
  id: string;
  label: string; // the name shown when the dot is hovered
  value: number;
  color: string; // a CSS colour, e.g. var(--level-2)
  note?: string; // a further line in the tooltip, e.g. the family and level
}

export interface SwarmOptions {
  /** What the values count, for the tooltip: "releases". */
  noun: string;
  /** A dot was clicked (or Enter was pressed on it); `mark` is the dot, for highlighting. */
  onPick?: (item: SwarmItem, mark: SVGElement) => void;
}

export type SwarmChart = SVGSVGElement & {
  /** Keep only the items the filter accepts, animating the change. */
  update(keep: (item: SwarmItem) => boolean): void;
};

const MOVE_MS = 800;
const ease = (p: number) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);

export function swarmChart(items: SwarmItem[], opts: SwarmOptions): SwarmChart {
  const width = 900;
  const mL = 16;
  const mR = 18;
  const mTop = 34;
  const mBottom = 40;
  const radius = 2.3;
  const n = items.length;
  const values = items.map((d) => d.value);

  interface Layout { lo: number; hi: number; median: number; offsets: number[]; biggest: number }
  const cache = new Map<string, Layout>();
  const xFor = (lo: number, hi: number) => (v: number) => mL + ((Math.log10(v) - lo) / (hi - lo)) * (width - mL - mR);
  function layoutFor(on: boolean[]): Layout {
    const key = on.map((b) => (b ? 1 : 0)).join("");
    const hit = cache.get(key);
    if (hit) return hit;
    const idx = on.flatMap((b, i) => (b ? [i] : []));
    const vs = idx.map((i) => values[i]);
    const sorted = [...vs].sort((a, b) => a - b);
    const lo = Math.log10(sorted[0] * 0.8);
    const hi = Math.log10(sorted[sorted.length - 1] * 1.25);
    const sub = swarmLayout(vs, xFor(lo, hi), radius * 2 + 0.7);
    const offsets = new Array<number>(n).fill(0);
    idx.forEach((i, j) => (offsets[i] = sub[j]));
    const biggest = idx.reduce((m, i) => (values[i] > values[m] ? i : m), idx[0]);
    const out = { lo, hi, median: sorted[Math.floor(sorted.length / 2)], offsets, biggest };
    cache.set(key, out);
    return out;
  }

  let on = new Array<boolean>(n).fill(true);
  const full = layoutFor(on);
  const reach = Math.max(...full.offsets.map(Math.abs)) + radius + 4;
  const midY = mTop + reach;
  const axisY = midY + reach + 4;
  const height = axisY + mBottom;

  const svg = svgEl("svg", {
    class: "chart swarm",
    viewBox: `0 0 ${width} ${height}`,
    role: "img",
    "aria-label": `Beeswarm of ${commas(n)} genres by ${opts.noun}. Hover or use the arrow keys to name a dot.`,
  }) as SwarmChart;

  // ----- axis: a tick per decade the full range covers; each fades in or out as the axis re-fits
  const kLo = Math.floor(full.lo);
  const kHi = Math.ceil(full.hi);
  const ticks: { v: number; line: SVGLineElement; label: SVGTextElement; x: number; o: number }[] = [];
  for (let k = kLo; k <= kHi; k++) {
    const v = 10 ** k;
    const label = v >= 1e6 ? `${v / 1e6}M` : v >= 1e3 ? `${v / 1e3}K` : String(v);
    const line = svgEl("line", { class: "gridline", y1: mTop - 6, y2: axisY });
    const text = svgEl("text", { class: "axis-label", y: axisY + 22, "text-anchor": "middle", "font-size": 13 }, document.createTextNode(label));
    svg.append(line, text);
    ticks.push({ v, line, label: text, x: 0, o: 0 });
  }
  svg.appendChild(svgEl("line", { class: "baseline", x1: mL, x2: width - mR, y1: axisY, y2: axisY }));

  const medianLine = svgEl("line", { class: "swarm-median", y1: mTop - 8, y2: axisY });
  const medianText = svgEl("text", { class: "swarm-median-label", y: mTop - 14, "font-size": 13 });
  svg.append(medianLine, medianText);

  // ----- dots: current values (drawn) and the values they are heading for
  const cx = new Array<number>(n).fill(0);
  const cy = new Array<number>(n).fill(0);
  const co = new Array<number>(n).fill(1);
  const dots = items.map((d, i) => {
    const dot = svgEl("circle", { class: "swarm-dot", r: radius, "data-id": d.id });
    dot.style.fill = d.color;
    svg.appendChild(dot);
    return dot;
  });

  const callLine = svgEl("line", { class: "swarm-call-line" });
  const callText = svgEl("text", { class: "swarm-call-label", "text-anchor": "end", "font-size": 14 });
  svg.append(callLine, callText);

  // ----- the layout the picture is heading for, and the animation toward it
  let target = { x: new Array<number>(n).fill(0), y: new Array<number>(n).fill(0), o: new Array<number>(n).fill(1), median: 0, medX: 0, tickX: [] as number[], tickO: [] as number[], biggest: 0 };
  let from = { x: cx.slice(), y: cy.slice(), o: co.slice(), medX: 0, tickX: [] as number[], tickO: [] as number[] };
  let medX = 0;
  let calledOut = -1;
  let raf = 0;
  let t0 = 0;

  function aim(): void {
    const lay = layoutFor(on);
    const x = xFor(lay.lo, lay.hi);
    target = {
      x: items.map((d, i) => (on[i] ? x(d.value) : cx[i])),
      y: items.map((_, i) => (on[i] ? midY + lay.offsets[i] : cy[i])),
      o: on.map((b) => (b ? 1 : 0)),
      median: lay.median,
      medX: x(lay.median),
      tickX: ticks.map((t) => x(t.v)),
      tickO: ticks.map((t) => (Math.log10(t.v) >= lay.lo && Math.log10(t.v) <= lay.hi ? 1 : 0)),
      biggest: lay.biggest,
    };
  }

  function draw(p: number): void {
    const e = ease(p);
    for (let i = 0; i < n; i++) {
      cx[i] = from.x[i] + (target.x[i] - from.x[i]) * e;
      cy[i] = from.y[i] + (target.y[i] - from.y[i]) * e;
      co[i] = from.o[i] + (target.o[i] - from.o[i]) * e;
      const dot = dots[i];
      dot.setAttribute("cx", cx[i].toFixed(2));
      dot.setAttribute("cy", cy[i].toFixed(2));
      dot.setAttribute("opacity", co[i].toFixed(2));
    }
    ticks.forEach((t, j) => {
      t.x = from.tickX[j] + (target.tickX[j] - from.tickX[j]) * e;
      t.o = from.tickO[j] + (target.tickO[j] - from.tickO[j]) * e;
      t.line.setAttribute("x1", t.x.toFixed(2));
      t.line.setAttribute("x2", t.x.toFixed(2));
      t.label.setAttribute("x", t.x.toFixed(2));
      t.line.setAttribute("opacity", t.o.toFixed(2));
      t.label.setAttribute("opacity", t.o.toFixed(2));
    });
    medX = from.medX + (target.medX - from.medX) * e;
    medianLine.setAttribute("x1", medX.toFixed(2));
    medianLine.setAttribute("x2", medX.toFixed(2));
    medianText.setAttribute("x", (medX + 7).toFixed(2));
    // the callout follows the biggest dot that is showing
    const b = target.biggest;
    if (b !== calledOut) {
      calledOut = b;
      callText.textContent = `${items[b].label} · ${commas(items[b].value)}`;
    }
    const top = cy[b] - 8;
    callLine.setAttribute("x1", cx[b].toFixed(2));
    callLine.setAttribute("x2", cx[b].toFixed(2));
    callLine.setAttribute("y1", top.toFixed(2));
    callLine.setAttribute("y2", (top - 26).toFixed(2));
    callText.setAttribute("x", (cx[b] + 4).toFixed(2));
    callText.setAttribute("y", (top - 34).toFixed(2));
  }

  function snapshot() {
    return { x: cx.slice(), y: cy.slice(), o: co.slice(), medX, tickX: ticks.map((t) => t.x), tickO: ticks.map((t) => t.o) };
  }

  function go(animated: boolean): void {
    cancelAnimationFrame(raf);
    from = snapshot();
    aim();
    medianText.textContent = `Median genre: ${commas(target.median)}`;
    if (!animated || matchMedia("(prefers-reduced-motion: reduce)").matches) return draw(1);
    t0 = performance.now();
    const step = (now: number) => {
      const p = Math.min(1, (now - t0) / MOVE_MS);
      draw(p);
      if (p < 1 && svg.isConnected) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
  }

  // first picture: everything in place, no animation
  from = { x: cx.slice(), y: cy.slice(), o: co.slice(), medX: 0, tickX: ticks.map(() => 0), tickO: ticks.map(() => 0) };
  aim();
  medianText.textContent = `Median genre: ${commas(target.median)}`;
  for (let i = 0; i < n; i++) {
    cx[i] = target.x[i];
    cy[i] = target.y[i];
  }
  from = { x: cx.slice(), y: cy.slice(), o: co.slice(), medX: target.medX, tickX: target.tickX.slice(), tickO: target.tickO.slice() };
  draw(1);

  const picking = attachDotPicking(svg, {
    items,
    cx,
    cy,
    dots,
    radius,
    isOn: (i) => on[i],
    order: items.map((_, i) => i).sort((a, b) => values[a] - values[b] || a - b),
    tipRows: (d) => [
      { value: d.label, label: "" },
      { value: commas(d.value), label: opts.noun },
      ...(d.note ? [{ value: "", label: d.note }] : []),
    ],
    onPick: opts.onPick,
  });

  svg.update = (keep) => {
    const next = items.map((d) => keep(d));
    if (!next.some(Boolean)) return;
    if (next.every((b, i) => b === on[i])) return;
    on = next;
    picking.clear(); // a tooltip must not name a dot that has just gone
    go(true);
  };
  return svg;
}
