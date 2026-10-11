// The words on the page live in src/copy.json, not in the code, so they can be edited in place
// (util/editMode.ts, dev server only) or in any text editor. A template may contain
//   {name}   a live number or name the code supplies (shown as a chip while editing), and
//   <b>...</b>  bold.
// Everything else is literal text. Keys look like "popularity.caveat".
import raw from "../copy.json";
import { el } from "./dom";

export type Vars = Record<string, string | number>;

const store = raw as Record<string, string>;
const varsMap = new WeakMap<Element, Vars>();

export const hasCopy = (key: string): boolean => key in store;
export const copyTemplate = (key: string): string | undefined => store[key];
/** The live values an element was built with (the editor shows them in the chips). */
export const varsFor = (node: Element): Vars => varsMap.get(node) ?? {};

const TOKEN = /(<\/?b>|\{[A-Za-z0-9_]+\})/;

/** Fill `into` with a template. `edit` shows each {name} as a non-editable chip carrying its live value. */
export function renderTemplate(into: Element, tpl: string, vars: Vars, edit = false): void {
  into.replaceChildren();
  let parent: Element = into;
  for (const part of tpl.split(TOKEN)) {
    if (!part) continue;
    if (part === "<b>") {
      const b = document.createElement("b");
      parent.appendChild(b);
      parent = b;
    } else if (part === "</b>") {
      if (parent !== into) parent = parent.parentElement ?? into;
    } else if (part.startsWith("{") && part.endsWith("}")) {
      const name = part.slice(1, -1);
      if (!(name in vars)) {
        console.warn(`copy: no value for ${part}`);
        parent.appendChild(document.createTextNode(part));
      } else if (edit) {
        const chip = document.createElement("span");
        chip.className = "copy-chip";
        chip.contentEditable = "false";
        chip.dataset.var = name;
        chip.title = `{${name}} is a live number: move it or delete it, but don't retype it`;
        chip.textContent = String(vars[name]);
        parent.appendChild(chip);
      } else {
        parent.appendChild(document.createTextNode(String(vars[name])));
      }
    } else {
      parent.appendChild(document.createTextNode(part));
    }
  }
}

/** Redraw a copy element with new live values (and, optionally, another passage), e.g. when a filter changes a number. */
export function updateCopy(node: HTMLElement, vars: Vars, key?: string): void {
  if (key) node.dataset.copyKey = key;
  varsMap.set(node, vars);
  const tpl = store[node.dataset.copyKey ?? ""];
  renderTemplate(node, tpl ?? `[missing text: ${node.dataset.copyKey}]`, vars, node.classList.contains("copy-editable"));
}

/** A passage as plain text (for a chart's own label), {names} filled in and <b> dropped. A missing passage or value is an error. */
export function copyText(key: string, vars: Vars = {}): string {
  const tpl = store[key];
  if (tpl === undefined) throw new Error(`copy.json has no "${key}"`);
  return tpl.replace(/<\/?b>/g, "").replace(/\{([A-Za-z0-9_]+)\}/g, (_m, name: string) => {
    if (!(name in vars)) throw new Error(`"${key}" needs a value for {${name}}`);
    return String(vars[name]);
  });
}

/** An element whose text is the template under `key`, filled with `vars`. */
export function copyEl<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  key: string,
  vars: Vars = {},
  attrs: Record<string, string> = {}
): HTMLElementTagNameMap[K] {
  const node = el(tag, attrs);
  node.dataset.copyKey = key;
  varsMap.set(node, vars);
  const tpl = store[key];
  if (tpl === undefined) console.warn(`copy: no text for "${key}"`);
  renderTemplate(node, tpl ?? `[missing text: ${key}]`, vars);
  return node;
}
