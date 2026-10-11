// Sequential single-hue grid heatmap -- the textbook form for "compare
// magnitude across a grid" (family x decade). Deliberately NOT categorical:
// rows are already labeled by family name in text, so no family-color
// identity work is needed here, which sidesteps the 7-8-hue cap entirely.
import { svgEl, showTooltip, hideTooltip } from "../util/dom";
import { makeClickable } from "./drill";

export interface HeatmapOptions {
  cellHeight?: number;
  valueFormat?: (v: number) => string;
  colLabel?: (c: string) => string;
  /** Start normalised: each row's colours are relative to that row's own busiest column (default false). */
  normalise?: boolean;
  /** A cell (row + col), a row label (col null) or a column label (row null) was clicked. */
  onPick?: (pick: { row: string | null; col: string | null }, mark: SVGElement) => void;
}

export const SEQ_STEPS = ["--seq-100", "--seq-200", "--seq-300", "--seq-400", "--seq-500", "--seq-600", "--seq-700"];

export type Heatmap = SVGSVGElement & {
  /** Colour every row against its own busiest column (true), or every cell against the busiest cell anywhere (false). */
  setNormalise(on: boolean): void;
};

export function heatmap(
  rows: string[],
  cols: string[],
  matrix: Record<string, Record<string, number>>,
  opts: HeatmapOptions = {}
): Heatmap {
  const width = 900;
  const marginLeft = 236; // room for the longest family name ("Musical Theatre and Entertainment")
  const marginTop = 8;
  const marginRight = 8;
  const cellH = opts.cellHeight ?? 26;
  const colLabelH = 32;
  const height = marginTop + colLabelH + rows.length * (cellH + 2) + 10;
  const fmt = opts.valueFormat ?? ((v: number) => v.toLocaleString("en-US"));
  const colLabel = opts.colLabel ?? ((c: string) => `${c}s`);

  const plotW = width - marginLeft - marginRight;
  const cellW = plotW / cols.length;

  let max = 1;
  for (const r of rows) for (const c of cols) max = Math.max(max, matrix[r]?.[c] ?? 0);

  const svg = svgEl("svg", { class: "chart", viewBox: `0 0 ${width} ${height}`, role: "img", "aria-label": "heatmap" }) as Heatmap;
  let normalised = opts.normalise ?? false;
  const rowMax = new Map(rows.map((r) => [r, Math.max(1, ...cols.map((c) => matrix[r]?.[c] ?? 0))]));
  const rowTotal = new Map(rows.map((r) => [r, Math.max(1, cols.reduce((s, c) => s + (matrix[r]?.[c] ?? 0), 0))]));
  const stepFor = (v: number, r: string): string | null => {
    const frac = v / (normalised ? rowMax.get(r)! : max);
    return frac <= 0 ? null : SEQ_STEPS[Math.min(SEQ_STEPS.length - 1, Math.floor(frac * (SEQ_STEPS.length - 1) + 0.6))];
  };
  const paints: (() => void)[] = [];

  cols.forEach((c, ci) => {
    const label = svgEl(
      "text",
      {
        class: "axis-label",
        x: marginLeft + ci * cellW + cellW / 2,
        y: marginTop + colLabelH - 10,
        "text-anchor": "middle",
        "font-size": "13",
      },
      document.createTextNode(colLabel(c))
    );
    if (opts.onPick) makeClickable(label, () => opts.onPick!({ row: null, col: c }, label));
    svg.appendChild(label);
  });

  rows.forEach((r, ri) => {
    const y = marginTop + colLabelH + ri * (cellH + 2);
    const rowLabel = svgEl(
      "text",
      { class: "axis-label", x: marginLeft - 10, y: y + cellH / 2 + 4, "text-anchor": "end", "font-size": "13" },
      document.createTextNode(r)
    );
    if (opts.onPick) makeClickable(rowLabel, () => opts.onPick!({ row: r, col: null }, rowLabel));
    svg.appendChild(rowLabel);
    cols.forEach((c, ci) => {
      const v = matrix[r]?.[c] ?? 0;
      const x = marginLeft + ci * cellW;
      const step = stepFor(v, r);
      const rect = svgEl("rect", {
        class: "cell",
        x,
        y,
        width: cellW - 2,
        height: cellH,
        rx: 3,
        fill: step ? `var(${step})` : "var(--gridline)",
      });
      rect.style.cursor = "pointer";
      if (opts.onPick) makeClickable(rect, () => opts.onPick!({ row: r, col: c }, rect));
      const tipRows = () => [
        { label: `${r} · ${colLabel(c)}`, value: fmt(v) },
        ...(normalised && v > 0 ? [{ label: `of ${r}`, value: `${Math.round((100 * v) / rowTotal.get(r)!)}%` }] : []),
      ];
      paints.push(() => rect.setAttribute("fill", stepFor(v, r) ? `var(${stepFor(v, r)})` : "var(--gridline)"));
      rect.addEventListener("pointerenter", (e) => showTooltip(e.clientX, e.clientY, tipRows()));
      rect.addEventListener("pointermove", (e) => showTooltip(e.clientX, e.clientY, tipRows()));
      rect.addEventListener("pointerleave", hideTooltip);
      rect.tabIndex = 0;
      rect.addEventListener("focus", () => {
        const b = rect.getBoundingClientRect();
        showTooltip(b.left, b.top, tipRows());
      });
      rect.addEventListener("blur", hideTooltip);
      svg.appendChild(rect);
    });
  });

  svg.setNormalise = (on) => {
    normalised = on;
    for (const paint of paints) paint(); // the cells' fill transition (design.css) makes this a fade
  };
  return svg;
}
