import "./theme.css";
import "./design.css"; // the look: viridis, frosted glass, dark by default (loaded after theme.css)
import type { Stats, GenreRecord } from "./types";
import { el } from "./util/dom";
import { compact, commas, pct, minutesLabel, countryName, INFERRED_COUNTRY_SOURCES, withThe } from "./util/format";
import { card, legend, tableToggleButton, dataTable, setTableRows } from "./charts/card";
import { kpiRow, updateTile } from "./charts/stat";
import { barList } from "./charts/barlist";
import { columnChart, type ColumnItem } from "./charts/column";
import { heatmap, SEQ_STEPS as HEAT_STEPS } from "./charts/heatmap";
import { scaleKey, retuneKey } from "./charts/scalekey";
import { Drill, byYear } from "./charts/drill";
import { treemap, type TreemapItem } from "./charts/treemap";
import { worldMap, SEQ_STEPS as MAP_STEPS } from "./charts/worldmap";
import { swarmChart } from "./charts/swarm";
import { dotHistogram } from "./charts/dothist";
import { LEVELS, levelOf, levelColor, levelPhrase, levelLegend, median } from "./charts/levels";
import { AtlasView } from "./atlas/view";
import { buildFamilyColorMap } from "./charts/familyColors";
import { copyEl, copyText, type Vars } from "./util/copy";

async function main() {
  restoreTheme(); // before anything is drawn, so there is no flash and nothing is built for the wrong theme
  const stats: Stats = await fetch("/data/stats.json").then((r) => r.json());
  const app = document.getElementById("app")!;
  const headerEl = header(stats);
  const statsBody = body(stats);
  const atlasBody = el("main", { class: "atlas-tab-body" });
  atlasBody.style.display = "none";
  app.replaceChildren(headerEl, statsBody, atlasBody, footer(stats));
  wireTabs(headerEl, statsBody, atlasBody);
  // dev server only: edit the page's words in place (util/editMode.ts); the public build drops this
  if (import.meta.env.DEV) void import("./util/editMode").then((m) => m.initEditMode());
}

function wireTabs(headerEl: HTMLElement, statsBody: HTMLElement, atlasBody: HTMLElement): void {
  const tabs = [...headerEl.querySelectorAll<HTMLButtonElement>(".tab")];
  const [statsTab, atlasTab] = tabs;
  let atlasView: AtlasView | null = null;

  statsTab.addEventListener("click", () => {
    statsTab.setAttribute("aria-selected", "true");
    atlasTab.setAttribute("aria-selected", "false");
    statsBody.style.display = "";
    atlasBody.style.display = "none"; // the atlas (and whatever is playing, and the floating bar) carries on underneath
  });
  atlasTab.addEventListener("click", () => {
    statsTab.setAttribute("aria-selected", "false");
    atlasTab.setAttribute("aria-selected", "true");
    statsBody.style.display = "none";
    atlasBody.style.display = "";
    if (!atlasView) {
      atlasView = new AtlasView(atlasBody, { reveal: () => atlasTab.click() });
      void atlasView.init();
    } else {
      atlasView.onShown();
    }
  });
}

// ---------------------------------------------------------------- chrome ---
// Where the header's two links go. The video is "All Genres by Branch" (see data/youtube_uploads.json).
const CHANNEL_URL = "https://www.youtube.com/@VirulentHorizon";
const KOFI_URL = "https://ko-fi.com/fouriels";
const GITHUB_URL = "https://github.com/fouriels/rym-sampler"; // the public copy of this site (scripts/export_public_site.py)
const ALL_GENRES_VIDEO_URL = "https://www.youtube.com/watch?v=bElxttxaPnc";

/** An external link whose words are a copy.json passage. */
function outLink(href: string, copyKey: string, cls = "", arrow = true, titleKey = ""): HTMLElement {
  const a = el("a", { href, target: "_blank", rel: "noopener noreferrer", ...(cls ? { class: cls } : {}), ...(titleKey ? { title: copyText(titleKey) } : {}) });
  a.append(copyEl("span", copyKey));
  if (arrow) a.append(" ↗");
  return a;
}

function header(stats: Stats): HTMLElement {
  const wrap = el("div", {});
  // Dark is the default; the choice is remembered. "Dark (original)" is the first dark
  // palette, kept for comparison with the softened one.
  const themeSwitch = segmented("Colour theme", "data-theme", "theme", "dark", [
    { value: "light", label: "Light", title: "Light theme" },
    { value: "dark", label: "Dark", title: "Dark theme (default)" },
    { value: "dark-classic", label: "Dark (original)", title: "The first dark theme: near-black with brighter colours" },
  ]);
  wrap.style.position = "relative";
  wrap.appendChild(el("div", { class: "header-switches" }, themeSwitch));

  const hero = el("header", { class: "hero" });
  hero.appendChild(copyEl("h1", "header.title"));
  // "by <author> · <channel>": the words are in copy.json, the addresses are here
  const byline = el("p", { class: "sub" });
  const dot = () => el("span", { class: "dot", "aria-hidden": "true" }, "·");
  byline.append(
    copyEl("span", "header.byline"),
    " ",
    outLink(KOFI_URL, "header.author", "", false, "header.authorTitle"), // the author's name links to their Ko-fi
    dot(),
    outLink(CHANNEL_URL, "header.channel"),
    dot(),
    outLink(GITHUB_URL, "header.github")
  );
  hero.appendChild(byline);
  const meta = el("div", { class: "meta" });
  meta.append(
    copyEl("span", "header.meta.snapshot"),
    copyEl("span", "header.meta.built", { date: __BUILD_DATE__ }),
    copyEl("span", "header.meta.sources")
  );
  hero.appendChild(meta);

  const tabs = el("div", { class: "tabs", role: "tablist" });
  const statsTab = el("button", { class: "tab", role: "tab", "aria-selected": "true" }, "Stats");
  const atlasTab = el("button", { class: "tab", role: "tab", "aria-selected": "false" }, "Genre Atlas");
  tabs.append(statsTab, atlasTab);
  hero.appendChild(el("div", { class: "hero-row" }, tabs, outLink(ALL_GENRES_VIDEO_URL, "header.video", "video-link")));
  wrap.appendChild(hero);
  return wrap;
}

/** A small segmented control that sets an attribute on <html> and remembers the choice. */
function segmented(
  label: string,
  attr: "data-theme",
  storageKey: string,
  fallback: string,
  options: { value: string; label: string; title: string }[]
): HTMLElement {
  const group = el("div", { class: "theme-switch", role: "group", "aria-label": label });
  const paint = () => {
    const current = document.documentElement.getAttribute(attr) ?? fallback;
    for (const b of group.querySelectorAll("button")) b.setAttribute("aria-pressed", String(b.dataset.value === current));
  };
  for (const o of options) {
    const b = el("button", { type: "button", title: o.title }, o.label);
    b.dataset.value = o.value;
    b.addEventListener("click", () => {
      document.documentElement.setAttribute(attr, o.value);
      try {
        localStorage.setItem(storageKey, o.value);
      } catch {
        /* private mode: the choice just isn't remembered */
      }
      paint();
    });
    group.appendChild(b);
  }
  requestAnimationFrame(paint);
  return group;
}

function restoreTheme() {
  let saved: string | null = null;
  try {
    saved = localStorage.getItem("theme");
  } catch {
    /* unavailable: fall back to the default */
  }
  const known = ["light", "dark", "dark-classic"];
  // Dark unless another was chosen (user, 2026-10-11): the operating system's setting is not followed.
  // index.html applies the same rule before first paint, so there is no flash of the wrong theme.
  document.documentElement.setAttribute("data-theme", saved && known.includes(saved) ? saved : "dark");
}

function footer(stats: Stats): HTMLElement {
  const f = el("footer", { class: "footer-note" });
  f.appendChild(copyEl("p", "footer.note"));
  return f;
}

// ---------------------------------------------------------------- drill ----
// Every chart opens the records behind whatever was clicked (user request
// 2026-09-24). One Drill per chart, mounted right under it.
function newDrill(stats: Stats): Drill {
  return new Drill(loadGenresLazy, new Set(stats.ancient_undated?.genres ?? []));
}

const byReleases = (a: GenreRecord, b: GenreRecord) => b.releases - a.releases || a.name.localeCompare(b.name);
const releasesColumn = { header: "Releases", cell: (g: GenreRecord) => commas(g.releases), num: true };

/** The decade buckets of the "when the chosen albums came out" chart, as a test on a record.
 * `label` is "pre-1900", "Unknown" or "1990s" -- the same rules build_site_data.py counted with. */
function inDecade(g: GenreRecord, label: string, ancient: Set<string>): boolean {
  const isAncient = ancient.has(g.name);
  if (label === "Unknown") return !g.year && !isAncient;
  if (label === PRE_1900_LABEL) return (!!g.year && g.year < 1900) || isAncient;
  return !!g.year && Math.floor(g.year / 10) * 10 === Number(label.slice(0, 4));
}
const decadeName = (label: string) => (label === PRE_1900_LABEL ? "Before 1900" : label === "Unknown" ? "No year known" : label);

// ----------------------------------------------------------------- body ----
function body(stats: Stats): HTMLElement {
  const wrap = el("main", {});
  wrap.appendChild(overviewKpis(stats));

  // Two halves (user, 2026-09-25). First: what RYM says about music, taking its catalogue as
  // complete. These are the charts worth posting. Second: facts about this dataset and about RYM's
  // own quirks -- kept on the page, lower down, and never a post candidate.
  wrap.appendChild(sectionHead("section.world"));
  wrap.appendChild(grid("one", popularityCard(stats)));
  wrap.appendChild(grid("one", treemapCard(stats)));
  wrap.appendChild(grid("one", decadeCard(stats)));
  wrap.appendChild(grid("one", decadeHeatmapCard(stats)));
  wrap.appendChild(grid("one", mapCard(stats)));
  wrap.appendChild(grid("one", durationCard(stats)));

  wrap.appendChild(sectionHead("section.dataset", true));
  wrap.appendChild(grid("one", regionalCard(stats)));
  wrap.appendChild(grid("two", overlapCard(stats), depthCard(stats)));
  wrap.appendChild(grid("two", artistsCard(stats), scriptsCard(stats)));
  wrap.appendChild(grid("one", obscurityCard(stats)));
  return wrap;
}

function sectionTitle(key: string, vars: Vars = {}): HTMLElement {
  return copyEl("h3", key, vars, { class: "section-title" });
}
function sectionHead(copy: string, quirks = false): HTMLElement {
  return el(
    "div",
    { class: quirks ? "section-head quirks" : "section-head" },
    copyEl("h3", `${copy}.title`, {}, { class: "section-title" }),
    copyEl("p", `${copy}.lede`, {}, { class: "section-lede" })
  );
}
function grid(kind: "one" | "two", ...cards: HTMLElement[]): HTMLElement {
  return el("div", { class: `grid ${kind === "two" ? "two" : ""}` }, ...cards);
}

function overviewKpis(stats: Stats): HTMLElement {
  // the countries and areas an artist is from; XE / XW are MusicBrainz's "Europe" and "Worldwide", not places
  const countries = Object.keys(stats.countries).filter((c) => !c.startsWith("X")).length;
  return kpiRow([
    { copy: "overview.genres", value: commas(stats.total_genres) },
    { copy: "overview.artists", value: commas(stats.distinct_artists), vars: { n: stats.most_sampled_artists.length } },
    { copy: "overview.families", value: String(Object.keys(stats.by_family.primary).length) },
    { copy: "overview.countries", value: String(countries) },
    ...(stats.song_time
      ? [{
          copy: "overview.songTime",
          // hours as the headline, days as the note; the hours of a single song would round to a long figure otherwise
          value: `${commas(Math.round(stats.song_time.seconds / 3600))} hours`,
          vars: { days: (stats.song_time.seconds / 86400).toFixed(1) },
        }]
      : []),
  ]);
}

// ------------------------------------------------------------- families ----
function familyColor(stats: Stats, name: string): string {
  const order = Object.entries(stats.by_family.primary).sort((a, b) => b[1] - a[1]).map(([k]) => k);
  return buildFamilyColorMap(order).get(name) ?? "var(--series-other)";
}

function popularityCard(stats: Stats): HTMLElement {
  const all = stats.top_by_releases; // biggest first
  type Row = (typeof all)[number];
  const topLevel = new Set(all.filter((d) => d.depth === 0).map((d) => d.name));
  const note = (d: Row) => `${d.primary} family · ${levelPhrase(levelOf(d.depth))}`;
  let excludeTop = false; // the switch: drop the top-level genres, and everything below re-fits

  // Two drills, each under the chart that opens it: a click on a dot and a click on a row are far apart.
  const swarmDrill = newDrill(stats);
  const listDrill = newDrill(stats);
  const swarm = swarmChart(
    all.map((d) => ({ id: d.name, label: d.name, value: d.releases, color: levelColor(levelOf(d.depth)), note: note(d) })),
    {
      noun: "releases",
      onPick: (item, mark) => void swarmDrill.show({ title: item.label, test: (g) => g.name === item.label, extra: releasesColumn }, mark),
    }
  );

  /** The four tiles' numbers for whichever genres are showing. */
  const figures = (rows: Row[]): { copy: string; value: string; vars: Vars; noteKey?: string }[] => {
    const mid = median(rows.map((d) => d.releases));
    const biggest = rows[0];
    const under100 = rows.filter((d) => d.releases < 100).length;
    const over100k = rows.filter((d) => d.releases >= 100_000);
    return [
      { copy: "popularity.tile.median", value: commas(mid), vars: {} },
      { copy: "popularity.tile.largest", value: biggest.name, vars: { n: commas(biggest.releases), x: commas(Math.round(biggest.releases / mid)) } },
      { copy: "popularity.tile.under100", value: commas(under100), vars: { share: pct((100 * under100) / rows.length, 0) } },
      {
        copy: "popularity.tile.over100k",
        value: commas(over100k.length),
        vars: { top: over100k.filter((d) => d.depth === 0).length },
        noteKey: excludeTop ? "popularity.tile.over100k.noteExcluded" : "popularity.tile.over100k.note",
      },
    ];
  };
  const stat = kpiRow(figures(all).map(({ copy, value, vars }) => ({ copy, value, vars })));
  const tiles = [...stat.querySelectorAll<HTMLElement>(".stat-tile")];

  const makeList = (rows: Row[]) =>
    barList(
      rows.slice(0, 20).map((d) => ({ label: d.name, value: d.releases, tooltip: note(d), color: levelColor(levelOf(d.depth)) })),
      {
        scale: "log",
        valueFormat: (v) => compact(v),
        onPick: (item, row) => void listDrill.show({ title: item.label, test: (g) => g.name === item.label, extra: releasesColumn }, row),
      }
    );
  const listMount = el("div", {}, makeList(all));
  const legendMount = el("div", {}, levelLegend(all, (d) => d.depth, (d) => d.releases, commas));

  // The table is the full 2,613-genre list, not just the chart's top 20 (and follows the switch).
  const tableRows = (rows: Row[]) => rows.map((d) => [d.name, d.primary, LEVELS[levelOf(d.depth)], d.releases]);
  const tbl = dataTable(["Genre", "Family", "Level", "Releases"], tableRows(all));
  const toggle = tableToggleButton(tbl);

  const box = el("input", { type: "checkbox" });
  box.addEventListener("change", () => {
    excludeTop = box.checked;
    const rows = excludeTop ? all.filter((d) => !topLevel.has(d.name)) : all;
    swarm.update((d) => !excludeTop || !topLevel.has(d.id)); // the dots glide to the re-fitted chart
    figures(rows).forEach((f, i) => updateTile(tiles[i], f));
    const list = makeList(rows);
    list.classList.add("fade-in");
    listMount.replaceChildren(list);
    legendMount.replaceChildren(levelLegend(rows, (d) => d.depth, (d) => d.releases, commas));
    setTableRows(tbl, tableRows(rows));
    swarmDrill.hide();
    listDrill.hide();
  });
  const switchRow = el("label", { class: "switch-row" }, box, copyEl("span", "popularity.toggle"));

  return card(
    {
      id: "chart-popularity",
      copy: "popularity",
      vars: { biggest: commas(all[0].releases) },
      reddit: true,
    },
    stat,
    switchRow,
    swarm,
    legendMount,
    swarmDrill.el,
    sectionTitle("popularity.listHeading"),
    listMount,
    listDrill.el,
    toggle,
    tbl
  );
}

function treemapCard(stats: Stats): HTMLElement {
  // Sized by each top-level genre's OWN count, which already includes all its subgenres. (The first
  // version summed every genre in a family, so Rock's subgenres were counted again on top of Rock.)
  const top = stats.top_by_releases.filter((d) => d.depth === 0);
  const uncategorised = stats.top_by_releases.filter((d) => d.primary === "Uncategorised" && d.depth === 1);
  const cells = [
    ...top.map((d) => ({ name: d.name, releases: d.releases })),
    { name: "Uncategorised", releases: uncategorised.reduce((s, d) => s + d.releases, 0) },
  ].sort((a, b) => b.releases - a.releases);
  const total = cells.reduce((s, d) => s + d.releases, 0);
  const drill = newDrill(stats);
  const items: TreemapItem[] = cells.map((d) => ({ label: d.name, value: d.releases, color: familyColor(stats, d.name) }));
  const tbl = dataTable(
    ["Top-level genre", "Releases (incl. subgenres)", copyText("treemap.tableShare"), "Genres whose home it is"],
    cells.map((d) => [d.name, d.releases, pct((100 * d.releases) / total), stats.by_family.primary[d.name] ?? 0])
  );
  const toggle = tableToggleButton(tbl);
  const [a, b, c] = cells;
  return card(
    {
      id: "chart-treemap",
      copy: "treemap",
      vars: {
        n: top.length,
        a: a.name,
        b: b.name,
        c: c.name,
        share: pct((100 * (a.releases + b.releases + c.releases)) / total, 0),
        total: compact(total),
        u: uncategorised.length,
      },
      reddit: true,
    },
    treemap(items, {
      height: 380,
      soft: true,
      shareLabel: copyText("treemap.shareLabel"),
      onPick: (item, mark) =>
        void drill.show({ title: `${item.label} family`, test: (g) => g.primary === item.label, compare: byReleases, extra: releasesColumn }, mark),
    }),
    drill.el,
    toggle,
    tbl
  );
}

function regionalCard(stats: Stats): HTMLElement {
  const primaryShare = pct((100 * stats.by_family.primary["Regional Music"]) / stats.total_genres);
  const dagShare = pct((100 * stats.by_family.dag["Regional Music"]) / stats.total_genres);
  const branches = Object.entries(stats.regional_branches).map(([label, value]) => ({ label, value }));
  const drill = newDrill(stats);
  const list = barList(branches, {
    color: "var(--series-1)",
    onPick: (item, row) => void drill.show({ title: `${item.label} (Regional Music)`, test: (g) => g.regional_branch === item.label }, row),
  });
  const tbl = dataTable(["Region", "Genres"], branches.map((b) => [b.label, b.value]));
  const toggle = tableToggleButton(tbl);
  return card(
    {
      id: "chart-regional",
      copy: "regional",
    },
    kpiRow([
      { copy: "regional.tile.home", value: primaryShare },
      { copy: "regional.tile.under", value: dagShare },
    ]),
    list,
    drill.el,
    toggle,
    tbl
  );
}

function overlapCard(stats: Stats): HTMLElement {
  const pairs = Object.entries(stats.multi_family.top_pairs).map(([label, value]) => ({ label, value }));
  const drill = newDrill(stats);
  const list = barList(pairs.slice(0, 12), {
    color: "var(--series-1)",
    onPick: (item, row) => {
      const [a, b] = item.label.split(" + ");
      void drill.show(
        { title: item.label, test: (g) => g.over_genres.includes(a) && g.over_genres.includes(b), extra: { header: "All families", cell: (g) => g.over_genres.join(", ") } },
        row
      );
    },
  });
  return card(
    {
      id: "chart-overlap",
      copy: "overlap",
      vars: { n: commas(stats.multi_family.count), share: pct(stats.multi_family.share) },
    },
    list,
    drill.el
  );
}

function depthCard(stats: Stats): HTMLElement {
  const items: ColumnItem[] = Object.entries(stats.depths).map(([label, value]) => ({ label, value }));
  const drill = newDrill(stats);
  const examples = el("ul", {});
  examples.style.cssText = "margin:10px 0 0;padding-left:18px;font-size:12px;color:var(--text-secondary);line-height:1.7;";
  for (const ex of stats.deepest_examples.slice(0, 4)) {
    examples.appendChild(el("li", {}, `${ex.name} — ${ex.path?.join(" → ") ?? ""}`));
  }
  return card(
    {
      id: "chart-depth",
      copy: "depth",
    },
    columnChart(items, {
      height: 260,
      onPick: (item, mark) =>
        void drill.show({ title: item.label === "null" ? "No depth recorded" : `Depth ${item.label}`, test: (g) => String(g.depth) === item.label }, mark),
    }),
    drill.el,
    copyEl("p", "depth.deepest", {}, { class: "caveat", style: "margin-top:14px;margin-bottom:0;" }),
    examples
  );
}

// ------------------------------------------------------------------ time ---
const PRE_1900_LABEL = "pre-1900";
function decadeBuckets(stats: Stats): ColumnItem[] {
  const items: ColumnItem[] = [];
  let pre1900 = 0;
  for (const [decade, count] of Object.entries(stats.decades)) {
    const d = Number(decade);
    if (d < 1900) pre1900 += count;
    else items.push({ label: `${decade}s`, value: count });
  }
  items.sort((a, b) => Number(a.label.slice(0, 4)) - Number(b.label.slice(0, 4)));
  // 8 genres (ancient civilisations + anonymous medieval chant traditions --
  // Byzantine/Gregorian/Ambrosian/Old Roman Chant, Plainsong) are known to
  // have been COMPOSED pre-1900 even though the only recording is modern and
  // no specific year is fetchable -- folded into pre-1900 rather than
  // "Unknown", since the era is known even if the exact year isn't.
  const ancient = stats.ancient_undated?.count ?? 0;
  return [
    {
      label: PRE_1900_LABEL,
      value: pre1900 + ancient,
      tooltipLabel: `Before 1900 (earliest dated: 1150; plus ${ancient} genres known to have been composed pre-1900 with no specific year to pin down: ${(stats.ancient_undated?.genres ?? []).join(", ")})`,
    },
    ...items,
    { label: "Unknown", value: stats.year_unknown, highlight: true, tooltipLabel: "Modern tradition, no dateable release found" },
  ];
}

function decadeCard(stats: Stats): HTMLElement {
  const drill = newDrill(stats);
  const ancient = new Set(stats.ancient_undated?.genres ?? []);
  return card(
    {
      id: "chart-decades",
      copy: "decades",
      vars: { n: stats.year_unknown, share: pct((100 * stats.year_unknown) / stats.total_genres) },
      caveatMore: stats.ancient_undated?.count
        ? [{ key: "decades.ancient", vars: { n: stats.ancient_undated.count, list: stats.ancient_undated.genres.join(", ") } }]
        : [],
      reddit: true,
    },
    columnChart(decadeBuckets(stats), {
      height: 360,
      labelEvery: 1,
      onPick: (item, mark) =>
        void drill.show({ title: decadeName(item.label), test: (g) => inDecade(g, item.label, ancient), compare: byYear }, mark),
    }),
    drill.el
  );
}

function decadeHeatmapCard(stats: Stats): HTMLElement {
  const topFamilies = Object.entries(stats.by_family.primary).sort((a, b) => b[1] - a[1]).map(([k]) => k); // all of them, biggest first
  const allCols = new Set(Object.values(stats.decade_by_family).flatMap((m) => Object.keys(m)));
  const numericDecades = Array.from(allCols)
    .filter((d) => d !== "pre-1900")
    .sort((a, b) => Number(a) - Number(b));
  const cols = allCols.has("pre-1900") ? ["pre-1900", ...numericDecades] : numericDecades;
  const drill = newDrill(stats);
  const ancient = new Set(stats.ancient_undated?.genres ?? []);
  const colName = (c: string) => (c === "pre-1900" ? "Pre-1900" : `${c}s`);
  const heatMax = Math.max(...Object.values(stats.decade_by_family).flatMap((m) => Object.values(m)));
  const colTest = (g: GenreRecord, c: string) => inDecade(g, c === "pre-1900" ? c : `${c}s`, ancient);
  // Normalised by default (user, 2026-10-11): each family's colours are relative to ITS OWN busiest decade, so
  // a small family's shape shows instead of every cell fading to the same pale next to Regional Music's.
  const heat = heatmap(topFamilies, cols, stats.decade_by_family, {
      normalise: true,
      colLabel: (c) => (c === "pre-1900" ? "<1900" : `${c}s`), // short enough not to run into "1900s"
      onPick: ({ row, col }, mark) => {
        if (row && col) {
          void drill.show({ title: `${row} · ${colName(col)}`, test: (g) => g.primary === row && colTest(g, col), compare: byYear }, mark);
        } else if (row) {
          void drill.show({ title: `${row} · every decade`, test: (g) => g.primary === row, compare: byYear }, mark);
        } else if (col) {
          void drill.show({ title: `All families · ${colName(col)}`, test: (g) => colTest(g, col), compare: byYear }, mark);
        }
      },
    });
  const key = scaleKey({ steps: HEAT_STEPS, low: "0%", high: "100%", caption: copyEl("span", "heatmap.scaleCaptionNormalised") });
  const box = el("input", { type: "checkbox" });
  box.checked = true;
  box.addEventListener("change", () => {
    heat.setNormalise(box.checked);
    if (box.checked) retuneKey(key, "0%", "100%", "heatmap.scaleCaptionNormalised");
    else retuneKey(key, "1", String(heatMax), "heatmap.scaleCaption");
  });
  const switchRow = el("label", { class: "switch-row" }, box, copyEl("span", "heatmap.toggle"));
  return card({ id: "chart-decade-family", copy: "heatmap", reddit: true }, switchRow, heat, key, drill.el);
}

// -------------------------------------------------------------------- map ---
let genresPromise: Promise<GenreRecord[]> | null = null;
function loadGenresLazy(): Promise<GenreRecord[]> {
  if (!genresPromise) {
    genresPromise = fetch("/data/genres.json")
      .then((r) => r.json())
      .then((d: { genres: GenreRecord[] }) => d.genres);
  }
  return genresPromise;
}

function mapCard(stats: Stats): HTMLElement {
  const agreementCount = stats.country_sources?.genre_release_agreement ?? 0;
  const impliedCount = stats.country_sources?.genre_implied ?? 0;
  const discogsCount = stats.country_sources?.discogs_profile ?? 0;
  // the fine print under the map: one passage for the origin, one per inference tier that was used
  const finePrint = el("p", {});
  finePrint.appendChild(
    copyEl("span", "map.fineprint.origin", {
      n: commas(stats.country_coverage.with_country),
      total: commas(stats.total_genres),
      share: pct(stats.country_coverage.share),
      codes: Object.keys(stats.countries).length,
    })
  );
  for (const [key, n] of [
    ["map.fineprint.agreement", agreementCount],
    ["map.fineprint.discogs", discogsCount],
    ["map.fineprint.implied", impliedCount],
  ] as const) {
    if (n) finePrint.append(" ", copyEl("span", key, { n: commas(n) }));
  }
  finePrint.append(" ", copyEl("span", "map.fineprint.territories"));
  const rankedAll = Object.entries(stats.countries)
    .sort((a, b) => b[1] - a[1])
    .map(([code, value]) => ({ code, label: countryName(code), value }));
  const knownCount = stats.country_coverage.with_country;
  const [first, second] = rankedAll;
  const mapKpis = kpiRow([
    { copy: "map.tile.top", value: pct((100 * first.value) / knownCount), vars: { country: withThe(first.label), n: commas(first.value), known: commas(knownCount) } },
    { copy: "map.tile.second", value: pct((100 * second.value) / knownCount), vars: { country: withThe(second.label), n: commas(second.value) } },
    { copy: "map.tile.known", value: pct(stats.country_coverage.share), vars: { n: commas(stats.total_genres - knownCount) } },
  ]);
  const rankedList = barList(
    rankedAll.slice(0, 20).map((r) => ({ label: r.label, value: r.value, id: r.code })),
    { scale: "log", onPick: (item) => void showCountry(item.id!, item.label) }
  );
  // The table is the full list (all countries), not just the chart's top 20.
  const rankedTbl = dataTable(["Country", "Genres"], rankedAll.map((r) => [r.label, r.value]));
  const rankedToggle = tableToggleButton(rankedTbl);

  // Clicking a country on the map swaps the table below for that country's
  // actual artists + genres (user request 2026-09-23), instead of just the
  // per-country count. genres.json is lazy-loaded on first click -- the
  // dashboard tab otherwise never needs the full per-genre dataset.
  const resultsHeading = el("h3", { class: "section-title", style: "margin-top:22px;" });
  const backBtn = el("button", { class: "table-toggle", type: "button" }, "← Back to country list");
  backBtn.style.display = "none";
  backBtn.style.marginBottom = "8px";
  const resultsMount = el("div", {});

  function showCountryList(): void {
    backBtn.style.display = "none";
    resultsHeading.textContent =
      "Genres per country";
    resultsMount.replaceChildren(rankedList, rankedToggle, rankedTbl);
  }

  async function showCountry(code: string, label: string): Promise<void> {
    backBtn.style.display = "";
    resultsHeading.textContent = `Loading artists from ${label}…`;
    resultsMount.replaceChildren();
    const genres = await loadGenresLazy();
    const matched = genres.filter((g) => g.country === code);
    const genreCount = new Set(matched.map((g) => g.slug)).size;
    // Show each artist once, with each of their genres listed once. Jrpjej,
    // for example, represents both Caucasian and Circassian Folk Music.
    const byArtist = new Map<string, { names: Set<string>; inferred: boolean }>();
    for (const g of matched) {
      const entry = byArtist.get(g.artist) ?? { names: new Set<string>(), inferred: false };
      entry.names.add(g.name);
      entry.inferred ||= INFERRED_COUNTRY_SOURCES.has(g.country_source ?? "");
      byArtist.set(g.artist, entry);
    }
    const rows = [...byArtist.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([artist, entry]) => [
        artist,
        [...entry.names].sort((a, b) => a.localeCompare(b)).join(", "),
        entry.inferred ? "Inferred" : "Sourced",
      ]);
    resultsHeading.textContent = `${commas(genreCount)} genre${genreCount === 1 ? "" : "s"} (${commas(
      rows.length
    )} artist${rows.length === 1 ? "" : "s"}) from ${label}`;
    resultsMount.replaceChildren(dataTable(["Artist", "Genre(s)", "Origin basis"], rows));
  }

  backBtn.addEventListener("click", showCountryList);
  showCountryList();

  return card(
    {
      id: "chart-map",
      copy: "map",
      vars: { rank1: pct((100 * (stats.rank_used["1"] ?? 0)) / stats.total_genres, 0) },
      reddit: true,
    },
    mapKpis,
    worldMap(stats.countries, { onCountryClick: (code) => showCountry(code, countryName(code)) }),
    scaleKey({ steps: MAP_STEPS, low: "1", high: commas(Math.max(...Object.values(stats.countries))), caption: copyEl("span", "map.scaleCaption") }),
    el("details", { class: "fine-print" }, copyEl("summary", "map.fineprint.summary"), finePrint),
    backBtn,
    resultsHeading,
    resultsMount
  );
}

// ---------------------------------------------------------------- people ---
function artistsCard(stats: Stats): HTMLElement {
  const drill = newDrill(stats);
  const items = stats.most_sampled_artists.slice(0, 15).map((a) => ({ label: a.artist, value: a.genres }));
  return card(
    {
      id: "chart-artists",
      copy: "artists",
      vars: { n: commas(stats.distinct_artists), total: commas(stats.total_genres) },
    },
    barList(items, {
      unit: "genres",
      onPick: (item, row) => void drill.show({ title: item.label, test: (g) => g.artist === item.label }, row),
    }),
    drill.el
  );
}

function scriptsCard(stats: Stats): HTMLElement {
  const drill = newDrill(stats);
  const entries = Object.entries(stats.scripts).filter(([k]) => k !== "Latin");
  const items = entries.map(([label, value]) => ({
    label,
    value,
    tooltip: (stats.script_examples[label] ?? []).slice(0, 3).join(", "),
  }));
  return card(
    {
      id: "chart-scripts",
      copy: "scripts",
      vars: { n: entries.length },
    },
    barList(items, {
      scale: "log",
      onPick: (item, row) => {
        const names = new Set(stats.script_genres?.[item.label] ?? []);
        void drill.show({ title: `${item.label} script`, test: (g) => names.has(g.name) }, row);
      },
    }),
    drill.el
  );
}

// ------------------------------------------------------------- obscurity ---
function obscurityCard(stats: Stats): HTMLElement {
  if (!stats.popularity) return card({ id: "chart-obscurity", copy: "obscurity", bare: true }, el("p", {}, "No data."));
  const drill = newDrill(stats);
  const items: ColumnItem[] = Object.entries(stats.popularity.histogram)
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([bucket, value]) => ({ label: `${bucket}–${Number(bucket) + 9}`, value, id: bucket }));
  return card(
    {
      id: "chart-obscurity",
      copy: "obscurity",
      vars: { share: pct(stats.popularity.coverage) },
    },
    columnChart(items, {
      height: 260,
      onPick: (item, mark) => {
        const start = Number(item.id);
        void drill.show(
          {
            title: `Spotify popularity ${item.label}`,
            test: (g) => g.popularity != null && Math.floor(g.popularity / 10) * 10 === start,
            compare: (a, b) => (a.popularity ?? 0) - (b.popularity ?? 0) || a.name.localeCompare(b.name),
            extra: { header: "Spotify popularity", cell: (g) => String(g.popularity), num: true },
          },
          mark
        );
      },
    }),
    drill.el
  );
}

function durationCard(stats: Stats): HTMLElement {
  if (!stats.durations) return card({ id: "chart-duration", copy: "duration", bare: true }, el("p", {}, "No data."));
  const known = stats.top_by_releases.filter((d) => d.seconds != null) as (Stats["top_by_releases"][number] & { seconds: number })[];
  const med = median(known.map((d) => d.seconds));
  const longestRow = known.reduce((m, d) => (d.seconds > m.seconds ? d : m));
  const under3 = known.filter((d) => d.seconds < 180).length;
  const over10 = known.filter((d) => d.seconds >= 600).length;
  const levelMedians = LEVELS.map((_, i) => median(known.filter((d) => levelOf(d.depth) === i).map((d) => d.seconds)));
  const clock = (sec: number) => minutesLabel(sec / 60);
  const drill = newDrill(stats);
  const chart = dotHistogram(
    known.map((d) => ({
      id: d.name,
      label: d.name,
      value: d.seconds,
      color: levelColor(levelOf(d.depth)),
      stack: levelOf(d.depth),
      note: `${d.primary} family · ${levelPhrase(levelOf(d.depth))}`,
    })),
    {
      binWidth: 15,
      tailFrom: 12 * 60,
      tail: [
        { lo: 720, hi: 900, label: "12–15" },
        { lo: 900, hi: 1200, label: "15–20" },
        { lo: 1200, hi: 1800, label: "20–30" },
        { lo: 1800, hi: 3600, label: "30–60" },
        { lo: 3600, hi: Infinity, label: "1h+" },
      ],
      ticks: Array.from({ length: 13 }, (_, m) => ({ value: m * 60, label: String(m) })),
      axisTitle: copyText("duration.axisTitle"),
      valueFormat: clock,
      median: { value: med, label: `Median: ${clock(med)}` },
      callout: { id: longestRow.name, label: `Longest: ${longestRow.name} · ${clock(longestRow.seconds)}` },
      onPick: (item, mark) =>
        void drill.show(
          { title: item.label, test: (g) => g.name === item.label, extra: { header: "Length", cell: (g) => minutesLabel((g.duration_ms ?? 0) / 60000), num: true } },
          mark
        ),
    }
  );
  const longest = (stats.longest_tracks ?? []).map((t) => [t.name, `${t.artist} — ${t.track}`, minutesLabel(t.minutes)]);
  const shortest = (stats.shortest_tracks ?? []).map((t) => [t.name, `${t.artist} — ${t.track}`, `${t.seconds}s`]);
  const spread = [Math.min(...levelMedians), Math.max(...levelMedians)];
  return card(
    {
      id: "chart-duration",
      copy: "duration",
      vars: { lo: clock(spread[0]), hi: clock(spread[1]), share: pct(stats.durations.coverage), n: commas(known.length) },
      reddit: true,
    },
    kpiRow([
      { copy: "duration.tile.median", value: clock(med), vars: { mean: minutesLabel(stats.durations.mean_min) } },
      { copy: "duration.tile.under3", value: commas(under3), vars: { share: pct((100 * under3) / known.length, 0) } },
      { copy: "duration.tile.over10", value: commas(over10), vars: { share: pct((100 * over10) / known.length, 0) } },
    ]),
    chart,
    levelLegend(known, (d) => d.depth, (d) => d.seconds, clock),
    drill.el,
    sectionTitle("duration.longestHeading"),
    dataTable(["Genre", "Artist — Track", "Length"], longest.slice(0, 5)),
    sectionTitle("duration.shortestHeading"),
    dataTable(["Genre", "Artist — Track", "Length"], shortest.slice(0, 5))
  );
}

main();
