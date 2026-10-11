// A dot histogram (a histogram built from units): one dot per item, stacked in its bin's column, so the
// silhouette reads as a histogram while every dot is still one named thing. Made for "how long is each
// genre's top track" (user, 2026-09-25: an OC candidate like the releases chart, but a different form).
// Within a column dots stack by `stack` first (the genre's level: top-level at the bottom), so the
// colours form bands and show whether the shape changes with level. The main axis is linear; bins past
// `tailFrom` are drawn after a break as wider, labelled columns, so a long tail stays visible without
// squeezing the body. Picking (nearest dot, arrow keys) is shared with the beeswarm via dots.ts.
import { svgEl } from "../util/dom";
import { attachDotPicking } from "./dots";

export interface DotHistItem {
  id: string;
  label: string;
  value: number;
  color: string;
  stack: number; // stacking order within a column, lowest first
  note?: string;
}

export interface DotHistOptions {
  /** Width of each main bin, in value units. */
  binWidth: number;
  /** The main axis runs 0..tailFrom; values beyond fall into `tail`. */
  tailFrom: number;
  /** Tail bins, [lo, hi) with a label under each; the last may have hi = Infinity. */
  tail: { lo: number; hi: number; label: string }[];
  /** Axis ticks on the main axis. */
  ticks: { value: number; label: string }[];
  axisTitle: string;
  across?: number; // dots side by side in one column
  valueFormat: (v: number) => string;
  median?: { value: number; label: string };
  /** An item to name permanently on the chart (the longest, usually). */
  callout?: { id: string; label: string };
  onPick?: (item: DotHistItem, mark: SVGElement) => void;
}

export function dotHistogram(items: DotHistItem[], opts: DotHistOptions): SVGSVGElement {
  const width = 900;
  const mL = 14;
  const mR = 14;
  const mTop = 40;
  const mBottom = 58;
  const across = opts.across ?? 3;
  const nMain = Math.ceil(opts.tailFrom / opts.binWidth);
  const gapCols = 2;
  const tailSpan = 3.5; // a tail column's slot, in main-column widths: room for its label
  const colW = (width - mL - mR) / (nMain + gapCols + opts.tail.length * tailSpan);
  const pitch = colW / across;
  const radius = pitch * 0.42;
  const tailX0 = mL + (nMain + gapCols) * colW;

  // column index per item: 0..nMain-1 main, nMain.. tail
  const colOf = (v: number) => {
    if (v < opts.tailFrom) return Math.floor(v / opts.binWidth);
    const t = opts.tail.findIndex((b) => v >= b.lo && v < b.hi);
    return nMain + (t < 0 ? opts.tail.length - 1 : t);
  };
  const colLeft = (c: number) => (c < nMain ? mL + c * colW : tailX0 + (c - nMain) * tailSpan * colW + ((tailSpan - 1) * colW) / 2);
  const columns = new Map<number, number[]>();
  items.forEach((d, i) => {
    const c = colOf(d.value);
    columns.set(c, [...(columns.get(c) ?? []), i]);
  });
  const maxRows = Math.max(...[...columns.values()].map((ix) => Math.ceil(ix.length / across)));
  const plotH = maxRows * pitch;
  const baseY = mTop + plotH + 6;
  const height = baseY + mBottom;

  const svg = svgEl("svg", {
    class: "chart swarm dothist",
    viewBox: `0 0 ${width} ${height}`,
    role: "img",
    "aria-label": `Dot histogram of ${items.length.toLocaleString("en-US")} items. Hover or use the arrow keys to name a dot.`,
  });
  const text = (s: string) => document.createTextNode(s);
  const xOf = (v: number) => mL + (v / opts.binWidth) * colW; // main axis only

  // ticks and gridlines on the main axis
  for (const t of opts.ticks) {
    svg.appendChild(svgEl("line", { class: "gridline", x1: xOf(t.value), x2: xOf(t.value), y1: mTop - 4, y2: baseY }));
    svg.appendChild(svgEl("text", { class: "axis-label", x: xOf(t.value), y: baseY + 20, "text-anchor": "middle", "font-size": 13 }, text(t.label)));
  }
  svg.appendChild(svgEl("line", { class: "baseline", x1: mL, x2: mL + nMain * colW, y1: baseY, y2: baseY }));
  // the break, then the tail's own labelled columns
  const bx = mL + (nMain + gapCols / 2) * colW;
  svg.appendChild(svgEl("path", { class: "dothist-break", d: `M${bx - 5} ${baseY + 5} L${bx - 1} ${baseY - 5} M${bx + 1} ${baseY + 5} L${bx + 5} ${baseY - 5}` }));
  opts.tail.forEach((b, t) => {
    const left = colLeft(nMain + t);
    svg.appendChild(svgEl("line", { class: "baseline", x1: left - 2, x2: left + colW + 2, y1: baseY, y2: baseY }));
    svg.appendChild(svgEl("text", { class: "axis-label", x: left + colW / 2, y: baseY + 20, "text-anchor": "middle", "font-size": 12 }, text(b.label)));
  });
  svg.appendChild(svgEl("text", { class: "axis-label", x: mL, y: baseY + 44, "font-size": 13 }, text(opts.axisTitle)));

  if (opts.median) {
    const mx = xOf(opts.median.value);
    svg.appendChild(svgEl("line", { class: "swarm-median", x1: mx, x2: mx, y1: mTop - 10, y2: baseY }));
    svg.appendChild(svgEl("text", { class: "swarm-median-label", x: mx + 7, y: mTop - 16, "font-size": 13 }, text(opts.median.label)));
  }

  const cx = new Array<number>(items.length);
  const cy = new Array<number>(items.length);
  for (const [c, ix] of columns) {
    ix.sort((a, b) => items[a].stack - items[b].stack || items[a].value - items[b].value || a - b);
    ix.forEach((i, k) => {
      cx[i] = colLeft(c) + ((k % across) + 0.5) * pitch;
      cy[i] = baseY - 1 - (Math.floor(k / across) + 0.5) * pitch;
    });
  }
  const dots = items.map((d, i) => {
    const dot = svgEl("circle", { class: "swarm-dot", cx: cx[i], cy: cy[i], r: radius, "data-id": d.id });
    dot.style.fill = d.color;
    svg.appendChild(dot);
    return dot;
  });

  const ci = opts.callout ? items.findIndex((d) => d.id === opts.callout!.id) : -1;
  if (ci >= 0) {
    // the label runs leftwards from the dot, so it must clear every dot under its whole width
    const fs = 13;
    const labelW = opts.callout!.label.length * fs * 0.56;
    const colTop = Math.min(...(columns.get(colOf(items[ci].value)) ?? [ci]).map((i) => cy[i])) - radius;
    const spanTop = Math.min(...cx.map((x, i) => (x >= cx[ci] - labelW && x <= cx[ci] + 4 ? cy[i] - radius : Infinity)));
    const labelY = Math.min(colTop - 30, spanTop - 12);
    svg.appendChild(svgEl("line", { class: "swarm-call-line", x1: cx[ci], x2: cx[ci], y1: colTop - 4, y2: labelY + 5 }));
    svg.appendChild(svgEl("text", { class: "swarm-call-label", x: cx[ci] + 4, y: labelY, "text-anchor": "end", "font-size": fs }, text(opts.callout!.label)));
  }

  attachDotPicking(svg, {
    items,
    cx,
    cy,
    dots,
    radius,
    order: items.map((_, i) => i).sort((a, b) => items[a].value - items[b].value || a - b),
    tipRows: (d) => [
      { value: d.label, label: "" },
      { value: opts.valueFormat(d.value), label: "" },
      ...(d.note ? [{ value: "", label: d.note }] : []),
    ],
    onPick: opts.onPick,
  });
  return svg;
}
