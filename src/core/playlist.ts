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
import type { RepeatMode, ShuffleMode, Track } from "./types";

export class MoveRejectedError extends Error {}

export interface PlaylistSnapshot {
  tracks: Track[];
  current: number; // original index, -1 if none
  queue: number[]; // original indices
  order: number[];
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
    return this.pos === -1 ? -1 : this.order[this.pos];
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

  // ---- lifecycle ------------------------------------------------------

  /** Replace the playlist entirely and start at startDisplay (default 0). */
  load(tracks: Track[], startDisplay = 0): void {
    this.snapshot = null;
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
    this.snapshot = null;
    this.tracks = [];
    this.order = [];
    this.queue = [];
    this.pos = -1;
    this.dirty();
  }
  stop(): void {
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
      this.jumpToIndex(idx);
      return true;
    }
    if (this.repeatMode === "one") {
      // Replay current track.
      this.dirty();
      return true;
    }
    let p = this.pos + 1;
    if (p >= this.order.length) {
      if (this.repeatMode === "all") p = 0;
      else return false;
    }
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
      // Rebuild randomized play order, preserving the current track.
      const current = this.currentIndex;
      const rest = shuffledWithout(current, this.tracks.length);
      this.order = current === -1 ? rest : [current, ...rest];
      this.pos = this.order.length ? 0 : -1;
    } else {
      const current = this.currentIndex;
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
    const current = this.currentIndex;
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
    const current = this.currentIndex;
    const remap = (i: number) => this.count - 1 - i;
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
    const current = this.currentIndex;
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
    this.snapshot = {
      tracks: this.tracks.map((t) => ({ ...t })),
      current: this.currentIndex,
      queue: [...this.queue],
      order: [...this.order],
    };
  }
  /** Restore the snapshot taken before the last destructive mutation. */
  undo(): void {
    if (!this.snapshot) return;
    const s = this.snapshot;
    this.snapshot = null;
    this.tracks = s.tracks;
    this.queue = s.queue;
    this.order = s.order;
    this.pos = s.current === -1 ? -1 : this.displayAt(s.current);
    this.dirty();
  }
}
