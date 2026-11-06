import { create } from "zustand";
import type { Track } from "../core/types";

export interface SavedPlaylist { id: string; name: string; tracks: Track[]; updatedAt: number; }
const KEY = "cliamp-web:playlists";
function read(): SavedPlaylist[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) || "null");
    if (parsed?.version !== 1 || !Array.isArray(parsed.lists)) return [];
    return parsed.lists.filter((p: SavedPlaylist) => p && typeof p.id === "string" && typeof p.name === "string"
      && Array.isArray(p.tracks) && p.tracks.every((t) => t && typeof t.path === "string" && typeof t.title === "string"));
  } catch { return []; }
}
export const useSavedPlaylists = create<{
  lists: SavedPlaylist[]; error: string | null;
  save: (name: string, tracks: Track[]) => boolean;
  rename: (id: string, name: string) => void;
  remove: (id: string) => void;
}>((set, get) => {
  const commit = (lists: SavedPlaylist[]): boolean => {
    try { localStorage.setItem(KEY, JSON.stringify({ version: 1, lists })); set({ lists, error: null }); return true; }
    catch { set({ error: "Could not save playlists. Browser storage may be full." }); return false; }
  };
  return {
    lists: read(), error: null,
    save(name, tracks) {
      if (!name.trim() || !tracks.length) return false;
      return commit([{ id: crypto.randomUUID(), name: name.trim(), tracks: structuredClone(tracks), updatedAt: Date.now() }, ...get().lists]);
    },
    rename(id, name) { if (name.trim()) commit(get().lists.map((p) => p.id === id ? { ...p, name: name.trim(), updatedAt: Date.now() } : p)); },
    remove(id) { commit(get().lists.filter((p) => p.id !== id)); },
  };
});
