// An SVG vertical column chart for ordered categorical data (decades, tree
// depth, histogram buckets). Single hue, hairline gridlines/baseline, value
// on the cap only for the max and any highlighted column (labelling every
// column is the "number on every point" anti-pattern), full readout on hover.
import { svgEl, showTooltip, hideTooltip } from "../util/dom";
import { makeClickable } from "./drill";

export interface ColumnItem {
  label: string;
  id?: string; // what the column stands for, when that is not its label
  value: number;
  highlight?: boolean; // e.g. "Unknown" -- rendered in the muted/other tone
  tooltipLabel?: string;
}

export interface ColumnOptions {
  height?: number;
  valueFormat?: (v: number) => string;
  color?: string;
  yTickCount?: number;
  labelEvery?: number; // show every Nth x label when there are many columns
  /** A column was clicked (or activated from the keyboard); `mark` is the bar, for highlighting. */
  onPick?: (item: ColumnItem, mark: SVGElement) => void;
}

export function columnChart(data: ColumnItem[], opts: ColumnOptions = {}): SVGSVGElement {
  const width = 900;
  const height = opts.height ?? 300;
  const marginLeft = 52;
  const marginBottom = 42;
  const marginTop = 14;
  const marginRight = 8;
  const fmt = opts.valueFormat ?? ((v: number) => v.toLocaleString("en-US"));
  const color = opts.color ?? "var(--series-1)";

  const plotW = width - marginLeft - marginRight;
  const plotH = height - marginTop - marginBottom;
  const max = Math.max(1, ...data.map((d) => d.value));
  const niceMax = niceCeil(max);
  const yTicks = buildTicks(niceMax, opts.yTickCount ?? 4);

  const svg = svgEl("svg", {
    class: "chart",
    viewBox: `0 0 ${width} ${height}`,
    role: "img",
    "aria-label": "column chart",
  });

  // gridlines + y ticks
  for (const t of yTicks) {
    const y = marginTop + plotH - (t / niceMax) * plotH;
    svg.appendChild(svgEl("line", { class: "gridline", x1: marginLeft, x2: width - marginRight, y1: y, y2: y }));
    svg.appendChild(
      svgEl(
        "text",
        { class: "axis-label", x: marginLeft - 8, y: y + 4, "text-anchor": "end", "font-size": "13" },
        text(fmtTick(t))
      )
    );
  }

  const bandW = plotW / data.length;
  const barW = Math.min(28, bandW * 0.62);
  const labelEvery = opts.labelEvery ?? (data.length > 24 ? Math.ceil(data.length / 16) : 1);

  data.forEach((d, i) => {
    const x = marginLeft + i * bandW + (bandW - barW) / 2;
    const h = (d.value / niceMax) * plotH;
    const y = marginTop + plotH - h;
    const rect = svgEl("rect", {
      class: "cell",
      x,
      y,
      width: barW,
      height: Math.max(0.5, h),
      rx: 4,
      fill: d.highlight ? "var(--series-other)" : color,
      "data-i": i,
    });
    rect.style.cursor = "pointer";
    if (opts.onPick) makeClickable(rect, () => opts.onPick!(d, rect));
    rect.addEventListener("pointerenter", (e) => tip(e, d));
    rect.addEventListener("pointermove", (e) => tip(e, d));
    rect.addEventListener("pointerleave", hideTooltip);
    rect.tabIndex = 0;
    rect.addEventListener("focus", () => {
      const r = rect.getBoundingClientRect();
      showTooltip(r.left, r.top, [{ label: d.tooltipLabel ?? d.label, value: fmt(d.value) }]);
    });
    rect.addEventListener("blur", hideTooltip);
    svg.appendChild(rect);

    if (d.value === max) {
      svg.appendChild(
        svgEl(
          "text",
          { class: "value-label", x: x + barW / 2, y: y - 8, "text-anchor": "middle", "font-size": "13" },
          text(fmt(d.value))
        )
      );
    }

    if (i % labelEvery === 0) {
      svg.appendChild(
        svgEl(
          "text",
          {
            class: "axis-label",
            x: x + barW / 2,
            y: height - marginBottom + 20,
            "text-anchor": "middle",
            "font-size": "13",
          },
          text(d.label)
        )
      );
    }
  });

  svg.appendChild(
    svgEl("line", {
      class: "baseline",
      x1: marginLeft,
      x2: width - marginRight,
      y1: marginTop + plotH,
      y2: marginTop + plotH,
    })
  );

  function tip(e: PointerEvent, d: ColumnItem) {
    showTooltip(e.clientX, e.clientY, [{ label: d.tooltipLabel ?? d.label, value: fmt(d.value) }]);
  }

  return svg;
}

function text(value: string) {
  return document.createTextNode(value);
}

function niceCeil(max: number): number {
  const magnitude = Math.pow(10, Math.floor(Math.log10(max || 1)));
  const norm = max / magnitude;
  const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  return step * magnitude;
}

function buildTicks(niceMax: number, count: number): number[] {
  const out: number[] = [];
  for (let i = 0; i <= count; i++) out.push(Math.round((niceMax * i) / count));
  return out;
}

function fmtTick(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}K`;
  return String(n);
}
