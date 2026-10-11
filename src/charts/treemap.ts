// A squarified treemap (Bruls/Huizing/van Wijk) for "releases by family".
// Categorical color is used here -- and ONLY here on the dashboard -- capped
// at the top 7 families (the documented 8-slot palette minus one, since the
// all-pairs risk of a packed 2D layout is higher than a simple bar's adjacent
// pairs); every smaller family still gets its own labeled rectangle, just in
// the neutral --series-other tone. Every rectangle carries a direct text
// label (name + share), so identity never depends on hue alone even for the
// unlabeled-by-color "Other" tail.
import { svgEl, showTooltip, hideTooltip } from "../util/dom";
import { makeClickable } from "./drill";

export interface TreemapItem {
  label: string;
  value: number;
  color: string; // resolved CSS value, e.g. "var(--series-1)" or "var(--series-other)"
}

interface Rect { x: number; y: number; w: number; h: number }

function squarify(items: TreemapItem[], rect: Rect): (Rect & { item: TreemapItem })[] {
  const total = items.reduce((s, d) => s + d.value, 0) || 1;
  const scale = (rect.w * rect.h) / total;
  const out: (Rect & { item: TreemapItem })[] = [];

  function worstRatio(row: number[], length: number): number {
    const sum = row.reduce((a, b) => a + b, 0);
    const max = Math.max(...row);
    const min = Math.min(...row);
    return Math.max((length * length * max) / (sum * sum), (sum * sum) / (length * length * min));
  }

  function layoutRow(row: TreemapItem[], r: Rect, vertical: boolean): Rect {
    const rowSum = row.reduce((s, d) => s + d.value * scale, 0);
    const length = vertical ? r.h : r.w;
    const thickness = length > 0 ? rowSum / length : 0;
    let offset = 0;
    for (const it of row) {
      const size = (it.value * scale) / (thickness || 1);
      if (vertical) out.push({ x: r.x, y: r.y + offset, w: thickness, h: size, item: it });
      else out.push({ x: r.x + offset, y: r.y, w: size, h: thickness, item: it });
      offset += size;
    }
    return vertical
      ? { x: r.x + thickness, y: r.y, w: r.w - thickness, h: r.h }
      : { x: r.x, y: r.y + thickness, w: r.w, h: r.h - thickness };
  }

  let remaining = [...items].sort((a, b) => b.value - a.value);
  let area = rect;
  while (remaining.length) {
    const vertical = area.w >= area.h;
    const length = vertical ? area.h : area.w;
    let row: TreemapItem[] = [remaining[0]];
    let rest = remaining.slice(1);
    let rowSizes = row.map((d) => d.value * scale);
    while (rest.length) {
      const nextSizes = [...rowSizes, rest[0].value * scale];
      if (worstRatio(nextSizes, length) > worstRatio(rowSizes, length) && rowSizes.length > 0) break;
      row.push(rest[0]);
      rowSizes = nextSizes;
      rest = rest.slice(1);
    }
    area = layoutRow(row, area, vertical);
    remaining = rest;
  }
  return out;
}

export function treemap(
  items: TreemapItem[],
  opts: {
    height?: number;
    valueFormat?: (v: number) => string;
    /** Tooltip wording for the share line: "share of releases". */
    shareLabel?: string;
    /** Family colour mixed toward the surface, ink labels scaled to the cell, the value under the name. */
    soft?: boolean;
    /** A rectangle was clicked (or activated from the keyboard). */
    onPick?: (item: TreemapItem, mark: SVGElement) => void;
  } = {}
): SVGSVGElement {
  const width = 900;
  const height = opts.height ?? 320;
  const fmt = opts.valueFormat ?? ((v: number) => v.toLocaleString("en-US"));
  const total = items.reduce((s, d) => s + d.value, 0);
  const cells = squarify(items, { x: 0, y: 0, w: width, h: height });

  const svg = svgEl("svg", { class: opts.soft ? "chart treemap-soft" : "chart", viewBox: `0 0 ${width} ${height}`, role: "img", "aria-label": "treemap" });

  for (const cell of cells) {
    const gap = 2;
    const x = cell.x + gap / 2;
    const y = cell.y + gap / 2;
    const w = Math.max(0, cell.w - gap);
    const h = Math.max(0, cell.h - gap);
    // one group per cell, so hovering it can restore both its colour and its label's (sparing-colour mode)
    const cellG = svgEl("g", { class: "treemap-cell" });
    svg.appendChild(cellG);
    const rect = svgEl("rect", { x, y, width: w, height: h, rx: 3, fill: cell.item.color });
    if (opts.soft) rect.style.setProperty("--c", cell.item.color);
    rect.style.cursor = "pointer";
    if (opts.onPick) makeClickable(rect, () => opts.onPick!(cell.item, rect));
    const share = (100 * cell.item.value) / total;
    const tipRows = () => [
      { label: cell.item.label, value: fmt(cell.item.value) },
      { label: opts.shareLabel ?? "share of releases", value: `${share.toFixed(1)}%` },
    ];
    rect.addEventListener("pointerenter", (e) => showTooltip(e.clientX, e.clientY, tipRows()));
    rect.addEventListener("pointermove", (e) => showTooltip(e.clientX, e.clientY, tipRows()));
    rect.addEventListener("pointerleave", hideTooltip);
    rect.tabIndex = 0;
    rect.addEventListener("focus", () => {
      const b = rect.getBoundingClientRect();
      showTooltip(b.left, b.top, tipRows());
    });
    rect.addEventListener("blur", hideTooltip);
    cellG.appendChild(rect);

    if (opts.soft) {
      softLabel(cellG, x, y, w, h, cell.item.label, `${fmt(cell.item.value)} · ${share.toFixed(share < 1 ? 1 : 0)}%`);
      continue;
    }
    // Direct label only when it fits -- never overflow a small cell (anti-pattern).
    const canFitName = w > 70 && h > 28;
    const canFitShare = w > 70 && h > 44;
    if (canFitName) {
      cellG.appendChild(
        svgEl(
          "text",
          { class: "treemap-label", x: x + 8, y: y + 18, "font-size": "12", "font-weight": "600", "pointer-events": "none" },
          document.createTextNode(truncate(cell.item.label, w))
        )
      );
      if (canFitShare) {
        cellG.appendChild(
          svgEl(
            "text",
            { class: "treemap-share", x: x + 8, y: y + 34, "font-size": "11", "pointer-events": "none" },
            document.createTextNode(`${share.toFixed(1)}%`)
          )
        );
      }
    }
  }

  return svg;
}

/** The soft style's label: the name sized to the cell (12-24), the value under it when there is room. */
function softLabel(g: SVGGElement, x: number, y: number, w: number, h: number, name: string, value: string): void {
  const fs = Math.max(12, Math.min(24, Math.sqrt(w * h) / 9));
  if (w < 46 || h < fs + 12) return; // the tooltip and the table carry it
  const pad = Math.max(7, fs * 0.45);
  const fitted = truncate(name, w - pad, fs);
  g.appendChild(svgEl("text", { class: "treemap-label", x: x + pad, y: y + pad + fs * 0.82, "font-size": fs.toFixed(1), "font-weight": "650", "pointer-events": "none" }, document.createTextNode(fitted)));
  const vs = Math.max(11, fs * 0.62);
  if (h > pad + fs + vs + 10 && w > 64) {
    g.appendChild(svgEl("text", { class: "treemap-share", x: x + pad, y: y + pad + fs + vs * 1.05, "font-size": vs.toFixed(1), "pointer-events": "none" }, document.createTextNode(value)));
  }
}

function truncate(s: string, boxW: number, fontSize = 12): string {
  const maxChars = Math.floor(boxW / (fontSize * 0.6));
  return s.length > maxChars ? s.slice(0, Math.max(1, maxChars - 1)) + "…" : s;
}
