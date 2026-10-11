// A ranked horizontal bar list, built as HTML rather than SVG so long labels
// (genre/artist/script names) truncate with a native ellipsis + title tooltip
// instead of fighting SVG text measurement. Mark spec: <=24px bar, 4px rounded
// end, single categorical hue (nominal data -> one series, no legend needed),
// value label at the tip when it fits, else the tooltip carries it.
import { el, showTooltip, hideTooltip } from "../util/dom";
import { makeClickable } from "./drill";

export interface BarListItem {
  label: string;
  id?: string; // what the row stands for, when that is not its label (a country code, a raw key)
  value: number;
  tooltip?: string; // extra tooltip line, e.g. "3 genres"
  highlight?: boolean; // e.g. the "Unknown" / "Other" row
  color?: string; // this row's own colour, overriding the list's (e.g. the genre's level)
}

export interface BarListOptions {
  valueFormat?: (v: number) => string;
  scale?: "linear" | "log";
  color?: string; // CSS value, defaults to var(--series-1)
  barHeight?: number;
  unit?: string; // appended to the tooltip value row's label
  /** A row was clicked (or activated from the keyboard); `row` is the element, for highlighting. */
  onPick?: (item: BarListItem, row: HTMLElement) => void;
}

export function barList(data: BarListItem[], opts: BarListOptions = {}): HTMLElement {
  const fmt = opts.valueFormat ?? ((v: number) => v.toLocaleString("en-US"));
  const barHeight = opts.barHeight ?? 18;
  const color = opts.color ?? "var(--series-1)";
  const useLog = opts.scale === "log";
  const max = Math.max(1, ...data.map((d) => d.value));
  const scaledMax = useLog ? Math.log10(max + 1) : max;

  const wrap = el("div", { class: "barlist" });
  wrap.style.display = "flex";
  wrap.style.flexDirection = "column";
  wrap.style.gap = "4px";

  for (const d of data) {
    const frac = (useLog ? Math.log10(d.value + 1) : d.value) / (scaledMax || 1);
    const row = el("div", { class: "barlist-row" });
    row.style.cssText = "display:grid;grid-template-columns:minmax(90px,180px) 1fr auto;align-items:center;gap:8px;";
    row.tabIndex = 0;

    const label = el("div", { class: "barlist-label", title: d.label }, d.label);
    label.style.cssText = "font-size:12.5px;color:var(--text-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";

    const track = el("div", { class: "barlist-track" });
    track.style.cssText = `height:${barHeight}px;background:transparent;position:relative;`;
    const bar = el("div", { class: "barlist-bar" });
    bar.style.cssText = `height:100%;width:${Math.max(1.5, frac * 100)}%;background:${
      d.highlight ? "var(--series-other)" : d.color ?? color
    };border-radius:0 4px 4px 0;min-width:2px;`;
    track.appendChild(bar);

    const value = el("div", { class: "barlist-value" }, fmt(d.value));
    value.style.cssText = "font-size:12px;color:var(--text-primary);font-weight:600;font-variant-numeric:tabular-nums;text-align:right;min-width:44px;";

    row.append(label, track, value);
    if (opts.onPick) makeClickable(row, () => opts.onPick!(d, row));
    row.addEventListener("pointerenter", (e) => showRowTip(e, d));
    row.addEventListener("pointermove", (e) => showRowTip(e, d));
    row.addEventListener("pointerleave", hideTooltip);
    row.addEventListener("focus", (e) => {
      const r = row.getBoundingClientRect();
      showTooltip(r.right, r.top, tipRows(d));
    });
    row.addEventListener("blur", hideTooltip);

    wrap.appendChild(row);
  }

  function tipRows(d: BarListItem) {
    const rows = [{ label: d.label, value: fmt(d.value) + (opts.unit ? ` ${opts.unit}` : "") }];
    if (d.tooltip) rows.push({ label: d.tooltip, value: "" });
    return rows;
  }
  function showRowTip(e: PointerEvent | FocusEvent, d: BarListItem) {
    const evt = e as PointerEvent;
    showTooltip(evt.clientX ?? 0, evt.clientY ?? 0, tipRows(d));
  }

  return wrap;
}
