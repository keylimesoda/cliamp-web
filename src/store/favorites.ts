/**
 * Track favorites — a persisted ★ list of tracks the driver starred from any
 * provider. Complements the Radio provider's station favorites.
 */
import { create } from "zustand";
import type { Track } from "../core/types";

const KEY = "cliamp-web:favorites";

function read(): Track[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
function write(list: Track[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* ignore quota */
  }
}

interface FavoritesState {
  tracks: Track[];
  toggle: (t: Track) => void;
}

export const useFavoritesStore = create<FavoritesState>((set) => ({
  tracks: read(),
  toggle(t) {
    set((s) => {
      const has = s.tracks.some((x) => x.path === t.path);
      const tracks = has ? s.tracks.filter((x) => x.path !== t.path) : [t, ...s.tracks];
      write(tracks);
      return { tracks };
    });
  },
}));

export function isFavorite(path: string): boolean {
  return useFavoritesStore.getState().tracks.some((t) => t.path === path);
}
