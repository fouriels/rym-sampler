// Click-through for every chart (user request 2026-09-24): whatever bar, cell,
// rectangle or country you click, a scrollable table underneath lists the actual
// records behind it -- genre, artist, album, track, year, family -- so no number
// on the dashboard is a dead end. The charts only report the click (and which
// mark was clicked); this panel does the rest. genres.json (4.7 MB) is only
// fetched on the first click -- the Stats tab otherwise never needs it.
import type { GenreRecord } from "../types";
import { el } from "../util/dom";
import { commas } from "../util/format";

export interface DrillColumn {
  header: string;
  cell: (g: GenreRecord) => string;
  num?: boolean;
}

export interface DrillSpec {
  /** What was clicked, in words: "Rock · 1970s". */
  title: string;
  /** Which records it stands for. */
  test: (g: GenreRecord) => boolean;
  /** Row order; default is by genre name. */
  compare?: (a: GenreRecord, b: GenreRecord) => number;
  /** One more column, for what the chart was about (a country, a length, ...). */
  extra?: DrillColumn;
}

const byName = (a: GenreRecord, b: GenreRecord) => a.name.localeCompare(b.name);
export const byYear = (a: GenreRecord, b: GenreRecord) => (a.year ?? 9999) - (b.year ?? 9999) || byName(a, b);

export class Drill {
  readonly el: HTMLElement;
  private title: HTMLElement;
  private body: HTMLElement;
  private mark: Element | null = null;
  private token = 0;

  /**
   * @param loadGenres the full record set (lazy)
   * @param undated genres known to be pre-1900 that have no year, shown as such
   */
  constructor(private loadGenres: () => Promise<GenreRecord[]>, private undated: Set<string> = new Set()) {
    this.title = el("h3", { class: "drill-title" });
    const close = el("button", { class: "table-toggle drill-close", type: "button" }, "✕ Close");
    close.addEventListener("click", () => this.hide());
    this.body = el("div", { class: "drill-body" });
    this.el = el("div", { class: "drill", "aria-live": "polite" }, el("div", { class: "drill-head" }, this.title, close), this.body);
    this.el.hidden = true;
  }

  /** Show the records behind `mark` (the clicked element); clicking the same mark again closes it. */
  async show(spec: DrillSpec, mark?: Element): Promise<void> {
    if (mark && mark === this.mark && !this.el.hidden) return this.hide();
    this.setMark(mark ?? null);
    const mine = ++this.token;
    this.el.hidden = false;
    this.title.textContent = spec.title;
    this.body.replaceChildren(el("p", { class: "drill-note" }, "Loading…"));
    const genres = await this.loadGenres();
    if (mine !== this.token) return; // something else was clicked meanwhile

    const rows = genres.filter(spec.test).sort(spec.compare ?? byName);
    this.title.textContent = `${spec.title} — ${commas(rows.length)} genre${rows.length === 1 ? "" : "s"}`;
    if (rows.length === 0) {
      this.body.replaceChildren(el("p", { class: "drill-note" }, "No genres here."));
      return;
    }
    const columns: DrillColumn[] = [
      { header: "Genre", cell: (g) => g.name },
      { header: "Artist", cell: (g) => (g.performer ? `${g.artist} (performed by ${g.performer})` : g.artist) },
      { header: "Album", cell: (g) => g.album },
      { header: "Track", cell: (g) => g.track },
      { header: "Year", cell: (g) => (g.year ? String(g.year) : this.undated.has(g.name) ? "pre-1900 (undated)" : "—"), num: true },
      { header: "Family", cell: (g) => g.primary },
    ];
    if (spec.extra) columns.push(spec.extra);

    const table = el("table", { class: "data-table drill-table" });
    const head = el("tr", {});
    head.appendChild(el("th", { class: "rank" }, ""));
    for (const c of columns) head.appendChild(el("th", { class: c.num ? "num" : "" }, c.header));
    table.appendChild(el("thead", {}, head));
    const tbody = el("tbody", {});
    rows.forEach((g, r) => {
      const tr = el("tr", {});
      tr.appendChild(el("td", { class: "rank" }, `${r + 1}.`));
      for (const c of columns) tr.appendChild(el("td", { class: c.num ? "num" : "" }, c.cell(g)));
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    this.body.replaceChildren(el("div", { class: "data-table-wrap drill-scroll" }, table));
    // the panel can open below the fold of a tall chart card
    this.el.scrollIntoView({ block: "nearest", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }

  hide(): void {
    this.token++;
    this.el.hidden = true;
    this.setMark(null);
  }

  private setMark(next: Element | null): void {
    this.mark?.classList.remove("is-selected");
    this.mark?.removeAttribute("aria-pressed");
    this.mark = next;
    next?.classList.add("is-selected");
    next?.setAttribute("aria-pressed", "true");
  }
}

/** Make a chart mark clickable and keyboard-activatable. */
export function makeClickable(node: Element, onPick: () => void): void {
  node.setAttribute("role", "button");
  if (!node.hasAttribute("tabindex")) node.setAttribute("tabindex", "0");
  node.classList.add("is-clickable");
  node.addEventListener("click", onPick);
  node.addEventListener("keydown", (e) => {
    const k = (e as KeyboardEvent).key;
    if (k === "Enter" || k === " ") {
      e.preventDefault();
      onPick();
    }
  });
}
