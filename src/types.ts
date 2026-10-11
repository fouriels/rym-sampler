export interface GenreRecord {
  slug: string;
  name: string;
  rym: string | null;
  description: string;
  primary: string;
  over_genres: string[];
  regional_branch: string | null;
  parents: string[];
  paths: string[][];
  depth: number | null;
  subgenres: number;
  releases: number;
  artist: string;
  performer: string | null;
  track: string;
  album: string;
  year: number | null;
  country: string | null; // artist's own origin, with provenance below
  country_source: string | null;
  country_source_url: string | null;
  release_country: string | null; // country of the album's earliest release edition (Discogs/MB) -- NOT the same signal, see build_site_data.py
  release_country_raw: string | null;
  release_country_source: string | null;
  duration_ms: number | null;
  popularity: number | null;
  rank_used: number | null;
  art: string | null;
  album_rym: string | null;
  spotify_url: string | null;
  youtube_video: string | null; // the uploaded compilation video this genre appears in, once known
  video: {
    id: string;
    start: number | null;
    length: number | null;
    embed: string;
    timestamp_source: string | null;
    /** The sheet's explicit clip_start..clip_end in seconds (a track cut from a longer upload), else null. */
    window: [number, number] | null;
    /** The real length of the downloaded source video, in seconds. */
    length_s: number | null;
    /** "album" for a long upload (album, mix, full work) a song was cut out of; else "song". See build_site_data.py. */
    kind: "song" | "album";
    manual_link: boolean;
  };
}

export interface GraphNode {
  id: string;
  slug: string;
  primary: string;
  depth: number | null;
  releases: number;
  year: number | null;
}

export interface GraphEdge {
  from: string;
  to: string;
  kind: "primary" | "also";
}

export interface Graph {
  generated_at: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface Stats {
  generated_at: string;
  total_genres: number;
  /** One row per genre, biggest first. `depth` 0 = a top-level genre; `seconds` = its top track's length, null if unknown.
   * NB `releases` includes the genre's subgenres' releases, so never sum it across levels. */
  top_by_releases: { name: string; releases: number; primary: string; depth: number | null; seconds: number | null }[];
  releases_summary: { sum: number; min: number; max: number; median: number; log_histogram: Record<string, number> };
  by_family: { primary: Record<string, number>; dag: Record<string, number>; primary_total: number; dag_total: number };
  releases_by_family_primary: Record<string, number>;
  multi_family: { count: number; share: number; top_pairs: Record<string, number> };
  regional_branches: Record<string, number>;
  decades: Record<string, number>;
  year_unknown: number;
  ancient_undated?: { count: number; genres: string[] };
  year_range: { min: number; max: number } | null;
  decade_by_family: Record<string, Record<string, number>>;
  depths: Record<string, number>;
  deepest_examples: { name: string; path: string[] | null }[];
  rank_used: Record<string, number>;
  timestamp_sources: Record<string, number>;
  embed_status: Record<string, number>;
  manual_links: number;
  distinct_artists: number;
  most_sampled_artists: { artist: string; genres: number }[];
  countries: Record<string, number>;
  country_sources: Record<string, number>;
  country_coverage: { with_country: number; without: number; share: number };
  country_coverage_by_family: Record<string, { with_country: number; total: number; share: number }>;
  country_coverage_by_regional_branch: Record<string, { with_country: number; total: number; share: number }>;
  release_countries: Record<string, number>;
  release_country_coverage: { with_country: number; without: number; share: number };
  artist_vs_release_country?: { both_known: number; agree: number; agree_share: number };
  durations?: {
    count: number; coverage: number; median_min: number; mean_min: number;
    min_s: number; max_min: number; histogram: Record<string, number>;
  };
  longest_tracks?: { name: string; artist: string; track: string; minutes: number }[];
  shortest_tracks?: { name: string; artist: string; track: string; seconds: number }[];
  popularity?: { count: number; coverage: number; histogram: Record<string, number> };
  /** Total length of every song as it plays: whole song videos, hand-set windows for albums (see build_site_data.py). */
  song_time?: { seconds: number; songs: number; unknown: number; by_source: Record<string, number> };
  most_obscure?: { name: string; artist: string; track: string; album: string; popularity: number }[];
  scripts: Record<string, number>;
  script_examples: Record<string, string[]>;
  script_genres?: Record<string, string[]>; // every genre behind each non-Latin bar
}
