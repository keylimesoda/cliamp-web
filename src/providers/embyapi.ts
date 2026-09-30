/**
 * Shared Jellyfin/Emby API client. Both servers speak the same REST API;
 * they differ only in the Authorization scheme (MediaBrowser vs Emby).
 * Auth is either a preconfigured API-key token, or username/password via
 * POST /Users/AuthenticateByName (token cached in memory).
 *
 * NOTE: cross-origin calls require the server to permit the PWA origin and
 * the auth headers (CORS preflight). Streams put the API key in the query so
 * the media fetch can be a plain GET.
 */
import type { Track } from "../core/types";
import { useServers, type ServerConfig, type ServerId } from "../store/servers";

export type EmbyFlavor = "jellyfin" | "emby";

export interface EmbyItem {
  Id: string;
  Name: string;
  Type: string;
  Artist?: string;
  Album?: string;
  AlbumArtist?: string;
  Year?: number;
  IndexNumber?: number;
  RunTimeTicks?: number;
  ParentId?: string;
  ParentIndexNumber?: number;
  ProviderIds?: Record<string, string>;
}

interface EmbyResponse<T> {
  Items?: T[];
  SortOrder?: string;
  TotalRecordCount?: number;
  Size?: number;
}

function base(cfg: ServerConfig): string {
  return cfg.url.replace(/\/$/, "");
}

const tokenCache = new Map<ServerId, string>();

function identityHeaders(flavor: EmbyFlavor, token?: string): Record<string, string> {
  const prefix = flavor === "jellyfin" ? "MediaBrowser" : "Emby";
  const auth = `${prefix} Client="cliamp", Device="cliamp-web", DeviceId="cliamp", Version="1.0.0"${token ? `, Token="${token}"` : ""}`;
  const h: Record<string, string> = {
    Authorization: auth,
    "X-Emby-Authorization": auth,
    Accept: "application/json",
  };
  if (token) h["X-Emby-Token"] = token;
  return h;
}

async function ensureToken(id: ServerId, flavor: EmbyFlavor): Promise<string> {
  const cfg = useServers.getState().getConfig(id)!;
  if (cfg.token?.trim()) return cfg.token.trim();
  const cached = tokenCache.get(id);
  if (cached) return cached;
  const res = await fetch(`${base(cfg)}/Users/AuthenticateByName`, {
    method: "POST",
    headers: { ...identityHeaders(flavor), "Content-Type": "application/json" },
    body: JSON.stringify({ Username: cfg.user, Password: cfg.password }),
  });
  if (!res.ok) throw new Error(`${id} auth failed (${res.status})`);
  const data = (await res.json()) as { User?: { Id?: string } };
  const tok = (data as { SessionToken?: string }).SessionToken;
  if (!tok) throw new Error(`${id} auth: no token`);
  tokenCache.set(id, tok);
  return tok;
}

async function get<T>(id: ServerId, flavor: EmbyFlavor, path: string, params: Record<string, string | number> = {}, token?: string): Promise<T> {
  const cfg = useServers.getState().getConfig(id)!;
  const tok = token ?? (await ensureToken(id, flavor));
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) q.set(k, String(v));
  const qs = q.toString();
  const url = `${base(cfg)}/${path}${qs ? `?${qs}` : ""}`;
  const res = await fetch(url, { headers: identityHeaders(flavor, tok) });
  if (!res.ok) throw new Error(`${id} ${res.status}`);
  return (await res.json()) as T;
}

export function embyConfig(id: ServerId): ServerConfig {
  const c = useServers.getState().getConfig(id);
  if (!c || !c.url.trim()) throw new Error(`${id} not configured (URL + token or user/password)`);
  return c;
}

/** Build the download URL for an item (API key in query for plain GET). */
export function embyDownloadUrl(id: ServerId, itemId: string): string {
  const cfg = embyConfig(id);
  const tok = cfg.token?.trim() || tokenCache.get(id) || "";
  const q = new URLSearchParams();
  q.set("ApiKey", tok);
  q.set("api_key", tok);
  return `${base(cfg)}/Items/${itemId}/Download?${q.toString()}`;
}

export function ticksToSecs(ticks?: number): number | undefined {
  if (!ticks || ticks <= 0) return undefined;
  return Math.round(ticks / 10_000_000);
}

export function itemToTrack(id: ServerId, it: EmbyItem): Track {
  return {
    path: `${id}://track/${it.Id}`,
    title: it.Name,
    artist: it.Artist || it.AlbumArtist,
    album: it.Album,
    year: it.Year,
    trackNumber: it.IndexNumber,
    durationSecs: ticksToSecs(it.RunTimeTicks),
    provider: id,
    providerMeta: { itemId: it.Id, parentId: it.ParentId },
  };
}

/** The client surface shared by the Jellyfin and Emby providers. */
export function embyBrowse(id: ServerId, flavor: EmbyFlavor) {
  return {
    async listViews(): Promise<{ id: string; name: string; type: string }[]> {
      const data = await get<EmbyResponse<EmbyItem>>(id, flavor, "Users/Me/Views");
      return (data.Items ?? []).map((v) => ({ id: v.Id, name: v.Name, type: v.Type }));
    },
    async listAlbums(viewId?: string, limit = 100): Promise<EmbyItem[]> {
      const params: Record<string, string | number> = {
        "Recursive.True": "true",
        "IncludeItemTypes": "Album",
        Limit: limit,
      };
      if (viewId) params.ParentId = viewId;
      const data = await get<EmbyResponse<EmbyItem>>(id, flavor, "Items", params);
      return data.Items ?? [];
    },
    async listTracks(parentId: string, limit = 300): Promise<EmbyItem[]> {
      const data = await get<EmbyResponse<EmbyItem>>(id, flavor, "Items", {
        ParentId: parentId,
        "Recursive.True": "true",
        "IncludeItemTypes": "Audio",
        Limit: limit,
      });
      return data.Items ?? [];
    },
    async search(query: string, limit = 50): Promise<EmbyItem[]> {
      const data = await get<EmbyResponse<EmbyItem>>(id, flavor, "Items", {
        SearchTerm: query,
        "IncludeItemTypes": "Audio,Album,Artist",
        Limit: limit,
      });
      return data.Items ?? [];
    },
    resolveDownload(itemId: string): string {
      return embyDownloadUrl(id, itemId);
    },
  };
}
