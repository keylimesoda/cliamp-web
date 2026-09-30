import { describe, expect, it } from "vitest";
import { MoveRejectedError, Playlist } from "./playlist";
import type { Track } from "./types";

function tracks(n: number): Track[] {
  return Array.from({ length: n }, (_, i) => ({ path: `t${i}`, title: `T${i}` }));
}

describe("Playlist", () => {
  it("loads and navigates sequentially", () => {
    const p = new Playlist();
    p.load(tracks(3));
    expect(p.count).toBe(3);
    expect(p.currentIndex).toBe(0);
    expect(p.next()).toBe(true);
    expect(p.currentIndex).toBe(1);
    expect(p.prev()).toBe(true);
    expect(p.currentIndex).toBe(0);
  });

  it("repeat off stops at end", () => {
    const p = new Playlist();
    p.load(tracks(2));
    expect(p.next()).toBe(true);
    expect(p.currentIndex).toBe(1);
    expect(p.next()).toBe(false);
    expect(p.currentIndex).toBe(1);
  });

  it("repeat all wraps next and prev", () => {
    const p = new Playlist();
    p.load(tracks(3));
    p.setRepeat("all");
    p.next();
    p.next();
    expect(p.currentIndex).toBe(2);
    expect(p.next()).toBe(true);
    expect(p.currentIndex).toBe(0);
    expect(p.prev()).toBe(true);
    expect(p.currentIndex).toBe(2);
  });

  it("repeat one replays current track", () => {
    const p = new Playlist();
    p.load(tracks(3));
    p.next();
    p.setRepeat("one");
    expect(p.next()).toBe(true);
    expect(p.currentIndex).toBe(1);
  });

  it("play-next queue is consumed before progression", () => {
    const p = new Playlist();
    p.load(tracks(4));
    p.queueToggle(2); // queue T2 while T0 is current
    p.next();
    expect(p.currentIndex).toBe(2); // queue item, not sequential T1
    p.next();
    expect(p.currentIndex).toBe(3); // progression continues forward from there
  });

  it("queue toggle removes already-queued track", () => {
    const p = new Playlist();
    p.load(tracks(2));
    p.queueToggle(0);
    expect(p.isQueued(0)).toBe(true);
    p.queueToggle(0);
    expect(p.isQueued(0)).toBe(false);
    expect(p.queueCount).toBe(0);
  });

  it("queue is consumed first even under repeat one", () => {
    const p = new Playlist();
    p.load(tracks(3));
    p.setRepeat("one");
    p.queueToggle(2);
    expect(p.next()).toBe(true);
    expect(p.currentIndex).toBe(2);
    expect(p.next()).toBe(true);
    expect(p.currentIndex).toBe(2);
  });

  it("shuffle preserves current track and permutes the rest", () => {
    const p = new Playlist();
    p.load(tracks(6));
    p.playDisplay(2);
    p.setShuffle("on");
    const order = p.displayOrder();
    expect(order[0]).toBe(2);
    expect([...order].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5]);
    p.setShuffle("off");
    expect(p.displayOrder()).toEqual([0, 1, 2, 3, 4, 5]);
    expect(p.currentIndex).toBe(2);
  });

  it("refuses track moves while shuffled", () => {
    const p = new Playlist();
    p.load(tracks(3));
    p.setShuffle("on");
    expect(() => p.moveDisplay(0, 1)).toThrow(MoveRejectedError);
  });

  // moveDisplay never changes the playing track; the cursor follows it.
  // Rows: [from, to, currentTrack, displaySlotAfter]
  const moveCases: Array<[number, number, number, number]> = [
    [1, 3, 2, 1],
    [3, 1, 2, 3],
    [0, 2, 0, 2], // moving the current track itself
    [2, 0, 4, 4],
    [0, 4, 1, 0],
  ];

  it.each(moveCases)(
    "moveDisplay(%i,%i) keeps track %i playing at display %i",
    (from, to, current, slotAfter) => {
      const p = new Playlist();
      p.load(tracks(5));
      p.playDisplay(current);
      p.moveDisplay(from, to);
      expect(p.currentIndex).toBe(current);
      expect(p.displayAt(current)).toBe(slotAfter);
    },
  );

  it("removing the current track advances to the same display slot", () => {
    const p = new Playlist();
    p.load(tracks(3));
    p.playDisplay(1);
    p.removeDisplay(1);
    expect(p.count).toBe(2);
    expect(p.currentIndex).toBe(1); // old T2 now at display 1
  });

  it("undo restores the last destructive mutation", () => {
    const p = new Playlist();
    p.load(tracks(3));
    p.queueToggle(1);
    p.queueClear();
    expect(p.queueCount).toBe(0);
    p.undo();
    expect(p.queueIndices()).toEqual([1]);
  });

  it("purges queue entries when their track is removed", () => {
    const p = new Playlist();
    p.load(tracks(3));
    p.queueToggle(2);
    p.removeDisplay(2);
    expect(p.queueCount).toBe(0);
  });
});
