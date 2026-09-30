/**
 * Plex provider — talks to the user's Plex Media Server (not plex.tv) with an
 * API-key token. All calls add X-Plex-Token (query) + X-Plex-Product /
 * X-Plex-Client-Identifier headers. Playback streams the original part file
 * (no transcoding). Cross-origin requires the server to allow the PWA origin.
 */
import type { Provider, ResolvedSource, Track } from "../core/types";
import { useServers, type ServerConfig } from "../store/servers";
import { registerProvider } from "./registry";

const ID = "cliamp";

interface PlexContainer<T> {
  MediaContainer?: {
    Metadata?: T[];
  };
}
interface PlexTrack {
  key: string;
  ratingKey: string;
  title: string;
  artist?: string;
  album?: string;
  year?: string;
  index?: number;
  duration?: number; // ms
  Media?: { Part?: { key: string }[] };
}
interface PlexSection {
  key: string;
  title: string;
  type: string;
}

function cfg(): ServerConfig {
  const c = useServers.getState().getConfig("plex");
  if (!c || !c.url.trim() || !c.token?.trim()) throw new Error("Plex not configured (URL + token)");
  return c;
}
function base(): string {
  return cfg().url.replace(/\/$/, "");
}
function headers(): Record<string, string> {
  return { Accept: "application/json", "X-Plex-Product": ID, "X-Plex-Client-Identifier": ID };
}
function tokenQ(): string {
  return `X-Plex-Token=${encodeURIComponent(cfg().token!)}`;
}
async function plexGet<T>(path: string): Promise<T> {
  const sep = path.includes("?") ? "&" : "?";
  const res = await fetch(`${base()}/${path}${sep}${tokenQ()}`, { headers: headers() });
  if (!res.ok) throw new Error(`plex ${res.status}`);
  return (await res.json()) as T;
}

export const plexProvider: Provider = {
  id: "plex",
  name: "Plex",
  description: "Plex Media Server library",
  capabilities: { browse: true, search: true, playlists: true },
  async resolveSource(track: Track): Promise<ResolvedSource> {
    const partKey = track.providerMeta?.partKey;
    if (typeof partKey !== "string" || !partKey) throw new Error("no part key");
    const sep = partKey.includes("?") ? "&" : "?";
    return { url: `${base()}/${partKey}${sep}${tokenQ()}`, seekable: true };
  },
};
registerProvider(plexProvider);

function plexTrack(t: PlexTrack): Track {
  const partKey = t.Media?.Part?.[0]?.key;
  return {
    path: `plex://track/${t.ratingKey}`,
    title: t.title,
    artist: t.artist,
    album: t.album,
    year: t.year ? parseInt(t.year, 10) : undefined,
    trackNumber: t.index,
    durationSecs: t.duration ? Math.round(t.duration / 1000) : undefined,
    provider: "plex",
    providerMeta: { ratingKey: t.ratingKey, partKey },
  };
}

export const plexBrowse = {
  async sections(): Promise<PlexSection[]> {
    const data = await plexGet<PlexContainer<PlexSection>>("library/sections");
    return data.MediaContainer?.Metadata ?? [];
  },
  async sectionTracks(sectionKey: string, size = 300): Promise<Track[]> {
    const data = await plexGet<PlexContainer<PlexTrack>>(
      `library/sections/${sectionKey}/all?type=9&X-Plex-Container-Start=0&X-Plex-Container-Size=${size}`,
    );
    return (data.MediaContainer?.Metadata ?? []).map(plexTrack);
  },
  async playlists(): Promise<{ ratingKey: string; title: string }[]> {
    const data = await plexGet<PlexContainer<{ ratingKey: string; title: string }>>("playlists");
    return data.MediaContainer?.Metadata ?? [];
  },
  async playlistItems(ratingKey: string, size = 1000): Promise<Track[]> {
    const data = await plexGet<PlexContainer<PlexTrack>>(
      `playlists/${ratingKey}/items?X-Plex-Container-Start=0&X-Plex-Container-Size=${size}`,
    );
    return (data.MediaContainer?.Metadata ?? []).map(plexTrack);
  },
  async albumTracks(ratingKey: string): Promise<Track[]> {
    const data = await plexGet<PlexContainer<PlexTrack>>(`library/metadata/${ratingKey}/children`);
    return (data.MediaContainer?.Metadata ?? []).map(plexTrack);
  },
  async search(query: string): Promise<Track[]> {
    const data = await plexGet<PlexContainer<PlexTrack>>(`library/search?query=${encodeURIComponent(query)}&type=10`);
    return (data.MediaContainer?.Metadata ?? []).map(plexTrack);
  },
};
