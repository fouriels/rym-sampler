// The zoomable genre browser: semantic zoom over three-ish levels (family ->
// branch(es) -> genre), per "Layout A" in rym-dashboard-build-plan.md. Every
// node is simultaneously playable (single click selects + plays it) and, if
// it has children, drillable (the same click also shows them) -- there is no
// separate expand gesture. Going back up is the breadcrumb bar or Escape.
import { pack, hierarchy } from "d3-hierarchy";
import type { GenreRecord } from "../types";
import { el, showTooltip, hideTooltip } from "../util/dom";
import { loadAtlas, walkFamily, type AtlasData } from "./data";
import { AtlasPlayer } from "./player";
import { MiniPlayer } from "./miniPlayer";
import { renderPanel } from "./panel";
import { buildFamilyColorMap } from "../charts/familyColors";
import { renderNetworkGraph } from "./networkGraph";
import { renderOrbitGraph, IDENTITY_ZOOM, type OrbitController, type OrbitZoom } from "./orbitGraph";
import { AtlasListView, normaliseChain, primaryChain } from "./listView";
import { makeComparator, SORT_OPTIONS, type SortKey } from "./sort";
import { AtlasSearch } from "./search";
import { isBool, readPref, writePref } from "../util/prefs";

type ViewMode = "browse" | "list" | "network" | "orbit";

export class AtlasView {
  private root: HTMLElement;
  private atlas: AtlasData | null = null;
  private stack: string[] = []; // [] = home; [family, ...nodeIds]
  private selectedId: string | null = null;
  // Two separate switches (user request 2026-09-24):
  //   autoplay    -- a clip starts as soon as a genre is picked (default on)
  //   autoAdvance -- when a clip finishes, move on to the next genre (default off)
  // Those are the first-visit defaults: both, and the sort order, are remembered from then on
  // (2026-09-25). Auto-advance implies autoplay, so a saved "advance on, autoplay off" is dropped.
  private autoplay = readPref("autoplay", true, isBool);
  private autoAdvance = readPref("autoAdvance", false, isBool) && this.autoplay;
  // Whether the orbit's genre families circle the centre (user, 2026-10-11). Off: they keep their places, still.
  private orbiting = readPref("orbit", true, isBool);
  private advanceQueue: string[] = []; // the family walk that auto-advance follows
  private sortKey: SortKey = readPref("sort", "name", (v): v is SortKey => SORT_OPTIONS.some((o) => o.key === v));
  private search: AtlasSearch | null = null;
  private orbitFocus: string | null = null; // one-shot: the genre the next Orbit build centres on
  private highlightQueued = false;
  // Orbit is the default (user, 2026-10-10); Browse and Network are switched off for now (see modeDefs)
  private viewMode: ViewMode = "orbit";
  private list: AtlasListView | null = null; // built on first use; keeps its own scroll state
  private orbitHub: string | null = null; // the centred top-level genre in Orbit view
  private orbitZoom: OrbitZoom = { ...IDENTITY_ZOOM };
  private orbit: OrbitController | null = null;
  private orbitTime = 0; // carried across rebuilds so the orbit keeps its place
  private modeButtons = new Map<string, HTMLButtonElement>();
  private networkChain: string[] = []; // open family > subgenre > ... path in Network view
  private player: AtlasPlayer | null = null;
  private mini: MiniPlayer | null = null; // the floating now-playing bar (on <body>, so it outlives the tab being hidden)
  private renderPending = false; // the stage could not be drawn while the tab was hidden; it is drawn when the tab is shown
  private familyColor = new Map<string, string>();
  private hasGesture = false;

  private stage!: HTMLElement;
  private breadcrumbEl!: HTMLElement;
  private panelMount!: HTMLElement;
  private panelPlaceholder!: HTMLElement;
  private playerMount!: HTMLElement;
  private toolbar!: HTMLElement;
  private stateLabelEl!: HTMLElement;
  private searchMount!: HTMLElement;
  private mainEl!: HTMLElement;
  private emptyState!: HTMLElement;

  constructor(mount: HTMLElement, private opts: { reveal?: () => void } = {}) {
    this.root = mount;
    this.buildChrome();
  }

  private buildChrome(): void {
    this.root.replaceChildren();
    this.root.className = "atlas-root";

    this.toolbar = el("div", { class: "atlas-toolbar" });
    this.breadcrumbEl = el("div", { class: "atlas-breadcrumb-bar" });
    this.toolbar.appendChild(this.breadcrumbEl);

    const controls = el("div", { class: "atlas-controls" });
    // Separate on purpose: autoplay is what happens when you PICK a genre,
    // auto-advance is what happens when a clip FINISHES.
    // Auto-advance needs autoplay (an advance that then waits for you to press play is
    // no advance at all), so the two are tied: switching auto-advance on switches
    // autoplay on, and switching autoplay off switches auto-advance off.
    const autoplayToggle = this.makeToggle(
      "atlas-autoplay-btn",
      "▶ Autoplay",
      this.autoplay,
      "Start each clip as soon as you pick a genre. Off: the clip loads and waits for you to press play (and Auto-advance goes off too).",
      (on) => {
        this.autoplay = on;
        if (on && this.selectedId) this.startCuedClip();
        if (!on && this.autoAdvance) {
          this.autoAdvance = false;
          advanceToggle.set(false);
        }
        this.savePrefs();
      }
    );
    const advanceToggle = this.makeToggle(
      "atlas-advance-btn",
      "⏭ Auto-advance",
      this.autoAdvance,
      "When a clip finishes, move on to the next genre and play it (in the order set by Sort). Turning it on also turns Autoplay on.",
      (on) => {
        this.autoAdvance = on;
        if (on && !this.autoplay) {
          this.autoplay = true;
          autoplayToggle.set(true);
          if (this.selectedId) this.startCuedClip();
        }
        this.savePrefs();
      }
    );
    const orbitToggle = this.makeToggle(
      "atlas-spin-btn",
      "↻ Orbiting",
      this.orbiting,
      "The top-level genres circle the centre of the Orbit view. Off: they stay arranged round it, but stop turning.",
      (on) => {
        this.orbiting = on;
        this.orbit?.setSpin(on);
        this.savePrefs();
      }
    );
    controls.append(autoplayToggle.button, advanceToggle.button, orbitToggle.button);
    const tools = el("div", { class: "atlas-tools" });
    // Four ways of looking at the same atlas (the earlier views are kept as they
    // were; Orbit and List were added 2026-09-24 as options, not replacements):
    //   Browse  -- the zoomable bubble pack
    //   List    -- plain columns: pick a genre, its subgenres open in a list to its right
    //   Network -- a draggable force graph of one genre's neighbourhood
    //   Orbit   -- a centred top-level genre with its whole tree, the others circling it
    const modes = el("div", { class: "atlas-modes", role: "group" });
    modes.setAttribute("aria-label", "View");
    // Browse and Network are commented out for now (user, 2026-10-10: "orbit is better"). Their code is
    // intact; put the two lines back to bring the buttons back.
    const modeDefs: { mode: ViewMode; label: string; cls: string }[] = [
      { mode: "orbit", label: "☄ Orbit", cls: "atlas-orbit-btn" },
      { mode: "list", label: "☰ List", cls: "atlas-list-btn" },
      // { mode: "browse", label: "◎ Browse", cls: "atlas-browse-btn" },
      // { mode: "network", label: "🕸 Network", cls: "atlas-network-btn" },
    ];
    for (const def of modeDefs) {
      const btn = el("button", { class: `atlas-btn atlas-mode-btn ${def.cls}`, type: "button" }, def.label);
      btn.setAttribute("aria-pressed", String(def.mode === this.viewMode));
      btn.addEventListener("click", () => this.setViewMode(def.mode));
      this.modeButtons.set(def.mode, btn);
      modes.appendChild(btn);
    }
    tools.appendChild(modes);
    const sortLabel = el(
      "label",
      {
        class: "atlas-sort",
        title:
          "Order of the genres in List, of the branches round Orbit, and of the genres Auto-advance walks through. Browse and Network have no order to sort.",
      },
      "Sort "
    );
    const sortSelect = el("select", { class: "atlas-select", "aria-label": "Sort genres" });
    for (const option of SORT_OPTIONS) sortSelect.appendChild(el("option", { value: option.key }, option.label));
    sortSelect.value = this.sortKey;
    sortSelect.addEventListener("change", () => this.setSort(sortSelect.value as SortKey));
    sortLabel.appendChild(sortSelect);
    tools.appendChild(sortLabel);
    this.searchMount = el("div", { class: "atlas-search-mount" });
    tools.appendChild(this.searchMount);
    this.stateLabelEl = el("span", { class: "atlas-state-label" }, "");
    this.stateLabelEl.title = "Click to play/pause";
    this.stateLabelEl.addEventListener("click", () => this.player?.togglePause());
    controls.appendChild(this.stateLabelEl);
    this.toolbar.append(controls, tools);
    this.root.appendChild(this.toolbar);

    const main = el("div", { class: "atlas-main" });
    this.mainEl = main;
    this.stage = el("div", { class: "atlas-stage", tabindex: "0" });
    this.emptyState = el(
      "div",
      { class: "atlas-empty-hint" },
      "Click a family to start — space to play/pause, ←/→ to move between genres, ↑/↓ to zoom."
    );
    this.stage.appendChild(this.emptyState);
    main.appendChild(this.stage);

    const side = el("div", { class: "atlas-side" });
    this.playerMount = el("div", { class: "atlas-player-mount" });
    this.playerMount.hidden = true; // shown while a genre is open
    side.appendChild(this.playerMount);
    this.panelMount = el("div", { class: "atlas-panel-mount" });
    this.panelPlaceholder = el(
      "div",
      { class: "atlas-panel-placeholder" },
      "Select a genre to see its details, hear its clip, and browse its neighbours."
    );
    this.panelMount.appendChild(this.panelPlaceholder);
    side.appendChild(this.panelMount);
    main.appendChild(side);

    this.root.appendChild(main);

    this.stage.addEventListener("keydown", (e) => this.onKeyDown(e));
    this.root.addEventListener("keydown", (e) => {
      if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
      if ((e.target as HTMLElement).closest("input, select, textarea")) return;
      e.preventDefault();
      this.search?.focus();
    });
    this.root.addEventListener("pointerdown", () => {
      this.hasGesture = true;
    });
  }

  async init(): Promise<void> {
    this.root.classList.add("loading");
    this.atlas = await loadAtlas();
    this.assignFamilyColors();
    this.search = new AtlasSearch(this.atlas, { onPick: (id) => this.goToGenre(id), onQuery: () => this.applyHighlight() });
    this.searchMount.appendChild(this.search.root);
    // every view rebuilds its DOM on a selection; keep the search highlight on the new one
    new MutationObserver(() => this.queueHighlight()).observe(this.stage, { childList: true, subtree: true });
    this.player = new AtlasPlayer(this.playerMount, {
      onEnded: () => {
        if (this.autoAdvance) this.advance();
      },
      onError: (record) => this.player!.fallbackToLocal(record),
      onStateLabel: (label) => {
        this.mini?.tick();
        this.stateLabelEl.textContent = {
          loading: "Loading…",
          playing: "▶ Playing",
          paused: "⏸ Paused",
          ready: "⏵ Press play (space)",
          ended: "↻ Finished — press play to replay",
          error: "⚠ Couldn't play this one",
        }[label];
      },
    });
    this.mini = new MiniPlayer({
      position: () => this.player?.position() ?? null,
      isPlaying: () => this.player?.isPlaying() ?? false,
      toggle: () => this.player?.togglePause(),
      seek: (seconds) => this.player?.seek(seconds),
      step: (direction) => this.stepQueue(direction),
      canStep: (direction) => this.canStepQueue(direction),
      close: () => this.closeGenre(true),
      reveal: () => this.opts.reveal?.(),
    });
    this.root.classList.remove("loading");
    this.render();
  }

  /** The Stats tab was swapped for this one: draw whatever could not be drawn while it was hidden. */
  onShown(): void {
    if (!this.renderPending) return;
    this.renderPending = false;
    this.render();
  }

  // --------------------------------------------------------------- colors --
  private assignFamilyColors(): void {
    this.familyColor = buildFamilyColorMap(this.atlas!.families);
  }

  // ------------------------------------------------------------- rendering --
  private render(): void {
    this.renderBreadcrumb();
    this.renderStage();
  }

  private renderBreadcrumb(): void {
    this.breadcrumbEl.replaceChildren();
    const home = el("button", { class: "atlas-crumb", type: "button" }, "Home");
    home.addEventListener("click", () => this.goTo(0));
    this.breadcrumbEl.appendChild(home);

    // Collapse runs of consecutive identical labels into one crumb -- a
    // family whose sole top-level genre shares its exact RYM name (e.g.
    // "Classical Music" the family AND the genre sitting at its own root)
    // used to render as two identical crumbs: "Home › Classical Music ›
    // Classical Music" (user request 2026-09-23: "it should just say 'home
    // -> classical music'"). The surviving crumb jumps to the deeper of the
    // matching depths, i.e. straight past the redundant one.
    const groups: { label: string; lastIndex: number }[] = [];
    this.stack.forEach((id, i) => {
      const last = groups[groups.length - 1];
      if (last && last.label === id) last.lastIndex = i;
      else groups.push({ label: id, lastIndex: i });
    });
    groups.forEach((g) => {
      this.breadcrumbEl.appendChild(el("span", { class: "atlas-crumb-sep" }, "›"));
      const btn = el("button", { class: "atlas-crumb", type: "button" }, g.label);
      if (g.lastIndex === this.stack.length - 1) btn.setAttribute("aria-current", "true");
      btn.addEventListener("click", () => this.goTo(g.lastIndex + 1));
      this.breadcrumbEl.appendChild(btn);
    });
  }

  private goTo(depth: number): void {
    this.stack = this.stack.slice(0, depth);
    this.render();
  }

  /** The set of node ids to draw as bubbles at the current stack depth. */
  private currentDisplaySet(): string[] {
    const atlas = this.atlas!;
    if (this.stack.length === 0) return atlas.families;
    if (this.stack.length === 1) return atlas.roots.get(this.stack[0]) ?? [];
    const parent = this.stack[this.stack.length - 1];
    return atlas.children.get(parent) ?? [];
  }

  private setViewMode(mode: ViewMode): void {
    if (mode === this.viewMode) return;
    this.viewMode = mode;
    for (const [m, btn] of this.modeButtons) btn.setAttribute("aria-pressed", String(m === mode));
    this.renderStage();
  }

  private renderStage(): void {
    // the orbit is sized from its box, which is zero while the tab is hidden (the music goes on, and may move to the next
    // genre): draw it when the tab comes back
    if (this.root.offsetParent === null) {
      this.renderPending = true;
      return;
    }
    // Orbit wants the whole page width, with the player and track info underneath
    this.mainEl.classList.toggle("orbit-wide", this.viewMode === "orbit");
    // the orbit view runs its own animation loop; stop it before the stage is replaced
    if (this.orbit) this.orbitTime = this.orbit.elapsed();
    this.orbit?.dispose();
    this.orbit = null;
    if (this.viewMode === "list") {
      // not cleared like the other views: the list keeps its DOM (and so its
      // scroll positions and keyboard focus) from one selection to the next
      this.renderListStage();
      return;
    }
    this.stage.replaceChildren();
    if (this.viewMode === "network") {
      this.renderNetworkStage();
      return;
    }
    if (this.viewMode === "orbit") {
      this.renderOrbitStage();
      return;
    }
    const atlas = this.atlas!;
    const ids = this.currentDisplaySet();
    if (ids.length === 0) {
      this.stage.appendChild(this.emptyState);
      return;
    }

    const isHome = this.stack.length === 0;
    const family = this.stack[0];

    type Datum = { id: string; value: number; label: string; isFamily: boolean; hasChildren: boolean };
    const data: Datum[] = ids.map((id) => {
      if (isHome) {
        const releases = Object.values(atlas.genres).filter((g) => g.primary === id).length;
        return { id, value: Math.log10(releases + 10), label: id, isFamily: true, hasChildren: true };
      }
      const node = atlas.nodesByName.get(id)!;
      return {
        id,
        value: Math.log10((node.releases || 5) + 10),
        label: id,
        isFamily: false,
        hasChildren: (atlas.children.get(id)?.length ?? 0) > 0,
      };
    });

    const size = 760;
    const root = hierarchy<{ children: Datum[] }>({ children: data } as any)
      .sum((d: any) => d.value ?? 0)
      .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
    const packed = pack<{ children: Datum[] }>().size([size, size]).padding(6)(root);

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", `0 0 ${size} ${size}`);
    svg.setAttribute("class", "atlas-pack");

    for (const leaf of packed.children ?? []) {
      const d = (leaf.data as unknown) as Datum;
      const color = isHome ? this.familyColor.get(d.id)! : this.familyColor.get(family)!;
      const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
      group.setAttribute("transform", `translate(${leaf.x},${leaf.y})`);
      group.setAttribute("data-id", d.id);
      group.setAttribute("tabindex", "0");
      group.setAttribute("role", "button");
      group.setAttribute("class", "atlas-node" + (d.id === this.selectedId ? " selected" : ""));

      const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      circle.setAttribute("r", String(leaf.r));
      circle.setAttribute("fill", color);
      circle.setAttribute("fill-opacity", d.id === this.selectedId ? "0.95" : "0.55");
      circle.setAttribute("stroke", color);
      circle.setAttribute("stroke-width", d.id === this.selectedId ? "3" : "1.5");
      group.appendChild(circle);

      if (leaf.r > 20) {
        const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
        label.setAttribute("text-anchor", "middle");
        label.setAttribute("dy", "0.35em");
        label.setAttribute("font-size", String(Math.min(15, Math.max(9, leaf.r / 4))));
        label.setAttribute("class", "atlas-node-label");
        label.textContent = truncateForCircle(d.label, leaf.r);
        group.appendChild(label);
      }
      if (d.hasChildren && leaf.r > 14) {
        const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        dot.setAttribute("cx", String(leaf.r * 0.62));
        dot.setAttribute("cy", String(leaf.r * 0.62));
        dot.setAttribute("r", "3.5");
        dot.setAttribute("class", "atlas-expand-dot");
        group.appendChild(dot);
      }

      group.addEventListener("click", () => this.selectNode(d.id, isHome));
      group.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          this.selectNode(d.id, isHome);
        }
      });
      group.addEventListener("pointerenter", (e) => showTooltip(e.clientX, e.clientY, [{ label: d.label, value: "" }]));
      group.addEventListener("pointerleave", hideTooltip);
      svg.appendChild(group);
    }

    this.stage.appendChild(svg);
  }

  private renderListStage(): void {
    const atlas = this.atlas!;
    if (!this.list) this.list = new AtlasListView(atlas, this.familyColor, { onPick: (depth, id) => this.pickFromList(depth, id) });
    if (this.list.root.parentElement !== this.stage) {
      this.stage.replaceChildren(this.list.root);
      this.list.resetView();
    }
    // Whatever the other views left in `stack`, the columns need a chain in
    // which every entry is a child of the one before it.
    const chain = normaliseChain(atlas, this.stack);
    if (chain.join("\u0000") !== this.stack.join("\u0000")) {
      this.stack = chain;
      this.renderBreadcrumb();
    }
    this.list.render(chain, this.selectedId, this.sortKey);
  }

  /** A row was picked in column `depth`: keep the columns to its left, play it,
   * and (if it has subgenres) open them as the next column. Picking a row in an
   * earlier column closes the columns that were open to its right. */
  private pickFromList(depth: number, id: string): void {
    if (depth === 0) {
      this.selectNode(id, true); // a top-level genre: same as clicking it in Browse
      return;
    }
    this.stack = normaliseChain(this.atlas!, this.stack).slice(0, depth);
    this.renderBreadcrumb();
    this.selectNode(id, false);
  }

  /** Point Browse / List at `record` along its primary route (the one
   * auto-advance walks) -- its subgenres open beside it, or, for a leaf, its
   * siblings -- and select it. `forcePlay`: start the clip even with autoplay off. */
  private showGenre(record: GenreRecord, forcePlay = false): void {
    const atlas = this.atlas!;
    const chain = primaryChain(atlas, record.primary, record.name, this.compare());
    const hasKids = (atlas.children.get(record.name)?.length ?? 0) > 0;
    this.stack = !chain ? [record.primary] : hasKids || chain.length < 2 ? chain : chain.slice(0, -1);
    this.playGenre(record, forcePlay);
    this.render();
  }

  // ------------------------------------------------------- sort + search --
  private compare(): (a: string, b: string) => number {
    return makeComparator(this.atlas!, this.sortKey);
  }

  /** The walk auto-advance follows through `family`, in the current sort order. */
  private familyQueue(family: string): string[] {
    return walkFamily(this.atlas!, family, this.compare());
  }

  private savePrefs(): void {
    writePref("autoplay", this.autoplay);
    writePref("autoAdvance", this.autoAdvance);
    writePref("orbit", this.orbiting);
    writePref("sort", this.sortKey);
  }

  private setSort(key: SortKey): void {
    this.sortKey = key;
    this.savePrefs();
    const family = this.stack[0] ?? (this.selectedId ? this.atlas!.byName.get(this.selectedId)?.primary : undefined);
    if (family) this.advanceQueue = this.familyQueue(family);
    // List and Orbit draw the order; Browse and Network only feel it through auto-advance
    if (this.viewMode === "list" || this.viewMode === "orbit") this.renderStage();
  }

  /** A search result was picked: go to that genre in whichever view is showing. */
  private goToGenre(id: string): void {
    const record = this.atlas!.byName.get(id);
    if (!record) return;
    if (this.viewMode === "network") {
      this.networkChain = []; // a fresh neighbourhood, centred on it
      this.selectFromNetwork(id);
      return;
    }
    if (this.viewMode === "orbit") {
      if (this.orbitHub !== record.primary) this.orbitZoom = { ...IDENTITY_ZOOM };
      this.orbitHub = record.primary;
      this.orbitFocus = id;
    }
    this.showGenre(record);
    if (this.viewMode === "list") this.list?.focusEntry();
  }

  /** Light up what the search box matches in whatever the stage is showing.
   * Every genre element carries data-id (bubbles, list rows, orbit and network
   * nodes): matches are ringed, the routes down to them stay clear, the rest fade. */
  private applyHighlight(): void {
    const hl = this.search?.highlight() ?? null;
    if (!hl && !this.stage.classList.contains("has-highlight")) return;
    for (const node of this.stage.querySelectorAll("[data-id]")) {
      const id = node.getAttribute("data-id")!;
      const isMatch = !!hl && hl.match.has(id);
      const onRoute = !!hl && hl.ancestors.has(id);
      node.classList.toggle("hl-match", isMatch);
      node.classList.toggle("hl-route", onRoute && !isMatch);
      node.classList.toggle("hl-dim", !!hl && !onRoute);
    }
    this.stage.classList.toggle("has-highlight", !!hl);
  }

  private queueHighlight(): void {
    if (this.highlightQueued) return;
    this.highlightQueued = true;
    queueMicrotask(() => {
      this.highlightQueued = false;
      this.applyHighlight();
    });
  }

  /** An on/off button. `set` changes it from outside without calling `onChange`. */
  private makeToggle(
    cls: string,
    label: string,
    initial: boolean,
    title: string,
    onChange: (on: boolean) => void
  ): { button: HTMLButtonElement; set: (on: boolean) => void } {
    const button = el("button", { class: `atlas-btn ${cls}`, type: "button", title }, "");
    let state = initial;
    const paint = () => {
      button.textContent = `${label}: ${state ? "on" : "off"}`;
      button.setAttribute("aria-pressed", String(state));
    };
    paint();
    button.addEventListener("click", () => {
      state = !state;
      paint();
      onChange(state);
    });
    return {
      button,
      set: (on) => {
        state = on;
        paint();
      },
    };
  }

  private renderOrbitStage(): void {
    const ctl = renderOrbitGraph(this.atlas!, this.familyColor, {
      hub: this.orbitHub,
      selectedId: this.selectedId,
      zoom: this.orbitZoom,
      time: this.orbitTime,
      spin: this.orbiting,
      compare: this.compare(),
      focus: this.orbitFocus, // set by a search result, used once
      // centring a top-level genre also selects (and plays) it, like Browse view
      onHubChange: (family) => {
        this.orbitHub = family;
        if (family) this.selectFromNetwork(family, false);
        else this.closeGenre(); // the orbit was released: nothing is open any more
      },
      onSelect: (id) => {
        // a click that closed everything below the top-level genre selects the top-level genre; a family with no genre of its
        // own (Uncategorised) has nothing to show then
        if (id === this.orbitHub && !this.atlas!.byName.has(id)) this.closeGenre(false, true);
        else this.selectFromNetwork(id, false);
      },
      onZoomChange: (zoom) => {
        this.orbitZoom = zoom;
      },
    });
    this.orbitFocus = null;
    this.orbit = ctl;
    this.stage.appendChild(ctl.svg);
    // No key or hint under the orbit (user, 2026-10-10 and 10-11): the family tooltips say what a click does.
  }

  private renderNetworkStage(): void {
    const svg = renderNetworkGraph(this.atlas!, this.familyColor, this.selectedId, (id) => this.selectFromNetwork(id), {
      // The open family -> subgenre -> ... chain survives a recentre or an
      // auto-advance; it only closes when the user closes it.
      initialChain: this.networkChain,
      onChainChange: (chain) => {
        this.networkChain = chain;
      },
      onSelect: (id) => this.selectFromNetwork(id, false),
    });
    this.stage.appendChild(svg);
    const legend = el(
      "div",
      { class: "atlas-net-legend" },
      el("span", { class: "atlas-net-legend-item" }, el("span", { class: "atlas-net-swatch center" }), "this genre"),
      el("span", { class: "atlas-net-legend-item" }, el("span", { class: "atlas-net-swatch family" }), "over-genre — click to open its genres"),
      el("span", { class: "atlas-net-legend-item" }, el("span", { class: "atlas-net-swatch outline" }), "parent / child / opened genre"),
      el("span", { class: "atlas-net-legend-item" }, el("span", { class: "atlas-net-line" }), "taxonomy edge"),
      el("span", { class: "atlas-net-legend-item" }, el("span", { class: "atlas-net-line dashed" }), "family membership"),
      el("span", { class: "atlas-net-legend-item hint" }, this.selectedId
        ? "drag to push things around · click an opened genre to play it and open its subgenres · click a parent/child to recentre"
        : "click an over-genre to open its genres, then any genre to go deeper")
    );
    this.stage.appendChild(legend);
  }

  /** Re-centre the network graph on a clicked neighbour and select/play it.
   * Also resyncs `stack` to that genre's own primary-family ancestry path
   * (not just stack[0]) -- a network click can jump anywhere in the DAG, so
   * without this, toggling back to Browse view would show whatever stale
   * drill-down position was left over from before Network view was opened,
   * not the genre actually being looked at. */
  private selectFromNetwork(id: string, recentre = true): void {
    const record = this.atlas!.byName.get(id);
    if (!record) return;
    const path = record.paths.find((p) => p[0] === record.primary) ?? record.paths[0] ?? [record.primary];
    if (this.stack[0] !== path[0]) this.advanceQueue = this.familyQueue(path[0]);
    // A genre with subgenres is browsed INTO; a leaf is browsed among its
    // siblings -- otherwise switching to Browse view after selecting a leaf
    // showed an empty stage (nothing beneath it to draw).
    const hasChildren = (this.atlas!.children.get(id)?.length ?? 0) > 0;
    this.stack = hasChildren || path.length < 2 ? path : path.slice(0, -1);
    this.renderBreadcrumb();
    this.playGenre(record);
    // A genre clicked inside the open chain is selected and played in place:
    // recentring would rebuild the graph and throw away the layout.
    if (recentre) this.renderStage();
  }

  // ------------------------------------------------------------ selection --
  private selectNode(id: string, isHome: boolean): void {
    const atlas = this.atlas!;
    if (isHome) {
      const roots = atlas.roots.get(id) ?? [];
      this.enterFamily(id, roots.length === 1 ? roots[0] : null);
      return;
    }
    const node = atlas.nodesByName.get(id);
    const hasChildren = (atlas.children.get(id)?.length ?? 0) > 0;
    if (hasChildren) this.stack = [...this.stack, id];
    const record = atlas.byName.get(id);
    if (record) this.playGenre(record);
    if (hasChildren) this.render();
    else this.renderStage(); // stay at the same level, just re-highlight
  }

  private enterFamily(family: string, singleRootId: string | null): void {
    this.stack = [family];
    this.advanceQueue = this.familyQueue(family);
    if (singleRootId) {
      const record = this.atlas!.byName.get(singleRootId);
      const hasChildren = (this.atlas!.children.get(singleRootId)?.length ?? 0) > 0;
      if (hasChildren) this.stack = [family, singleRootId];
      if (record) this.playGenre(record);
    }
    this.render();
  }

  /** `forcePlay`: start the clip even with autoplay off (auto-advance moving on). */
  private playGenre(record: GenreRecord, forcePlay = false): void {
    this.selectedId = record.name;
    this.emptyState.remove();
    this.panelMount.replaceChildren(renderPanel(record, (path) => this.navigateToPath(record, path)));
    this.playerMount.hidden = false;
    this.player?.select(record, this.autoplay || forcePlay);
    this.mini?.open(record);
    if (!this.advanceQueue.includes(record.name)) {
      this.advanceQueue = this.familyQueue(this.stack[0] ?? record.primary);
    }
  }

  /** Jump to seeing `record` among its siblings on one of its OTHER ancestry
   * routes (e.g. Aggrotech's Dance route vs its Electronic route) -- the
   * clickable-breadcrumb half of "show all connections to that genre". Does
   * not change the selection or interrupt playback, only the view. */
  private navigateToPath(record: GenreRecord, path: string[]): void {
    const family = path[0];
    const parentChain = path.slice(1, -1); // everything between the family root and this genre
    this.stack = [family, ...parentChain];
    // in the list, the genre's own subgenres open beside it, as they do when it is picked
    if (this.viewMode === "list" && (this.atlas!.children.get(record.name)?.length ?? 0) > 0) this.stack.push(record.name);
    this.advanceQueue = this.familyQueue(family);
    this.renderBreadcrumb();
    this.renderStage();
  }

  /** No genre is open any more (the orbit was released, or the floating bar was closed): close the details and the video, stop
   * whatever was playing, and clear the trail between Home and the buttons (user, 2026-10-11). `redraw`: the orbit is still showing
   * the genre (closed from the bar, not by releasing the orbit's hub), so put it back to the home view too. */
  private closeGenre(redraw = false, keepHub = false): void {
    this.selectedId = null;
    if (!keepHub) this.orbitHub = null; // keepHub: the family stays open in the orbit, only its genre is closed
    this.stack = keepHub && this.orbitHub ? [this.orbitHub] : [];
    this.advanceQueue = [];
    this.player?.stop();
    this.mini?.close();
    this.playerMount.hidden = true;
    this.panelMount.replaceChildren(this.panelPlaceholder);
    this.stateLabelEl.textContent = "";
    this.renderBreadcrumb();
    if (redraw) {
      this.orbitZoom = { ...IDENTITY_ZOOM };
      this.renderStage();
    }
  }

  // --------------------------------------------------------------- keynav --
  private onKeyDown(e: KeyboardEvent): void {
    // a filter box inside the stage: its keys (space, arrows, escape) are its own
    if ((e.target as HTMLElement).closest("input, select, textarea")) return;
    if (this.viewMode === "list" && e.key.startsWith("Arrow")) {
      // the list's own rows handle (and swallow) arrow keys; one that reaches
      // here means the stage itself has focus -- move into the list
      e.preventDefault();
      this.list?.focusEntry();
      return;
    }
    if (e.key === " ") {
      e.preventDefault();
      this.player?.togglePause();
    } else if (e.key === "Escape" || e.key === "ArrowUp") {
      e.preventDefault();
      if (this.stack.length > 0) this.goTo(this.stack.length - 1);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (this.selectedId) this.selectNode(this.selectedId, this.stack.length === 0);
    } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      this.stepSibling(e.key === "ArrowRight" ? 1 : -1);
    }
  }

  private stepSibling(dir: 1 | -1): void {
    const siblings = [...this.currentDisplaySet()].sort(makeComparator(this.atlas!, this.sortKey, this.stack.length === 0));
    if (siblings.length === 0) return;
    const isHome = this.stack.length === 0;
    const currentInLevel = isHome ? this.stack[0] ?? siblings[0] : this.selectedId ?? siblings[0];
    const idx = Math.max(0, siblings.indexOf(currentInLevel));
    const next = siblings[(idx + dir + siblings.length) % siblings.length];
    if (isHome) {
      this.selectNode(next, true);
    } else if ((this.atlas!.children.get(next)?.length ?? 0) === 0) {
      const record = this.atlas!.byName.get(next);
      if (record) this.playGenre(record);
      this.renderStage();
    } else {
      this.selectNode(next, false);
    }
  }

  // ---------------------------------------------------------- auto-advance --
  /** Move on to the next genre in the family's walk, and play it -- whether or
   * not autoplay is on: switching auto-advance on is asking for exactly that. */
  private advance(): void {
    if (!this.selectedId || this.advanceQueue.length === 0) return;
    const idx = this.advanceQueue.indexOf(this.selectedId);
    if (idx < 0 || idx === this.advanceQueue.length - 1) return; // end of this family's walk
    const nextId = this.advanceQueue[idx + 1];
    this.navigateToNodeInView(nextId);
  }

  /** Previous / next genre in the family's walk (the floating bar's buttons); plays it. */
  private stepQueue(direction: 1 | -1): void {
    const i = this.selectedId ? this.advanceQueue.indexOf(this.selectedId) : -1;
    const target = i < 0 ? undefined : this.advanceQueue[i + direction];
    if (target) this.navigateToNodeInView(target);
  }

  private canStepQueue(direction: 1 | -1): boolean {
    const i = this.selectedId ? this.advanceQueue.indexOf(this.selectedId) : -1;
    return i >= 0 && !!this.advanceQueue[i + direction];
  }

  private startCuedClip(): void {
    // Flipping autoplay ON while a clip is loaded-but-not-playing (it was
    // selected while autoplay was off, so it loaded cued rather than
    // playing) should just start it -- "autoplay on" reads as "go".
    this.player?.resume();
  }

  /** Bring a leaf into the visible level (so the playing bubble is on
   * screen) by walking the tree from the family root to find its parent. */
  private navigateToNodeInView(leafId: string): void {
    const atlas = this.atlas!;
    if (this.viewMode === "list") {
      const next = atlas.byName.get(leafId);
      if (next) this.showGenre(next, true);
      return;
    }
    const family = this.stack[0];
    const parent = findParent(atlas, family, leafId, this.compare());
    this.stack = parent ? [family, parent] : [family];
    const record = atlas.byName.get(leafId);
    if (record) this.playGenre(record, true);
    this.render();
  }
}

function findParent(
  atlas: AtlasData,
  family: string,
  targetLeaf: string,
  compare: (a: string, b: string) => number
): string | null {
  const roots = [...(atlas.roots.get(family) ?? [])].sort(compare);
  for (const root of roots) {
    const found = dfsParent(atlas, root, targetLeaf, compare);
    if (found !== undefined) return found;
  }
  return null;
}

function dfsParent(
  atlas: AtlasData,
  node: string,
  target: string,
  compare: (a: string, b: string) => number,
  parent: string | null = null,
  seen: Set<string> = new Set()
): string | null | undefined {
  if (node === target) return parent;
  if (seen.has(node)) return undefined; // defensive cycle guard, see walkUnder()
  seen.add(node);
  // primaryChildren, not the also-inclusive `children`: this walks the SAME
  // tree walkFamily() used to build the auto-advance queue, in the same order,
  // so the breadcrumb an advance lands on matches the path it actually took.
  const kids = atlas.primaryChildren.get(node);
  if (!kids) return undefined;
  for (const kid of [...kids].sort(compare)) {
    const found = dfsParent(atlas, kid, target, compare, node, seen);
    if (found !== undefined) return found;
  }
  return undefined;
}

function truncateForCircle(label: string, r: number): string {
  const maxChars = Math.floor((r * 1.7) / 6);
  return label.length > maxChars ? label.slice(0, Math.max(1, maxChars - 1)) + "…" : label;
}
