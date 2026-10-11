import { el } from "../util/dom";
import { copyEl, hasCopy, type Vars } from "../util/copy";

export interface CardOptions {
  id: string;
  /** Key prefix in copy.json: "<copy>.title" (required), "<copy>.caveat" and "<copy>.hint" (used if present). */
  copy: string;
  /** Live values the texts may use as {name}. */
  vars?: Vars;
  /** Further sentences added to the caveat, each its own editable passage (e.g. a conditional note). */
  caveatMore?: { key: string; vars?: Vars }[];
  /** Marks a post candidate. Shown while developing only (import.meta.env.DEV): the public build carries no trace of it. */
  reddit?: boolean;
  /** Title only: no caveat or hint (used for the "No data" stand-ins). */
  bare?: boolean;
}

export function card(opts: CardOptions, ...content: (HTMLElement | SVGElement)[]): HTMLElement {
  const wrap = el("section", { class: "card", id: opts.id });
  const h = el("h2", {});
  h.appendChild(copyEl("span", `${opts.copy}.title`, opts.vars, { class: "card-title" }));
  if (opts.reddit && import.meta.env.DEV) {
    const badge = el("span", { class: "reddit-hint" }, "OC candidate");
    h.appendChild(badge);
  }
  const anchor = el("a", { class: "anchor", href: `#${opts.id}` }, "#");
  h.appendChild(anchor);
  wrap.appendChild(h);
  if (!opts.bare && hasCopy(`${opts.copy}.caveat`)) {
    const p = el("p", { class: "caveat" });
    p.appendChild(copyEl("span", `${opts.copy}.caveat`, opts.vars));
    for (const more of opts.caveatMore ?? []) {
      p.appendChild(document.createTextNode(" "));
      p.appendChild(copyEl("span", more.key, more.vars ?? opts.vars));
    }
    wrap.appendChild(p);
  }
  if (!opts.bare && hasCopy(`${opts.copy}.hint`)) wrap.appendChild(copyEl("p", `${opts.copy}.hint`, opts.vars, { class: "drill-hint" }));
  const body = el("div", { class: "chart-wrap" }, ...content);
  wrap.appendChild(body);
  return wrap;
}

export function legend(items: { label: string; color: string }[]): HTMLElement {
  const wrap = el("div", { class: "legend" });
  for (const item of items) {
    const row = el("span", { class: "item" });
    const swatch = el("span", { class: "swatch" });
    swatch.style.background = item.color;
    row.append(swatch, document.createTextNode(item.label));
    wrap.appendChild(row);
  }
  return wrap;
}

export function tableToggleButton(table: HTMLElement): HTMLElement {
  table.classList.add("hidden");
  const btn = el("button", { class: "table-toggle", type: "button" }, "Show as table");
  btn.addEventListener("click", () => {
    const hidden = table.classList.toggle("hidden");
    btn.textContent = hidden ? "Show as table" : "Hide table";
  });
  return btn;
}

// A long table (some of these run to 2,000+ rows) used to expand the card to
// its full height and stretch the whole page -- wrapped in a fixed-height,
// scrolling, sticky-header container instead (user request 2026-09-23).
//
// Every row carries its rank in a dim first column ("1.", "2.", ...), so a table can be read as a
// ranking and a row can be referred to by number (user request 2026-10-10).
export function dataTable(headers: string[], rows: (string | number)[][]): HTMLElement {
  const table = el("table", { class: "data-table" });
  const thead = el("thead", {});
  const headRow = el("tr", {});
  headRow.appendChild(el("th", { class: "rank" }, ""));
  headers.forEach((h) => headRow.appendChild(el("th", {}, h)));
  thead.appendChild(headRow);
  table.appendChild(thead);
  const tbody = el("tbody", {});
  table.appendChild(tbody);
  const wrap = el("div", { class: "data-table-wrap" }, table);
  setTableRows(wrap, rows);
  return wrap;
}

/** Replace the rows of a table made by dataTable() (e.g. when a filter changes what the chart shows). */
export function setTableRows(wrap: HTMLElement, rows: (string | number)[][]): void {
  const tbody = wrap.querySelector("tbody")!;
  tbody.replaceChildren();
  rows.forEach((row, r) => {
    const tr = el("tr", {});
    tr.appendChild(el("td", { class: "rank" }, `${r + 1}.`));
    for (const cell of row) tr.appendChild(el("td", { class: typeof cell === "number" ? "num" : "" }, String(cell)));
    tbody.appendChild(tr);
  });
}
