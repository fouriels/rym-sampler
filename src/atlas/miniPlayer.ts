// The floating "now playing" bar (user, 2026-10-11): previous / play-pause / next, a progress bar with the position and length of the
// song, and what is playing. It lives on <body>, not inside the atlas, so it stays put (and the audio keeps playing) when the page is
// switched to the Stats tab. It does no playback itself: it asks the atlas for the player's position and tells it what was pressed.
import type { GenreRecord } from "../types";
import { el } from "../util/dom";

export interface MiniPlayerHooks {
  /** Seconds into the song and its length (0 while unknown); null when nothing is loaded. */
  position(): { current: number; duration: number } | null;
  isPlaying(): boolean;
  toggle(): void;
  seek(seconds: number): void;
  step(direction: 1 | -1): void;
  canStep(direction: 1 | -1): boolean;
  /** Stop and dismiss the bar. */
  close(): void;
  /** Bring the atlas into view on the genre that is playing. */
  reveal(): void;
}

const ICONS = {
  prev: '<path d="M6 5h2.2v14H6zM19 5.2v13.6L8.6 12z"/>',
  next: '<path d="M15.8 5H18v14h-2.2zM5 5.2v13.6L15.4 12z"/>',
  play: '<path d="M7 4.6v14.8L19.6 12z"/>',
  pause: '<path d="M6.4 4.8h4.1v14.4H6.4zM13.5 4.8h4.1v14.4h-4.1z"/>',
  close: '<path d="M6.2 6.2l11.6 11.6M17.8 6.2L6.2 17.8" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
};

function icon(path: string): string {
  return `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="currentColor">${path}</svg>`;
}

const clock = (s: number): string => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

export class MiniPlayer {
  readonly root: HTMLElement;
  private nameEl: HTMLElement;
  private subEl: HTMLElement;
  private prevBtn: HTMLButtonElement;
  private playBtn: HTMLButtonElement;
  private nextBtn: HTMLButtonElement;
  private seekEl: HTMLInputElement;
  private timeEl: HTMLElement;
  private lengthEl: HTMLElement;
  private timer: number | null = null;
  private scrubbing = false;

  constructor(private hooks: MiniPlayerHooks) {
    const button = (cls: string, label: string, svg: string): HTMLButtonElement => {
      const b = el("button", { type: "button", class: `mp-btn ${cls}`, "aria-label": label, title: label });
      b.innerHTML = icon(svg);
      return b;
    };
    this.prevBtn = button("mp-prev", "Previous genre", ICONS.prev);
    this.playBtn = button("mp-play", "Play", ICONS.play);
    this.nextBtn = button("mp-next", "Next genre", ICONS.next);
    const closeBtn = button("mp-close", "Close the player", ICONS.close);

    this.nameEl = el("span", { class: "mp-name" });
    this.subEl = el("span", { class: "mp-sub" });
    const info = el("button", { type: "button", class: "mp-info", title: "Show it in the atlas" }, this.nameEl, this.subEl);

    this.seekEl = el("input", { type: "range", class: "mp-seek", min: "0", max: "0", step: "0.1", value: "0", "aria-label": "Position in the song" });
    this.timeEl = el("span", { class: "mp-time" }, "0:00");
    this.lengthEl = el("span", { class: "mp-length" }, "–:––");

    this.root = el(
      "div",
      { class: "mini-player", role: "region", "aria-label": "Now playing" },
      info,
      el("div", { class: "mp-controls" }, this.prevBtn, this.playBtn, this.nextBtn),
      el("div", { class: "mp-track" }, this.timeEl, this.seekEl, this.lengthEl),
      closeBtn
    );
    this.root.hidden = true;
    document.body.appendChild(this.root);

    info.addEventListener("click", () => hooks.reveal());
    this.prevBtn.addEventListener("click", () => hooks.step(-1));
    this.nextBtn.addEventListener("click", () => hooks.step(1));
    this.playBtn.addEventListener("click", () => {
      hooks.toggle();
      window.setTimeout(() => this.tick(), 60);
    });
    closeBtn.addEventListener("click", () => hooks.close());
    // dragging only previews the time; the seek happens when the thumb is released
    this.seekEl.addEventListener("input", () => {
      this.scrubbing = true;
      this.timeEl.textContent = clock(Number(this.seekEl.value));
    });
    this.seekEl.addEventListener("change", () => {
      hooks.seek(Number(this.seekEl.value));
      this.scrubbing = false;
    });
  }

  /** A genre is loaded: show the bar for it. */
  open(record: GenreRecord): void {
    this.nameEl.textContent = record.name;
    this.subEl.textContent = [record.artist, record.track].filter(Boolean).join(" — ");
    this.root.hidden = false;
    document.body.classList.add("has-mini-player");
    if (this.timer === null) this.timer = window.setInterval(() => this.tick(), 250);
    this.tick();
  }

  /** Nothing is playing any more: hide it. */
  close(): void {
    this.root.hidden = true;
    document.body.classList.remove("has-mini-player");
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
  }

  /** Redraw from the player's current state (also runs four times a second while the bar is up). */
  tick(): void {
    if (this.root.hidden) return;
    const playing = this.hooks.isPlaying();
    this.playBtn.innerHTML = icon(playing ? ICONS.pause : ICONS.play);
    this.playBtn.setAttribute("aria-label", playing ? "Pause" : "Play");
    this.playBtn.title = playing ? "Pause" : "Play";
    this.prevBtn.disabled = !this.hooks.canStep(-1);
    this.nextBtn.disabled = !this.hooks.canStep(1);
    const pos = this.hooks.position();
    const known = !!pos && pos.duration > 0;
    this.seekEl.disabled = !known;
    if (!known) {
      this.seekEl.max = "0";
      this.seekEl.value = "0";
      this.lengthEl.textContent = "–:––";
      if (!pos) this.timeEl.textContent = "0:00";
      return;
    }
    this.seekEl.max = String(pos.duration);
    this.lengthEl.textContent = clock(pos.duration);
    if (!this.scrubbing) {
      this.seekEl.value = String(pos.current);
      this.timeEl.textContent = clock(pos.current);
    }
    this.seekEl.style.setProperty("--mp-fill", `${Math.min(100, (100 * pos.current) / pos.duration).toFixed(1)}%`);
  }
}
