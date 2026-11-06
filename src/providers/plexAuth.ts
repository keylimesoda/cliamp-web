import { plexParams, securePlexUrls } from "./plexConnection";
import type { ServerConfig } from "../store/servers";

export interface PlexPin { id: number; code: string; expiresAt: number; }
export interface PlexServer { id: string; name: string; token: string; urls: string[]; relayUrls: string[]; }

async function cloud<T>(path: string, options: { method?: string; token?: string; signal: AbortSignal }): Promise<T> {
  const url = new URL(`https://plex.tv/api/v2/${path}`);
  for (const [key, value] of plexParams(options.token)) url.searchParams.set(key, value);
  const res = await fetch(url, { method: options.method || "GET", headers: { Accept: "application/json" }, signal: AbortSignal.any([options.signal, AbortSignal.timeout(15000)]) });
  if (!res.ok) throw new Error(res.status === 404 || res.status === 410 ? "Plex code expired. Create a new code." : `Plex sign-in failed (${res.status})`);
  return await res.json() as T;
}

export async function createPlexPin(signal: AbortSignal): Promise<PlexPin> {
  const pin = await cloud<{ id: number; code: string; expiresIn?: number }>("pins", { method: "POST", signal });
  if (!Number.isFinite(pin.id) || typeof pin.code !== "string" || !pin.code) throw new Error("Plex did not return a sign-in code");
  return { id: pin.id, code: pin.code, expiresAt: Date.now() + (pin.expiresIn || 300) * 1000 };
}

export async function checkPlexPin(pin: PlexPin, signal: AbortSignal): Promise<string | null> {
  if (Date.now() >= pin.expiresAt) throw new Error("Plex code expired. Create a new code.");
  const result = await cloud<{ authToken?: string }>(`pins/${encodeURIComponent(pin.id)}`, { signal });
  return result.authToken || null;
}

export async function discoverPlexServers(token: string, signal: AbortSignal): Promise<PlexServer[]> {
  const resources = await cloud<{ clientIdentifier: string; name: string; provides?: string; accessToken?: string;
    connections?: { uri: string; relay?: boolean }[] }[]>("resources?includeHttps=1&includeRelay=1", { token, signal });
  if (!Array.isArray(resources)) throw new Error("Plex returned an invalid server list");
  return resources.filter((r) => r.provides?.split(",").includes("server") && r.accessToken && r.clientIdentifier)
    .map((r) => ({ id: r.clientIdentifier, name: r.name, token: r.accessToken!,
      urls: securePlexUrls([...(r.connections || [])].sort((a, b) => Number(Boolean(a.relay)) - Number(Boolean(b.relay))).map((c) => c.uri)),
      relayUrls: securePlexUrls((r.connections || []).filter((c) => c.relay).map((c) => c.uri)) }))
    .filter((server) => server.urls.length);
}

export function plexServerConfig(server: PlexServer): ServerConfig {
  return { url: server.urls[0], token: server.token, serverId: server.id, serverName: server.name, connectionUrls: server.urls, relayUrls: server.relayUrls };
}
