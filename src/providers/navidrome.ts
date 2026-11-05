/**
 * Navidrome provider — Subsonic REST API against a user-provided server.
 * Query-token auth (u / t=hex(MD5(password+salt)) / s=salt / v / c / f=json),
 * which avoids Authorization-header preflight. Navidrome sends
 * Access-Control-Allow-Origin: * by default, so it works from the PWA.
 *
 * Track identity is `navidrome://song/{id}`; resolveSource builds the
 * /rest/stream URL with fresh query auth.
 */
import { md5Hex } from "../core/md5";
import type { Provider, ResolvedSource, Track } from "../core/types";
import { useServers } from "../store/servers";
import { registerProvider } from "./registry";

const VERSION = "1.16.1";
const CLIENT = "cliamp";

function authParams(user: string, password: string): URLSearchParams {
  const saltBytes = new Uint8Array(8);
  crypto.getRandomValues(saltBytes);
  const salt = Array.from(saltBytes, (b) => b.toString(16).padStart(2, "0")).join("");
  const q = new URLSearchParams();
  q.set("u", user);
  q.set("t", md5Hex(password + salt));
  q.set("s", salt);
  q.set("v", VERSION);
  q.set("c", CLIENT);
  q.set("f", "json");
  return q;
}

interface SubsonicEnvelope<T> {
  "subsonic-response": T & { status: "ok" | "failed"; error?: { code: number; message: string } };
}

async function subsonic<T>(base: string, user: string, password: string, path: string, params: Record<string, string | number> = {}): Promise<T> {
  const q = authParams(user, password);
  for (const [k, v] of Object.entries(params)) q.set(k, String(v));
  const res = await fetch(`${base.replace(/\/$/, "")}/rest/${path}?${q.toString()}`);
  if (!res.ok) throw new Error(`navidrome ${res.status}`);
  const data = (await res.json()) as SubsonicEnvelope<T>;
  const response = data["subsonic-response"];
  if (response?.status !== "ok") throw new Error(response?.error?.message ?? "navidrome error");
  return response;
}

function cfg() {
  const c = useServers.getState().getConfig("navidrome");
  if (!c || !c.url.trim() || !c.user?.trim() || !c.password?.trim()) {
    throw new Error("Navidrome not configured (URL + user + password)");
  }
  return c;
}

interface SArtist { id: string; name: string; albumCount: number; }
interface SAlbum { id: string; name: string; artist: string; artistId?: string; coverArt?: string; songCount?: number; year?: number; }
interface SSong {
  id: string; title: string; artist: string; artistId?: string; album: string;
  albumId?: string; duration?: number; track?: number; year?: number; coverArt?: string; genre?: string; userRating?: number;
}

function coverUrl(coverArtId: string): string {
  const c = cfg();
  const q = authParams(c.user!, c.password!);
  q.set("id", coverArtId);
  return `${c.url.replace(/\/$/, "")}/rest/getCoverArt?${q.toString()}`;
}

function songToTrack(s: SSong): Track {
  return {
    path: `navidrome://song/${s.id}`,
    title: s.title,
    artist: s.artist,
    album: s.album,
    genre: s.genre,
    year: s.year,
    trackNumber: s.track,
    durationSecs: s.duration ? Math.round(s.duration) : undefined,
    artUrl: s.coverArt ? coverUrl(s.coverArt) : undefined,
    provider: "navidrome",
    rating: s.userRating ?? 0,
    providerMeta: { songId: s.id, albumId: s.albumId, artistId: s.artistId },
  };
}

export const navidromeProvider: Provider = {
  id: "navidrome",
  name: "Navidrome",
  description: "Self-hosted Subsonic music server",
  capabilities: { browse: true, search: true, playlists: true },
  async resolveSource(track: Track): Promise<ResolvedSource> {
    const c = cfg();
    const id = track.providerMeta?.songId as string | undefined;
    if (!id) throw new Error("no song id");
    const q = authParams(c.user!, c.password!);
    q.set("id", id);
    q.set("stream", "1");
    return { url: `${c.url.replace(/\/$/, "")}/rest/stream?${q.toString()}`, seekable: true };
  },
};

registerProvider(navidromeProvider);

export const navidromeBrowse = {
  async setRating(track: Track, rating: number): Promise<void> {
    if (!Number.isInteger(rating) || rating < 0 || rating > 5) throw new Error("Rating must be 0–5");
    if (track.provider !== "navidrome" || typeof track.providerMeta?.songId !== "string") throw new Error("Not a Navidrome song");
    const c = cfg();
    await subsonic(c.url, c.user!, c.password!, "setRating", { id: track.providerMeta.songId, rating });
  },
  async listArtists(): Promise<SArtist[]> {
    const c = cfg();
    const data = await subsonic<{ artists: { index?: { artist?: SArtist[] }[] } }>(c.url, c.user!, c.password!, "getArtists");
    return data.artists.index?.flatMap((i) => i.artist ?? []) ?? [];
  },
  async albumsForArtist(artistId: string): Promise<SAlbum[]> {
    const c = cfg();
    const data = await subsonic<{ artist: { album: SAlbum[] } }>(c.url, c.user!, c.password!, "getArtist", { id: artistId });
    return data.artist.album;
  },
  async listAlbums(size = 100): Promise<SAlbum[]> {
    const c = cfg();
    const data = await subsonic<{ albumList2: { album?: SAlbum[] } }>(c.url, c.user!, c.password!, "getAlbumList2", { type: "newest", size });
    return data.albumList2.album ?? [];
  },
  async tracksForAlbum(albumId: string): Promise<Track[]> {
    const c = cfg();
    const data = await subsonic<{ album: { song: SSong[] } }>(c.url, c.user!, c.password!, "getAlbum", { id: albumId });
    return data.album.song.map(songToTrack);
  },
  async search(query: string, songCount = 50): Promise<Track[]> {
    const c = cfg();
    const data = await subsonic<{ searchResult3: { song?: SSong[] } }>(c.url, c.user!, c.password!, "search3", { query, songCount, albumCount: 0, artistCount: 0 });
    return (data.searchResult3.song ?? []).map(songToTrack);
  },
  async listPlaylists(): Promise<{ id: string; name: string }[]> {
    const c = cfg();
    const data = await subsonic<{ playlists: { playlist?: { id: string; name: string }[] } }>(c.url, c.user!, c.password!, "getPlaylists");
    return data.playlists.playlist ?? [];
  },
  async playlistTracks(playlistId: string): Promise<Track[]> {
    const c = cfg();
    const data = await subsonic<{ playlist: { entry?: SSong[] } }>(c.url, c.user!, c.password!, "getPlaylist", { id: playlistId });
    return (data.playlist.entry ?? []).map(songToTrack);
  },
};
