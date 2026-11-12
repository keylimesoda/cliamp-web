import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AudioEngine } from "./engine";

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (e: Error) => void;
  const promise = new Promise<T>((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}
class FakeAudio extends EventTarget {
  static all: FakeAudio[] = [];
  src = ""; crossOrigin = ""; preload = ""; currentTime = 0; duration = 10;
  paused = true; readyState = 1; volume = 1; playbackRate = 1; error = null;
  defaultPlaybackRate = 1; preservesPitch = true;
  playResult: Promise<void> | null = null;
  constructor() { super(); FakeAudio.all.push(this); }
  load() {}
  async play() {
    if (this.playResult) await this.playResult;
    this.paused = false; this.dispatchEvent(new Event("playing"));
  }
  pause() { this.paused = true; this.dispatchEvent(new Event("pause")); }
}
class Node {
  gain = { value: 0 }; frequency = { value: 0 }; Q = { value: 0 }; port = { postMessage: vi.fn() };
  connect = vi.fn(); start = vi.fn(); stop = vi.fn(); onended: (() => void) | null = null;
  buffer: { duration: number } | null = null;
}
class Context {
  static current: Context;
  state = "running"; currentTime = 0; sampleRate = 44100; destination = new Node();
  audioWorklet = { addModule: vi.fn().mockResolvedValue(undefined) };
  sources: Node[] = [];
  decodeAudioData = vi.fn().mockResolvedValue({ length: 100, duration: 10 });
  constructor() { Context.current = this; }
  async resume() { this.state = "running"; }
  async suspend() { this.state = "suspended"; }
  createMediaElementSource = vi.fn(() => new Node());
  createGain() { return new Node(); }
  createBiquadFilter() { return new Node(); }
  createAnalyser() { return new Node(); }
  createBufferSource() { const n = new Node(); this.sources.push(n); return n; }
}
const track = (path: string) => ({ path, title: path, durationSecs: 10 });
const source = (url: string) => ({ url, seekable: true });

beforeEach(() => {
  FakeAudio.all = [];
  vi.stubGlobal("Audio", FakeAudio); vi.stubGlobal("AudioContext", Context); vi.stubGlobal("AudioWorkletNode", Node);
  vi.stubGlobal("document", { baseURI: "https://example.test/cliamp-web/" });
});
afterEach(() => vi.unstubAllGlobals());

describe("audio engine regressions", () => {
  it("uses native pitch-preserving speed for processed books and restores normal music timing", async () => {
    const engine = new AudioEngine();
    await engine.load({ ...track("book"), provider: "audiobookshelf" }, source("book.wav"));
    engine.setSpeed(2);
    expect(FakeAudio.all[0]).toMatchObject({ playbackRate: 2, defaultPlaybackRate: 2, preservesPitch: true });
    FakeAudio.all[0].currentTime = 45; expect(engine.getPosition()).toBe(45);
    engine.seek(75); expect(engine.getPosition()).toBe(75);
    await engine.load(track("music"), source("music.wav"));
    engine.setSpeed(1); expect(FakeAudio.all[0].playbackRate).toBe(1);
  });
  it("keeps direct podcast speed on subsequent episode loads", async () => {
    const engine = new AudioEngine(); engine.setSpeed(1.5);
    await engine.load({ ...track("one"), provider: "podcast" }, { ...source("one.wav"), direct: true });
    await engine.load({ ...track("two"), provider: "podcast" }, { ...source("two.wav"), direct: true });
    expect(FakeAudio.all[1]).toMatchObject({ playbackRate: 1.5, defaultPlaybackRate: 1.5, preservesPitch: true });
  });
  it("does not bridge from a sped-up spoken track into the next music track", async () => {
    const engine = new AudioEngine();
    await engine.load({ ...track("book"), kind: "audiobook" }, source("book.wav")); engine.setSpeed(2);
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    engine.armGapless(track("music"), "music.wav"); expect(fetcher).not.toHaveBeenCalled();
  });
  it("plays direct podcast sources without a worklet and keeps pause/seek functional", async () => {
    const onTrackEnd = vi.fn();
    const previousContext = Context.current;
    const engine = new AudioEngine({ onTrackEnd });
    await engine.load({ ...track("episode"), provider: "podcast" }, { ...source("episode.wav"), direct: true });
    expect(Context.current).toBe(previousContext);
    expect(FakeAudio.all[1].src).toBe("episode.wav");
    FakeAudio.all[1].currentTime = 21;
    expect(engine.getPosition()).toBe(21);
    engine.pause(); expect(engine.snapshot().state).toBe("paused");
    engine.seek(5); expect(FakeAudio.all[1].currentTime).toBe(5);
    await engine.play(); expect(engine.snapshot().state).toBe("playing");
    FakeAudio.all[1].dispatchEvent(new Event("ended"));
    expect(onTrackEnd).toHaveBeenCalledWith(false);
  });
  it("loads the worklet beneath the deployment subpath", async () => {
    const engine = new AudioEngine(); await engine.init();
    expect(Context.current.audioWorklet.addModule).toHaveBeenCalledWith("https://example.test/cliamp-web/worklets/wsola.js");
  });
  it("plays non-CORS streams on an element outside the Web Audio graph", async () => {
    const engine = new AudioEngine();
    FakeAudio.all[0].playResult = Promise.reject(new Error("CORS"));
    await engine.load(track("radio"), source("https://radio.test/live"));
    expect(FakeAudio.all[1].src).toBe("https://radio.test/live");
    expect(FakeAudio.all[1].paused).toBe(false);
    expect(Context.current.createMediaElementSource).toHaveBeenCalledTimes(1);
    expect(Context.current.createMediaElementSource).toHaveBeenCalledWith(FakeAudio.all[0]);
  });
  it("does not retry permission-denied playback as a CORS error", async () => {
    const engine = new AudioEngine();
    FakeAudio.all[0].playResult = Promise.reject(new DOMException("Tap required", "NotAllowedError"));
    await expect(engine.load(track("a"), source("a"))).rejects.toThrow("Tap required");
    expect(FakeAudio.all[1].src).toBe("");
  });
  it("ignores a late failure from a replaced load", async () => {
    const engine = new AudioEngine(); await engine.init();
    const old = deferred<void>(); FakeAudio.all[0].playResult = old.promise;
    const a = engine.load(track("a"), source("a"));
    await vi.waitFor(() => expect(FakeAudio.all[0].src).toBe("a"));
    FakeAudio.all[0].playResult = null;
    await engine.load(track("b"), source("b")); old.reject(new Error("old failed")); await a;
    expect(engine.snapshot().track?.path).toBe("b"); expect(FakeAudio.all[1].src).toBe("");
  });
  it("does not resurrect a decoded preload after the queue target changed", async () => {
    const onTrackEnd = vi.fn(); const engine = new AudioEngine({ onTrackEnd });
    await engine.load(track("a"), source("a"));
    const decoding = deferred<{ length: number; duration: number }>();
    Context.current.decodeAudioData.mockReturnValueOnce(decoding.promise);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(new Uint8Array([1, 2, 3]))));
    engine.armGapless(track("b"), "b");
    await vi.waitFor(() => expect(Context.current.decodeAudioData).toHaveBeenCalled());
    engine.clearPreload(); decoding.resolve({ length: 100, duration: 10 });
    await decoding.promise; await Promise.resolve();
    FakeAudio.all[0].dispatchEvent(new Event("ended"));
    expect(onTrackEnd).toHaveBeenCalledWith(false); expect(engine.snapshot().track?.path).toBe("a");
  });
  it("reports promotion once, then reports the end of a bridge without another preload", async () => {
    const onTrackEnd = vi.fn(); const engine = new AudioEngine({ onTrackEnd });
    await engine.load(track("a"), source("a"));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(new Uint8Array([1, 2, 3]))));
    engine.armGapless(track("b"), "b");
    await vi.waitFor(() => expect(Context.current.decodeAudioData).toHaveBeenCalled());
    await Promise.resolve(); await Promise.resolve();
    FakeAudio.all[0].dispatchEvent(new Event("ended"));
    expect(onTrackEnd).toHaveBeenCalledWith(true); expect(engine.snapshot().track?.path).toBe("b");
    engine.pause(); expect(engine.snapshot().state).toBe("paused");
    await engine.play(); expect(engine.snapshot().state).toBe("playing");
    Context.current.sources[0].onended?.(); expect(onTrackEnd).toHaveBeenLastCalledWith(false);
  });
});
