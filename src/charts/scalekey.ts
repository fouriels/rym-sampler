// The colour key under a viridis chart (the world map, the decade heatmap): the chart's own steps as
// flat swatches, with the value at each end. The swatches take their colours from the same CSS tokens
// (--seq-*) the chart uses, so the key follows the theme and can never disagree with the picture.
import { el } from "../util/dom";
import { updateCopy } from "../util/copy";

export function scaleKey(opts: { steps: string[]; low: string; high: string; caption?: HTMLElement }): HTMLElement {
  const bar = el("div", { class: "bar", "aria-hidden": "true" });
  for (const token of opts.steps) {
    const swatch = el("i", {});
    swatch.style.background = `var(${token})`;
    bar.appendChild(swatch);
  }
  const key = el("div", { class: "scale-key" }, el("span", { class: "end" }, opts.low), bar, el("span", { class: "end" }, opts.high));
  if (opts.caption) {
    opts.caption.classList.add("caption");
    key.appendChild(opts.caption);
  }
  return key;
}

/** Change what a key's two ends say, and (optionally) which passage its caption is, e.g. when a switch changes the scale. */
export function retuneKey(key: HTMLElement, low: string, high: string, captionKey?: string): void {
  const ends = key.querySelectorAll(".end");
  ends[0].textContent = low;
  ends[1].textContent = high;
  const caption = key.querySelector<HTMLElement>(".caption");
  if (caption && captionKey) updateCopy(caption, {}, captionKey);
}
