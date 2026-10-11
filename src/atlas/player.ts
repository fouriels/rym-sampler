// Playback: YouTube IFrame embed first, a locally-hosted Opus file as the
// fallback -- see the "audio decision" in rym-dashboard-build-plan.md.
//
// Routing is decided from `video.embed`, the verdict scripts/check_embeddable.py
// wrote for every genre (Phase 0). The same verdict set gates which genres
// actually got a transcoded .opus file in scripts/build_site_media.py -- keep
// the two in sync if either changes.
//
// load() vs play(): these are deliberately separate. YouTube's loadVideoById
// ALWAYS starts playback immediately -- there is no "load but don't play" via
// that call. So "Autoplay: off" not stopping playback (bug report, confirmed
// live 2026-09-23) wasn't a gate-the-next-clip bug, it was this: every
// selection unconditionally called the always-plays path. load() uses
// cueVideoById (YT) / sets src without calling play() (local audio) so a
// selection can be prepared without making sound; the caller decides whether
// to follow it with resume() based on the autoplay toggle.
//
// The box has three faces and shows exactly one: the YouTube player, an audio-only card (the local file, with its
// own controls) or a note ("audio not embeddable"). NB the YouTube API REPLACES the element it is given with an
// iframe, so the box hides our own wrapper, never that element (hiding the replaced element left the previous
// genre's video on screen when a local-audio genre was opened: user bug report, 2026-10-11).
import type { GenreRecord } from "../types";
import { copyEl } from "../util/copy";

/** The auto-picked clip length; a sheet window longer than this marks a track cut from a longer video. */
export const CLIP_SECONDS = 7;

/** What to play of a YouTube video (user, 2026-10-10 and 10-11):
 *   1. the sheet gives a clip window longer than the 7-second default -- a song taken from a long upload --
 *      so exactly that window;
 *   2. the video is itself a long upload (an album, a mix, a whole work: `kind` "album", decided at build time
 *      from its real length, the track's length and YouTube's own title) -- so just 7 seconds from the clip's
 *      start, which is the hand-pinned time where there is one;
 *   3. otherwise the video is the song: play it from the start, to the end.
 * (The local fallback files, for videos that can't be embedded, are the same thing already cut: the whole song, or the
 *  sheet's window of an album -- scripts/build_site_media.py -- so they always play start to finish.) */
export function playbackWindow(video: GenreRecord["video"]): { start: number; end?: number } {
  const w = video.window;
  if (w && w[1] - w[0] > CLIP_SECONDS) return { start: w[0], end: w[1] };
  if (video.kind === "album") {
    const start = video.start ?? 0;
    return { start, end: start + CLIP_SECONDS };
  }
  return { start: 0 };
}

/** How long the song plays for: the sheet's window for a track cut from a longer video, otherwise the whole video; the recorded
 * track length only where the video's own length is not known (user, 2026-10-11: the atlas shows the length of what plays,
 * not the streaming services' figure). null when nothing is known. */
export function playedSeconds(record: GenreRecord): number | null {
  const w = record.video.window;
  if (w && w[1] - w[0] > CLIP_SECONDS) return w[1] - w[0];
  if (record.video.kind === "song" && record.video.length_s) return record.video.length_s;
  return record.duration_ms ? record.duration_ms / 1000 : null;
}

const FALLBACK_VERDICTS = new Set(["no_embed", "region_dead", "private", "missing", "region_partial"]);

export function needsLocalFallback(record: GenreRecord): boolean {
  return FALLBACK_VERDICTS.has(record.video.embed);
}

type YTPlayer = {
  loadVideoById(opts: { videoId: string; startSeconds?: number; endSeconds?: number }): void;
  cueVideoById(opts: { videoId: string; startSeconds?: number; endSeconds?: number }): void;
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  getDuration(): number;
  destroy(): void;
  mute(): void;
  unMute(): void;
  getPlayerState(): number;
};

declare global {
  interface Window {
    YT?: {
      Player: new (el: HTMLElement | string, opts: Record<string, unknown>) => YTPlayer;
      PlayerState: { ENDED: number; PLAYING: number; PAUSED: number; BUFFERING: number; CUED: number };
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiReadyPromise: Promise<void> | null = null;
function loadYouTubeApi(): Promise<void> {
  if (apiReadyPromise) return apiReadyPromise;
  apiReadyPromise = new Promise((resolve) => {
    if (window.YT?.Player) {
      resolve();
      return;
    }
    const prior = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prior?.();
      resolve();
    };
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(script);
  });
  return apiReadyPromise;
}

export interface PlayerCallbacks {
  onEnded: () => void;
  onError: (record: GenreRecord) => void; // called when an embeddable-route video fails at play time
  onStateLabel: (label: "loading" | "playing" | "paused" | "ready" | "ended" | "error") => void;
}

interface PendingLoad {
  record: GenreRecord;
  autoplay: boolean;
}

export class AtlasPlayer {
  private ytWrap: HTMLDivElement; // ours: shown or hidden as a whole
  private ytTarget: HTMLDivElement; // handed to the YouTube API, which swaps it for the iframe
  private audioEl: HTMLAudioElement;
  private localEl: HTMLDivElement; // the audio-only card: a line of words and the audio element, with its own controls
  private noteEl: HTMLDivElement; // "audio not embeddable": a genre that can be neither embedded nor played from a local file
  private yt: YTPlayer | null = null;
  private ytReady = false;
  private callbacks: PlayerCallbacks;
  private current: GenreRecord | null = null;
  private route: "embedded" | "local" | null = null;
  private failed = false; // the note is showing: nothing can play
  private pending: PendingLoad | null = null; // set while YT init is still loading
  // True from the moment the loaded clip finishes until something new is loaded.
  // With auto-advance off (the default) nothing follows a finished clip, so play
  // must mean "again" -- a YouTube player that has hit its end time would
  // otherwise restart from the video's own beginning, not the clip's.
  private ended = false;

  constructor(mount: HTMLElement, callbacks: PlayerCallbacks) {
    this.callbacks = callbacks;
    this.ytWrap = document.createElement("div");
    this.ytWrap.className = "atlas-yt";
    this.ytTarget = document.createElement("div");
    this.ytWrap.appendChild(this.ytTarget);
    this.audioEl = document.createElement("audio");
    this.audioEl.className = "atlas-audio";
    this.audioEl.controls = true;
    this.audioEl.preload = "metadata"; // whole songs now: fetch a track only when it is played, not on every selection
    this.localEl = document.createElement("div");
    this.localEl.className = "atlas-local";
    this.localEl.append(copyEl("p", "atlas.audioOnly"), this.audioEl);
    this.noteEl = document.createElement("div");
    this.noteEl.className = "atlas-player-note";
    mount.append(this.ytWrap, this.localEl, this.noteEl);
    this.show("yt");

    this.audioEl.addEventListener("ended", () => this.finished());
    this.audioEl.addEventListener("error", () => this.localFailed());
    this.audioEl.addEventListener("playing", () => this.callbacks.onStateLabel("playing"));
    this.audioEl.addEventListener("pause", () => {
      if (!this.audioEl.ended) this.callbacks.onStateLabel("paused");
    });

    void this.initYouTube();
  }

  private async initYouTube(): Promise<void> {
    await loadYouTubeApi();
    const YT = window.YT!;
    this.yt = new YT.Player(this.ytTarget, {
      height: "100%",
      width: "100%",
      playerVars: { playsinline: 1, modestbranding: 1, rel: 0 },
      events: {
        onReady: () => {
          this.ytReady = true;
          if (this.pending) {
            const { record, autoplay } = this.pending;
            this.pending = null;
            this.loadEmbedded(record, autoplay);
          }
        },
        onStateChange: (e: { data: number }) => {
          if (e.data === YT.PlayerState.ENDED) this.finished();
          else if (e.data === YT.PlayerState.PLAYING) this.callbacks.onStateLabel("playing");
          else if (e.data === YT.PlayerState.PAUSED) this.callbacks.onStateLabel("paused");
          else if (e.data === YT.PlayerState.CUED) this.callbacks.onStateLabel("ready");
        },
        onError: () => {
          // The API told us this video embeds; it failed anyway (age gate,
          // a licence change since the Phase 0 snapshot, ...). Try the local
          // file if one happens to exist, otherwise say so.
          if (this.current) this.callbacks.onError(this.current);
        },
      },
    });
  }

  /** Select a genre. `autoplay` controls whether it starts making sound
   * immediately (true) or loads cued/paused, waiting for resume() (false) --
   * this is the actual fix for the "Autoplay: off" bug, not just gating
   * whether the NEXT clip follows. */
  select(record: GenreRecord, autoplay: boolean): void {
    this.current = record;
    this.ended = false;
    this.failed = false;
    this.silence(); // whichever face was playing stops: two streams at once otherwise
    if (needsLocalFallback(record)) {
      this.route = "local";
      this.loadLocal(record, autoplay);
    } else {
      this.route = "embedded";
      this.loadEmbedded(record, autoplay);
    }
  }

  /** Stop and forget the current genre (its details were closed): nothing keeps playing unseen. */
  stop(): void {
    this.current = null;
    this.pending = null;
    this.ended = false;
    this.failed = false;
    this.silence();
    this.callbacks.onStateLabel("ready");
  }

  /** Pause both the local audio and the YouTube player. */
  private silence(): void {
    this.audioEl.pause();
    if (this.ytReady) {
      try {
        this.yt?.pauseVideo();
      } catch {
        /* the iframe is not ready for commands yet */
      }
    }
  }

  private show(which: "yt" | "local" | "note"): void {
    this.ytWrap.style.display = which === "yt" ? "block" : "none";
    this.localEl.style.display = which === "local" ? "flex" : "none";
    this.noteEl.style.display = which === "note" ? "flex" : "none";
  }

  /** Nothing can play this genre in the page: say "audio not embeddable" and send the listener to YouTube. Reached when the
   * embed fails and there is no local file (the public site ships none for most genres), or the local file is missing. */
  private unavailable(record: GenreRecord): void {
    this.failed = true;
    this.callbacks.onStateLabel("error");
    const link = document.createElement("a");
    link.href = `https://www.youtube.com/watch?v=${record.video.id}&t=${Math.round(playbackWindow(record.video).start)}s`;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.append(copyEl("span", "atlas.noClipLink"), " ↗");
    this.noteEl.replaceChildren(copyEl("p", "atlas.noClip"), link);
    this.silence();
    this.show("note");
  }

  /** The local file is missing or won't decode. */
  private localFailed(): void {
    const record = this.current;
    if (!record || this.route !== "local") return;
    this.unavailable(record);
  }

  private loadLocal(record: GenreRecord, autoplay: boolean): void {
    this.show("local");
    this.callbacks.onStateLabel(autoplay ? "loading" : "ready");
    this.audioEl.src = `/audio/${record.slug}.opus`;
    this.audioEl.currentTime = 0;
    if (autoplay) this.audioEl.play().catch(() => this.callbacks.onStateLabel("error"));
  }

  private loadEmbedded(record: GenreRecord, autoplay: boolean): void {
    this.show("yt");
    if (!this.ytReady || !this.yt) {
      this.pending = { record, autoplay };
      this.callbacks.onStateLabel("loading");
      return;
    }
    this.callbacks.onStateLabel(autoplay ? "loading" : "ready");
    const { start, end } = playbackWindow(record.video);
    const opts = { videoId: record.video.id, startSeconds: start, endSeconds: end };
    if (autoplay) this.yt.loadVideoById(opts);
    else this.yt.cueVideoById(opts);
  }

  fallbackToLocal(record: GenreRecord): void {
    if (!needsLocalFallback(record)) {
      // Not in the pre-computed fallback set, so no audio file was deployed
      // for it: there is nothing to fail over to.
      this.unavailable(record);
      return;
    }
    this.route = "local";
    this.loadLocal(record, true);
  }

  /** Start (or resume) whatever is currently loaded -- the space-bar/"press
   * play" path for a clip that loaded cued because autoplay was off. */
  resume(): void {
    if (this.failed) return;
    if (this.replay()) return;
    if (this.route === "local") void this.audioEl.play().catch(() => this.callbacks.onStateLabel("error"));
    else if (this.route === "embedded") this.yt?.playVideo();
  }

  togglePause(): void {
    if (this.failed) return;
    if (this.replay()) return;
    if (this.route === "local") {
      if (this.audioEl.paused) void this.audioEl.play();
      else this.audioEl.pause();
    } else if (this.route === "embedded" && this.yt) {
      if (this.isPlaying()) this.yt.pauseVideo();
      else this.yt.playVideo();
    }
  }

  /** Is sound being made (or about to be)? */
  isPlaying(): boolean {
    if (this.failed || !this.current || this.ended) return false;
    if (this.route === "local") return !this.audioEl.paused;
    if (this.route === "embedded" && this.ytReady && this.yt) {
      const YT = window.YT!;
      try {
        const s = this.yt.getPlayerState();
        return s === YT.PlayerState.PLAYING || s === YT.PlayerState.BUFFERING;
      } catch {
        return false;
      }
    }
    return false;
  }

  /** Where the song is: seconds into it and how long it is (0 until known). For a YouTube video that is relative to the
   * start of what plays (a window of a long upload, or the whole song), not to the video. null when nothing is loaded. */
  position(): { current: number; duration: number } | null {
    const record = this.current;
    if (!record || this.failed) return null;
    if (this.route === "local") {
      const d = this.audioEl.duration;
      return { current: this.audioEl.currentTime || 0, duration: Number.isFinite(d) ? d : 0 };
    }
    if (this.route === "embedded" && this.ytReady && this.yt) {
      const { start, end } = playbackWindow(record.video);
      try {
        const total = this.yt.getDuration();
        const stop = end ?? (total || record.video.length_s || 0);
        const duration = Math.max(0, stop - start);
        return { current: Math.max(0, Math.min(this.yt.getCurrentTime() - start, duration)), duration };
      } catch {
        return null;
      }
    }
    return null;
  }

  /** Jump to `seconds` into the song (the same clock as position()). */
  seek(seconds: number): void {
    const record = this.current;
    if (!record || this.failed) return;
    this.ended = false;
    if (this.route === "local") this.audioEl.currentTime = seconds;
    else if (this.route === "embedded" && this.yt) this.yt.seekTo(playbackWindow(record.video).start + seconds, true);
  }

  private finished(): void {
    this.ended = true;
    this.callbacks.onStateLabel("ended"); // before onEnded: auto-advance replaces it straight away
    this.callbacks.onEnded();
  }

  /** Play the finished clip again from its start; false if it hasn't finished. */
  private replay(): boolean {
    if (!this.ended || !this.current) return false;
    this.select(this.current, true);
    return true;
  }
}
