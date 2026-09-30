/**
 * Recently Played history — parity with cliamp's history.toml.
 * Records a play once a track reaches 50% of its duration (same threshold as
 * the Navidrome scrobbler). Skipped tracks and live streams (no known
 * duration) are not recorded. Consecutive plays of the same track within
 * 5 minutes update the top entry instead of adding another. FIFO cap 200.
 */
import { create } from "zustand";
import type { Track } from "../core/types";

const KEY = "cliamp-web:history";
const CAP = 200;
const DEDUPE_MS = 5 * 60 * 1000;

export interface HistoryEntry {
  playedAt: number; // epoch ms
  path: string;
  title: string;
  artist: string;
  album: string;
  year?: number;
  durationSecs?: number;
  track: Track; // full track so it can be replayed
}

function read(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
function write(entries: HistoryEntry[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(entries));
  } catch {
    /* ignore quota */
  }
}

function shouldRecord(t: Track): boolean {
  if (!t.path) return false;
  if (t.stream || t.live) return false; // no known 50% point
  if (!t.durationSecs || t.durationSecs <= 0) return false;
  return true;
}

interface HistoryState {
  entries: HistoryEntry[];
  record: (t: Track) => void;
  clear: () => void;
}

export const useHistoryStore = create<HistoryState>((set) => ({
  entries: read(),
  record(t) {
    if (!shouldRecord(t)) return;
    set((s) => {
      const now = Date.now();
      const entries = [...s.entries];
      const top = entries[0];
      // consecutive same-track within 5 min -> refresh top timestamp
      if (top && top.path === t.path && now - top.playedAt < DEDUPE_MS) {
        top.playedAt = now;
        write(entries);
        return { entries };
      }
      entries.unshift({
        playedAt: now,
        path: t.path,
        title: t.title ?? t.path,
        artist: t.artist ?? "",
        album: t.album ?? "",
        year: t.year,
        durationSecs: t.durationSecs,
        track: t,
      });
      if (entries.length > CAP) entries.length = CAP;
      write(entries);
      return { entries };
    });
  },
  clear() {
    write([]);
    set({ entries: [] });
  },
}));
