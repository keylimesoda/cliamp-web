/**
 * Playlist / play-next queue model — pure logic, no DOM.
 * Parity with cliamp semantics (docs/recon/ui.md §4):
 *  - play-next queue is consumed before ordinary progression
 *  - repeat off/all/one; One replays current (queue still consumed first)
 *  - repeat all wraps next AND prev
 *  - shuffle on: randomized play order preserving current track;
 *    new tracks mix into upcoming order; off restores original order
 *  - track moves rejected while shuffle is on
 */
import { isTrack, type RepeatMode, type ShuffleMode, type Track } from "./types";

export class MoveRejectedError extends Error {}

export interface PlaylistSnapshot {
  tracks: Track[];
  current: number; // original index, -1 if none
  queue: number[]; // original indices
  order: number[];
  cursor: number;
  queuedCurrent: number;
}

export interface PlaylistState extends PlaylistSnapshot {
  shuffle: ShuffleMode;
  repeat: RepeatMode;
}

/** Reject corrupt indices rather than silently changing the listening order. */
export function isPlaylistState(value: unknown): value is PlaylistState {
  if (!value || typeof value !== "object") return false;
  const s = value as PlaylistState;
  if (!Array.isArray(s.tracks) || !s.tracks.every(isTrack)) return false;
  const n = s.tracks.length;
  const index = (i: number) => Number.isInteger(i) && i >= 0 && i < n;
  if (!Array.isArray(s.order) || s.order.length !== n || !s.order.every(index) || new Set(s.order).size !== n) return false;
  if (!Array.isArray(s.queue) || !s.queue.every(index) || new Set(s.queue).size !== s.queue.length) return false;
  if (!Number.isInteger(s.cursor) || s.cursor < -1 || s.cursor >= n) return false;
  if (s.queuedCurrent !== -1 && (!index(s.queuedCurrent) || s.cursor < 0)) return false;
  if (s.current !== (s.queuedCurrent >= 0 ? s.queuedCurrent : s.cursor < 0 ? -1 : s.order[s.cursor])) return false;
  return (s.shuffle === "off" || s.shuffle === "on") && ["off", "all", "one"].includes(s.repeat);
}

function shuffledWithout(current: number, count: number): number[] {
  const rest: number[] = [];
  for (let i = 0; i < count; i++) if (i !== current) rest.push(i);
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  return rest;
}

export class Playlist {
  private tracks: Track[] = [];
  private order: number[] = []; // original indices in play order
  private pos = -1; // position within order; -1 when empty
  private queuedCurrent = -1;
  private queue: number[] = []; // original indices, play-next order
  private shuffleMode: ShuffleMode = "off";
  private repeatMode: RepeatMode = "off";
  private snapshot: PlaylistSnapshot | null = null;
  private dirtyListeners = new Set<() => void>();

  onDirty(fn: () => void): () => void {
    this.dirtyListeners.add(fn);
    return () => this.dirtyListeners.delete(fn);
  }
  private dirty(): void {
    for (const fn of this.dirtyListeners) fn();
  }

  // ---- read API -------------------------------------------------------

  get count(): number {
    return this.tracks.length;
  }
  get shuffle(): ShuffleMode {
    return this.shuffleMode;
  }
  get repeat(): RepeatMode {
    return this.repeatMode;
  }
  get queueCount(): number {
    return this.queue.length;
  }

  /** Original indices in visible (play) order. */
  displayOrder(): number[] {
    return this.order;
  }
  /** Original index of the display position, or -1. */
  indexAtDisplay(pos: number): number {
    return this.order[pos] ?? -1;
  }
  /** Display position of an original index, or -1. */
  displayAt(index: number): number {
    return this.order.indexOf(index);
  }
  get currentIndex(): number {
    return this.queuedCurrent >= 0 ? this.queuedCurrent : this.pos === -1 ? -1 : this.order[this.pos];
  }
  get currentTrack(): Track | undefined {
    return this.currentIndex === -1 ? undefined : this.tracks[this.currentIndex];
  }
  track(index: number): Track | undefined {
    return this.tracks[index];
  }
  /** Original indices currently in the play-next queue. */
  queueIndices(): number[] {
    return [...this.queue];
  }
  isQueued(index: number): boolean {
    return this.queue.includes(index);
  }

  peekNextIndex(): number {
    if (this.queue.length) return this.queue[0];
    if (this.pos < 0) return -1;
    if (this.repeatMode === "one") return this.order[this.pos];
    if (this.pos + 1 < this.order.length) return this.order[this.pos + 1];
    return this.repeatMode === "all" ? (this.order[0] ?? -1) : -1;
  }

  // ---- lifecycle ------------------------------------------------------

  exportState(): PlaylistState {
    return {
      tracks: this.tracks.map((t) => ({ ...t })), current: this.currentIndex,
      queue: [...this.queue], order: [...this.order], cursor: this.pos,
      queuedCurrent: this.queuedCurrent, shuffle: this.shuffleMode, repeat: this.repeatMode,
    };
  }

  /** Restore exact order and both cursors, without reshuffling or consuming a queue entry. */
  restoreState(value: unknown): boolean {
    if (!isPlaylistState(value)) return false;
    this.tracks = value.tracks.map((t) => ({ ...t }));
    this.order = [...value.order];
    this.queue = [...value.queue];
    this.pos = value.cursor;
    this.queuedCurrent = value.queuedCurrent;
    this.shuffleMode = value.shuffle;
    this.repeatMode = value.repeat;
    this.snapshot = null;
    this.dirty();
    return true;
  }

  /** Replace the playlist entirely and start at startDisplay (default 0). */
  load(tracks: Track[], startDisplay = 0): void {
    this.snapshot = null;
    this.queuedCurrent = -1;
    this.queue = [];
    this.tracks = tracks.map((t) => ({ ...t }));
    this.order = this.tracks.map((_, i) => i);
    this.pos = this.order.length ? Math.max(0, Math.min(startDisplay, this.order.length - 1)) : -1;
    if (this.shuffleMode === "on" && this.pos >= 0) {
      const current = this.currentIndex;
      this.order = [current, ...shuffledWithout(current, this.tracks.length)];
      this.pos = 0;
    }
    this.dirty();
  }
  clear(): void {
    this.queuedCurrent = -1;
    this.snapshot = null;
    this.tracks = [];
    this.order = [];
    this.queue = [];
    this.pos = -1;
    this.dirty();
  }
  stop(): void {
    this.queuedCurrent = -1;
    this.pos = -1;
    this.dirty();
  }

  // ---- transport ------------------------------------------------------

  /**
   * Advance. Returns false when playback should stop (queue exhausted,
   * repeat off, end reached).
   */
  next(): boolean {
    if (this.pos === -1) return false;
    if (this.queue.length > 0) {
      const idx = this.queue.shift()!;
      this.queuedCurrent = idx;
      this.dirty();
      return true;
    }
    if (this.repeatMode === "one") {
      this.queuedCurrent = -1;
      // Replay the album cursor after queued tracks, matching native cliamp.
      this.dirty();
      return true;
    }
    let p = this.pos + 1;
    if (p >= this.order.length) {
      if (this.repeatMode === "all") p = 0;
      else return false;
    }
    this.queuedCurrent = -1;
    this.pos = p;
    this.dirty();
    return true;
  }

  /** Go back. Repeat all wraps from the beginning to the end. */
  prev(): boolean {
    if (this.pos === -1) return false;
    let p = this.pos - 1;
    if (p < 0) {
      if (this.repeatMode === "all") p = this.order.length - 1;
      else p = 0;
    }
    this.queuedCurrent = -1;
    this.pos = p;
    this.dirty();
    return true;
  }

  /** Play the track at a display position. */
  playDisplay(pos: number): boolean {
    const idx = this.indexAtDisplay(pos);
    if (idx === -1) return false;
    this.jumpToIndex(idx);
    return true;
  }

  private jumpToIndex(index: number): void {
    const d = this.displayAt(index);
    if (d === -1) return;
    this.queuedCurrent = -1;
    this.pos = d;
    this.dirty();
  }

  // ---- queue (play-next) ----------------------------------------------

  /** Toggle a track in the play-next queue. */
  queueToggle(displayPos: number): void {
    const idx = this.indexAtDisplay(displayPos);
    if (idx === -1) return;
    this.snapshot = null;
    const i = this.queue.indexOf(idx);
    if (i >= 0) this.queue.splice(i, 1);
    else this.queue.push(idx);
    this.dirty();
  }
  /** Move this track to the front of the play-next queue. */
  enqueueNext(displayPos: number): void {
    const idx = this.indexAtDisplay(displayPos);
    if (idx === -1) return;
    this.takeSnapshot();
    this.queue = [idx, ...this.queue.filter((q) => q !== idx)];
    this.dirty();
  }
  queueRemove(displayPos: number): void {
    if (displayPos < 0 || displayPos >= this.queue.length) return;
    this.takeSnapshot();
    this.queue.splice(displayPos, 1);
    this.dirty();
  }
  queueMove(from: number, to: number): void {
    if (from < 0 || from >= this.queue.length) return;
    this.snapshot = null;
    const [item] = this.queue.splice(from, 1);
    this.queue.splice(Math.max(0, Math.min(to, this.queue.length)), 0, item);
    this.dirty();
  }
  queueClear(): void {
    this.takeSnapshot();
    this.queue = [];
    this.dirty();
  }

  // ---- list mutation --------------------------------------------------

  /** Append tracks (display end). Shuffle on mixes them into upcoming order. */
  add(tracks: Track[], atStart = false): number {
    this.takeSnapshot();
    const start = this.tracks.length;
    this.tracks.push(...tracks.map((t) => ({ ...t })));
    if (this.shuffleMode === "on") {
      // Rebuild randomized order around the album cursor. A queued track is
      // transient and must not replace that cursor.
      const current = this.pos < 0 ? -1 : this.order[this.pos];
      const rest = shuffledWithout(current, this.tracks.length);
      this.order = current === -1 ? rest : [current, ...rest];
      this.pos = this.order.length ? 0 : -1;
    } else {
      const current = this.pos < 0 ? -1 : this.order[this.pos];
      const added = Array.from({ length: tracks.length }, (_, i) => start + i);
      if (atStart) this.order.unshift(...added);
      else this.order.push(...added);
      this.pos = current === -1 ? (this.order.length ? 0 : -1) : this.displayAt(current);
    }
    this.dirty();
    return start;
  }

  removeDisplay(pos: number): void {
    const idx = this.indexAtDisplay(pos);
    if (idx === -1) return;
    this.takeSnapshot();
    const current = this.pos < 0 ? -1 : this.order[this.pos];
    this.queuedCurrent = this.queuedCurrent === idx ? -1 : this.queuedCurrent > idx ? this.queuedCurrent - 1 : this.queuedCurrent;
    this.tracks.splice(idx, 1);
    this.queue = this.queue.filter((q) => q !== idx).map((q) => q > idx ? q - 1 : q);
    this.order = this.order.filter((o) => o !== idx).map((o) => (o > idx ? o - 1 : o));
    this.pos = current === -1 ? -1 : current === idx
      ? Math.min(pos, this.order.length - 1)
      : this.displayAt(current > idx ? current - 1 : current);
    this.dirty();
  }

  /** Reverse the list, preserving the playing track and queued identities. */
  reverse(): void {
    if (this.count < 2) return;
    this.takeSnapshot();
    const current = this.pos < 0 ? -1 : this.order[this.pos];
    const remap = (i: number) => this.count - 1 - i;
    if (this.queuedCurrent >= 0) this.queuedCurrent = remap(this.queuedCurrent);
    this.tracks.reverse();
    this.queue = this.queue.map(remap);
    this.order = this.shuffleMode === "on" ? this.order.map(remap) : this.tracks.map((_, i) => i);
    this.pos = current === -1 ? -1 : this.displayAt(remap(current));
    this.dirty();
  }

  updateTrack(path: string, patch: Partial<Track>): void {
    this.tracks = this.tracks.map((t) => t.path === path ? { ...t, ...patch } : t);
    this.dirty();
  }

  /** Move a track between display positions. Refused during shuffle. */
  moveDisplay(from: number, to: number): void {
    if (this.shuffleMode === "on") throw new MoveRejectedError("Turn off shuffle to move tracks");
    if (from < 0 || from >= this.order.length || to < 0 || to >= this.order.length) return;
    this.takeSnapshot();
    const [idx] = this.order.splice(from, 1);
    this.order.splice(to, 0, idx);
    if (this.pos === from) {
      this.pos = to;
    } else {
      let p = this.pos > from ? this.pos - 1 : this.pos;
      p = p >= to ? p + 1 : p;
      this.pos = p;
    }
    this.dirty();
  }

  // ---- modes ----------------------------------------------------------

  setShuffle(mode: ShuffleMode): void {
    if (mode === this.shuffleMode) return;
    this.shuffleMode = mode;
    const current = this.pos < 0 ? -1 : this.order[this.pos];
    if (mode === "on") {
      const order = shuffledWithout(current, this.tracks.length);
      this.order = current === -1 ? order : [current, ...order];
      this.pos = this.order.length ? 0 : -1;
    } else {
      this.order = this.tracks.map((_, i) => i);
      this.pos = current === -1 ? -1 : current;
    }
    this.dirty();
  }
  cycleRepeat(): RepeatMode {
    this.repeatMode = this.repeatMode === "off" ? "all" : this.repeatMode === "all" ? "one" : "off";
    this.dirty();
    return this.repeatMode;
  }
  setRepeat(mode: RepeatMode): void {
    this.repeatMode = mode;
    this.dirty();
  }

  // ---- undo ------------------------------------------------------------

  private takeSnapshot(): void {
    this.snapshot = this.exportState();
  }
  /** Restore the snapshot taken before the last destructive mutation. */
  undo(): void {
    if (!this.snapshot) return;
    const s = this.snapshot;
    this.snapshot = null;
    this.tracks = s.tracks;
    this.queue = s.queue;
    this.order = s.order;
    this.pos = s.cursor;
    this.queuedCurrent = s.queuedCurrent;
    this.dirty();
  }
}
