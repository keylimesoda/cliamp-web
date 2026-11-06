import type { ServerConfig } from "../store/servers";

export function plexClientId(): string {
  const key = "cliamp-web:plex-client-id";
  let id = localStorage.getItem(key);
  if (!id) { id = crypto.randomUUID(); localStorage.setItem(key, id); }
  return id;
}

export function plexParams(token?: string): URLSearchParams {
  const q = new URLSearchParams({ "X-Plex-Product": "cliamp-web", "X-Plex-Client-Identifier": plexClientId() });
  if (token) q.set("X-Plex-Token", token);
  return q;
}

/** Keep credentials on the selected server even when an API key is absolute. */
export function plexUrl(base: string, path: string, token: string): string {
  const root = new URL(base.replace(/\/+$/, "") + "/");
  const url = new URL(path.replace(/^\/(?!\/)/, ""), root);
  if (url.origin !== root.origin || !/^https?:$/.test(url.protocol)) throw new Error("Plex returned a file on another server");
  for (const [key, value] of plexParams(token)) url.searchParams.set(key, value);
  return url.href;
}

export function securePlexUrls(urls: string[]): string[] {
  return [...new Set(urls.flatMap((value) => {
    try {
      const u = new URL(value);
      if (u.username || u.password || u.search || u.hash || u.protocol !== "https:") return [];
      return [u.href.replace(/\/+$/, "")];
    } catch { return []; }
  }))];
}

export async function verifyPlexConfig(config: ServerConfig, signal?: AbortSignal): Promise<void> {
  if (!config.token?.trim()) throw new Error("Enter a Plex token or link your Plex account");
  const res = await fetch(plexUrl(config.url, "library/sections", config.token), {
    headers: { Accept: "application/json" }, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(6000)]) : AbortSignal.timeout(6000),
  });
  if (!res.ok) throw new Error(`Plex connection failed (${res.status})`);
  const data = await res.json() as { MediaContainer?: { machineIdentifier?: string; Directory?: { type: string }[]; Metadata?: { type: string }[] } };
  const container = data.MediaContainer;
  if (!container) throw new Error("This address did not return a Plex library");
  if (config.serverId && container.machineIdentifier && config.serverId !== container.machineIdentifier) throw new Error("Plex server identity changed");
  if (!(container.Directory || container.Metadata || []).some((section) => section.type === "artist" || section.type === "album")) throw new Error("This Plex server has no accessible music libraries");
}

/** Race direct endpoints, then try relays. A cancelled setup never saves. */
export async function connectPlexServer(config: ServerConfig, signal?: AbortSignal): Promise<ServerConfig> {
  const urls = securePlexUrls([config.url, ...(config.connectionUrls || [])]);
  if (!urls.length) throw new Error("Plex needs a reachable HTTPS server address");
  const direct = urls.filter((url) => !config.relayUrls?.includes(url));
  const relay = urls.filter((url) => !direct.includes(url));
  for (const group of [direct, relay]) {
    if (!group.length) continue;
    const controller = new AbortController();
    const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    try {
      const url = await Promise.any(group.map(async (url) => { await verifyPlexConfig({ ...config, url }, combined); return url; }));
      signal?.throwIfAborted();
      return { ...config, url, connectionUrls: urls };
    } catch { signal?.throwIfAborted(); }
    finally { controller.abort(); }
  }
  throw new Error("Cannot reach a music library on this Plex server. Check Remote Access and secure connections at home, then try again.");
}
