import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Track } from "../core/types";

const mocks = vi.hoisted(() => ({ resolve: vi.fn(), events: vi.fn() }));
vi.mock("../providers/registry", () => ({ registerProvider: vi.fn(), resolveTrack: mocks.resolve }));
vi.mock("../core/audio/engine", () => ({
  SPEED_MIN: 0.25, SPEED_MAX: 2,
  AudioEngine: class {
    track: Track | null = null;
    state = "stopped";
    position = 0;
    speed = 1;
    listeners = new Set<(s: unknown) => void>();
    constructor(readonly cb: { onTrackEnd: (promoted: boolean) => void }) {}
    snapshot() { return { track: this.track, state: this.state, volumeDb: 0, speed: this.speed, mono: false, eqGains: Array(10).fill(0), dspAvailable: true }; }
    subscribe(fn: (s: unknown) => void) { this.listeners.add(fn); }
    notify() { this.listeners.forEach((fn) => fn(this.snapshot())); }
    async init() {}
    async load(track: Track, _source: unknown, start = 0) { this.track = track; this.position = start; this.state = "playing"; this.notify(); }
    async play() { this.state = "playing"; this.notify(); }
    pause() { this.state = "paused"; this.notify(); }
    getPosition() { return this.position; } getDuration() { return this.track?.durationSecs || 10; } isSeekable() { return Boolean(this.track) && !this.track?.live && !this.track?.stream; }
    seek(position: number) { this.position = position; }
    clearPreload() {} armGapless() {} startTick() {} setEqGains() {} setVolumeDb() {} setMono() {}
    setSpeed(speed: number) { this.speed = speed; this.notify(); }
    end(promoted: boolean, track?: Track) { if (track) this.track = track; this.cb.onTrackEnd(promoted); }
  },
}));
const tracks = ["a", "b", "c"].map((path) => ({ path, title: path, durationSecs: 10 }));
let mod: typeof import("./player");
beforeEach(async () => {
  vi.resetModules(); vi.useFakeTimers();
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {}, removeItem: () => {} });
  mocks.events.mockReset();
  vi.stubGlobal("window", { setInterval, clearInterval, addEventListener: mocks.events });
  mocks.resolve.mockReset().mockImplementation(async (t: Track) => ({ url: t.path, seekable: true }));
  mod = await import("./player"); await mod.usePlayerStore.getState().boot();
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });
const end = (promoted: boolean, track?: Track) => (mod.getEngine() as unknown as { end: (p: boolean, t?: Track) => void }).end(promoted, track);

describe("full session restore", () => {
  let storage: Map<string, string>;
  const reload = async () => {
    vi.clearAllTimers(); vi.resetModules(); mocks.resolve.mockClear();
    mod = await import("./player"); await mod.usePlayerStore.getState().boot();
  };
  beforeEach(() => {
    storage = new Map();
    vi.stubGlobal("localStorage", { getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => storage.set(k, v), removeItem: (k: string) => storage.delete(k) });
  });
  it("reopens at the same music position with the playlist and queue intact, waiting for Play", async () => {
    const s = mod.usePlayerStore.getState(); await s.loadPlaylist(tracks); s.queueToggle(2); s.seek(6.25); s.pause();
    await reload();
    expect(mocks.resolve).not.toHaveBeenCalled();
    expect(mod.getEngine()?.snapshot().track).toBeNull();
    expect(mod.usePlayerStore.getState()).toMatchObject({ state: "stopped", position: 6.25, track: tracks[0], queueCount: 1, tracks });
    await vi.advanceTimersByTimeAsync(5500); // polling must not erase a restored position before Play
    expect(mod.usePlayerStore.getState().position).toBe(6.25);
    const load = vi.spyOn(mod.getEngine()!, "load");
    await mod.usePlayerStore.getState().play();
    expect(load).toHaveBeenCalledWith(tracks[0], { url: "a", seekable: true }, 6.25);
    await mod.usePlayerStore.getState().next();
    expect(mod.usePlayerStore.getState().track?.path).toBe("c");
    await mod.usePlayerStore.getState().next();
    expect(mod.usePlayerStore.getState().track?.path).toBe("b");
  });
  it("retains the album cursor while reopening in a consumed play-next track", async () => {
    const s = mod.usePlayerStore.getState(); await s.loadPlaylist(tracks); s.queueToggle(2); await s.next(); s.pause();
    await reload();
    expect(mod.usePlayerStore.getState()).toMatchObject({ track: tracks[2], queueCount: 0 });
    await mod.usePlayerStore.getState().play();
    await mod.usePlayerStore.getState().next();
    expect(mod.usePlayerStore.getState().track?.path).toBe("b");
  });
  it("saves shuffle/repeat and queue edits immediately, including edits before playback resumes", async () => {
    const s = mod.usePlayerStore.getState(); await s.loadPlaylist(tracks); s.toggleShuffle(); s.cycleRepeat();
    s.queueToggle(1); s.queueToggle(2); s.queueMove(0, 1);
    const expected = mod.getPlaylist()!.exportState();
    await reload();
    expect(mod.getPlaylist()!.exportState()).toEqual(expected);
    mod.usePlayerStore.getState().queueRemove(0);
    const edited = mod.getPlaylist()!.exportState();
    await reload();
    expect(mod.getPlaylist()!.exportState()).toEqual(edited);
  });
  it("migrates an existing single-track bookmark into a usable session", async () => {
    storage.set("cliamp-web:resume", JSON.stringify({ track: tracks[1], position: 4, at: Date.now() }));
    await reload();
    expect(mod.usePlayerStore.getState()).toMatchObject({ track: tracks[1], tracks: [tracks[1]], position: 4 });
    expect(storage.has("cliamp-web:session")).toBe(true);
    expect(storage.has("cliamp-web:resume")).toBe(false);
  });
  it("restores live radio and an independent queue, reconnecting from live on Play", async () => {
    const s = mod.usePlayerStore.getState(); await s.loadPlaylist(tracks); s.queueToggle(2);
    const radio = { path: "https://radio.fixture/live", title: "Radio", stream: true, live: true, provider: "radio" };
    await s.playTrack(radio); s.seek(8); s.pause();
    await reload();
    expect(mod.usePlayerStore.getState()).toMatchObject({ track: radio, position: 0, queueCount: 1 });
    const load = vi.spyOn(mod.getEngine()!, "load"); await mod.usePlayerStore.getState().play();
    expect(load).toHaveBeenCalledWith(radio, expect.anything(), 0);
    await mod.usePlayerStore.getState().next();
    expect(mod.usePlayerStore.getState().track?.path).toBe("c");
  });
  it("keeps the spoken-audio rewind behavior when restoring the whole session", async () => {
    const podcast = { path: "https://podcast.fixture/episode", title: "Episode", provider: "podcast", feed: "https://podcast.fixture/feed", durationSecs: 300 };
    const s = mod.usePlayerStore.getState(); await s.loadPlaylist([podcast]);
    vi.spyOn(mod.getEngine()!, "getDuration").mockReturnValue(300);
    s.seek(60); s.pause(); await reload();
    const load = vi.spyOn(mod.getEngine()!, "load"); await mod.usePlayerStore.getState().play();
    expect(load).toHaveBeenCalledWith(podcast, expect.anything(), 55);
  });
  it("checkpoints on pagehide and preserves playback if storage becomes unavailable", async () => {
    const s = mod.usePlayerStore.getState(); await s.loadPlaylist(tracks);
    vi.spyOn(mod.getEngine()!, "getPosition").mockReturnValue(3);
    const handler = mocks.events.mock.calls.filter(([name]) => name === "pagehide").at(-1)![1]; handler();
    const checkpoint = storage.get("cliamp-web:session");
    expect(JSON.parse(checkpoint!).position).toBe(3);
    vi.stubGlobal("localStorage", { getItem: (k: string) => storage.get(k) ?? null,
      setItem: () => { throw new Error("Quota exceeded"); }, removeItem: () => {} });
    expect(() => s.queueToggle(2)).not.toThrow();
    expect(mod.usePlayerStore.getState().state).toBe("playing");
    expect(storage.get("cliamp-web:session")).toBe(checkpoint);
  });
  it("checkpoints an external media pause without waiting for the periodic save", async () => {
    await mod.usePlayerStore.getState().loadPlaylist(tracks);
    vi.spyOn(mod.getEngine()!, "getPosition").mockReturnValue(4);
    mod.getEngine()!.pause();
    expect(JSON.parse(storage.get("cliamp-web:session")!).position).toBe(4);
  });
  it("remembers speech speed across reloads and track changes without speeding up music", async () => {
    const episode = { path: "episode", title: "Episode", provider: "podcast", durationSecs: 300 };
    const s = mod.usePlayerStore.getState(); await s.loadPlaylist([episode, tracks[0]]);
    s.setSpeed(1.5); s.pause(); await reload();
    expect(mod.usePlayerStore.getState().spokenSpeed).toBe(1.5);
    await mod.usePlayerStore.getState().play(); expect(mod.usePlayerStore.getState().speed).toBe(1.5);
    await mod.usePlayerStore.getState().next(); expect(mod.usePlayerStore.getState().speed).toBe(1);
    await mod.usePlayerStore.getState().playTrack(episode); expect(mod.usePlayerStore.getState().speed).toBe(1.5);
  });
  it.each(["{", JSON.stringify({ version: 99 }), JSON.stringify({ version: 1, playlist: {} })])("ignores damaged or unknown sessions: %s", async (saved) => {
    storage.set("cliamp-web:session", saved); await reload();
    expect(mod.usePlayerStore.getState()).toMatchObject({ track: null, tracks: [], state: "stopped" });
  });
});

describe("relative spoken seeking", () => {
  it("uses the current engine clock, keeps pause, and bounds both directions to the current file", async () => {
    await mod.usePlayerStore.getState().playTrack({ path: "book", title: "Book", kind: "audiobook", durationSecs: 100 });
    mod.usePlayerStore.getState().pause();
    mod.getEngine()!.seek(62); // UI polling may still show the old position
    mod.usePlayerStore.getState().seekRelative(-15);
    expect(mod.getEngine()!.getPosition()).toBe(47);
    mod.usePlayerStore.getState().seekRelative(30); expect(mod.getEngine()!.getPosition()).toBe(77);
    mod.usePlayerStore.getState().seekRelative(30); expect(mod.getEngine()!.getPosition()).toBe(99.9);
    mod.usePlayerStore.getState().seekRelative(-1000); expect(mod.getEngine()!.getPosition()).toBe(0);
    expect(mod.usePlayerStore.getState().state).toBe("paused");
  });
  it("ignores live seeking and invalid offsets", async () => {
    const s = mod.usePlayerStore.getState(); await s.playTrack(tracks[0]);
    s.seekRelative(NaN); s.seekRelative(Infinity); expect(mod.getEngine()!.getPosition()).toBe(0);
    await s.playTrack({ path: "live", title: "Live", live: true, stream: true });
    const seek = vi.spyOn(mod.getEngine()!, "seek"); s.seekRelative(30); expect(seek).not.toHaveBeenCalled();
  });
});

describe("custom EQ", () => {
  it("keeps the saved curve when presets and the working curve change", () => {
    const s = mod.usePlayerStore.getState();
    const curve = [2, 3, 4, 1, 0, -1, -2, 1, 2, 3];
    const apply = vi.spyOn(mod.getEngine()!, "setEqGains");
    s.setEqGains(curve); s.saveCustomEq();
    expect(apply).toHaveBeenLastCalledWith(curve);
    s.applyPreset("Rock");
    expect(mod.usePlayerStore.getState().eqGains[0]).toBe(5);
    s.setEqGains(Array(10).fill(-2));
    s.applyPreset("Custom");
    expect(mod.usePlayerStore.getState().eqGains).toEqual(curve);
    expect(mod.usePlayerStore.getState().customEqGains).toEqual(curve);
  });
  it("persists separate working and saved curves and restores them on boot", async () => {
    const storage = new Map<string, string>();
    vi.stubGlobal("localStorage", { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) });
    const s = mod.usePlayerStore.getState();
    s.setEqGains(Array(10).fill(3)); s.saveCustomEq(); s.applyPreset("Flat");
    vi.resetModules(); mod = await import("./player"); await mod.usePlayerStore.getState().boot();
    expect(mod.usePlayerStore.getState().eqPreset).toBe("Flat");
    expect(mod.usePlayerStore.getState().customEqGains).toEqual(Array(10).fill(3));
    mod.usePlayerStore.getState().applyPreset("Custom");
    expect(mod.usePlayerStore.getState().eqGains).toEqual(Array(10).fill(3));
  });
  it("clamps gain limits and rejects malformed curves", () => {
    const s = mod.usePlayerStore.getState();
    s.setEqGains([30, -30, ...Array(8).fill(0)]);
    expect(mod.usePlayerStore.getState().eqGains.slice(0, 2)).toEqual([12, -12]);
    s.setEqGains([1]); s.setEqGains(Array(10).fill(NaN));
    expect(mod.usePlayerStore.getState().eqGains.slice(0, 2)).toEqual([12, -12]);
  });
  it("rejects malformed persisted curves without applying them to the engine", async () => {
    vi.stubGlobal("localStorage", { getItem: (key: string) => key === "cliamp-web:settings"
      ? JSON.stringify({ eqGains: [4], customEqGains: Array(10).fill("4") }) : null });
    vi.resetModules(); mod = await import("./player"); await mod.usePlayerStore.getState().boot();
    expect(mod.usePlayerStore.getState().eqGains).toEqual(Array(10).fill(0));
    expect(mod.usePlayerStore.getState().customEqGains).toBeNull();
    mod.usePlayerStore.getState().applyPreset("Custom");
    expect(mod.usePlayerStore.getState().eqPreset).toBe("Flat");
  });
});

describe("player transition guards", () => {
  it("keeps recovery enabled when delayed audio initialization notifies an unchanged paused state", async () => {
    let initialized!: () => void;
    vi.spyOn(mod.getEngine()!, "init").mockImplementationOnce(() => new Promise((resolve) => { initialized = resolve; }));
    mocks.resolve.mockRejectedValueOnce(new Error("Temporary network failure"));
    await mod.usePlayerStore.getState().playTrack(tracks[0]);
    expect(mod.usePlayerStore.getState().recovery?.attempt).toBe(1);
    initialized();
    (mod.getEngine() as unknown as { notify: () => void }).notify();
    expect(mod.usePlayerStore.getState().recovery?.attempt).toBe(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(mod.usePlayerStore.getState().state).toBe("playing");
  });
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
    end(false); await vi.waitFor(() => expect(mod.usePlayerStore.getState().track?.path).toBe("b"));
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


describe("native subscription appends", () => {
  it("appends latest after the existing FIFO queue, including repeated episode identities", async () => {
    const s = mod.usePlayerStore.getState(); await s.loadPlaylist(tracks); s.queueToggle(2); s.seek(4); s.pause();
    const load = vi.spyOn(mod.getEngine()!, "load");
    await s.appendTracks([tracks[1]], true);
    expect(load).not.toHaveBeenCalled();
    expect(mod.usePlayerStore.getState()).toMatchObject({ state: "paused", position: 4, track: tracks[0], tracks: [...tracks, tracks[1]] });
    expect(mod.getPlaylist()!.queueIndices()).toEqual([2, 3]);
    await s.next(); expect(mod.usePlayerStore.getState().track).toEqual(tracks[2]);
    await s.next(); expect(mod.usePlayerStore.getState().track).toEqual(tracks[1]);
    await s.next(); expect(mod.usePlayerStore.getState().track).toEqual(tracks[1]); // returns to album cursor
  });
  it("appends the sweep without queueing or changing shuffled playback, position or modes", async () => {
    const s = mod.usePlayerStore.getState(); await s.loadPlaylist(tracks); s.toggleShuffle(); s.cycleRepeat(); s.queueToggle(2); s.seek(3);
    const queued = mod.getPlaylist()!.queueIndices();
    const load = vi.spyOn(mod.getEngine()!, "load");
    await s.appendTracks([{ path: "latest", title: "Latest" }, tracks[0]]);
    expect(load).not.toHaveBeenCalled();
    expect(mod.usePlayerStore.getState()).toMatchObject({ state: "playing", track: tracks[0], position: 3, shuffle: "on", repeat: "all", queueCount: 1 });
    expect(mod.getPlaylist()!.queueIndices()).toEqual(queued);
    expect(mod.getPlaylist()!.count).toBe(5);
  });
  it("does not autoplay an empty playlist; Play starts its first appended episode", async () => {
    const s = mod.usePlayerStore.getState(); const load = vi.spyOn(mod.getEngine()!, "load");
    await s.appendTracks(tracks);
    expect(load).not.toHaveBeenCalled(); expect(mod.usePlayerStore.getState().state).toBe("stopped");
    await s.play(); expect(mod.usePlayerStore.getState().track).toEqual(tracks[0]);
  });
});
