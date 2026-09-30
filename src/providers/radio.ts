/**
 * Radio provider — live internet radio.
 *
 * Two catalogs, both CORS-open (verified):
 *   1. Built-in cliamp channels: https://radio.cliamp.stream/stations
 *      (each channel is a 24/7 live stream; sends Access-Control-Allow-Origin: *
 *       and exposes ICY metadata headers).
 *   2. Radio Browser directory: https://de1.api.radio-browser.info/json
 *      (countries, tags, station search; sends Access-Control-Allow-Origin: *).
 *
 * Every station resolves to a direct live stream URL — not seekable, no
 * gapless boundary, no track end. Browsers cannot set a custom User-Agent,
 * so the directory's `User-Agent: cliamp` convention is dropped (the API
 * does not require it).
 */
import type { Provider, ResolvedSource, Track } from "../core/types";
import { registerProvider } from "./registry";

const API = "https://de1.api.radio-browser.info/json";
const BUILTIN = "https://radio.cliamp.stream/stations";

/** Directory ordering (recon §9: Most Voted / Listened / Trending / Name / Random). */
export type RadioOrder = "votes" | "clickcount" | "clicktrend" | "name" | "random";
export const RADIO_ORDER_LABELS: Record<RadioOrder, string> = {
  votes: "Most Voted",
  clickcount: "Most Listened",
  clicktrend: "Trending",
  name: "By Name",
  random: "Random",
};

export interface RadioCountry {
  code: string;
  name: string;
  stationcount: number;
}
export interface RadioTag {
  name: string;
  stationcount: number;
}

interface ApiStation {
  name: string;
  url: string;
  url_resolved?: string;
  homepage?: string;
  favicon?: string;
  tags?: string;
  country?: string;
  countrycode?: string;
  state?: string;
  language?: string;
  codec?: string;
  bitrate?: number;
  votes?: number;
  clickcount?: number;
  clicktrend?: number;
  stationuuid?: string;
  lastcheckok?: number;
}

function toTrack(s: ApiStation): Track {
  return {
    path: s.url,
    title: s.name,
    station: s.name,
    stream: true,
    live: true,
    artUrl: s.favicon || undefined,
    provider: "radio",
    providerMeta: {
      uuid: s.stationuuid,
      country: s.country,
      countrycode: s.countrycode,
      state: s.state,
      tags: s.tags,
      codec: s.codec,
      bitrate: s.bitrate,
      votes: s.votes,
      homepage: s.homepage,
    },
  };
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`radio API ${res.status}`);
  return (await res.json()) as T;
}

function searchParams(params: Record<string, string | number | undefined>): string {
  const q = new URLSearchParams();
  q.set("hidebroken", "true");
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") q.set(k, String(v));
  }
  return q.toString();
}

export const radioProvider: Provider = {
  id: "radio",
  name: "Radio",
  description: "Internet radio — built-in channels + Radio Browser directory",
  capabilities: { browse: true, search: true },
  async resolveSource(track: Track): Promise<ResolvedSource> {
    // A radio station's path is the playable live stream URL itself.
    return { url: track.path, seekable: false };
  },
};

registerProvider(radioProvider);

export const radioBrowse = {
  /** Built-in cliamp channels (live streams). */
  async listBuiltins(): Promise<Track[]> {
    const data = await getJson<{ stations: { id: string; name: string; description?: string; genre?: string; stream: string; tracks?: number }[] }>(BUILTIN);
    return data.stations.map((s) => ({
      path: s.stream,
      title: s.name,
      station: s.name,
      genre: s.genre,
      stream: true,
      live: true,
      provider: "radio",
      providerMeta: { builtin: s.id, description: s.description, trackCount: s.tracks },
    }));
  },

  /** Directory countries (for country browse). */
  async listCountries(): Promise<RadioCountry[]> {
    const data = await getJson<{ name: string; iso_3166_1: string; stationcount: number }[]>(`${API}/countries`);
    return data
      .filter((c) => c.stationcount > 0)
      .map((c) => ({ code: c.iso_3166_1, name: c.name, stationcount: c.stationcount }));
  },

  /** Directory tags sorted by station count. */
  async listTags(): Promise<RadioTag[]> {
    const data = await getJson<{ name: string; stationcount: number }[]>(
      `${API}/tags?order=stationcount&reverse=true&hidebroken=true&limit=100000`,
    );
    return data.map((t) => ({ name: t.name, stationcount: t.stationcount }));
  },

  /** Search stations by name. */
  async searchStations(query: string, limit = 50): Promise<Track[]> {
    const data = await getJson<ApiStation[]>(
      `${API}/stations/search?${searchParams({ name: query, limit })}`,
    );
    return data.map(toTrack);
  },

  /** Stations in a country/region, ordered. */
  async stationsForCountry(code: string, order: RadioOrder = "votes", limit = 200): Promise<Track[]> {
    const data = await getJson<ApiStation[]>(
      `${API}/stations/search?${searchParams({ countrycode: code, order, limit })}`,
    );
    return data.map(toTrack);
  },

  /** Stations matching an exact tag, ordered. */
  async stationsForTag(tag: string, order: RadioOrder = "votes", limit = 200): Promise<Track[]> {
    const data = await getJson<ApiStation[]>(
      `${API}/stations/search?${searchParams({ tag, tagExact: "true", order, limit })}`,
    );
    return data.map(toTrack);
  },
};
