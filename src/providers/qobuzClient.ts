/** Direct browser API adapter; not exposed until browser OAuth is configured. */
import { md5Hex } from "../core/md5";
import type { ResolvedSource, Track } from "../core/types";

export type QobuzQuality = 5 | 6 | 7 | 27;
export interface QobuzSession { appId: string; signingSecret: string; userToken: string; userId: string; }
export interface QobuzArtist { id: number | string; name: string; }
export interface QobuzAlbum {
  id: string; title: string; artist?: QobuzArtist; release_date_original?: string;
  genre?: { name?: string }; image?: { large?: string }; tracks?: Page<QobuzTrack>;
}
export interface QobuzPlaylist { id: number | string; name: string; tracks_count?: number; tracks?: Page<QobuzTrack>; }
interface QobuzTrack {
  id: number | string; title: string; duration?: number; streamable?: boolean;
  track_number?: number; performer?: QobuzArtist; album?: QobuzAlbum;
}
interface Page<T> { items: T[]; total: number; }
const API = "https://www.qobuz.com/api.json/0.2/";
const QUALITIES: QobuzQuality[] = [5, 6, 7, 27];

export function qobuzFileSignature(id: string, quality: QobuzQuality, timestamp: string, secret: string): string {
  return md5Hex(`trackgetFileUrlformat_id${quality}intentstreamtrack_id${id}${timestamp}${secret}`);
}

export class QobuzClient {
  constructor(private readonly session: QobuzSession, private readonly quality: QobuzQuality = 6) {
    if (!session.appId || !session.signingSecret || !session.userToken || !session.userId) throw new Error("Qobuz requires a verified browser session");
    if (!QUALITIES.includes(quality)) throw new Error("Unsupported Qobuz quality");
  }

  private async request<T>(endpoint: string, params: Record<string, string | number> = {}, signal?: AbortSignal, post = false): Promise<T> {
    const url = new URL(endpoint, API);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
    const response = await fetch(url, {
      method: post ? "POST" : "GET",
      headers: { Accept: "application/json", "X-App-Id": this.session.appId, "X-User-Auth-Token": this.session.userToken,
        ...(post ? { "Content-Type": "application/x-www-form-urlencoded" } : {}) },
      ...(post ? { body: "extra=partner" } : {}),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000),
    });
    if (response.status === 401) throw new Error("Qobuz session expired. Sign in again.");
    if (response.status === 403) throw new Error("Qobuz did not allow access to this content.");
    if (!response.ok) throw new Error(`Qobuz request failed (${response.status})`);
    const result = await response.json() as T & { status?: string };
    if (result.status === "error") throw new Error("Qobuz rejected the request");
    return result;
  }

  async verify(signal?: AbortSignal): Promise<{ userId: string; label: string }> {
    const info = await this.request<{ user: { id: string | number; credential?: { parameters?: { short_label?: string } } } }>("user/login", {}, signal, true);
    if (!info.user?.credential?.parameters) throw new Error("This Qobuz account is not eligible for streaming");
    if (String(info.user.id) !== this.session.userId) throw new Error("Qobuz account changed. Sign in again.");
    return { userId: String(info.user.id), label: info.user.credential.parameters.short_label || "Qobuz" };
  }

  private track(item: QobuzTrack, album?: QobuzAlbum): Track | null {
    if (item.streamable !== true || !/^\d+$/.test(String(item.id))) return null;
    const record = item.album || album;
    return {
      path: `qobuz://track/${item.id}`, title: item.title,
      artist: item.performer?.name || record?.artist?.name, album: record?.title,
      genre: record?.genre?.name, year: Number(record?.release_date_original?.slice(0, 4)) || undefined,
      durationSecs: item.duration, trackNumber: item.track_number,
      artUrl: record?.image?.large?.startsWith("https://") ? record.image.large : undefined,
      provider: "qobuz", providerMeta: { trackId: String(item.id), albumId: record?.id, userId: this.session.userId },
    };
  }

  private tracks(items: QobuzTrack[], album?: QobuzAlbum): Track[] {
    return items.flatMap((item) => { const track = this.track(item, album); return track ? [track] : []; });
  }

  async playlists(offset = 0, signal?: AbortSignal): Promise<Page<QobuzPlaylist>> {
    const result = await this.request<{ playlists: Page<QobuzPlaylist> }>("playlist/getUserPlaylists", { offset, limit: 100 }, signal);
    if (!Array.isArray(result.playlists?.items)) throw new Error("Qobuz returned an invalid playlist list");
    return result.playlists;
  }

  async playlistTracks(id: string, signal?: AbortSignal): Promise<Track[]> {
    const result: Track[] = [];
    for (let offset = 0; ; offset += 500) {
      const playlist = await this.request<QobuzPlaylist>("playlist/get", { playlist_id: id, extra: "tracks", offset, limit: 500 }, signal);
      if (!Array.isArray(playlist.tracks?.items)) throw new Error("Qobuz returned invalid playlist tracks");
      result.push(...this.tracks(playlist.tracks.items));
      if (!playlist.tracks.items.length || offset + 500 >= playlist.tracks.total) return result;
    }
  }

  async albumTracks(id: string, signal?: AbortSignal): Promise<Track[]> {
    const album = await this.request<QobuzAlbum>("album/get", { album_id: id, extra: "tracks" }, signal);
    if (!Array.isArray(album.tracks?.items)) throw new Error("Qobuz returned invalid album tracks");
    return this.tracks(album.tracks.items, album);
  }

  async favorites(type: "tracks", offset?: number, signal?: AbortSignal): Promise<Page<Track>>;
  async favorites(type: "albums", offset?: number, signal?: AbortSignal): Promise<Page<QobuzAlbum>>;
  async favorites(type: "artists", offset?: number, signal?: AbortSignal): Promise<Page<QobuzArtist>>;
  async favorites(type: "tracks" | "albums" | "artists", offset = 0, signal?: AbortSignal): Promise<Page<Track> | Page<QobuzAlbum> | Page<QobuzArtist>> {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const data = await this.request<Record<string, Page<QobuzTrack | QobuzAlbum | QobuzArtist>>>("favorite/getUserFavorites", {
      type, offset, limit: 100, request_ts: timestamp,
      request_sig: md5Hex(`favoritegetUserFavorites${timestamp}${this.session.signingSecret}`),
    }, signal);
    const page = data[type];
    if (!Array.isArray(page?.items)) throw new Error("Qobuz returned an invalid favorites list");
    return type === "tracks" ? { ...page, items: this.tracks(page.items as QobuzTrack[]) } : page as Page<QobuzAlbum> | Page<QobuzArtist>;
  }

  async artistAlbums(id: string, offset = 0, signal?: AbortSignal): Promise<Page<QobuzAlbum>> {
    const result = await this.request<{ albums: Page<QobuzAlbum> }>("artist/get", { artist_id: id, extra: "albums", offset, limit: 100 }, signal);
    if (!Array.isArray(result.albums?.items)) throw new Error("Qobuz returned an invalid album list");
    return result.albums;
  }

  async search(query: string, signal?: AbortSignal): Promise<Track[]> {
    const result = await this.request<{ tracks: Page<QobuzTrack> }>("track/search", { query, limit: 50 }, signal);
    if (!Array.isArray(result.tracks?.items)) throw new Error("Qobuz returned invalid search results");
    return this.tracks(result.tracks.items);
  }

  async resolve(track: Track, signal?: AbortSignal): Promise<ResolvedSource> {
    const id = track.providerMeta?.trackId;
    if (track.provider !== "qobuz" || typeof id !== "string" || !/^\d+$/.test(id)) throw new Error("Not a Qobuz track");
    if (track.providerMeta?.userId !== this.session.userId) throw new Error("This track belongs to another Qobuz session");
    const timestamp = String(Math.floor(Date.now() / 1000));
    const result = await this.request<{ url: string }>("track/getFileUrl", {
      track_id: id, format_id: this.quality, intent: "stream", request_ts: timestamp,
      request_sig: qobuzFileSignature(id, this.quality, timestamp, this.session.signingSecret),
    }, signal);
    const url = new URL(result.url);
    if (url.protocol !== "https:" || url.username || url.password) throw new Error("Qobuz did not return a secure audio URL");
    return { url: url.href, seekable: true };
  }
}
