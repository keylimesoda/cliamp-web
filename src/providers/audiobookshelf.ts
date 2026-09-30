/**
 * Audiobookshelf provider — books + podcasts on a self-hosted ABS server.
 * Bearer auth (API token, or username/password login → token). Playback is a
 * direct authenticated item file URL. Cross-origin requires CORS permission.
 */
import type { Provider, ResolvedSource, Track } from "../core/types";
import { useServers, type ServerConfig } from "../store/servers";
import { registerProvider } from "./registry";

interface AbsItem {
  id: string;
  title: string;
  author?: string;
  mediaType?: string;
  mediaSize?: number;
  hasAudio?: boolean;
  chapters?: { id: string; title: string; ino?: number }[];
  assets?: { id: string; title: string; ino?: number }[];
}
interface AbsAuthor {
  id: string;
  name: string;
  items?: AbsItem[];
}

let tokenOverride: string | null = null;

function cfg(): ServerConfig {
  const c = useServers.getState().getConfig("audiobookshelf");
  if (!c || !c.url.trim()) throw new Error("Audiobookshelf not configured (URL + token or user/password)");
  return c;
}
function base(): string {
  return cfg().url.replace(/\/$/, "");
}
function token(): string {
  if (tokenOverride) return tokenOverride;
  const c = cfg();
  if (c.token?.trim()) return c.token.trim();
  throw new Error("Audiobookshelf needs a token (or log in with user/password)");
}
function headers(): Record<string, string> {
  return { Authorization: `Bearer ${token()}`, Accept: "application/json" };
}
async function absGet<T>(path: string): Promise<T> {
  const res = await fetch(`${base()}/${path}`, { headers: headers() });
  if (!res.ok) throw new Error(`abs ${res.status}`);
  return (await res.json()) as T;
}

export async function absLogin(username: string, password: string): Promise<void> {
  const res = await fetch(`${base()}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) throw new Error(`abs login ${res.status}`);
  const data = (await res.json()) as { access_token?: string };
  if (!data.access_token) throw new Error("abs login: no token");
  tokenOverride = data.access_token;
}

/** A playable file for an item: first chapter (books) or the item asset (podcasts). */
function fileOf(item: AbsItem): { ino: number; title: string } {
  if (item.chapters?.length) return { ino: item.chapters[0].ino ?? 0, title: item.chapters[0].title };
  const a = item.assets?.[0];
  return { ino: a?.ino ?? 0, title: a?.title ?? item.title };
}

function absTrack(item: AbsItem): Track {
  const f = fileOf(item);
  return {
    path: `audiobookshelf://item/${item.id}`,
    title: item.title,
    artist: item.author,
    durationSecs: undefined,
    provider: "audiobookshelf",
    providerMeta: { itemId: item.id, ino: f.ino, fileTitle: f.title },
  };
}

export const audiobookshelfProvider: Provider = {
  id: "audiobookshelf",
  name: "Audiobookshelf",
  description: "Self-hosted audiobooks + podcasts",
  capabilities: { browse: true, search: true },
  async resolveSource(track: Track): Promise<ResolvedSource> {
    const itemId = track.providerMeta?.itemId;
    const ino = track.providerMeta?.ino;
    if (typeof itemId !== "string" || typeof ino !== "number") throw new Error("no item/ino");
    return { url: `${base()}/api/items/${itemId}/file/${ino}?token=${encodeURIComponent(token())}`, seekable: true };
  },
};
registerProvider(audiobookshelfProvider);

export const absBrowse = {
  async libraries(): Promise<{ id: string; name: string }[]> {
    const data = await absGet<{ id: string; name: string }[]>("api/libraries");
    return data;
  },
  async items(libraryId: string, limit = 500): Promise<AbsItem[]> {
    const data = await absGet<{ items: AbsItem[] }>(
      `api/libraries/${libraryId}/items?limit=${limit}&sort=media.metadata.title`,
    );
    return data.items ?? [];
  },
  async authors(libraryId: string): Promise<AbsAuthor[]> {
    const data = await absGet<AbsAuthor[]>(`api/libraries/${libraryId}/authors`);
    return data;
  },
  async authorItems(authorId: string): Promise<AbsItem[]> {
    const data = await absGet<{ items: AbsItem[] }>(`api/authors/${authorId}?include=items`);
    return data.items ?? [];
  },
  async search(libraryId: string, q: string, limit = 50): Promise<AbsItem[]> {
    const data = await absGet<{ items: AbsItem[] }>(
      `api/libraries/${libraryId}/search?q=${encodeURIComponent(q)}&limit=${limit}`,
    );
    return data.items ?? [];
  },
  track: absTrack,
};
