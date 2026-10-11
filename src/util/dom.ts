const SVG_NS = "http://www.w3.org/2000/svg";

export function svgEl<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number> = {},
  ...children: (SVGElement | Text)[]
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag) as SVGElementTagNameMap[K];
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  for (const child of children) node.appendChild(child);
  return node;
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  ...children: (HTMLElement | SVGElement | Text | string)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else node.setAttribute(k, v);
  }
  for (const child of children) {
    node.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return node;
}

export function text(value: string): Text {
  // Labels are untrusted data (genre/artist names) -- always textContent, never innerHTML.
  return document.createTextNode(value);
}

// --- one shared tooltip, positioned per-chart on hover/focus -----------------
let tooltipEl: HTMLDivElement | null = null;

function ensureTooltip(): HTMLDivElement {
  if (!tooltipEl) {
    tooltipEl = document.createElement("div");
    tooltipEl.className = "tooltip";
    document.body.appendChild(tooltipEl);
  }
  return tooltipEl;
}

export function showTooltip(x: number, y: number, rows: { label: string; value: string }[]): void {
  const tip = ensureTooltip();
  tip.replaceChildren();
  for (const row of rows) {
    const r = el("div", { class: "t-row" });
    r.appendChild(el("span", { class: "t-value" }, row.value));
    r.appendChild(el("span", { class: "t-label" }, row.label));
    tip.appendChild(r);
  }
  const pad = 14;
  const w = 260;
  let left = x + pad;
  if (left + w > window.innerWidth) left = x - w - pad;
  tip.style.left = `${left}px`;
  tip.style.top = `${Math.max(8, y - 12)}px`;
  tip.classList.add("show");
}

export function hideTooltip(): void {
  tooltipEl?.classList.remove("show");
}
