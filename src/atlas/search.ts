// "Find a genre or artist" box for the atlas toolbar (user request 2026-09-24).
// One box, used by every view: type, and a dropdown lists the best matches;
// picking one jumps to that genre in whichever view is showing. While there is
// text in the box the views also light up the matches in what they are drawing
// (see AtlasView.applyHighlight) -- that is how "search" reaches the graph views.
import type { AtlasData } from "./data";
import { el } from "../util/dom";
import { fold } from "./text";

const MAX_SHOWN = 12;
const MIN_HIGHLIGHT_CHARS = 2; // one letter matches half the atlas

interface Entry {
  id: string;
  key: string; // folded genre name
  fields: { label: string; raw: string; key: string }[]; // the clip's artist, performer, track, album
  releases: number;
  route: string; // "Regional Music › Asian Music", the genre's parents on its primary route
}

interface Hit {
  id: string;
  rank: number;
  detail: string;
  releases: number;
}

/** What the current query matches, for the views to highlight. */
export interface SearchHighlight {
  match: Set<string>; // genres that match
  ancestors: Set<string>; // every genre on any route down to a match (so paths light up)
}

export interface SearchOptions {
  /** A result was chosen. */
  onPick(id: string): void;
  /** The text changed (or was cleared) -- the views re-apply their highlight. */
  onQuery(): void;
}

export class AtlasSearch {
  readonly root: HTMLElement;
  private input: HTMLInputElement;
  private list: HTMLElement;
  private entries: Entry[];
  private hits: Hit[] = [];
  private active = 0;
  private highlightCache: { query: string; value: SearchHighlight | null } = { query: "", value: null };

  constructor(private atlas: AtlasData, private opts: SearchOptions) {
    this.entries = atlas.genres.map((g) => {
      const path = g.paths.find((p) => p[0] === g.primary) ?? g.paths[0] ?? [];
      const parents = path.slice(0, -1);
      const raw: [string, string | null][] = [
        ["artist", g.artist],
        ["performer", g.performer],
        ["track", g.track],
        ["album", g.album],
      ];
      return {
        id: g.name,
        key: fold(g.name),
        fields: raw.filter((f): f is [string, string] => !!f[1]).map(([label, value]) => ({ label, raw: value, key: fold(value) })),
        releases: g.releases ?? 0,
        route: parents.length ? (parents.length > 3 ? ["…", ...parents.slice(-3)] : parents).join(" › ") : "Top-level genre",
      };
    });

    this.input = el("input", {
      class: "atlas-search-input",
      type: "search",
      placeholder: "Find a genre or artist…   ( / )",
      role: "combobox",
      autocomplete: "off",
      spellcheck: "false",
      "aria-label": "Find a genre or artist",
      "aria-autocomplete": "list",
      "aria-expanded": "false",
      "aria-controls": "atlas-search-results",
    });
    this.list = el("ul", { class: "atlas-search-results", id: "atlas-search-results", role: "listbox" });
    this.list.hidden = true;
    this.root = el("div", { class: "atlas-search", role: "search" }, this.input, this.list);

    this.input.addEventListener("input", () => {
      this.update();
      this.opts.onQuery();
    });
    this.input.addEventListener("focus", () => this.update());
    this.input.addEventListener("keydown", (e) => this.onKey(e));
    // keep focus in the box while a result is being clicked
    this.list.addEventListener("mousedown", (e) => e.preventDefault());
    this.list.addEventListener("click", (e) => {
      const li = (e.target as HTMLElement).closest<HTMLElement>("[data-id]");
      if (li) this.pick(li.dataset.id!);
    });
    this.root.addEventListener("focusout", (e) => {
      if (!this.root.contains(e.relatedTarget as Node | null)) this.close();
    });
  }

  focus(): void {
    this.input.focus();
    this.input.select();
  }

  clear(): void {
    this.input.value = "";
    this.close();
    this.opts.onQuery();
  }

  /** Genres matching the text (and every route down to them), or null when the
   * box is empty or too short to be worth lighting up. */
  highlight(): SearchHighlight | null {
    const query = fold(this.input.value);
    if (query.length < MIN_HIGHLIGHT_CHARS) return null;
    if (this.highlightCache.query === query) return this.highlightCache.value;
    const match = new Set<string>();
    const ancestors = new Set<string>();
    for (const hit of this.search(query)) {
      match.add(hit.id);
      for (const path of this.atlas.byName.get(hit.id)?.paths ?? []) for (const id of path) ancestors.add(id);
    }
    const value = match.size ? { match, ancestors } : null;
    this.highlightCache = { query, value };
    return value;
  }

  // ---------------------------------------------------------------- query --
  /** Every match, best first: name matches before clip (artist/track/album)
   * matches, exact before prefix before word-start before anywhere, then the
   * genre with more releases. */
  private search(query: string): Hit[] {
    const tokens = query.split(" ");
    const score = (key: string): number | null => {
      if (key === query) return 0;
      if (key.startsWith(query)) return 1;
      if ((" " + key).includes(" " + query)) return 2;
      if (key.includes(query)) return 3;
      if (tokens.length > 1 && tokens.every((t) => key.includes(t))) return 4; // "free jazz" finds "Jazz, Free"
      return null;
    };
    const hits: Hit[] = [];
    for (const entry of this.entries) {
      const nameScore = score(entry.key);
      if (nameScore !== null) {
        hits.push({ id: entry.id, rank: nameScore, detail: entry.route, releases: entry.releases });
        continue;
      }
      let best: Hit | null = null;
      for (const f of entry.fields) {
        const s = score(f.key);
        if (s !== null && (!best || 5 + s < best.rank)) {
          best = { id: entry.id, rank: 5 + s, detail: `${f.label}: ${f.raw}`, releases: entry.releases };
        }
      }
      if (best) hits.push(best);
    }
    return hits.sort((a, b) => a.rank - b.rank || b.releases - a.releases || a.id.localeCompare(b.id));
  }

  private update(): void {
    const query = fold(this.input.value);
    this.hits = query ? this.search(query) : [];
    this.active = 0;
    this.renderList(query);
  }

  private renderList(query: string): void {
    this.list.replaceChildren();
    if (!query) return this.close();
    if (this.hits.length === 0) {
      this.list.appendChild(el("li", { class: "atlas-search-empty" }, "No genre or artist matches"));
    }
    this.hits.slice(0, MAX_SHOWN).forEach((hit, i) => {
      const li = el(
        "li",
        {
          class: "atlas-search-hit" + (i === this.active ? " active" : ""),
          role: "option",
          id: `atlas-search-opt-${i}`,
          "aria-selected": String(i === this.active),
        },
        el("span", { class: "atlas-search-name" }, hit.id),
        el("span", { class: "atlas-search-detail" }, hit.detail)
      );
      li.dataset.id = hit.id;
      this.list.appendChild(li);
    });
    if (this.hits.length > MAX_SHOWN) {
      this.list.appendChild(el("li", { class: "atlas-search-more" }, `${this.hits.length - MAX_SHOWN} more — keep typing to narrow`));
    }
    this.list.hidden = false;
    this.input.setAttribute("aria-expanded", "true");
    this.syncActive();
  }

  private syncActive(): void {
    const options = [...this.list.querySelectorAll<HTMLElement>(".atlas-search-hit")];
    options.forEach((li, i) => {
      li.classList.toggle("active", i === this.active);
      li.setAttribute("aria-selected", String(i === this.active));
    });
    const current = options[this.active];
    if (current) {
      this.input.setAttribute("aria-activedescendant", current.id);
      current.scrollIntoView({ block: "nearest" });
    } else {
      this.input.removeAttribute("aria-activedescendant");
    }
  }

  private close(): void {
    this.list.hidden = true;
    this.input.setAttribute("aria-expanded", "false");
    this.input.removeAttribute("aria-activedescendant");
  }

  private pick(id: string): void {
    this.input.value = "";
    this.close();
    this.input.blur();
    this.opts.onQuery(); // the highlight goes with the text
    this.opts.onPick(id);
  }

  private onKey(e: KeyboardEvent): void {
    const shown = Math.min(this.hits.length, MAX_SHOWN);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (shown === 0) return;
      e.preventDefault();
      if (this.list.hidden) this.renderList(fold(this.input.value));
      this.active = (this.active + (e.key === "ArrowDown" ? 1 : -1) + shown) % shown;
      this.syncActive();
    } else if (e.key === "Enter") {
      const hit = this.hits[this.active];
      if (hit) {
        e.preventDefault();
        this.pick(hit.id);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      if (!this.list.hidden) this.close();
      else {
        this.input.value = "";
        this.opts.onQuery();
        this.input.blur();
      }
    }
  }
}
