/** Audiobookshelf token/login, expanded books and podcast episodes. */
import type { Provider, ResolvedSource, Track } from "../core/types";
import { useServers, type ServerConfig } from "../store/servers";
import { registerProvider } from "./registry";

interface AudioFile { ino?: string | number; duration?: number; title?: string; index?: number; metadata?: { filename?: string }; }
export interface AbsItem {
  id: string; mediaType?: string; title: string; author?: string;
  media: { metadata: { title: string; authorName?: string; author?: string }; tracks?: AudioFile[];
    episodes?: { id: string; title: string; publishedAt?: number; audioFile?: AudioFile; audioTrack?: AudioFile }[] };
}
let cached: { config: ServerConfig; token: string } | null = null;
function cfg(): ServerConfig {
  const c = useServers.getState().getConfig("audiobookshelf");
  if (!c?.url.trim()) throw new Error("Configure Audiobookshelf first");
  return c;
}
async function auth(): Promise<{ base: string; token: string }> {
  const c = cfg(), base = c.url.replace(/\/$/, "");
  if (c.token?.trim()) return { base, token: c.token.trim() };
  if (cached?.config === c) return { base, token: cached.token };
  if (!c.user || !c.password) throw new Error("Audiobookshelf needs a token or username/password");
  const res = await fetch(`${base}/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: c.user, password: c.password }) });
  if (!res.ok) throw new Error(`Audiobookshelf login ${res.status}`);
  const data = await res.json() as { user?: { token?: string }; accessToken?: string };
  const token = data.user?.token || data.accessToken;
  if (!token) throw new Error("Audiobookshelf login returned no token");
  if (cfg() !== c) throw new Error("Audiobookshelf configuration changed");
  cached = { config: c, token }; return { base, token };
}
async function get<T>(path: string): Promise<T> {
  const { base, token } = await auth();
  const res = await fetch(`${base}/${path}`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
  if (!res.ok) { if (res.status === 401) cached = null; throw new Error(`Audiobookshelf ${res.status}`); }
  return await res.json() as T;
}
function item(it: AbsItem): AbsItem {
  return { ...it, title: it.media?.metadata?.title || it.title || "Untitled", author: it.media?.metadata?.authorName || it.media?.metadata?.author || it.author };
}
async function tracksForItem(itemId: string): Promise<Track[]> {
  const book = item(await get<AbsItem>(`api/items/${encodeURIComponent(itemId)}?expanded=1`));
  const serverUrl = cfg().url.replace(/\/$/, "");
  const common = { artist: book.author, album: book.title, provider: "audiobookshelf" };
  if (book.mediaType === "podcast") return [...(book.media.episodes || [])]
    .sort((a, b) => (b.publishedAt || 0) - (a.publishedAt || 0)).flatMap((ep): Track[] => {
      const file = ep.audioFile?.ino ? ep.audioFile : ep.audioTrack;
      if (!file?.ino) return [];
      return [{ ...common, kind: "podcast", path: `audiobookshelf://episode/${book.id}/${ep.id}`, title: ep.title,
        durationSecs: ep.audioTrack?.duration || file.duration, providerMeta: { itemId: book.id, episodeId: ep.id, ino: String(file.ino), serverUrl } }];
    });
  return (book.media.tracks || []).filter((file) => file.ino).map((file, i) => ({
    ...common, kind: "audiobook", path: `audiobookshelf://book/${book.id}/${file.ino}`,
    title: file.title || file.metadata?.filename || `${book.title} · Part ${i + 1}`, durationSecs: file.duration,
    providerMeta: { itemId: book.id, ino: String(file.ino), serverUrl },
  }));
}
export const audiobookshelfProvider: Provider = {
  id: "audiobookshelf", name: "Audiobookshelf", description: "Audiobooks and podcast episodes",
  capabilities: { browse: true, search: true },
  async resolveSource(track: Track): Promise<ResolvedSource> {
    const { base, token } = await auth();
    if (track.providerMeta?.serverUrl && track.providerMeta.serverUrl !== base) throw new Error("This book belongs to another Audiobookshelf server");
    const { itemId, ino } = track.providerMeta || {};
    if (typeof itemId !== "string" || (typeof ino !== "string" && typeof ino !== "number")) throw new Error("Book has no playable file");
    return { url: `${base}/api/items/${encodeURIComponent(itemId)}/file/${encodeURIComponent(String(ino))}?token=${encodeURIComponent(token)}`, seekable: true };
  },
};
registerProvider(audiobookshelfProvider);
export const absBrowse = {
  async libraries(): Promise<{ id: string; name: string }[]> { return (await get<{ libraries: { id: string; name: string }[] }>("api/libraries")).libraries || []; },
  async items(libraryId: string, limit = 500): Promise<AbsItem[]> {
    return ((await get<{ results: AbsItem[] }>(`api/libraries/${encodeURIComponent(libraryId)}/items?limit=${limit}&sort=media.metadata.title`)).results || []).map(item);
  },
  tracks: tracksForItem,
  async search(libraryId: string, query: string): Promise<Track[]> {
    const data = await get<{ book?: { libraryItem: AbsItem }[]; podcast?: { libraryItem: AbsItem }[] }>(`api/libraries/${encodeURIComponent(libraryId)}/search?q=${encodeURIComponent(query)}&limit=25`);
    const items = [...(data.book || []), ...(data.podcast || [])];
    return (await Promise.all(items.map((hit) => tracksForItem(hit.libraryItem.id)))).flat();
  },
};
