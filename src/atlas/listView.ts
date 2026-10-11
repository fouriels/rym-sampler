// The atlas as a plain column list (user request 2026-09-24, a fourth view next
// to Browse / Network / Orbit): top-level genres on the left, and picking one
// opens its subgenres in a new list to its right, and so on -- a Finder-style
// "column view" of the genre tree. Nothing clever: every row is a genre, the
// row you pick is played, and the chain of open rows is your position.
//
// The chain (`chain` below) has the same shape as the atlas's own `stack`, in
// its reduced form: [family, sub, subsub, ...]. A family whose only root is the
// family itself ("Jazz" > "Jazz") does not get a redundant one-row column -- its
// row in the first column stands in for that root.
//
// Long columns get a filter box (added the same day, with the sort setting):
// type to narrow the column, Enter plays the first match. The open and playing
// rows stay visible whatever the filter says, so the chain never breaks.
import type { AtlasData } from "./data";
import { el } from "../util/dom";
import { compareNames, formatMetric, makeComparator, SORT_OPTIONS, sortMetric, type SortKey } from "./sort";
import { fold } from "./text";

const FILTER_MIN = 12; // columns shorter than this get no filter box

/** The family's root genre when it IS the family ("Jazz" under Jazz); every
 * family but Uncategorised (27 unrelated roots) is like this. */
export function soleRoot(atlas: AtlasData, family: string): string | null {
  const roots = atlas.roots.get(family);
  return roots && roots.length === 1 && roots[0] === family ? family : null;
}

/** The ids listed in the column that follows `chain` (unsorted). */
export function listItems(atlas: AtlasData, chain: string[]): string[] {
  if (chain.length === 0) return atlas.families;
  if (chain.length === 1 && !soleRoot(atlas, chain[0])) return atlas.roots.get(chain[0]) ?? [];
  return atlas.children.get(chain[chain.length - 1]) ?? [];
}

/** Turn any stack the rest of the atlas might have left behind (Browse's
 * [family, root, ...], Network's record paths, ...) into a chain in which every
 * entry really is a child of the one before -- so every column has an active row. */
export function normaliseChain(atlas: AtlasData, stack: string[]): string[] {
  if (stack.length === 0 || !atlas.families.includes(stack[0])) return [];
  const chain = [stack[0]];
  for (const id of stack.slice(1)) {
    if (chain.length === 1 && id === soleRoot(atlas, chain[0])) continue; // that root IS the family row
    if (!listItems(atlas, chain).includes(id)) break;
    chain.push(id);
  }
  return chain;
}

/** The chain down to `target` along primary edges, in the same order
 * auto-advance walks the family (`compare` must be the same one, since 250
 * genres have more than one primary parent and the walk keeps the first it
 * meets) -- so while auto-advance marches through a family the list shows the
 * route it is actually taking. */
export function primaryChain(
  atlas: AtlasData,
  family: string,
  target: string,
  compare: (a: string, b: string) => number = compareNames
): string[] | null {
  const seen = new Set<string>();
  const dfs = (id: string, trail: string[]): string[] | null => {
    if (seen.has(id)) return null;
    seen.add(id);
    const here = [...trail, id];
    if (id === target) return here;
    for (const kid of [...(atlas.primaryChildren.get(id) ?? [])].sort(compare)) {
      const found = dfs(kid, here);
      if (found) return found;
    }
    return null;
  };
  for (const root of [...(atlas.roots.get(family) ?? [])].sort(compare)) {
    const found = dfs(root, []);
    if (found) return soleRoot(atlas, family) ? found : [family, ...found];
  }
  return null;
}

export interface ListCallbacks {
  /** A row was chosen. `depth` = how many chain entries come before its column. */
  onPick(depth: number, id: string): void;
}

export class AtlasListView {
  readonly root: HTMLElement;
  private strip: HTMLElement;
  private lastActive = new Map<string, string | null>();
  private lastColumns = -1;
  private fresh = true;
  private pendingFocus: { depth: number; id: string | null } | null = null;
  private filters = new Map<string, string>(); // column key -> what was typed in its filter box

  constructor(
    private atlas: AtlasData,
    private familyColor: Map<string, string>,
    private cb: ListCallbacks
  ) {
    this.strip = el("div", { class: "atlas-list-strip" });
    this.strip.addEventListener("click", (e) => {
      const row = (e.target as HTMLElement).closest<HTMLElement>(".atlas-list-row");
      if (row) this.cb.onPick(Number(row.dataset.depth), row.dataset.id!);
    });
    this.strip.addEventListener("input", (e) => {
      const input = e.target as HTMLInputElement;
      if (!input.classList.contains("atlas-list-filter")) return;
      const col = input.closest<HTMLElement>(".atlas-list-col")!;
      this.filters.set(col.dataset.key!, input.value);
      this.applyFilter(col);
    });
    this.strip.addEventListener("keydown", (e) => this.onKey(e));
    this.root = el(
      "div",
      { class: "atlas-list" },
      this.strip,
      el(
        "div",
        { class: "atlas-net-legend" },
        el(
          "span",
          { class: "atlas-net-legend-item hint" },
          "click a genre to play it and open its subgenres · ↑ ↓ move · → open · ← back · esc up a level · start typing to filter a long column"
        )
      )
    );
  }

  /** Call when the list is put back on screen: scroll every column to its open row afresh. */
  resetView(): void {
    this.fresh = true;
  }

  /** Focus the row a keyboard user would want first (the deepest column's open row). */
  focusEntry(): void {
    const bodies = this.strip.querySelectorAll<HTMLElement>(".atlas-list-body");
    const body = bodies[bodies.length - 1];
    const row = body?.querySelector<HTMLElement>('.atlas-list-row[tabindex="0"]');
    if (row) this.focusRow(row);
  }

  render(chain: string[], selectedId: string | null, sort: SortKey = "name"): void {
    const atlas = this.atlas;

    // what the previous build looked like: scroll positions and the focused element
    const oldScroll = new Map<string, number>();
    for (const body of this.strip.querySelectorAll<HTMLElement>(".atlas-list-body")) {
      oldScroll.set(body.dataset.key!, body.scrollTop);
    }
    const focusedEl = this.strip.contains(document.activeElement) ? (document.activeElement as HTMLElement) : null;
    const focusedRow = focusedEl?.closest<HTMLElement>(".atlas-list-row") ?? null;
    const focusedFilter = focusedEl?.classList.contains("atlas-list-filter") ? (focusedEl as HTMLInputElement) : null;
    const refilter = focusedFilter
      ? {
          key: focusedFilter.closest<HTMLElement>(".atlas-list-col")!.dataset.key!,
          start: focusedFilter.selectionStart ?? focusedFilter.value.length,
          end: focusedFilter.selectionEnd ?? focusedFilter.value.length,
        }
      : null;
    const refocus =
      this.pendingFocus ?? (focusedRow ? { depth: Number(focusedRow.dataset.depth), id: focusedRow.dataset.id ?? null } : null);
    this.pendingFocus = null;

    // what the rows show alongside the name: the number they are sorted by
    // (subgenre count for A-Z, which has none of its own)
    const shownKey: SortKey = sort === "name" ? "subgenres" : sort;
    const sortNote = SORT_OPTIONS.find((o) => o.key === sort)?.note ?? "";

    const columns: HTMLElement[] = [];
    const bodies: { body: HTMLElement; key: string; activeId: string | null }[] = [];
    const rows = new Map<string, HTMLElement>();

    for (let d = 0; d <= chain.length; d++) {
      const compare = makeComparator(atlas, sort, d === 0);
      const ids = [...new Set(listItems(atlas, chain.slice(0, d)))].sort(compare);
      if (ids.length === 0) continue; // a leaf: nothing to open to its right
      const key = `${d}:${d === 0 ? "" : chain[d - 1]}`;
      // the open row; in the last column it is the playing genre, if that genre is listed there
      const activeId = d < chain.length ? chain[d] : selectedId && ids.includes(selectedId) ? selectedId : null;

      const title = d === 0 ? "Top-level genres" : chain[d - 1];
      const baseSub =
        (d === 0 ? `${ids.length} to choose from` : `${ids.length} subgenre${ids.length === 1 ? "" : "s"}`) +
        (sortNote ? ` · ${sortNote}` : "");
      const body = el("ul", { class: "atlas-list-body", role: "listbox", "aria-label": title });
      body.dataset.key = key;
      const empty = el("li", { class: "atlas-list-empty" }, "No genre in this column matches");
      empty.hidden = true;
      body.appendChild(empty);

      for (const id of ids) {
        const childCount = atlas.children.get(id)?.length ?? 0;
        const hasKids = d === 0 || childCount > 0;
        const colour = this.familyColor.get(d === 0 ? id : atlas.nodesByName.get(id)?.primary ?? chain[0]) ?? "";
        const isOpen = d < chain.length && id === chain[d];
        const isPlaying = id === selectedId;
        const metric = sortMetric(atlas, shownKey, id, d === 0);
        const metricText = formatMetric(shownKey, metric);
        const what =
          shownKey === "year"
            ? metric === null ? "no year" : d === 0 ? `median sampled year ${metric}` : `sampled from ${metric}`
            : shownKey === "releases"
              ? `${metric ?? 0} releases`
              : d === 0
                ? `${metric ?? 0} genres`
                : `${childCount} subgenre${childCount === 1 ? "" : "s"}`;
        const row = el(
          "li",
          {
            class: "atlas-list-row" + (isOpen ? " open" : "") + (isPlaying ? " playing" : ""),
            role: "option",
            tabindex: id === (activeId ?? ids[0]) ? "0" : "-1",
            "aria-selected": String(isOpen || isPlaying),
            title: `${id} · ${what}`,
          },
          el("span", { class: "atlas-list-dot" }),
          el("span", { class: "atlas-list-name" }, id),
          el("span", { class: "atlas-list-count" }, metricText),
          el("span", { class: "atlas-list-chev", "aria-hidden": "true" }, hasKids ? "›" : "")
        );
        if (isPlaying) row.setAttribute("aria-current", "true");
        if (colour) row.style.setProperty("--c", colour);
        row.dataset.depth = String(d);
        row.dataset.id = id;
        row.dataset.kids = hasKids ? "1" : "0";
        row.dataset.fold = fold(id);
        row.dataset.match = "1";
        rows.set(`${d}\u0000${id}`, row);
        body.appendChild(row);
      }

      const head = el(
        "div",
        { class: "atlas-list-head" },
        el("div", { class: "atlas-list-title", title }, title),
        el("div", { class: "atlas-list-sub" }, baseSub)
      );
      if (ids.length >= FILTER_MIN) {
        const input = el("input", {
          class: "atlas-list-filter",
          type: "search",
          placeholder: `Filter ${ids.length}…`,
          "aria-label": `Filter ${title}`,
          autocomplete: "off",
          spellcheck: "false",
        });
        input.value = this.filters.get(key) ?? "";
        head.appendChild(input);
      }
      const col = el("div", { class: "atlas-list-col" }, head, body);
      col.dataset.depth = String(d);
      col.dataset.key = key;
      col.dataset.sub = baseSub;
      col.dataset.total = String(ids.length);
      columns.push(col);
      bodies.push({ body, key, activeId });
    }

    let note: HTMLElement | null = null;
    if (chain.length === 0) note = el("div", { class: "atlas-list-note" }, "Pick a top-level genre to see its subgenres here.");
    this.strip.replaceChildren(...columns, ...(note ? [note] : []));

    // filters typed into columns that still exist are kept; the rest are forgotten
    const liveKeys = new Set(bodies.map((b) => b.key));
    for (const key of [...this.filters.keys()]) if (!liveKeys.has(key)) this.filters.delete(key);
    for (const col of columns) if (this.filters.get(col.dataset.key!)) this.applyFilter(col);

    // scroll each column back to where it was; bring a newly-active row into view
    const activeNow = new Map<string, string | null>();
    for (const { body, key, activeId } of bodies) {
      activeNow.set(key, activeId);
      const before = this.fresh ? undefined : oldScroll.get(key);
      if (before !== undefined) body.scrollTop = before;
      const row = activeId ? rows.get(`${body.parentElement!.dataset.depth}\u0000${activeId}`) : undefined;
      if (row && (this.fresh || this.lastActive.get(key) !== activeId)) {
        const top = row.offsetTop;
        const bottom = top + row.offsetHeight;
        if (top < body.scrollTop || bottom > body.scrollTop + body.clientHeight) {
          body.scrollTop = Math.max(0, top - (body.clientHeight - row.offsetHeight) / 2);
        }
      }
    }
    this.lastActive = activeNow;

    if (refilter) {
      // mid-typing in a filter box when the view rebuilt (auto-advance moved on, say)
      const input = this.strip.querySelector<HTMLElement>(`.atlas-list-col[data-key="${CSS.escape(refilter.key)}"] .atlas-list-filter`);
      if (input instanceof HTMLInputElement) {
        input.focus({ preventScroll: true });
        input.setSelectionRange(refilter.start, refilter.end);
      }
    } else if (refocus) {
      const target =
        (refocus.id === null
          ? this.strip.querySelector<HTMLElement>(`.atlas-list-col[data-depth="${refocus.depth}"] .atlas-list-row[tabindex="0"]`)
          : rows.get(`${refocus.depth}\u0000${refocus.id}`)) ??
        // the row that had focus is gone (its column closed): keep keyboard focus in the list
        [...this.strip.querySelectorAll<HTMLElement>('.atlas-list-col .atlas-list-row[tabindex="0"]')].pop();
      if (target) {
        target.parentElement!.querySelector('.atlas-list-row[tabindex="0"]')?.setAttribute("tabindex", "-1");
        target.setAttribute("tabindex", "0");
        target.focus({ preventScroll: true });
      }
    }

    // a new column opened (or closed): show the newest one
    if (this.fresh || columns.length !== this.lastColumns) {
      const smooth = !this.fresh && !matchMedia("(prefers-reduced-motion: reduce)").matches;
      this.strip.scrollTo({ left: this.strip.scrollWidth, behavior: smooth ? "smooth" : "auto" });
    }
    this.lastColumns = columns.length;
    this.fresh = false;
  }

  // --------------------------------------------------------------- filter --
  /** Hide the rows of one column that do not match what is typed in its filter
   * box -- except the open and playing rows, which stay put so the chain of
   * columns still makes sense. */
  private applyFilter(col: HTMLElement): void {
    const input = col.querySelector<HTMLInputElement>(".atlas-list-filter");
    const query = input ? fold(input.value) : "";
    const tokens = query ? query.split(" ") : [];
    const body = col.querySelector<HTMLElement>(".atlas-list-body")!;
    let matching = 0;
    for (const row of body.querySelectorAll<HTMLElement>(".atlas-list-row")) {
      const matches = tokens.every((t) => row.dataset.fold!.includes(t));
      const pinned = row.classList.contains("open") || row.classList.contains("playing");
      row.dataset.match = matches ? "1" : "0";
      row.hidden = !matches && !pinned;
      if (matches) matching++;
    }
    col.querySelector<HTMLElement>(".atlas-list-empty")!.hidden = !(query && matching === 0);
    col.querySelector<HTMLElement>(".atlas-list-sub")!.textContent = query
      ? `${matching} of ${col.dataset.total} match`
      : col.dataset.sub!;
    // keep one tab stop in the column, and never on a hidden row
    const visible = [...body.querySelectorAll<HTMLElement>(".atlas-list-row")].filter((r) => !r.hidden);
    const stop = body.querySelector<HTMLElement>('.atlas-list-row[tabindex="0"]');
    if (visible.length && (!stop || stop.hidden)) {
      stop?.setAttribute("tabindex", "-1");
      visible[0].setAttribute("tabindex", "0");
    }
  }

  // ------------------------------------------------------------- keyboard --
  private focusRow(row: HTMLElement): void {
    row.parentElement!.querySelector('.atlas-list-row[tabindex="0"]')?.setAttribute("tabindex", "-1");
    row.setAttribute("tabindex", "0");
    row.focus({ preventScroll: true });
    // keep it on screen, inside its own column and along the strip
    const body = row.parentElement!;
    const top = row.offsetTop;
    const bottom = top + row.offsetHeight;
    if (top < body.scrollTop) body.scrollTop = top;
    else if (bottom > body.scrollTop + body.clientHeight) body.scrollTop = bottom - body.clientHeight;
    const col = body.parentElement!;
    const left = col.offsetLeft;
    const right = left + col.offsetWidth;
    if (left < this.strip.scrollLeft) this.strip.scrollLeft = left;
    else if (right > this.strip.scrollLeft + this.strip.clientWidth) this.strip.scrollLeft = right - this.strip.clientWidth;
  }

  private visibleRows(col: HTMLElement): HTMLElement[] {
    return [...col.querySelectorAll<HTMLElement>(".atlas-list-row")].filter((r) => !r.hidden);
  }

  private onFilterKey(e: KeyboardEvent, input: HTMLInputElement): void {
    e.stopPropagation(); // typing must never reach the atlas's own keys (space = pause)
    const col = input.closest<HTMLElement>(".atlas-list-col")!;
    if (e.key === "ArrowDown") {
      const first = this.visibleRows(col)[0];
      if (first) {
        e.preventDefault();
        this.focusRow(first);
      }
    } else if (e.key === "Enter") {
      // play the first genre that actually matches (not one kept visible only because it is open)
      const first = this.visibleRows(col).find((r) => r.dataset.match === "1");
      if (first) {
        e.preventDefault();
        this.cb.onPick(Number(first.dataset.depth), first.dataset.id!);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      if (input.value) {
        input.value = "";
        this.filters.delete(col.dataset.key!);
        this.applyFilter(col);
      } else {
        input.blur();
        this.focusEntry();
      }
    }
  }

  private onKey(e: KeyboardEvent): void {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const target = e.target as HTMLElement;
    if (target.classList.contains("atlas-list-filter")) return this.onFilterKey(e, target as HTMLInputElement);
    const row = target.closest<HTMLElement>(".atlas-list-row");
    if (!row) return;
    const depth = Number(row.dataset.depth);
    const col = row.closest<HTMLElement>(".atlas-list-col")!;
    const siblings = this.visibleRows(col);
    const i = siblings.indexOf(row);
    switch (e.key) {
      case "ArrowDown":
        if (siblings[i + 1]) this.focusRow(siblings[i + 1]);
        break;
      case "ArrowUp":
        if (siblings[i - 1]) this.focusRow(siblings[i - 1]);
        break;
      case "PageDown":
        this.focusRow(siblings[Math.min(siblings.length - 1, i + 8)]);
        break;
      case "PageUp":
        this.focusRow(siblings[Math.max(0, i - 8)]);
        break;
      case "Home":
        this.focusRow(siblings[0]);
        break;
      case "End":
        this.focusRow(siblings[siblings.length - 1]);
        break;
      case "ArrowLeft": {
        const parentRow = this.strip.querySelector<HTMLElement>(
          `.atlas-list-col[data-depth="${depth - 1}"] .atlas-list-row.open`
        );
        if (parentRow) this.focusRow(parentRow);
        break;
      }
      case "ArrowRight": {
        if (row.dataset.kids !== "1") break;
        const next = this.strip.querySelector<HTMLElement>(
          `.atlas-list-col[data-depth="${depth + 1}"] .atlas-list-row[tabindex="0"]`
        );
        if (row.classList.contains("open") && next) {
          this.focusRow(next); // already open: just step into it
        } else {
          this.pendingFocus = { depth: depth + 1, id: null };
          this.cb.onPick(depth, row.dataset.id!);
        }
        break;
      }
      case "Enter":
        this.cb.onPick(depth, row.dataset.id!);
        break;
      default: {
        // a letter or digit in a column that has a filter box: type-to-filter.
        // Focus moves now and the browser delivers the character to the box.
        const filter = col.querySelector<HTMLInputElement>(".atlas-list-filter");
        if (filter && e.key.length === 1 && /[\p{L}\p{N}]/u.test(e.key)) filter.focus();
        return; // space, escape, ... belong to the atlas (play/pause, up a level)
      }
    }
    e.preventDefault();
    e.stopPropagation();
  }
}
