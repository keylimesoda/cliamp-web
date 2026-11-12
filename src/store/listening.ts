import { create } from "zustand";
import { findProgress, makeProgress, type ListeningProgress } from "../core/listening";
import type { Track } from "../core/types";

const KEY = "cliamp-web:listening-progress";
function read(): Record<string, ListeningProgress> {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) || "null");
    if (value?.version !== 1 || !Array.isArray(value.entries)) return {};
    return Object.fromEntries(value.entries.filter((p: ListeningProgress) => p && typeof p.key === "string"
      && Number.isFinite(p.position) && p.position >= 0 && Number.isFinite(p.duration) && p.duration >= 0
      && typeof p.completed === "boolean" && Number.isFinite(p.updatedAt)).map((p: ListeningProgress) => [p.key, p]));
  } catch { return {}; }
}
export const useListening = create<{
  entries: Record<string, ListeningProgress>;
  record: (track: Track, position: number, duration: number, ended?: boolean) => void;
  restart: (track: Track) => void;
}>((set, get) => ({
  entries: read(),
  record(track, position, duration, ended = false) {
    const p = makeProgress(track, position, duration, ended);
    if (!p) return;
    const entries = { ...get().entries };
    const previous = findProgress(entries, track);
    if (previous && previous.key !== p.key) delete entries[previous.key];
    entries[p.key] = p;
    const bounded = Object.values(entries).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 2000);
    try { localStorage.setItem(KEY, JSON.stringify({ version: 1, entries: bounded })); } catch { /* quota */ }
    set({ entries: Object.fromEntries(bounded.map((entry) => [entry.key, entry])) });
  },
  restart(track) { get().record(track, 0, track.durationSecs || 0); },
}));
