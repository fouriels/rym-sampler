// Hover, click and keyboard for charts drawn as thousands of small dots (the releases beeswarm, the
// track-length dot histogram). A 2px dot cannot be hit-tested sensibly, so the pointer picks the
// NEAREST dot within HIT chart units; the arrow keys step through the dots in `order`; Enter opens.
import { svgEl, showTooltip, hideTooltip } from "../util/dom";

const HIT = 9;

export interface DotPicking<T> {
  items: T[];
  cx: number[];
  cy: number[];
  dots: SVGElement[];
  radius: number;
  /** Item indices in keyboard order (ascending value). */
  order: number[];
  /** False for an item that is not showing (filtered out): it can be neither hovered nor stepped to. */
  isOn?: (i: number) => boolean;
  tipRows: (item: T) => { label: string; value: string }[];
  onPick?: (item: T, mark: SVGElement) => void;
}

export function attachDotPicking<T>(svg: SVGSVGElement, p: DotPicking<T>): { clear: () => void } {
  const showing = (i: number) => p.isOn?.(i) ?? true;
  const ring = svgEl("circle", { class: "swarm-focus", r: p.radius + 3.5, cx: 0, cy: 0 });
  ring.style.display = "none";
  svg.appendChild(ring);

  let active = -1;
  function setActive(i: number, at?: { x: number; y: number }): void {
    if (i < 0) {
      active = -1;
      ring.style.display = "none";
      svg.style.cursor = "";
      hideTooltip();
      return;
    }
    active = i;
    ring.setAttribute("cx", String(p.cx[i]));
    ring.setAttribute("cy", String(p.cy[i]));
    ring.style.display = "";
    svg.style.cursor = p.onPick ? "pointer" : "";
    const b = p.dots[i].getBoundingClientRect();
    showTooltip(at?.x ?? b.right, at?.y ?? b.top, p.tipRows(p.items[i]));
  }
  function nearest(e: MouseEvent): number {
    const ctm = svg.getScreenCTM();
    if (!ctm) return -1;
    const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    let best = -1;
    let bestD = HIT * HIT;
    for (let i = 0; i < p.cx.length; i++) {
      if (!showing(i)) continue;
      const d = (p.cx[i] - pt.x) ** 2 + (p.cy[i] - pt.y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }
  const onPointer = (e: PointerEvent) => {
    const i = nearest(e);
    if (i < 0) setActive(-1);
    else setActive(i, { x: e.clientX, y: e.clientY });
  };
  svg.addEventListener("pointermove", onPointer);
  svg.addEventListener("pointerdown", onPointer); // a touch has no hover, so the first touch names the dot
  svg.addEventListener("pointerleave", () => setActive(-1));
  svg.addEventListener("click", (e) => {
    const i = nearest(e);
    if (i >= 0 && p.onPick) p.onPick(p.items[i], p.dots[i]);
  });

  svg.tabIndex = 0;
  svg.addEventListener("keydown", (e) => {
    const order = p.order.filter(showing);
    const pos = active < 0 ? -1 : order.indexOf(active);
    const last = order.length - 1;
    let next: number | null = null;
    if (e.key === "ArrowRight" || e.key === "ArrowUp") next = active < 0 ? Math.floor(last / 2) : Math.min(last, pos + 1);
    else if (e.key === "ArrowLeft" || e.key === "ArrowDown") next = active < 0 ? Math.floor(last / 2) : Math.max(0, pos - 1);
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = last;
    else if (e.key === "Escape") setActive(-1);
    else if ((e.key === "Enter" || e.key === " ") && active >= 0 && p.onPick) p.onPick(p.items[active], p.dots[active]);
    else return;
    e.preventDefault();
    if (next != null) setActive(order[next]);
  });
  svg.addEventListener("blur", () => setActive(-1));
  return { clear: () => setActive(-1) };
}
