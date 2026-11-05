import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Track } from "../core/types";

const mocks = vi.hoisted(() => ({ resolve: vi.fn() }));
vi.mock("../providers/registry", () => ({ registerProvider: vi.fn(), resolveTrack: mocks.resolve }));
vi.mock("../core/audio/engine", () => ({
  SPEED_MIN: 0.25, SPEED_MAX: 2,
  AudioEngine: class {
    track: Track | null = null;
    state = "stopped";
    listeners = new Set<(s: unknown) => void>();
    constructor(readonly cb: { onTrackEnd: (promoted: boolean) => void }) {}
    snapshot() { return { track: this.track, state: this.state, volumeDb: 0, speed: 1, mono: false, eqGains: Array(10).fill(0) }; }
    subscribe(fn: (s: unknown) => void) { this.listeners.add(fn); }
    notify() { this.listeners.forEach((fn) => fn(this.snapshot())); }
    async init() {}
    async load(track: Track) { this.track = track; this.state = "playing"; this.notify(); }
    async play() { this.state = "playing"; this.notify(); }
    pause() { this.state = "paused"; this.notify(); }
    getPosition() { return 0; } getDuration() { return 10; } isSeekable() { return true; }
    clearPreload() {} armGapless() {} startTick() {} setEqGains() {} setSpeed() {} setVolumeDb() {} setMono() {}
    end(promoted: boolean, track?: Track) { if (track) this.track = track; this.cb.onTrackEnd(promoted); }
  },
}));
const tracks = ["a", "b", "c"].map((path) => ({ path, title: path, durationSecs: 10 }));
let mod: typeof import("./player");
beforeEach(async () => {
  vi.resetModules(); vi.useFakeTimers();
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {}, removeItem: () => {} });
  vi.stubGlobal("window", { setInterval, clearInterval, addEventListener: () => {} });
  mocks.resolve.mockReset().mockImplementation(async (t: Track) => ({ url: t.path, seekable: true }));
  mod = await import("./player"); await mod.usePlayerStore.getState().boot();
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });
const end = (promoted: boolean, track?: Track) => (mod.getEngine() as unknown as { end: (p: boolean, t?: Track) => void }).end(promoted, track);

describe("player transition guards", () => {
  it("advances when a source ends without a decoded preload", async () => {
    await mod.usePlayerStore.getState().loadPlaylist(tracks);
    end(false); await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    await vi.waitFor(() => expect(mod.usePlayerStore.getState().track?.path).toBe("b"));
    expect(mod.getPlaylist()?.currentTrack?.path).toBe("b");
  });
  it("consumes the queued track once when the engine promotes its preload", async () => {
    const s = mod.usePlayerStore.getState(); await s.loadPlaylist(tracks); s.queueToggle(2);
    end(true, tracks[2]);
    expect(mod.getPlaylist()?.queueCount).toBe(0); expect(mod.getPlaylist()?.currentTrack?.path).toBe("c");
    end(false); expect(mod.usePlayerStore.getState().state).toBe("stopped");
  });
  it("repeats the current track at natural end in repeat-one mode", async () => {
    await mod.usePlayerStore.getState().loadPlaylist(tracks);
    mod.getPlaylist()!.setRepeat("one");
    end(false); await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(mod.getPlaylist()?.currentTrack?.path).toBe("a");
  });
  it("ignores a source resolver that completes after a newer play request", async () => {
    let finish!: (src: { url: string; seekable: boolean }) => void;
    mocks.resolve.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const a = mod.usePlayerStore.getState().playTrack(tracks[0]);
    await mod.usePlayerStore.getState().playTrack(tracks[1]);
    finish({ url: "a", seekable: true }); await a;
    expect(mod.usePlayerStore.getState().track?.path).toBe("b");
    expect(mod.getEngine()?.snapshot().track?.path).toBe("b");
  });
  it("does not start a pending resolved track after pause", async () => {
    let finish!: (src: { url: string; seekable: boolean }) => void;
    mocks.resolve.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const pending = mod.usePlayerStore.getState().playTrack(tracks[0]);
    mod.usePlayerStore.getState().pause(); finish({ url: "a", seekable: true }); await pending;
    expect(mod.getEngine()?.snapshot().track).toBeNull();
  });
});
