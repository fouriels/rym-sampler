// Choropleth of artist country -- sequential blue, log-scaled (US 546 vs a
// single-genre country needs log, not linear, to show any texture at all).
// Deliberately NOT colored by family/region identity: this is a magnitude
// question ("how many genres"), so one hue does the job and avoids the
// categorical cap entirely. See the coverage-bias companion chart alongside
// this one -- the map under-represents regions with weaker documentation
// of the featured artists. That is a coverage gap, not a statement about
// where music comes from.
import { geoEqualEarth, geoPath } from "d3-geo";
import { feature } from "topojson-client";
import worldTopo from "world-atlas/countries-110m.json";
import countryIds from "../data/country-topo-ids.json";
import { svgEl, showTooltip, hideTooltip } from "../util/dom";
import { countryName } from "../util/format";

export const SEQ_STEPS = ["--seq-150", "--seq-250", "--seq-350", "--seq-450", "--seq-550", "--seq-650", "--seq-700"];

export interface WorldMapOptions {
  height?: number;
  onCountryClick?: (alpha2: string) => void;
}

export function worldMap(counts: Record<string, number>, opts: WorldMapOptions = {}): SVGSVGElement {
  const width = 900;
  const height = opts.height ?? 400;

  const world = feature(worldTopo as any, (worldTopo as any).objects.countries) as any;
  // Antarctica has no genres and only shrinks everything else
  const geo = { ...world, features: world.features.filter((f: any) => String(f.id) !== "010") };
  const idToAlpha2: Record<string, string> = {};
  for (const [alpha2, id] of Object.entries(countryIds as Record<string, string>)) idToAlpha2[id] = alpha2;

  const projection = geoEqualEarth().fitSize([width, height - 4], geo);
  const path = geoPath(projection);

  const values = Object.values(counts).filter((v) => v > 0);
  const maxLog = Math.log10(Math.max(1, ...values) + 1);

  const svg = svgEl("svg", { class: "chart", viewBox: `0 0 ${width} ${height}`, role: "img", "aria-label": "world map of artist country" });

  for (const f of geo.features) {
    const id = String(parseInt(f.id, 10));
    const alpha2 = idToAlpha2[id];
    const count = alpha2 ? counts[alpha2] ?? 0 : 0;
    const d = path(f);
    if (!d) continue;
    let fill = "var(--gridline)";
    if (count > 0) {
      const frac = Math.log10(count + 1) / (maxLog || 1);
      const step = SEQ_STEPS[Math.min(SEQ_STEPS.length - 1, Math.round(frac * (SEQ_STEPS.length - 1)))];
      fill = `var(${step})`;
    }
    const name = alpha2 ? countryName(alpha2) : (f.properties?.name ?? "");
    const path_ = svgEl("path", {
      d, fill, stroke: "var(--surface-1)", "stroke-width": "0.6",
      "data-country-code": alpha2 ?? "",
      "aria-label": `${name}: ${count > 0 ? `${count} genre${count === 1 ? "" : "s"}` : "no data"}`,
    });
    path_.style.cursor = count > 0 ? "pointer" : "default";
    const tipRows = () => [{ label: name, value: count > 0 ? `${count} genre${count === 1 ? "" : "s"}` : "no data" }];
    path_.addEventListener("pointerenter", (e) => showTooltip(e.clientX, e.clientY, tipRows()));
    path_.addEventListener("pointermove", (e) => showTooltip(e.clientX, e.clientY, tipRows()));
    path_.addEventListener("pointerleave", hideTooltip);
    if (count > 0) {
      path_.tabIndex = 0;
      path_.addEventListener("focus", () => {
        const b = path_.getBoundingClientRect();
        showTooltip(b.left, b.top, tipRows());
      });
      path_.addEventListener("blur", hideTooltip);
      if (opts.onCountryClick && alpha2) {
        const click = () => opts.onCountryClick!(alpha2);
        path_.addEventListener("click", click);
        path_.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            click();
          }
        });
      }
    }
    svg.appendChild(path_);
  }

  return svg;
}
