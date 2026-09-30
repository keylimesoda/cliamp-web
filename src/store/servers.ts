/**
 * Self-hosted server configs — base URL + credentials for the user's own
 * music servers (Navidrome, Jellyfin, Emby, Plex, Audiobookshelf, Lyrion).
 * Persisted to localStorage. A provider is "configured" when its entry has
 * a non-empty base URL (+ required credentials).
 */
import { create } from "zustand";

export interface ServerConfig {
  url: string;
  user?: string;
  password?: string;
  token?: string;
  /** Optional restriction (e.g. Plex/Audiobookshelf library names). */
  libraries?: string[];
}

const KEY = "cliamp-web:servers";

export type ServerId =
  | "navidrome"
  | "jellyfin"
  | "emby"
  | "plex"
  | "audiobookshelf"
  | "lyrion";

export type ServerIdList = ServerId[];

function readAll(): Partial<Record<ServerId, ServerConfig>> {
  try {
    const s = localStorage.getItem(KEY);
    return s ? (JSON.parse(s) as Partial<Record<ServerId, ServerConfig>>) : {};
  } catch {
    return {};
  }
}
function writeAll(v: Partial<Record<ServerId, ServerConfig>>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(v));
  } catch {
    // non-fatal
  }
}

interface ServersStore {
  servers: Partial<Record<ServerId, ServerConfig>>;
  getConfig: (id: ServerId) => ServerConfig | undefined;
  isConfigured: (id: ServerId, needsCreds?: boolean) => boolean;
  saveConfig: (id: ServerId, cfg: ServerConfig) => void;
  removeConfig: (id: ServerId) => void;
}

export const useServers = create<ServersStore>()((set, get) => ({
  servers: readAll(),

  getConfig(id) {
    return get().servers[id];
  },
  isConfigured(id, needsCreds = true) {
    const c = get().servers[id];
    if (!c || !c.url.trim()) return false;
    if (!needsCreds) return true;
    // Navidrome needs user+password; others accept token or user+password.
    return Boolean(c.token?.trim() || (c.user?.trim() && c.password?.trim()));
  },
  saveConfig(id, cfg) {
    const servers = { ...get().servers, [id]: cfg };
    writeAll(servers);
    set({ servers });
  },
  removeConfig(id) {
    const servers = { ...get().servers };
    delete servers[id];
    writeAll(servers);
    set({ servers });
  },
}));
