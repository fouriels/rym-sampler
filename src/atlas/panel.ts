import type { GenreRecord } from "../types";
import { playedSeconds } from "./player";
import { el, text } from "../util/dom";
import { commas, countryName, INFERRED_COUNTRY_SOURCES } from "../util/format";

/** 45s, 4m 11s, 1h 15m: the length of a song as a person says it. */
function lengthLabel(seconds: number): string {
  const s = Math.round(seconds);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
  return `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}m`;
}

const COUNTRY_SOURCE_LABELS: Record<string, string> = {
  musicbrainz: "MusicBrainz artist country",
  musicbrainz_area: "MusicBrainz artist area",
  manual_source: "Linked artist or ensemble source",
  wikidata_citizenship: "Wikidata citizenship",
  wikidata_country_of_origin: "Wikidata country of origin",
  wikidata_formation_place: "Wikidata formation place",
  wikidata_birthplace: "Wikidata birthplace",
  genre_release_agreement: "Inferred from a country-specific genre name and the earliest matching release country",
  genre_implied: "Inferred from the genre's own name only (about 85% agreement with known origins in a backtest)",
  discogs_profile: "Read from the artist's own Discogs profile text (about 85% agreement with MusicBrainz when checked)",
};

export function renderPanel(record: GenreRecord, onNavigatePath: (path: string[]) => void): HTMLElement {
  const wrap = el("div", { class: "atlas-panel" });

  const art = el("div", { class: "atlas-art" });
  if (record.art) {
    const img = document.createElement("img");
    img.src = `/art/${record.slug}@320.webp`;
    img.alt = `${record.album} cover art`;
    img.loading = "lazy";
    art.appendChild(img);
  } else {
    art.classList.add("empty");
  }
  wrap.appendChild(art);

  wrap.appendChild(el("h2", { class: "atlas-genre-name" }, record.name));
  if (record.description) {
    wrap.appendChild(el("p", { class: "atlas-description" }, record.description));
  }

  // All of this genre's ancestry branches, same convention as the "complete"
  // video -- and each one is a real connection you can follow: clicking a
  // path jumps the atlas to see this genre among its siblings on THAT route
  // (e.g. Aggrotech's Dance route vs its Electronic route are different
  // sibling sets). User request 2026-09-23: "should show all connections".
  const breadcrumbs = el("div", { class: "atlas-breadcrumbs" });
  if (record.paths.length > 1) {
    breadcrumbs.appendChild(
      el("div", { class: "atlas-breadcrumbs-hint" }, `${record.paths.length} routes to this genre — click one:`)
    );
  }
  for (const path of record.paths) {
    const btn = el("button", { class: "atlas-breadcrumb", type: "button" }, path.join(" › "));
    btn.addEventListener("click", () => onNavigatePath(path));
    breadcrumbs.appendChild(btn);
  }
  wrap.appendChild(breadcrumbs);

  const stats = el("div", { class: "atlas-stats-row" });
  stats.appendChild(statChip("Releases charted", commas(record.releases)));
  if (record.subgenres) stats.appendChild(statChip("Subgenres", commas(record.subgenres)));
  if (record.over_genres.length > 1) {
    stats.appendChild(statChip("Also under", record.over_genres.filter((o) => o !== record.primary).join(", ")));
  }
  if (record.country) {
    const inferred = INFERRED_COUNTRY_SOURCES.has(record.country_source ?? "");
    const chip = statChip(inferred ? "Likely artist origin" : "Artist from", countryName(record.country));
    if (record.country_source) {
      chip.title = COUNTRY_SOURCE_LABELS[record.country_source] ?? record.country_source.replaceAll("_", " ");
    }
    stats.appendChild(chip);
  }
  if (record.release_country) {
    stats.appendChild(statChip("First released in", countryName(record.release_country)));
  }
  wrap.appendChild(stats);

  const track = el("div", { class: "atlas-track" });
  track.appendChild(el("div", { class: "atlas-track-title" }, record.track || "(untitled)"));
  track.appendChild(
    el("div", { class: "atlas-track-sub" }, `${record.artist}${record.album ? " — " + record.album : ""}`)
  );
  const meta: string[] = [];
  if (record.year) meta.push(String(record.year));
  const played = playedSeconds(record); // what plays: the video's length, or the window of it where the song is
  if (played) meta.push(lengthLabel(played));
  if (record.rank_used && record.rank_used > 1) meta.push(`RYM chart #${record.rank_used}`);
  if (meta.length) track.appendChild(el("div", { class: "atlas-track-meta" }, meta.join(" · ")));
  wrap.appendChild(track);

  const links = el("div", { class: "atlas-links" });
  if (record.rym) links.appendChild(linkChip(`https://rateyourmusic.com${record.rym}`, "RYM genre page"));
  if (record.album_rym) links.appendChild(linkChip(`https://rateyourmusic.com${record.album_rym}`, "RYM release"));
  // The uploaded compilation video this genre actually appears in, once its
  // URL is known (data/youtube_uploads.json) -- falls back to the channel
  // itself so there's always somewhere to go looking in the meantime.
  if (record.youtube_video) links.appendChild(linkChip(record.youtube_video, "Watch the genre video"));
  else links.appendChild(linkChip("https://www.youtube.com/@VirulentHorizon", "Channel (video link pending)"));
  wrap.appendChild(links);

  return wrap;
}

function statChip(label: string, value: string): HTMLElement {
  const chip = el("div", { class: "atlas-chip" });
  chip.appendChild(el("span", { class: "atlas-chip-value" }, value));
  chip.appendChild(el("span", { class: "atlas-chip-label" }, label));
  return chip;
}

function linkChip(href: string, label: string): HTMLElement {
  const a = el("a", { class: "atlas-link", href, target: "_blank", rel: "noopener noreferrer" });
  a.appendChild(text(label));
  a.appendChild(text(" ↗"));
  return a;
}
