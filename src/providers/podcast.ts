/**
 * Podcast provider — Apple Podcasts directory + publisher RSS feeds.
 *
 * CORS-open Apple endpoints (verified):
 *   - Top chart:  https://itunes.apple.com/{cc}/rss/toppodcasts/limit={n}/json
 *   - Search:     https://itunes.apple.com/search?term=…&media=podcast&entity=podcast
 *   - Lookup:     https://itunes.apple.com/lookup?id={collectionId}
 *
 * Publisher RSS feeds are cross-origin and their CORS depends on the host
 * (e.g. megaphone sends *; some hosts do not). A feed that is not
 * CORS-enabled cannot be listed in the browser — the error is surfaced.
 * Episode audio plays via the audio element directly (works tainted).
 *
 * Categories follow cliamp's "Apple genre-name search" (the public
 * /search endpoint does not reliably filter by genreId from a browser).
 */
import { parseFeed } from "../core/rss";
import type { Provider, ResolvedSource, Track } from "../core/types";
import { registerProvider } from "./registry";

const BASE = "https://itunes.apple.com";

export interface PodcastShow {
  collectionId: number;
  name: string;
  artist?: string;
  feedUrl?: string;
  artworkUrl?: string;
  genre?: string;
}

interface AppleCategory {
  name: string;
  genreId: number;
}

/** Apple's podcast categories (genre-name search; genreId kept for reference). */
export const APPLE_CATEGORIES: AppleCategory[] = [
  { name: "Arts", genreId: 1242 },
  { name: "Business", genreId: 1294 },
  { name: "Comedy", genreId: 1404 },
  { name: "Education", genreId: 1025 },
  { name: "Fiction & Storytelling", genreId: 2007 },
  { name: "Health & Fitness", genreId: 1026 },
  { name: "History", genreId: 1326 },
  { name: "Kids & Family", genreId: 1633 },
  { name: "Music", genreId: 1029 },
  { name: "News", genreId: 1301 },
  { name: "Religion & Spirituality", genreId: 1144 },
  { name: "Science", genreId: 1312 },
  { name: "Society & Culture", genreId: 2018 },
  { name: "Sports", genreId: 2021 },
  { name: "Television", genreId: 1313 },
  { name: "True Crime", genreId: 1435 },
  { name: "Books", genreId: 1796 },
  { name: "Game Shows", genreId: 2009 },
  { name: "Leisure", genreId: 2022 },
];

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Apple ${res.status}`);
  return (await res.json()) as T;
}

const cc = (country: string) => country.trim().toLowerCase() || "us";

export const podcastProvider: Provider = {
  id: "podcast",
  name: "Podcasts",
  description: "Apple top charts + shows → episodes (RSS)",
  capabilities: { browse: true, search: true },
  async resolveSource(track: Track): Promise<ResolvedSource> {
    // A podcast episode's path is the playable enclosure URL (finite).
    return { url: track.path, seekable: true };
  },
};

registerProvider(podcastProvider);

export const podcastBrowse = {
  /** Apple top chart for a country (default us). */
  async listTopChart(country = "us", limit = 100): Promise<PodcastShow[]> {
    const data = await getJson<{ feed: { entry: AppleEntry[] } }>(
      `${BASE}/${cc(country)}/rss/toppodcasts/limit=${limit}/json`,
    );
    return (data.feed.entry ?? []).map(fromEntry);
  },

  /** Search shows by name. */
  async searchShows(query: string, country = "us", limit = 100): Promise<PodcastShow[]> {
    const q = encodeURIComponent(query.trim());
    const data = await getJson<{ results: AppleSearch[] }>(
      `${BASE}/search?term=${q}&media=podcast&entity=podcast&country=${cc(country)}&limit=${limit}`,
    );
    return (data.results ?? []).map(fromSearch);
  },

  /** Browse a category (Apple genre-name search). */
  async showsForCategory(name: string, country = "us", limit = 100): Promise<PodcastShow[]> {
    return this.searchShows(name, country, limit);
  },

  /** Resolve a show's feed URL via Apple lookup. */
  async lookupShow(collectionId: number): Promise<PodcastShow> {
    const data = await getJson<{ results: AppleSearch[] }>(`${BASE}/lookup?id=${collectionId}`);
    const r = data.results?.[0];
    if (!r) throw new Error("show not found");
    return fromSearch(r);
  },

  /** Fetch + parse a show's RSS feed into playable episodes. */
  async showEpisodes(feedUrl: string, showTitle: string, limit = 300): Promise<Track[]> {
    const res = await fetch(feedUrl);
    if (!res.ok) throw new Error(`feed ${res.status}`);
    const xml = await res.text();
    const info = parseFeed(xml, feedUrl, showTitle, limit);
    return info.episodes;
  },
};

interface AppleEntry {
  "im:name"?: { label: string };
  "im:image"?: { label: string }[];
  id?: { attributes?: { "im:id"?: string } };
  "im:artist"?: { label: string };
  "im:genre"?: { label: string }[];
  "im:feedUrl"?: { label: string };
}
interface AppleSearch {
  collectionId: number;
  collectionName: string;
  artistName?: string;
  feedUrl?: string;
  artworkUrl512?: string;
  primaryGenreName?: string;
}

function fromEntry(e: AppleEntry): PodcastShow {
  return {
    collectionId: Number(e.id?.attributes?.["im:id"] ?? 0),
    name: e["im:name"]?.label ?? "Unknown",
    artist: e["im:artist"]?.label,
    feedUrl: e["im:feedUrl"]?.label,
    artworkUrl: e["im:image"]?.[2]?.label ?? e["im:image"]?.[0]?.label,
    genre: e["im:genre"]?.[0]?.label,
  };
}
function fromSearch(r: AppleSearch): PodcastShow {
  return {
    collectionId: r.collectionId,
    name: r.collectionName,
    artist: r.artistName,
    feedUrl: r.feedUrl,
    artworkUrl: r.artworkUrl512,
    genre: r.primaryGenreName,
  };
}
