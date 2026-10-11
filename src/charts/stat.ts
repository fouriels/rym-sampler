import { el } from "../util/dom";
import { copyEl, hasCopy, updateCopy, type Vars } from "../util/copy";

export interface StatTileData {
  /** Key prefix in copy.json: "<copy>.label" and (if present) "<copy>.note". */
  copy: string;
  /** Live values the label and note may use as {name}. */
  vars?: Vars;
  value: string;
}

export function statTile(d: StatTileData): HTMLElement {
  const tile = el("div", { class: "stat-tile" });
  tile.appendChild(copyEl("div", `${d.copy}.label`, d.vars, { class: "label" }));
  tile.appendChild(el("div", { class: "value" }, d.value));
  if (hasCopy(`${d.copy}.note`)) tile.appendChild(copyEl("div", `${d.copy}.note`, d.vars, { class: "note" }));
  return tile;
}

/** Change a tile's number and the live values in its note, in place (the labels stay as they are).
 * `noteKey` points the note at a different passage, for a tile whose wording depends on a filter. */
export function updateTile(tile: HTMLElement, change: { value: string; vars?: Vars; noteKey?: string }): void {
  const value = tile.querySelector(".value");
  if (value) value.textContent = change.value;
  const label = tile.querySelector<HTMLElement>(".label");
  const note = tile.querySelector<HTMLElement>(".note");
  if (label) updateCopy(label, change.vars ?? {});
  if (note) updateCopy(note, change.vars ?? {}, change.noteKey);
}

export function kpiRow(tiles: StatTileData[]): HTMLElement {
  const row = el("div", { class: "kpi-row" });
  for (const t of tiles) row.appendChild(statTile(t));
  return row;
}
