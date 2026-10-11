// The viridis colour scale (Smith & van der Walt, matplotlib): perceptually uniform, monotone in lightness,
// and readable under the common colour-vision deficiencies. The 33 stops below are sampled from matplotlib's
// table; `viridis(t)` interpolates between them for any t in [0, 1] (0 = dark purple, 1 = yellow).
// The page's sequential encodings (map, heatmap), the genre-level shades and the page background all draw
// from it; the same ramp is in design.css as --v-0 ... --v-10 and --seq-100 ... --seq-700.
const STOPS = [
  "#440154",
  "#470d60",
  "#48186a",
  "#482374",
  "#472d7b",
  "#453781",
  "#424086",
  "#3e4989",
  "#3b528b",
  "#375b8d",
  "#33638d",
  "#2f6b8e",
  "#2c728e",
  "#297a8e",
  "#26828e",
  "#23898e",
  "#21918c",
  "#1f988b",
  "#1fa088",
  "#22a785",
  "#28ae80",
  "#32b67a",
  "#3fbc73",
  "#4ec36b",
  "#5ec962",
  "#70cf57",
  "#84d44b",
  "#98d83e",
  "#addc30",
  "#c2df23",
  "#d8e219",
  "#ece51b",
  "#fde725",
];

const rgb = (hex: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
const TABLE = STOPS.map(rgb);

/** viridis at t in [0, 1], as "#rrggbb". */
export function viridis(t: number): string {
  const x = Math.min(1, Math.max(0, t)) * (TABLE.length - 1);
  const i = Math.min(TABLE.length - 2, Math.floor(x));
  const f = x - i;
  const c = TABLE[i].map((v, k) => Math.round(v + (TABLE[i + 1][k] - v) * f));
  return "#" + c.map((v) => v.toString(16).padStart(2, "0")).join("");
}

/** A CSS linear-gradient of the scale (or of part of it: `from`..`to`), e.g. for a colour key bar. */
export function viridisGradient(direction = "to right", from = 0, to = 1, steps = 12): string {
  const stopsCss = Array.from({ length: steps + 1 }, (_, i) => `${viridis(from + ((to - from) * i) / steps)} ${((100 * i) / steps).toFixed(1)}%`);
  return `linear-gradient(${direction}, ${stopsCss.join(", ")})`;
}
