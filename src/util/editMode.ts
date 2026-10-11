// Edit the page's words in place (user request 2026-10-10). Dev server only: main.ts imports this
// behind import.meta.env.DEV, so the public build never contains it. Every element made by copyEl()
// becomes editable; live numbers show as chips; Save posts the changed templates to the dev server
// (/__copy, see vite.config.ts), which writes src/copy.json and keeps a timestamped backup.
import { copyTemplate, renderTemplate, varsFor } from "./copy";

const FLAG = "copyEdit";
const dirty = new Set<HTMLElement>();
let on = false;
let bar: HTMLElement;
let status: HTMLElement;
let toggle: HTMLButtonElement;

const all = () => [...document.querySelectorAll<HTMLElement>("[data-copy-key]")];
const keyOf = (e: HTMLElement) => e.dataset.copyKey!;
const owner = (t: EventTarget | null) => (t instanceof Element ? (t.closest("[data-copy-key]") as HTMLElement | null) : null);

/** The template an element now holds: text, {chips} and <b> only. */
function serialise(node: Node): string {
  let out = "";
  for (const c of node.childNodes) {
    if (c.nodeType === Node.TEXT_NODE) out += (c.textContent ?? "").replace(/ /g, " ");
    else if (c instanceof HTMLElement) {
      if (c.dataset.var) out += `{${c.dataset.var}}`;
      else if (c.tagName === "B" || c.tagName === "STRONG") out += `<b>${serialise(c)}</b>`;
      else if (c.tagName !== "BR") out += serialise(c);
    }
  }
  return out.replace(/<b><\/b>/g, "");
}
const names = (tpl: string) => new Set([...tpl.matchAll(/\{([A-Za-z0-9_]+)\}/g)].map((m) => m[1]));

function setEditable(e: HTMLElement, editing: boolean): void {
  renderTemplate(e, copyTemplate(keyOf(e)) ?? "", varsFor(e), editing);
  if (editing) {
    e.contentEditable = "true";
    e.classList.add("copy-editable");
  } else {
    e.removeAttribute("contenteditable");
    e.classList.remove("copy-editable");
  }
}

function paint(): void {
  const n = dirty.size;
  status.textContent = on ? (n ? `${n} passage${n === 1 ? "" : "s"} changed` : "Click any dashed text to edit it") : "";
  bar.classList.toggle("on", on);
  bar.classList.toggle("has-changes", n > 0);
  toggle.textContent = on ? "Done" : "✎ Edit text";
}

function enable(): void {
  on = true;
  document.querySelectorAll<HTMLDetailsElement>("details").forEach((d) => (d.open = true));
  all().forEach((e) => setEditable(e, true));
  try {
    sessionStorage.setItem(FLAG, "1");
  } catch {
    /* fine */
  }
  paint();
}

function disable(): void {
  if (dirty.size && !confirm(`Throw away ${dirty.size} unsaved change${dirty.size === 1 ? "" : "s"}?`)) return;
  dirty.clear();
  on = false;
  all().forEach((e) => setEditable(e, false));
  try {
    sessionStorage.removeItem(FLAG);
  } catch {
    /* fine */
  }
  paint();
}

function discard(): void {
  for (const e of dirty) setEditable(e, true);
  dirty.clear();
  paint();
}

async function save(): Promise<void> {
  const changes: Record<string, string> = {};
  const problems: string[] = [];
  for (const e of dirty) {
    const key = keyOf(e);
    const tpl = serialise(e).trim();
    const had = names(copyTemplate(key) ?? "");
    const has = names(tpl);
    const unknown = [...has].filter((n) => !(n in varsFor(e)));
    if (unknown.length) problems.push(`"${key}" uses {${unknown.join("}, {")}}, which isn't a number this passage is given.`);
    const dropped = [...had].filter((n) => !has.has(n));
    if (dropped.length && !confirm(`In "${key}" you removed {${dropped.join("}, {")}} — the live number won't appear there any more. Keep that change?`)) return;
    changes[key] = tpl;
  }
  if (problems.length) return void alert(problems.join("\n"));
  status.textContent = "Saving…";
  try {
    const r = await fetch("/__copy", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(changes) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error ?? r.statusText);
    dirty.clear();
    status.textContent = `Saved ${j.saved} passage${j.saved === 1 ? "" : "s"} — reloading…`;
    setTimeout(() => location.reload(), 150); // Vite reloads on its own too; this just makes sure
  } catch (err) {
    status.textContent = "Not saved";
    alert(`Could not save: ${err instanceof Error ? err.message : err}`);
  }
}

export function initEditMode(): void {
  const style = document.createElement("style");
  style.textContent = `
    #copy-bar { position: fixed; right: 16px; bottom: 16px; z-index: 100; display: flex; gap: 8px; align-items: center;
      font: 13px/1.3 system-ui, sans-serif; background: #1d1b16; color: #f4f0e6; padding: 8px 10px; border-radius: 10px;
      box-shadow: 0 4px 18px rgba(0,0,0,.35); }
    #copy-bar button { font: inherit; border: 1px solid #6b665a; background: transparent; color: inherit; border-radius: 6px; padding: 4px 10px; cursor: pointer; }
    #copy-bar button:hover { border-color: #f4f0e6; }
    #copy-bar .save { background: #d2532c; border-color: #d2532c; color: #fff; display: none; }
    #copy-bar .discard { display: none; }
    #copy-bar.has-changes .save, #copy-bar.has-changes .discard { display: inline-block; }
    #copy-bar .status { opacity: .85; max-width: 320px; }
    #copy-bar:not(.on) .status { display: none; }
    .copy-editable { outline: 1px dashed #d2532c; outline-offset: 2px; cursor: text; min-width: 1em; border-radius: 2px; }
    .copy-editable:hover { background: rgba(210, 83, 44, .08); }
    .copy-editable:focus { outline: 2px solid #d2532c; background: rgba(210, 83, 44, .12); }
    .copy-chip { background: #d2532c; color: #fff; border-radius: 4px; padding: 0 5px; margin: 0 1px; font-weight: 600; }
  `;
  document.head.appendChild(style);

  bar = document.createElement("div");
  bar.id = "copy-bar";
  status = document.createElement("span");
  status.className = "status";
  const saveBtn = Object.assign(document.createElement("button"), { className: "save", textContent: "Save", type: "button" });
  const discardBtn = Object.assign(document.createElement("button"), { className: "discard", textContent: "Discard", type: "button" });
  toggle = Object.assign(document.createElement("button"), { type: "button", textContent: "✎ Edit text" });
  saveBtn.addEventListener("click", () => void save());
  discardBtn.addEventListener("click", discard);
  toggle.addEventListener("click", () => (on ? disable() : enable()));
  bar.append(status, saveBtn, discardBtn, toggle);
  document.body.appendChild(bar);

  document.addEventListener("input", (e) => {
    const t = owner(e.target);
    if (on && t) {
      dirty.add(t);
      paint();
    }
  });
  document.addEventListener(
    "keydown",
    (e) => {
      if (!on || !owner(e.target)) return;
      if (e.key === "Enter") e.preventDefault(); // one paragraph per passage
      if ((e.ctrlKey || e.metaKey) && ["i", "u"].includes(e.key.toLowerCase())) e.preventDefault(); // bold is the only styling kept
    },
    true
  );
  // a summary toggles on click / Space, and a label toggles its checkbox: not while its text is being edited
  const quiet = (e: Event) => {
    if (on && owner(e.target)?.closest("summary, label")) e.preventDefault();
  };
  document.addEventListener("click", quiet, true);
  document.addEventListener(
    "keyup",
    (e) => {
      if (e.key === " ") quiet(e);
    },
    true
  );
  document.addEventListener(
    "paste",
    (e) => {
      if (!on || !owner(e.target)) return;
      e.preventDefault();
      document.execCommand("insertText", false, e.clipboardData?.getData("text/plain") ?? "");
    },
    true
  );
  window.addEventListener("beforeunload", (e) => {
    if (dirty.size) e.preventDefault();
  });

  paint();
  try {
    if (sessionStorage.getItem(FLAG) === "1") enable();
  } catch {
    /* fine */
  }
}
