/**
 * Plex provider — talks to the user's Plex Media Server (not plex.tv) with an
 * API-key token. All calls add X-Plex-Token (query) + X-Plex-Product /
 * X-Plex-Client-Identifier headers. Playback streams the original part file
 * (no transcoding). Cross-origin requires the server to allow the PWA origin.
 */
import type { Provider, ResolvedSource, Track } from "../core/types";
import { useServers, type ServerConfig } from "../store/servers";
import { registerProvider } from "./registry";
import { connectPlexServer, plexUrl } from "./plexConnection";

interface PlexContainer<T> {
  MediaContainer?: {
    Metadata?: T[];
    Directory?: T[];
  };
}
interface PlexTrack {
  key: string;
  ratingKey: string;
  title: string;
  artist?: string;
  album?: string;
  grandparentTitle?: string;
  parentTitle?: string;
  year?: number | string;
  parentYear?: number | string;
  thumb?: string;
  parentThumb?: string;
  index?: number;
  duration?: number; // ms
  Media?: { Part?: { key: string }[] }[];
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
async function plexGet<T>(path: string): Promise<T> {
  const config = cfg();
  const request = (url: string) => fetch(plexUrl(url, path, config.token!), { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(10000) });
  let res: Response;
  try { res = await request(config.url); }
  catch {
    const connected = await reconnect(config);
    res = await request(connected.url);
  }
  if (!res.ok && res.status !== 401 && res.status !== 403 && config.connectionUrls?.length) {
    const connected = await reconnect(config); res = await request(connected.url);
  }
  if (!res.ok) throw new Error(`plex ${res.status}`);
  return (await res.json()) as T;
}

async function reconnect(config: ServerConfig): Promise<ServerConfig> {
  const connected = await connectPlexServer(config);
  if (cfg() !== config) throw new Error("Plex configuration changed");
  if (config.url !== connected.url) useServers.getState().saveConfig("plex", connected);
  return connected;
}

export const plexProvider: Provider = {
  id: "plex",
  name: "Plex",
  description: "Plex Media Server library",
  capabilities: { browse: true, search: true, playlists: true },
  async resolveSource(track: Track): Promise<ResolvedSource> {
    const config = cfg();
    if (track.providerMeta?.serverId && track.providerMeta.serverId !== config.serverId) throw new Error("This track belongs to another Plex server");
    if (!track.providerMeta?.serverId && track.providerMeta?.serverUrl && track.providerMeta.serverUrl !== config.url
      && !config.connectionUrls?.includes(String(track.providerMeta.serverUrl))) throw new Error("This track belongs to another Plex server");
    const partKey = track.providerMeta?.partKey;
    if (typeof partKey !== "string" || !partKey) throw new Error("no part key");
    const connected = await reconnect(config);
    return { url: plexUrl(connected.url, partKey, connected.token!), seekable: true };
  },
};
registerProvider(plexProvider);

function plexTrack(t: PlexTrack): Track {
  const partKey = t.Media?.[0]?.Part?.[0]?.key;
  return {
    path: `plex://${encodeURIComponent(cfg().serverId || base())}/track/${t.ratingKey}`,
    title: t.title,
    artist: t.grandparentTitle ?? t.artist,
    album: t.parentTitle ?? t.album,
    year: Number(t.year || t.parentYear) || undefined,
    artUrl: t.thumb || t.parentThumb ? plexUrl(base(), (t.thumb || t.parentThumb)!, cfg().token!) : undefined,
    trackNumber: t.index,
    durationSecs: t.duration ? Math.round(t.duration / 1000) : undefined,
    provider: "plex",
    providerMeta: { ratingKey: t.ratingKey, partKey, serverId: cfg().serverId, serverUrl: base() },
  };
}

export const plexBrowse = {
  async sections(): Promise<PlexSection[]> {
    const data = await plexGet<PlexContainer<PlexSection>>("library/sections");
    return data.MediaContainer?.Directory ?? data.MediaContainer?.Metadata ?? [];
  },
  async sectionTracks(sectionKey: string, size = 300): Promise<Track[]> {
    const data = await plexGet<PlexContainer<PlexTrack>>(
      `library/sections/${encodeURIComponent(sectionKey)}/all?type=10&X-Plex-Container-Start=0&X-Plex-Container-Size=${size}`,
    );
    return (data.MediaContainer?.Metadata ?? []).map(plexTrack);
  },
  async playlists(): Promise<{ ratingKey: string; title: string }[]> {
    const data = await plexGet<PlexContainer<{ ratingKey: string; title: string; playlistType?: string }>>("playlists?playlistType=audio");
    return (data.MediaContainer?.Metadata ?? []).filter((p) => p.playlistType === "audio");
  },
  async sectionAlbums(sectionKey: string, start = 0, size = 100): Promise<{ albums: { ratingKey: string; title: string; parentTitle?: string; year?: number }[]; more: boolean }> {
    const data = await plexGet<PlexContainer<{ ratingKey: string; title: string; parentTitle?: string; year?: number }>>(
      `library/sections/${encodeURIComponent(sectionKey)}/all?type=9&sort=artist.titleSort,album.titleSort&X-Plex-Container-Start=${start}&X-Plex-Container-Size=${size}`);
    const albums = data.MediaContainer?.Metadata ?? [];
    return { albums, more: albums.length === size };
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
