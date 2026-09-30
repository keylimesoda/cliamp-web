/**
 * Jellyfin + Emby providers — both use the shared embyapi client; they differ
 * only in the Authorization scheme (MediaBrowser vs Emby). Tracks are
 * `jellyfin://track/{id}` / `emby://track/{id}` and resolve to the item
 * download URL (API key in query).
 */
import type { Provider, ResolvedSource, Track } from "../core/types";
import { embyBrowse, embyConfig, embyDownloadUrl, itemToTrack } from "./embyapi";
import type { EmbyItem } from "./embyapi";
import { registerProvider } from "./registry";

function metaId(track: Track): string {
  const id = track.providerMeta?.itemId;
  if (typeof id !== "string" || !id) throw new Error("no item id");
  return id;
}

function makeProvider(id: "jellyfin" | "emby", name: string): Provider {
  return {
    id,
    name,
    description: "Self-hosted media server (Emby-compatible API)",
    capabilities: { browse: true, search: true },
    async resolveSource(track: Track): Promise<ResolvedSource> {
      embyConfig(id);
      return { url: embyDownloadUrl(id, metaId(track)), seekable: true };
    },
  };
}

export const jellyfinProvider: Provider = makeProvider("jellyfin", "Jellyfin");
export const embyProvider: Provider = makeProvider("emby", "Emby");
registerProvider(jellyfinProvider);
registerProvider(embyProvider);

export const jellyfinBrowse = embyBrowse("jellyfin", "jellyfin");
export const embyBrowseClient = embyBrowse("emby", "emby");

export function jellyfinTrack(it: EmbyItem): Track {
  return itemToTrack("jellyfin", it);
}
export function embyTrack(it: EmbyItem): Track {
  return itemToTrack("emby", it);
}
