/**
 * Lyrion (Logitech Media Server / LMS) provider — JSON-RPC `slim.request`
 * against the LMS web interface (default port 9000). Browse Artists → Albums →
 * tracks, saved playlists, and title search. Playback streams the original
 * file at /music/{id}/download. Basic auth when credentials are configured.
 */
import type { Provider, ResolvedSource, Track } from "../core/types";
import { useServers, type ServerConfig } from "../store/servers";
import { registerProvider } from "./registry";

interface LmsTrack {
  id: number;
  title: string;
  artist: string;
  album: string;
  albumid?: number;
  artistid?: number;
  duration?: number;
  tracknumber?: number;
}
interface LmsArtist { id: number; name: string; }
interface LmsAlbum { id: number; name: string; artistid?: number; artist?: string; }

function cfg(): ServerConfig {
  const c = useServers.getState().getConfig("lyrion");
  if (!c || !c.url.trim()) throw new Error("Lyrion not configured (URL)");
  return c;
}
function base(): string {
  return cfg().url.replace(/\/$/, "");
}
function basicAuth(): string | undefined {
  const c = cfg();
  if (c.user?.trim() && c.password) return "Basic " + btoa(`${c.user}:${c.password}`);
  return undefined;
}
function headers(): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json", "User-Agent": "cliamp/1.0" };
  const auth = basicAuth();
  if (auth) h.Authorization = auth;
  return h;
}

let rpcId = 1;
/** slim.request returns the payload as a JSON *string*; parse it. */
async function slim<T>(command: string): Promise<T> {
  const body = JSON.stringify({ id: rpcId++, method: "slim.request", params: ["", command] });
  const res = await fetch(`${base()}/jsonrpc.js`, { method: "POST", headers: headers(), body });
  if (!res.ok) throw new Error(`lms ${res.status}`);
  const data = (await res.json()) as { result?: string | T; error?: unknown };
  if (data.error) throw new Error("lms rpc error");
  const result = data.result;
  if (typeof result === "string") return JSON.parse(result) as T;
  return result as T;
}

function lyrionTrack(t: LmsTrack): Track {
  return {
    path: `lyrion://track/${t.id}`,
    title: t.title,
    artist: t.artist,
    album: t.album,
    durationSecs: t.duration ? Math.round(t.duration) : undefined,
    trackNumber: t.tracknumber,
    provider: "lyrion",
    providerMeta: { trackId: t.id, albumId: t.albumid, artistId: t.artistid },
  };
}

export const lyrionProvider: Provider = {
  id: "lyrion",
  name: "Lyrion (LMS)",
  description: "Logitech Media Server library",
  capabilities: { browse: true, search: true, playlists: true },
  async resolveSource(track: Track): Promise<ResolvedSource> {
    const id = track.providerMeta?.trackId;
    if (typeof id !== "number") throw new Error("no track id");
    const c = cfg();
    const u = new URL(c.url);
    // Basic auth can't be sent on a cross-origin media fetch reliably; when
    // credentials exist the URL embeds userinfo (best-effort) per cliamp.
    if (c.user?.trim() && c.password) {
      u.username = c.user;
      u.password = c.password;
    }
    u.pathname = `/music/${id}/download`;
    u.search = "";
    return { url: u.toString(), seekable: true };
  },
};
registerProvider(lyrionProvider);

export const lyrionBrowse = {
  async artists(): Promise<LmsArtist[]> {
    const data = await slim<{ artists: LmsArtist[] }>("artists");
    return data.artists ?? [];
  },
  async albums(artistId: number): Promise<LmsAlbum[]> {
    const data = await slim<{ albums: LmsAlbum[] }>(`albums ${artistId} -1`);
    return data.albums ?? [];
  },
  async allAlbums(): Promise<LmsAlbum[]> {
    const data = await slim<{ albums: LmsAlbum[] }>("albums");
    return data.albums ?? [];
  },
  async tracks(albumId: number): Promise<Track[]> {
    const data = await slim<{ tracks: LmsTrack[] }>(`titles ${albumId} -1`);
    return (data.tracks ?? []).map(lyrionTrack);
  },
  async search(query: string): Promise<Track[]> {
    const data = await slim<{ tracks: LmsTrack[] }>(`titles search:"${query.replace(/"/g, "")}" -1`);
    return (data.tracks ?? []).map(lyrionTrack);
  },
  async playlists(): Promise<{ id: number; name: string }[]> {
    const data = await slim<{ playlists: { id: number; name: string }[] }>("playlists");
    return data.playlists ?? [];
  },
  async playlistTracks(playlistId: number): Promise<Track[]> {
    const data = await slim<{ tracks: LmsTrack[] }>(`playlists tracks ${playlistId}`);
    return (data.tracks ?? []).map(lyrionTrack);
  },
  track: lyrionTrack,
};
