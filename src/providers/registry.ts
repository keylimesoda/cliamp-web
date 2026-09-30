/**
 * Provider registry — the web equivalent of cliamp's provider list.
 * A track's `provider` field (or a direct URL) selects which provider
 * resolves its playable source. Providers register at import time.
 */
import type { Provider, ResolvedSource, Track } from "../core/types";

const providers = new Map<string, Provider>();

export function registerProvider(p: Provider): void {
  providers.set(p.id, p);
}

export function getProvider(id: string): Provider | undefined {
  return providers.get(id);
}

export function listProviders(): Provider[] {
  return [...providers.values()];
}

/**
 * Resolve a track to a playable source. A track with no `provider` (or
 * provider "url") whose path is an http(s) URL is treated as a direct
 * source. Otherwise the owning provider's resolveSource is used.
 */
export async function resolveTrack(track: Track): Promise<ResolvedSource> {
  const id = track.provider;
  if (!id || id === "url") {
    if (/^https?:\/\//.test(track.path)) {
      return { url: track.path, seekable: !track.stream };
    }
    throw new Error(`no playable source for ${track.path}`);
  }
  const p = providers.get(id);
  if (!p) throw new Error(`unknown provider: ${id}`);
  return p.resolveSource(track);
}
