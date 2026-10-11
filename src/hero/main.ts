// Hero images (user's design bar, 2026-09-22: "not just blue bars on a white background"). Compositions at a
// fixed 2000 x 1500, each led by its finding rather than its chart type, with the caveat the finding needs
// written on the image. Rendered to PNG by scripts/render-hero-images.mjs; preview one with
// /hero.html?which=popularity|map|treemap|decades|heatmap|duration|regional.
//
// Redrawn 2026-10-11 in the dashboard's dark viridis look, and extended from the first two candidates to all
// six r/dataisbeautiful candidates (the six cards the dashboard marks `reddit: true`). Regional is a quirk of
// how RYM files genres, not a fact about music, so it stays here for reference but is not in the default
// render set (user, 2026-09-25: facts about music, taking RYM as complete, are worth posting; facts about the
// dataset or RYM's own quirks are not). Every sentence on the canvas comes from copy.json (hero.*).
import { geoEqualEarth, geoPath } from "d3-geo";
import { hierarchy, treemap as d3treemap, treemapSquarify } from "d3-hierarchy";
import { feature } from "topojson-client";
import worldTopo from "world-atlas/countries-110m.json";
import countryIds from "../data/country-topo-ids.json";
import type { GenreRecord, Stats } from "../types";
import { el, svgEl } from "../util/dom";
import { commas, compact, countryName } from "../util/format";
import { copyEl, copyTemplate, varsFor, type Vars } from "../util/copy";
import { swarmLayout } from "../charts/swarm";
import { LEVELS, levelOf, median as medianOf } from "../charts/levels";
import { viridis } from "../charts/viridis";

const W = 2000;
const H = 1500;
const INK = "#f0eff9";
const INK2 = "#bcbad2";
const MUTED = "#8e8ca8";
const RULE = "rgba(255,255,255,0.13)";
const FAINT = "rgba(255,255,255,0.065)";
const DARK = "#0b0e24";
const YELLOW = viridis(1);
const GREEN = viridis(0.72);
const TEAL = viridis(0.5);
// the five genre levels, as on the dashboard (--level-0 .. --level-4, dark theme)
const LEVEL_INK = ["#d2e21b", "#63cb5f", "#22a884", "#26828e", "#375a8c"];

/** A copy.json passage as plain text for an SVG label: {names} filled in, <b> dropped. A missing passage or value is an error, not a blank. */
const wordsUsed: { key: string; text: string; vars: Vars }[] = [];
function words(key: string, vars: Vars = {}): string {
  const tpl = copyTemplate(key);
  if (tpl === undefined) throw new Error(`copy.json has no "${key}"`);
  const text = tpl.replace(/<\/?b>/g, "").replace(/\{([A-Za-z0-9_]+)\}/g, (_m, name: string) => {
    if (!(name in vars)) throw new Error(`"${key}" needs a value for {${name}}`);
    return String(vars[name]);
  });
  wordsUsed.push({ key, text, vars });
  return text;
}

const txt = (s: string) => document.createTextNode(s);
const pct = (n: number, of: number, d = 1) => `${((100 * n) / of).toFixed(d)}%`;
const onFill = (t: number) => (t > 0.5 ? DARK : "#f6f5ff"); // readable type on a viridis fill at position t
function clock(sec: number): string {
  const total = Math.round(sec);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}
function put(parent: Element, x: number, y: number, s: string, attrs: Record<string, string | number> = {}): SVGElement {
  return parent.appendChild(svgEl("text", { x, y, ...attrs }, txt(s)));
}

interface Frame {
  svg: SVGSVGElement;
  /** where the free space starts, below the title and subtitle */
  top: number;
  /** where it ends, above the footer */
  bottom: number;
}

/** Kicker, title, subtitle and footer (all copy.json passages: `<copy>.kicker|title|sub|source`, plus the shared footer). */
function frame(canvas: HTMLElement, copy: string, vars: Vars, subTop?: number): Frame {
  const title = copyEl("h1", `${copy}.title`, vars, { class: "title" });
  const sub = copyEl("p", `${copy}.sub`, vars, { class: "sub" });
  const foot = el("div", { class: "foot" }, copyEl("span", `${copy}.source`, vars), copyEl("span", "hero.footer"));
  canvas.append(copyEl("div", `${copy}.kicker`, vars, { class: "kicker" }), title, sub, foot);
  const svg = svgEl("svg", { width: W, height: H, viewBox: `0 0 ${W} ${H}` });
  canvas.prepend(svg);
  sub.style.top = `${subTop ?? title.offsetTop + title.offsetHeight + 22}px`;
  return { svg, top: sub.offsetTop + sub.offsetHeight + 34, bottom: foot.offsetTop - 28 };
}

function stat(canvas: HTMLElement, x: number, y: number, w: number, big: string, colour: string, labelKey: string, vars: Vars): HTMLElement {
  const box = el("div", { class: "stat" });
  box.style.cssText = `left:${x}px;top:${y}px;width:${w}px;`;
  const n = el("div", { class: "n" }, big);
  n.style.color = colour;
  box.append(n, copyEl("div", labelKey, vars, { class: "l" }));
  canvas.appendChild(box);
  return box;
}

/** A level key: a coloured bullet per genre level with that level's median, in the same words on every image. */
function levelNote(canvas: HTMLElement, x: number, y: number, w: number, medians: string[]): HTMLElement {
  const note = el("div", { class: "note" });
  note.style.cssText = `left:${x}px;top:${y}px;width:${w}px;`;
  const levels = el("span", {});
  levels.innerHTML = LEVELS.map((_, i) => `<span style="color:${LEVEL_INK[i]}">●</span>&nbsp;${words(`hero.level.${i}`)} ${medians[i]}`).join(" &nbsp; ");
  note.append(copyEl("span", "hero.popularity.keyIntro"), " ", levels);
  canvas.appendChild(note);
  return note;
}

// -------------------------------------------------------------------------------------- regional ----
/** Regional Music: a quirk of RYM's taxonomy, not a fact about music -- NOT a Reddit candidate. */
function regional(canvas: HTMLElement, genres: GenreRecord[]): void {
  const total = genres.length;
  const famRank = new Map<string, number>();
  for (const [i, [f]] of [...genres.reduce((m, g) => m.set(g.primary, (m.get(g.primary) ?? 0) + 1), new Map<string, number>())]
    .sort((a, b) => b[1] - a[1])
    .entries()) famRank.set(f, i);
  const byFamily = (a: GenreRecord, b: GenreRecord) => (famRank.get(a.primary)! - famRank.get(b.primary)!) || a.name.localeCompare(b.name);

  const home = genres.filter((g) => g.primary === "Regional Music").sort((a, b) => (a.regional_branch ?? "").localeCompare(b.regional_branch ?? "") || a.name.localeCompare(b.name));
  const shared = genres.filter((g) => g.primary !== "Regional Music" && g.over_genres.includes("Regional Music")).sort(byFamily);
  const none = genres.filter((g) => !g.over_genres.includes("Regional Music")).sort(byFamily);
  if (home.length + shared.length + none.length !== total) throw new Error("groups do not add up");
  const under = home.length + shared.length;
  const partner = [...shared.reduce((m, g) => m.set(g.primary, (m.get(g.primary) ?? 0) + 1), new Map<string, number>())].sort((a, b) => b[1] - a[1]);

  const { svg } = frame(canvas, "hero.regional", { genres: commas(total) }, 424);
  const HOME = YELLOW;
  const SHARED = viridis(0.52);
  const NONE = "#3b3f6c";

  const COLS = 67;
  const ROWS = Math.ceil(total / COLS);
  const pitch = 18.2;
  const x0 = 700;
  const y0 = 560;
  const r = 6.3;
  const all = [...home, ...shared, ...none];
  all.forEach((_, i) => {
    const colour = i < home.length ? HOME : i < under ? SHARED : NONE;
    svg.appendChild(svgEl("circle", { cx: x0 + (i % COLS) * pitch, cy: y0 + Math.floor(i / COLS) * pitch, r, fill: colour }));
  });

  const rowY = (idx: number) => y0 + (Math.floor(idx / COLS) - 0.5) * pitch;
  const bandMid = (a: number, b: number) => (rowY(a) + rowY(b - 1) + pitch) / 2;
  const blockH = 156;
  stat(canvas, 100, bandMid(0, home.length) - blockH / 2, 500, pct(home.length, total), HOME, "hero.regional.stat.home", { n: commas(home.length) });
  stat(canvas, 100, bandMid(home.length, under) - blockH / 2, 500, pct(shared.length, total), SHARED, "hero.regional.stat.shared", {
    n: commas(shared.length),
    a: partner[0][1],
    b: partner[1][0].replace(" Music", ""),
    c: partner[1][1],
  });
  stat(canvas, 100, bandMid(under, total) - blockH / 2, 500, pct(none.length, total), MUTED, "hero.regional.stat.none", { n: commas(none.length) });

  // the bracket: everything under Regional Music
  const top = rowY(0) + pitch * 0.15;
  const bottom = rowY(under - 1) + pitch * 1.1;
  const bx = 650;
  svg.appendChild(svgEl("path", { d: `M${bx - 9} ${top} H${bx} V${bottom} H${bx - 9}`, fill: "none", stroke: SHARED, "stroke-width": 3 }));
  put(svg, 0, 0, words("hero.regional.bracket", { share: pct(under, total), n: commas(under) }), {
    "font-size": 21,
    "font-weight": 600,
    fill: SHARED,
    "text-anchor": "middle",
    transform: `translate(${bx - 22} ${(top + bottom) / 2}) rotate(-90)`,
  });

  const note = copyEl("div", "hero.regional.note", { under: commas(under), total: commas(total), home: commas(home.length) }, { class: "note" });
  note.style.cssText = `left:${x0 - 6}px;top:${y0 + ROWS * pitch + 22}px;width:1210px;`;
  canvas.appendChild(note);
}

// ------------------------------------------------------------------------------------------ map ----
function worldMap(canvas: HTMLElement, genres: GenreRecord[], stats: Stats): void {
  const counts = stats.countries;
  const known = stats.country_coverage.with_country;
  const ranked = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const us = counts.US ?? 0;
  const eu = stats.country_coverage_by_regional_branch["European Music"];
  const af = stats.country_coverage_by_regional_branch["African Music"];

  const { svg } = frame(
    canvas,
    "hero.map",
    {
      genres: commas(genres.length),
      known: commas(known),
      codes: Object.keys(counts).length,
      us: Math.round((100 * us) / known),
      unknown: commas(genres.length - known),
    },
    340
  );

  const world = feature(worldTopo as any, (worldTopo as any).objects.countries) as any;
  // Antarctica has no genres and only shrinks everything else
  const geo = { ...world, features: world.features.filter((f: any) => String(f.id) !== "010") };
  const mapW = 1440;
  const mapH = 740;
  const projection = geoEqualEarth().fitSize([mapW, mapH], geo);
  const path = geoPath(projection);
  const idToAlpha2: Record<string, string> = {};
  for (const [alpha2, id] of Object.entries(countryIds as Record<string, string>)) idToAlpha2[id] = alpha2;

  // viridis on a log scale; the lowest colour is lifted off the page so a single genre still reads as land
  const maxLog = Math.log10(Math.max(...Object.values(counts)) + 1);
  const ramp = (c: number) => viridis(0.13 + 0.87 * Math.pow(Math.log10(c + 1) / maxLog, 0.85));

  const mapG = svgEl("g", { transform: "translate(100 470)" });
  for (const f of geo.features) {
    const d = path(f);
    if (!d) continue;
    const a2 = idToAlpha2[String(parseInt(f.id, 10))];
    const c = a2 ? counts[a2] ?? 0 : 0;
    mapG.appendChild(svgEl("path", { d, fill: c > 0 ? ramp(c) : "#1a1e3d", stroke: "#0a0d26", "stroke-width": 0.7 }));
  }
  svg.appendChild(mapG);

  // the ranking
  const px = 1620;
  const py = 490;
  put(svg, px, py, words("hero.map.listHeading").toUpperCase(), { "font-size": 20, "font-weight": 600, "letter-spacing": "0.16em", fill: MUTED });
  const top = ranked.slice(0, 10);
  const barMax = 240;
  top.forEach(([code, n], i) => {
    const y = py + 44 + i * 50;
    put(svg, px, y, countryName(code), { "font-size": 25, fill: i === 0 ? INK : INK2, "font-weight": i === 0 ? 700 : 400 });
    svg.appendChild(svgEl("rect", { x: px, y: y + 9, width: Math.max(4, (n / top[0][1]) * barMax), height: 9, rx: 2, fill: ramp(n) }));
    put(svg, px + 290, y, commas(n), { "font-size": 25, "font-weight": 700, "text-anchor": "end", fill: INK });
  });

  // colour key (log scale)
  const ky = 1226;
  put(svg, 100, ky - 16, words("hero.map.scaleCaption"), { "font-size": 19, fill: MUTED });
  const stops = [1, 3, 10, 30, 100, 300, us];
  stops.forEach((s, i) => {
    svg.appendChild(svgEl("rect", { x: 100 + i * 96, y: ky, width: 92, height: 16, rx: 2, fill: ramp(s) }));
    put(svg, 100 + i * 96, ky + 40, String(s), { "font-size": 18, fill: MUTED });
  });

  const note = copyEl("div", "hero.map.note", { eu: Math.round(eu.share), af: Math.round(af.share) }, { class: "note" });
  note.style.cssText = `left:820px;top:1200px;width:1080px;`;
  canvas.appendChild(note);
}

// ------------------------------------------------------------------------------------ popularity ----
function popularity(canvas: HTMLElement, genres: GenreRecord[]): void {
  const sorted = [...genres].sort((a, b) => b.releases - a.releases);
  const rel = sorted.map((g) => g.releases);
  const median = [...rel].sort((a, b) => a - b)[Math.floor(rel.length / 2)];
  const under100 = rel.filter((v) => v < 100).length;
  const rock = sorted[0];
  // Shade = level in RYM's tree. NB the old sub-line ("the 20 biggest hold 47%...") divided by the sum of every
  // genre's count, but a genre's count already includes its subgenres', so that sum counts most releases several times over.
  const ink = (g: GenreRecord) => LEVEL_INK[levelOf(g.depth)];

  const { svg } = frame(
    canvas,
    "hero.popularity",
    { genres: commas(genres.length), rock: rock.name, median: commas(median), under100: commas(under100), share: pct(under100, rel.length, 0) },
    340
  );

  const lo = Math.log10(Math.min(...rel) * 0.8);
  const hi = Math.log10(1.25e6);
  const x = (v: number) => 110 + ((Math.log10(v) - lo) / (hi - lo)) * 1780;
  const mid = 905;
  const axisY = 1195;

  // gridlines + axis
  for (const t of [10, 100, 1000, 10000, 100000, 1000000]) {
    svg.appendChild(svgEl("line", { x1: x(t), x2: x(t), y1: 500, y2: axisY, stroke: RULE, "stroke-width": 1 }));
    put(svg, x(t), axisY + 36, t >= 1e6 ? "1M" : t >= 1000 ? `${t / 1000}K` : String(t), { "font-size": 22, fill: MUTED, "text-anchor": "middle" });
  }
  svg.appendChild(svgEl("line", { x1: 110, x2: 1890, y1: axisY, y2: axisY, stroke: MUTED, "stroke-width": 1.5 }));
  put(svg, 1890, axisY + 76, words("hero.popularity.axis"), { "font-size": 20, fill: MUTED, "text-anchor": "end" });

  // a beeswarm: dots keep their x, and stack vertically only as far as needed not to touch
  const radius = 4.6;
  const offsets = swarmLayout(genres.map((g) => g.releases), x, radius * 2 + 0.8);
  const ys = new Map(genres.map((g, i) => [g.name, offsets[i]] as const));
  for (const g of genres) svg.appendChild(svgEl("circle", { cx: x(g.releases), cy: mid + ys.get(g.name)!, r: radius, fill: ink(g) }));

  // the median
  const mx = x(median);
  svg.appendChild(svgEl("line", { x1: mx, x2: mx, y1: 520, y2: axisY, stroke: INK, "stroke-width": 2, "stroke-dasharray": "6 6" }));
  put(svg, mx + 16, 540, words("hero.popularity.median", { median: commas(median) }), { "font-size": 27, "font-weight": 700, fill: INK });
  put(svg, mx + 16, 574, words("hero.popularity.medianNote"), { "font-size": 21, fill: INK2 });

  // Rock, called out
  const rx = x(rock.releases);
  const ry = mid + ys.get(rock.name)!;
  svg.appendChild(svgEl("line", { x1: rx, x2: rx, y1: ry - 12, y2: ry - 150, stroke: YELLOW, "stroke-width": 2 }));
  put(svg, rx, ry - 190, rock.name, { "font-size": 34, "font-weight": 700, class: "serif", fill: YELLOW, "text-anchor": "end" });
  put(svg, rx, ry - 160, commas(rock.releases), { "font-size": 24, fill: INK2, "text-anchor": "end" });

  // the biggest ten, as a quiet ranking
  const lx = 1240;
  const ly = 540;
  put(svg, lx, ly, words("hero.popularity.listHeading").toUpperCase(), { "font-size": 20, "font-weight": 600, "letter-spacing": "0.16em", fill: MUTED });
  sorted.slice(1, 10).forEach((g, i) => {
    const y = ly + 40 + i * 33;
    svg.appendChild(svgEl("circle", { cx: lx + 6, cy: y - 8, r: 5.4, fill: ink(g) }));
    put(svg, lx + 26, y, g.name, { "font-size": 23, fill: INK });
    put(svg, lx + 430, y, commas(g.releases), { "font-size": 23, "font-weight": 700, "text-anchor": "end", fill: INK2 });
  });

  levelNote(canvas, 110, axisY + 100, 1500, LEVELS.map((_, i) => commas(medianOf(genres.filter((g) => levelOf(g.depth) === i).map((g) => g.releases)))));
}

// -------------------------------------------------------------------------------------- treemap ----
function wrapLabel(name: string, maxChars: number): string[] {
  const lines: string[] = [];
  let cur = "";
  for (const w of name.split(" ")) {
    if (!cur) cur = w;
    else if ((cur + " " + w).length <= maxChars) cur += " " + w;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

function treemapHero(canvas: HTMLElement, genres: GenreRecord[], stats: Stats): void {
  // Sized by each top-level genre's OWN count, which already includes all its subgenres (never sum across levels).
  const top = stats.top_by_releases.filter((d) => d.depth === 0);
  const uncategorised = stats.top_by_releases.filter((d) => d.primary === "Uncategorised" && d.depth === 1);
  const cells = [
    ...top.map((d) => ({ name: d.name, v: d.releases })),
    { name: "Uncategorised", v: uncategorised.reduce((s, d) => s + d.releases, 0) },
  ].sort((a, b) => b.v - a.v);
  const total = cells.reduce((s, d) => s + d.v, 0);
  const [a, b, c] = cells;
  const share3 = (a.v + b.v + c.v) / total;

  const { svg, top: y0, bottom } = frame(canvas, "hero.treemap", {
    genres: commas(genres.length),
    a: a.name,
    b: b.name,
    c: c.name,
    share: `${Math.round(100 * share3)}%`,
    n: top.length,
    total: compact(total),
    u: uncategorised.length,
  });

  const noteH = 80;
  const gx = 100;
  const gy = y0 + 4;
  const gw = 1800;
  const gh = bottom - noteH - gy;
  type Cell = { name?: string; v?: number; children?: { name: string; v: number }[] };
  const root = hierarchy<Cell>({ children: cells })
    .sum((d) => d.v ?? 0)
    .sort((p, q) => (q.value ?? 0) - (p.value ?? 0));
  d3treemap<Cell>().size([gw, gh]).tile(treemapSquarify.ratio(1.1)).paddingInner(5).round(true)(root);

  const unlabelled: string[] = [];
  const tOf = (v: number) => Math.pow(v / a.v, 0.42); // size -> position on the scale; the exponent keeps small cells off the page colour
  root.leaves().forEach((leaf, i) => {
    const d = leaf.data as { name: string; v: number };
    const l = leaf as unknown as { x0: number; y0: number; x1: number; y1: number };
    const w = l.x1 - l.x0;
    const h = l.y1 - l.y0;
    const t = tOf(d.v);
    const x = gx + l.x0;
    const y = gy + l.y0;
    const big = i < 3;
    svg.appendChild(svgEl("rect", { x, y, width: w, height: h, rx: 9, fill: viridis(t), stroke: big ? INK : "none", "stroke-width": big ? 3.5 : 0 }));
    const ink = onFill(t);
    // the biggest label that fits, in both directions: name (wrapped), then the share line if it fits too
    let labelled = false;
    for (const fs of [46, 36, 28, 22, 18, 15]) {
      const serif = fs >= 28;
      const maxChars = Math.floor((w - 30) / (fs * (serif ? 0.64 : 0.6)));
      if (maxChars < 4) continue;
      const lines = wrapLabel(d.name, maxChars);
      if (lines.some((s) => s.length > maxChars)) continue;
      const sfs = Math.max(16, Math.round(fs * 0.62));
      const fits = (s: string) => s.length * sfs * 0.58 <= w - 30;
      const full = `${pct(d.v, total, 1)} · ${compact(d.v)}`;
      const shareText = fs < 22 ? null : fits(full) ? full : fits(pct(d.v, total, 1)) ? pct(d.v, total, 1) : null;
      if (lines.length * fs * 1.18 + (shareText ? sfs * 1.6 : 0) + 24 > h) continue;
      lines.forEach((s, k) => put(svg, x + 16, y + 14 + fs * (1 + 1.18 * k) - 4, s, { "font-size": fs, "font-weight": 700, class: serif ? "serif" : "", fill: ink }));
      if (shareText) put(svg, x + 16, y + 14 + fs * (1 + 1.18 * lines.length) + 2, shareText, { "font-size": sfs, fill: ink, opacity: 0.88 });
      labelled = true;
      break;
    }
    if (!labelled) unlabelled.push(d.name);
  });

  const note = el("div", { class: "note" }, copyEl("span", "hero.treemap.note", { u: uncategorised.length }));
  if (unlabelled.length) note.append(el("br"), copyEl("span", "hero.treemap.small", { names: unlabelled.join(", ") }));
  note.style.cssText = `left:${gx}px;top:${gy + gh + 14}px;width:${gw}px;`;
  canvas.appendChild(note);
}

// -------------------------------------------------------------------------------------- decades ----
function decadesHero(canvas: HTMLElement, genres: GenreRecord[], stats: Stats): void {
  const decades = Array.from({ length: 13 }, (_, i) => 1900 + i * 10);
  const at = (d: number) => stats.decades[String(d)] ?? 0;
  // before 1900 = every dated year below it, plus the ancient/medieval traditions known to be older but with no single year
  const pre = Object.entries(stats.decades).filter(([k]) => Number(k) < 1900).reduce((s, [, v]) => s + v, 0) + (stats.ancient_undated?.count ?? 0);
  const bars = [{ label: words("hero.decades.pre"), v: pre }, ...decades.map((d) => ({ label: `${d}s`, v: at(d) }))];
  const n20 = at(2020);
  const n70 = at(1970);
  const n80 = at(1980);
  if (!(n20 > n70)) throw new Error("the title's claim (2020s > 1970s) no longer holds");

  const { svg, top: y0, bottom } = frame(canvas, "hero.decades", {
    genres: commas(genres.length),
    unknown: commas(stats.year_unknown),
    unknownShare: pct(stats.year_unknown, stats.total_genres, 0),
    ancient: stats.ancient_undated?.count ?? 0,
  });

  const axisMax = 400;
  const left = 190;
  const right = 1900;
  const baseY = bottom - 96;
  const plotTop = y0 + 26;
  const yOf = (v: number) => baseY - ((baseY - plotTop) * v) / axisMax;
  const slot = (right - left) / bars.length;
  const barW = slot * 0.78;

  for (const t of [0, 100, 200, 300, 400]) {
    svg.appendChild(svgEl("line", { x1: left - 10, x2: right, y1: yOf(t), y2: yOf(t), stroke: t === 0 ? MUTED : RULE, "stroke-width": t === 0 ? 1.6 : 1 }));
    put(svg, left - 24, yOf(t) + 7, String(t), { "font-size": 21, fill: MUTED, "text-anchor": "end" });
  }
  put(svg, left - 24, plotTop - 18, words("hero.decades.axis"), { "font-size": 20, fill: MUTED, "text-anchor": "end" });

  bars.forEach((d, i) => {
    const x = left + i * slot + (slot - barW) / 2;
    const t = i / (bars.length - 1);
    const hot = i === bars.length - 1;
    svg.appendChild(svgEl("rect", { x, y: yOf(d.v), width: barW, height: baseY - yOf(d.v), rx: 6, fill: viridis(t), stroke: hot ? INK : "none", "stroke-width": hot ? 3.5 : 0 }));
    put(svg, x + barW / 2, yOf(d.v) - 12, String(d.v), { "font-size": 26, "font-weight": 700, fill: hot ? YELLOW : INK2, "text-anchor": "middle" });
    put(svg, x + barW / 2, baseY + 38, d.label, { "font-size": 22, fill: hot ? INK : INK2, "font-weight": hot ? 700 : 400, "text-anchor": "middle" });
  });

  // the 1970s' height, ruled across the 2020s' bar (a dark underlay so the rule reads on the bright bar and on the page)
  const last = bars.length - 1;
  const lx = left + last * slot + (slot - barW) / 2;
  const ly = yOf(n70);
  svg.appendChild(svgEl("line", { x1: lx - 14, x2: lx + barW + 14, y1: ly, y2: ly, stroke: DARK, "stroke-width": 7, "stroke-linecap": "round" }));
  svg.appendChild(svgEl("line", { x1: lx - 14, x2: lx + barW + 14, y1: ly, y2: ly, stroke: INK, "stroke-width": 2.5, "stroke-dasharray": "7 6" }));
  put(svg, lx + barW / 2, ly + 32, words("hero.decades.rule"), { "font-size": 22, "font-weight": 700, fill: DARK, "text-anchor": "middle" });
  put(svg, lx + barW / 2, ly + 58, String(n70), { "font-size": 26, "font-weight": 700, fill: DARK, "text-anchor": "middle" });

  // the headline number, in the empty upper left of the plot
  const call = copyEl("div", "hero.decades.callout", { n20, n70, n80 }, { class: "note callout" });
  call.style.cssText = `left:${left + 10}px;top:${plotTop + 10}px;width:760px;font-size:30px;line-height:1.38;`;
  canvas.appendChild(call);
  const big = call.querySelector("b");
  if (big instanceof HTMLElement) big.style.cssText = `display:block;font-family:var(--display);font-size:150px;line-height:1;color:${YELLOW};letter-spacing:-0.02em;margin-bottom:6px;`;
}

// -------------------------------------------------------------------------------------- heatmap ----
function heatmapHero(canvas: HTMLElement, genres: GenreRecord[], stats: Stats): void {
  const dbf = stats.decade_by_family;
  const cols = ["pre-1900", ...Array.from({ length: 13 }, (_, i) => String(1900 + i * 10))];
  const colRank = (c: string) => (c === "pre-1900" ? 0 : 1 + (Number(c) - 1900) / 10);
  const rows = Object.keys(dbf)
    .map((family) => {
      const m = dbf[family];
      const n = cols.reduce((s, c) => s + (m[c] ?? 0), 0);
      const peak = cols.reduce((best, c) => ((m[c] ?? 0) > (m[best] ?? 0) ? c : best), cols[0]);
      return { family, m, n, peak, max: m[peak] ?? 0 };
    })
    .filter((r) => r.n > 0)
    .sort((p, q) => colRank(p.peak) - colRank(q.peak) || q.n - p.n);

  // the sub-line names four peaks: the picture must agree
  const claims: [string, string][] = [["Blues", "1960"], ["Rock", "1970"], ["Metal", "1990"], ["Hip Hop", "2020"]];
  for (const [f, d] of claims) {
    const row = rows.find((r) => r.family === f)!;
    const rivals = cols.filter((c) => c !== d && (row.m[c] ?? 0) >= (row.m[d] ?? 0));
    if (row.peak !== d || rivals.length) throw new Error(`${f} no longer has its single busiest decade in the ${d}s`);
  }
  const small = rows.filter((r) => r.n < 10 && r.family !== "Uncategorised").map((r) => r.family);

  const { svg, top: y0, bottom } = frame(canvas, "hero.heatmap", {
    genres: commas(genres.length),
    families: rows.length,
    small: small.length > 1 ? `${small.slice(0, -1).join(", ")} and ${small[small.length - 1]}` : small.join(""),
  });

  const labelRight = 484;
  const gx = 504;
  const colW = 96;
  const headerH = 44;
  const gy = y0 + headerH;
  const rowH = Math.min(36, Math.floor((bottom - gy - 6) / rows.length));
  const short = (f: string) => f.replace("Musical Theatre and Entertainment", "Musical Theatre & Entertainment");

  cols.forEach((c, ci) => put(svg, gx + ci * colW + colW / 2, gy - 14, c === "pre-1900" ? "<1900" : `${c}s`, { "font-size": 20, fill: MUTED, "text-anchor": "middle" }));
  put(svg, gx + cols.length * colW + 14, gy - 14, words("hero.heatmap.nLabel"), { "font-size": 20, fill: MUTED });

  rows.forEach((r, ri) => {
    const y = gy + ri * rowH;
    put(svg, labelRight, y + rowH / 2 + 7, short(r.family), { "font-size": 21, fill: INK, "text-anchor": "end", "font-weight": r.n >= 10 ? 500 : 400, opacity: r.n >= 10 ? 1 : 0.7 });
    put(svg, gx + cols.length * colW + 14, y + rowH / 2 + 6, String(r.n), { "font-size": 18, fill: MUTED });
    cols.forEach((c, ci) => {
      const v = r.m[c] ?? 0;
      const t = 0.06 + 0.94 * (v / r.max);
      const x = gx + ci * colW;
      svg.appendChild(svgEl("rect", { x: x + 2, y: y + 2, width: colW - 4, height: rowH - 4, rx: 5, fill: v > 0 ? viridis(t) : FAINT }));
      if (v > 0) put(svg, x + colW / 2, y + rowH / 2 + 6, String(v), { "font-size": 16, "font-weight": 600, fill: onFill(t), "text-anchor": "middle", opacity: 0.9 });
      if (v === r.max) svg.appendChild(svgEl("rect", { x: x + 1, y: y + 1, width: colW - 2, height: rowH - 2, rx: 6, fill: "none", stroke: INK, "stroke-width": 3 }));
    });
  });
}

// ------------------------------------------------------------------------------------- duration ----
function durationHero(canvas: HTMLElement, genres: GenreRecord[], stats: Stats): void {
  const known = stats.top_by_releases.filter((d) => d.seconds != null) as (Stats["top_by_releases"][number] & { seconds: number })[];
  const med = medianOf(known.map((d) => d.seconds));
  const longest = known.reduce((m, d) => (d.seconds > m.seconds ? d : m));
  const shortest = known.reduce((m, d) => (d.seconds < m.seconds ? d : m));
  const levelMeds = LEVELS.map((_, i) => medianOf(known.filter((d) => levelOf(d.depth) === i).map((d) => d.seconds)));
  const under3 = known.filter((d) => d.seconds < 180).length;
  const over10 = known.filter((d) => d.seconds >= 600).length;
  const hour = known.filter((d) => d.seconds >= 3600).sort((p, q) => q.seconds - p.seconds);
  const longRow = (stats.longest_tracks ?? []).find((t) => t.name === longest.name);
  const shortRow = (stats.shortest_tracks ?? []).find((t) => t.name === shortest.name);

  const { svg, top: y0, bottom } = frame(canvas, "hero.duration", {
    genres: commas(genres.length),
    n: commas(known.length),
    share: pct(known.length, genres.length, 0),
    median: clock(med),
    longest: `${Math.round(longest.seconds / 60)} minutes`,
    lo: clock(Math.min(...levelMeds)),
    hi: clock(Math.max(...levelMeds)),
  });

  const X0 = 100;
  const width = 1800;
  const tailFrom = 720;
  const tails = [[720, 900, "12–15"], [900, 1200, "15–20"], [1200, 1800, "20–30"], [1800, 3600, "30–60"], [3600, Infinity, "1h+"]] as [number, number, string][];
  const gapCols = 2;
  const tailSpan = 3.5;
  const baseY = bottom - 150;
  const availH = baseY - (y0 + 20);

  // the finest bins and the widest columns of dots that still fit the height; fewer, taller columns read better
  const colsOf = (binW: number, across: number) => {
    const nMain = Math.ceil(tailFrom / binW);
    const colW = width / (nMain + gapCols + tails.length * tailSpan);
    const colOf = (v: number) => (v < tailFrom ? Math.floor(v / binW) : nMain + Math.max(0, tails.findIndex(([lo, hi]) => v >= lo && v < hi)));
    const counts = new Map<number, number>();
    for (const d of known) counts.set(colOf(d.seconds), (counts.get(colOf(d.seconds)) ?? 0) + 1);
    const rows = Math.ceil(Math.max(...counts.values()) / across);
    return { binW, across, nMain, colW, colOf, plotH: rows * (colW / across) };
  };
  const options = [colsOf(15, 3), colsOf(20, 3), colsOf(20, 4), colsOf(30, 4)].filter((o) => o.plotH <= availH * 0.82);
  const L = options.sort((p, q) => q.plotH - p.plotH)[0] ?? colsOf(30, 4);
  const pitch = L.colW / L.across;
  const r = pitch * 0.43;
  const tailX0 = X0 + (L.nMain + gapCols) * L.colW;
  const colLeft = (c: number) => (c < L.nMain ? X0 + c * L.colW : tailX0 + (c - L.nMain) * tailSpan * L.colW + ((tailSpan - 1) * L.colW) / 2);
  const xOf = (sec: number) => X0 + (sec / L.binW) * L.colW;

  // minute gridlines and labels
  for (let m = 0; m <= 12; m++) {
    svg.appendChild(svgEl("line", { x1: xOf(m * 60), x2: xOf(m * 60), y1: baseY - L.plotH - 30, y2: baseY, stroke: m === 0 ? MUTED : RULE, "stroke-width": 1 }));
    put(svg, xOf(m * 60), baseY + 32, String(m), { "font-size": 22, fill: MUTED, "text-anchor": "middle" });
  }
  svg.appendChild(svgEl("line", { x1: X0, x2: X0 + L.nMain * L.colW, y1: baseY, y2: baseY, stroke: MUTED, "stroke-width": 1.6 }));
  put(svg, X0, baseY + 70, words("hero.duration.axis"), { "font-size": 20, fill: MUTED });
  const bx = X0 + (L.nMain + gapCols / 2) * L.colW;
  svg.appendChild(svgEl("path", { d: `M${bx - 6} ${baseY + 7} L${bx - 1} ${baseY - 7} M${bx + 1} ${baseY + 7} L${bx + 6} ${baseY - 7}`, stroke: MUTED, "stroke-width": 1.8, fill: "none" }));
  tails.forEach(([, , label], t) => {
    const left = colLeft(L.nMain + t);
    svg.appendChild(svgEl("line", { x1: left - 2, x2: left + L.colW + 2, y1: baseY, y2: baseY, stroke: MUTED, "stroke-width": 1.6 }));
    put(svg, left + L.colW / 2, baseY + 32, label, { "font-size": 19, fill: MUTED, "text-anchor": "middle" });
  });

  // the dots: stacked in their column by level, so the colours form bands
  const byCol = new Map<number, typeof known>();
  for (const d of known) byCol.set(L.colOf(d.seconds), [...(byCol.get(L.colOf(d.seconds)) ?? []), d]);
  const pos = new Map<string, { x: number; y: number }>();
  for (const [c, items] of byCol) {
    items.sort((p, q) => levelOf(p.depth) - levelOf(q.depth) || p.seconds - q.seconds || p.name.localeCompare(q.name));
    items.forEach((d, k) => {
      const x = colLeft(c) + ((k % L.across) + 0.5) * pitch;
      const y = baseY - 1.5 - (Math.floor(k / L.across) + 0.5) * pitch;
      pos.set(d.name, { x, y });
      svg.appendChild(svgEl("circle", { cx: x, cy: y, r, fill: LEVEL_INK[levelOf(d.depth)] }));
    });
  }

  // the median
  const mx = xOf(med);
  svg.appendChild(svgEl("line", { x1: mx, x2: mx, y1: baseY - L.plotH - 40, y2: baseY, stroke: INK, "stroke-width": 2.2, "stroke-dasharray": "7 6" }));
  put(svg, mx + 14, baseY - L.plotH - 42, words("hero.duration.median", { median: clock(med) }), { "font-size": 30, "font-weight": 700, fill: INK });

  // the shortest and the longest, named
  const sp = pos.get(shortest.name)!;
  const lp = pos.get(longest.name)!;
  const rise = 150;
  // shortest: its label sits above the hump's left shoulder, where nothing is plotted
  const up = 430;
  svg.appendChild(svgEl("line", { x1: sp.x, x2: sp.x, y1: sp.y - r - 4, y2: sp.y - up - 24, stroke: INK2, "stroke-width": 1.6 }));
  put(svg, sp.x + 10, sp.y - up, words("hero.duration.shortest", { name: shortest.name }), { "font-size": 24, "font-weight": 700, fill: INK });
  const latin = shortRow?.artist.match(/\[(.*)\]/);
  put(svg, sp.x + 10, sp.y - up + 28, words("hero.duration.shortestNote", { length: clock(shortest.seconds), artist: shortRow ? (latin ? latin[1] : shortRow.artist) : "" }), { "font-size": 19, fill: MUTED });
  // longest: the label stops short of its own leader line
  svg.appendChild(svgEl("line", { x1: lp.x, x2: lp.x, y1: lp.y - r - 4, y2: lp.y - rise - 70, stroke: INK2, "stroke-width": 1.6 }));
  put(svg, lp.x - 12, lp.y - rise - 80, words("hero.duration.longest", { name: longest.name, length: `${Math.floor(longest.seconds / 3600)}h ${String(Math.round((longest.seconds % 3600) / 60)).padStart(2, "0")}m` }), {
    "font-size": 24,
    "font-weight": 700,
    fill: INK,
    "text-anchor": "end",
  });
  if (longRow) put(svg, lp.x - 12, lp.y - rise - 52, words("hero.duration.longestNote", { artist: longRow.artist, track: longRow.track }), { "font-size": 19, fill: MUTED, "text-anchor": "end" });

  // three facts about the shape, in the empty upper right
  const sx = 1010;
  const sy = y0 + 10;
  const sw = 270;
  stat(canvas, sx, sy, sw, commas(under3), YELLOW, "hero.duration.stat.under3", { share: pct(under3, known.length, 0) });
  stat(canvas, sx + 300, sy, sw, commas(over10), GREEN, "hero.duration.stat.over10", { share: pct(over10, known.length, 0) });
  stat(canvas, sx + 600, sy, sw, String(hour.length), TEAL, "hero.duration.stat.hour", { names: hour.map((d) => d.name).join(", ") });

  levelNote(canvas, X0, baseY + 100, 1700, levelMeds.map(clock));
}

// ------------------------------------------------------------------------------------------------
async function main() {
  const which = new URLSearchParams(location.search).get("which") ?? "popularity";
  const canvas = document.getElementById("canvas")!;
  const [{ genres }, stats] = await Promise.all([
    fetch("/data/genres.json").then((r) => r.json() as Promise<{ genres: GenreRecord[] }>),
    fetch("/data/stats.json").then((r) => r.json() as Promise<Stats>),
  ]);
  if (which === "map") worldMap(canvas, genres, stats);
  else if (which === "popularity") popularity(canvas, genres);
  else if (which === "treemap") treemapHero(canvas, genres, stats);
  else if (which === "decades") decadesHero(canvas, genres, stats);
  else if (which === "heatmap") heatmapHero(canvas, genres, stats);
  else if (which === "duration") durationHero(canvas, genres, stats);
  else regional(canvas, genres);
  await document.fonts.ready;
  // every passage on the canvas, as it reads, with the live values it was filled with (for the copy sheet; harmless otherwise)
  const onPage = [...canvas.querySelectorAll<HTMLElement>("[data-copy-key]")].map((e) => ({ key: e.dataset.copyKey!, text: (e.textContent ?? "").replace(/\s+/g, " ").trim(), vars: varsFor(e) }));
  (window as unknown as { __heroCopy: unknown }).__heroCopy = [...onPage, ...wordsUsed];
  // /hero.html?which=...&edit=1 (dev server only): edit the words in place. Never on for the PNG render.
  if (import.meta.env.DEV && new URLSearchParams(location.search).has("edit")) void import("../util/editMode").then((m) => m.initEditMode());
  document.body.dataset.ready = "1";
}
void main();
