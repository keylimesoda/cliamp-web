import { describe, expect, it } from "vitest";
import { Playlist } from "./playlist";
import { readPlaybackSession } from "./session";

const track = { path: "https://audio.fixture/song.wav", title: "Song", durationSecs: 30 };
function saved() {
  const playlist = new Playlist(); playlist.load([track]);
  return { version: 1, playlist: playlist.exportState(), track, position: 8, duration: 30, at: Date.now() };
}
describe("session validation", () => {
  it("bounds a finite resume position to the recorded duration", () => {
    expect(readPlaybackSession({ ...saved(), position: 40 })?.position).toBe(30);
  });
  it("permits an independent live source while retaining the album and queue", () => {
    const s = saved(); s.playlist.queue = [0];
    const live = { path: "https://radio.fixture/live", title: "Radio", live: true };
    expect(readPlaybackSession({ ...s, track: live })?.position).toBe(0);
    expect(readPlaybackSession({ ...s, track: live })?.playlist.queue).toEqual([0]);
  });
  it.each([
    { position: -1 }, { position: "8" }, { position: null }, { duration: -1 }, { at: null },
    { track: { ...track, artist: { unexpected: "object" } } },
  ])("rejects malformed persisted fields: %j", (patch) => {
    expect(readPlaybackSession({ ...saved(), ...patch })).toBeNull();
  });
});
