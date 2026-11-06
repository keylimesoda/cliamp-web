/**
 * Audio engine — the Web Audio pipeline, parity with cliamp's player:
 *
 *   <audio> → MediaElementSource → WSOLA worklet (pitch-preserving speed)
 *           → 10 peaking biquads (70 Hz … 16 kHz, Q 1.4)
 *           → analyser (mono tap for the visualizer)
 *           → volume gain → stereo out → destination
 *                          ↘ mono downmix → upmix → mono out → destination
 *
 * Transitions: short finite tracks can be fetched/decoded ahead of time.
 * On end, the decoded next track enters the same DSP chain and the store
 * advances the playlist. This is best-effort, not sample-accurate gapless.
 *
 * The AudioContext is created lazily on first play (user gesture) so the
 * PWA can start suspended and unlock on the first tap.
 */
import { EQ_BANDS_HZ, EQ_Q, clampDb } from "../eq";
import { bandLevels, FFT_SIZE, Spectrum } from "../spectrum";
import type { PlaybackState, ResolvedSource, Track } from "../types";

export const VOLUME_MIN_DB = -50;
export const VOLUME_MAX_DB = 6;
export const SPEED_MIN = 0.25;
export const SPEED_MAX = 2.0;

function dbToGain(db: number): number {
  return Math.pow(10, db / 20);
}

export interface EngineCallbacks {
  /** Fired when the current source reached its end (or the gapless bridge did). */
  onTrackEnd?: (promoted: boolean) => void;
  onError?: (message: string) => void;
}

export interface EngineSnapshot {
  state: PlaybackState;
  track: Track | null;
  volumeDb: number;
  speed: number;
  mono: boolean;
  eqGains: number[];
  dspAvailable: boolean;
}

export class AudioEngine {
  private cb: EngineCallbacks;
  private ctx: AudioContext | null = null;
  private processedElement = new Audio();
  private plainElement = new Audio();
  private element = this.processedElement;
  private graphInput: GainNode | null = null;
  private loadGeneration = 0;
  private preloadGeneration = 0;
  private preloadAbort: AbortController | null = null;
  private resumeCleanup: (() => void) | null = null;
  private seekable = false;
  private wsolaNode: AudioWorkletNode | null = null;
  private eqFilters: BiquadFilterNode[] = [];
  private analyser: AnalyserNode | null = null;
  private volumeGain: GainNode | null = null;
  private stereoOut: GainNode | null = null;
  private monoOut: GainNode | null = null;
  private loading = false;

  private spectrum = new Spectrum();
  private bands = new Float32Array(10);
  private sampleBuf: Float32Array<ArrayBuffer> | null = null;
  private zeroBuf: Float32Array<ArrayBuffer> = new Float32Array(FFT_SIZE);
  private tickTimer: number | null = null;

  private track: Track | null = null;
  private state: PlaybackState = "stopped";
  private volumeDb = 0;
  private speed = 1;
  private mono = false;
  private eqGains = new Array<number>(EQ_BANDS_HZ.length).fill(0);

  private gaplessBuffer: AudioBuffer | null = null;
  private gaplessSource: AudioBufferSourceNode | null = null;
  private gaplessStartedAt = 0;
  private gaplessOffset = 0;
  private gaplessTrack: Track | null = null;

  private listeners = new Set<(s: EngineSnapshot) => void>();
  private initPromise: Promise<void> | null = null;

  constructor(cb: EngineCallbacks = {}) {
    this.cb = cb;
    this.element.preload = "auto";
    this.plainElement.preload = "auto";
    for (const el of [this.processedElement, this.plainElement]) {
        const active = () => this.element === el && !this.gaplessSource;
        el.addEventListener("playing", () => { if (active()) this.setState("playing"); });
        el.addEventListener("pause", () => {
          if (active() && !this.loading && this.state !== "stopped") this.setState("paused");
        });
        el.addEventListener("waiting", () => { if (active()) this.setState("buffering"); });
        el.addEventListener("seeking", () => { if (active()) this.setState("seeking"); });
        el.addEventListener("seeked", () => { if (active()) this.setState(el.paused ? "paused" : "playing"); });
        el.addEventListener("ended", () => { if (active()) this.handleEnded(); });
        el.addEventListener("error", () => {
          if (active() && !this.loading && el.error && this.state !== "stopped") this.cb.onError?.(el.error.message || "playback error");
        });
      }
  }

  // ---- lifecycle ------------------------------------------------------

  /** Create the AudioContext and graph. Idempotent. Call from a user gesture. */
  async init(): Promise<void> {
    if (this.initPromise) return this.initPromise;
    this.initPromise = (async () => {
      const ctx = new AudioContext({ latencyHint: "interactive" });
      this.ctx = ctx;
      void ctx.resume().catch(() => {});
      try { await ctx.audioWorklet.addModule(new URL("worklets/wsola.js", document.baseURI).href); }
      catch (e) { this.initPromise = null; this.ctx = null; void ctx.close?.().catch(() => {}); throw e; }

      const source = ctx.createMediaElementSource(this.processedElement);
      this.graphInput = ctx.createGain();
      source.connect(this.graphInput);

      const chainIn = ctx.createGain();

      const wsola = new AudioWorkletNode(ctx, "wsola");
      this.wsolaNode = wsola;
      this.graphInput.connect(wsola);
      wsola.connect(chainIn);

      let prev: AudioNode = chainIn;
      this.eqFilters = EQ_BANDS_HZ.map((f) => {
        const b = ctx.createBiquadFilter();
        b.type = "peaking";
        b.frequency.value = f;
        b.Q.value = EQ_Q;
        b.gain.value = 0;
        prev.connect(b);
        prev = b;
        return b;
      });

      const analyser = ctx.createAnalyser();
      this.analyser = analyser;
      analyser.fftSize = FFT_SIZE;
      analyser.channelCount = 1; // mono tap (auto downmix) for the visualizer
      analyser.channelInterpretation = "discrete";
      prev.connect(analyser);

      const volume = ctx.createGain();
      this.volumeGain = volume;
      volume.gain.value = dbToGain(this.volumeDb);
      analyser.connect(volume);

      const stereo = ctx.createGain();
      this.stereoOut = stereo;
      stereo.gain.value = 1;
      volume.connect(stereo);
      stereo.connect(ctx.destination);

      const monoDown = ctx.createGain();
      monoDown.channelCount = 1;
      monoDown.channelCountMode = "explicit";
      monoDown.channelInterpretation = "speakers";
      const monoUp = ctx.createGain();
      monoUp.channelCount = 2;
      monoUp.channelCountMode = "explicit";
      monoUp.channelInterpretation = "speakers";
      const monoOut = ctx.createGain();
      this.monoOut = monoOut;
      monoOut.gain.value = 0;
      volume.connect(monoDown);
      monoDown.connect(monoUp);
      monoUp.connect(monoOut);
      monoOut.connect(ctx.destination);

      this.sampleBuf = new Float32Array(analyser.fftSize);

      this.setEqGains(this.eqGains);
      this.setMono(this.mono);
      this.applySpeedToWorklet();
    })();
    return this.initPromise;
  }

  // ---- transport ------------------------------------------------------

  /** Load and play a track from a resolved source. */
  async load(track: Track, src: ResolvedSource, startAtSec = 0): Promise<void> {
    const generation = ++this.loadGeneration;
    // Podcast enclosures use the standalone element immediately: they do not
    // need a worklet or CORS permission and retain the initiating touch gesture.
    if (src.direct) {
      this.loading = true;
      this.element.pause();
      this.resumeCleanup?.();
      this.track = track;
      this.seekable = src.seekable === true;
      this.stopGapless();
      this.processedElement.pause();
      this.element = this.plainElement;
      this.bands.fill(0);
      this.sampleBuf?.fill(0);
      const el = this.element;
      el.volume = Math.min(1, dbToGain(this.volumeDb));
      el.playbackRate = this.speed;
      el.src = src.url;
      el.load();
      this.applyResume(el, src, startAtSec);
      try { await el.play(); }
      catch (e) { if (generation === this.loadGeneration) { this.loading = false; throw e; } }
      if (generation !== this.loadGeneration) return;
      this.loading = false;
      this.notify();
      return;
    }
    await this.init();
    if (generation !== this.loadGeneration) return;
    const ctx = this.ctx!;
    this.loading = true;
    this.element.pause();
    this.resumeCleanup?.();
    this.track = track;
    this.seekable = src.seekable === true;
    this.stopGapless();
    this.resetWorklet();
    this.setState("stopped");
    await ctx.resume();
    if (generation !== this.loadGeneration) return;
    const el = this.processedElement;
    this.element = el;
    try {
      // Prefer CORS mode: crossOrigin="anonymous" lets the worklet and
      // analyser read real samples (speed + visualizer work).
      el.crossOrigin = "anonymous";
      el.src = src.url;
      el.load();
      this.applyResume(el, src, startAtSec);
      await el.play();
    } catch (error) {
      if (generation !== this.loadGeneration) return;
      if (error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "AbortError")) {
        this.loading = false;
        throw error;
      }
      // A media element connected to Web Audio is silenced by CORS even
      // when routed around a worklet. Use an unconnected element instead.
      el.pause();
      this.resumeCleanup?.();
      const plain = this.plainElement;
      this.element = plain;
      plain.src = src.url;
      plain.load();
      plain.volume = Math.min(1, dbToGain(this.volumeDb));
      plain.playbackRate = this.speed;
      this.applyResume(plain, src, startAtSec);
      try { await plain.play(); }
      catch (e) { if (generation === this.loadGeneration) { this.loading = false; throw e; } }
    }
    if (generation !== this.loadGeneration) return;
    this.loading = false;
    this.notify();
  }

  private applyResume(el: HTMLAudioElement, src: ResolvedSource, startAtSec: number): void {
    if (startAtSec <= 0 || !src.seekable) return;
    const onMeta = () => {
      el.currentTime = Math.min(startAtSec, Math.max(0, (el.duration || Infinity) - 1));
    };
    if (el.readyState >= 1) onMeta();
    else {
      el.addEventListener("loadedmetadata", onMeta, { once: true });
      this.resumeCleanup = () => el.removeEventListener("loadedmetadata", onMeta);
    }
  }

  async play(): Promise<void> {
    if (this.element === this.plainElement) {
      await this.element.play();
      this.setState("playing");
      return;
    }
    await this.init();
    const ctx = this.ctx!;
    await ctx.resume();
    if (this.gaplessSource) { this.setState("playing"); return; }
    await this.element.play();
    this.setState("playing");
  }

  pause(): void {
    this.loadGeneration++;
    this.loading = false;
    if (this.gaplessSource && this.ctx) this.ctx.suspend();
    else this.element.pause();
    this.setState("paused");
  }

  /** Seek within the current (finite) source. */
  seek(sec: number): void {
    if (!this.track) return;
    if (!this.seekable || !Number.isFinite(sec)) return;
    this.clearPreload();
    if (this.gaplessSource && this.ctx) {
      const buffer = this.gaplessSource.buffer;
      if (!buffer) return;
      const src = this.gaplessSource;
      src.onended = null;
      try { src.stop(); } catch { /* not running */ }
      this.gaplessSource = null;
      const s = this.ctx.createBufferSource();
      s.buffer = buffer;
      s.connect(this.graphInput!);
      s.onended = () => this.handleBufferEnd();
      s.start(0, Math.max(0, Math.min(sec, buffer.duration - 0.05)));
      this.gaplessSource = s;
      this.gaplessStartedAt = this.ctx.currentTime;
      this.gaplessOffset = Math.max(0, Math.min(sec, buffer.duration));
      return;
    }
    if (this.state === "stopped") return;
    this.element.currentTime = Math.max(0, sec);
  }
  // ---- mixing ---------------------------------------------------------

  setVolumeDb(db: number): void {
    if (!Number.isFinite(db)) return;
    this.volumeDb = Math.min(VOLUME_MAX_DB, Math.max(VOLUME_MIN_DB, db));
    if (this.volumeGain) this.volumeGain.gain.value = dbToGain(this.volumeDb);
    this.plainElement.volume = Math.min(1, dbToGain(this.volumeDb));
    this.notify();
  }

  setEqGains(gains: number[]): void {
    for (let i = 0; i < this.eqGains.length; i++) {
      this.eqGains[i] = clampDb(gains[i] ?? 0);
    }
    for (let i = 0; i < this.eqFilters.length; i++) {
      this.eqFilters[i].gain.value = this.eqGains[i];
    }
    this.notify();
  }

  setSpeed(ratio: number): void {
    if (!Number.isFinite(ratio)) return;
    this.speed = Math.min(SPEED_MAX, Math.max(SPEED_MIN, ratio));
    this.applySpeedToWorklet();
    this.plainElement.playbackRate = this.speed;
    this.notify();
  }

  setMono(on: boolean): void {
    this.mono = on;
    if (this.monoOut && this.stereoOut) {
      this.monoOut.gain.value = on ? 1 : 0;
      this.stereoOut.gain.value = on ? 0 : 1;
    }
    this.notify();
  }

  // ---- gapless --------------------------------------------------------

  /** Fetch + decode the next finite track in the background. */
  armGapless(track: Track, url: string, headers?: Record<string, string>): void {
    if (!this.ctx) return;
    this.clearPreload();
    // Avoid decoding long podcasts or unbounded downloads into car memory.
    if (!track.durationSecs || track.durationSecs > 600 || track.live) return;
    const generation = this.preloadGeneration;
    const abort = new AbortController();
    this.preloadAbort = abort;
    const ctx = this.ctx;
    fetch(url, { headers, signal: abort.signal })
      .then(async (res) => {
        if (!res.ok || !res.body) throw new Error("Preload unavailable");
        const reader = res.body.getReader();
        const chunks: Uint8Array<ArrayBuffer>[] = [];
        let size = 0;
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > 32 * 1024 * 1024) { await reader.cancel(); throw new Error("Preload too large"); }
            chunks.push(value);
          }
          return new Blob(chunks).arrayBuffer();
        } finally { reader.releaseLock(); }
      })
      .then((data) => ctx.decodeAudioData(data))
      .then((buf) => {
        if (generation === this.preloadGeneration && buf.length > 0) {
          this.gaplessTrack = track;
          this.gaplessBuffer = buf;
        }
      })
      .catch(() => {
        if (generation === this.preloadGeneration) this.clearPreload();
      });
  }

  /** Invalidate pending downloads without interrupting a playing bridge. */
  clearPreload(): void {
    this.preloadGeneration++;
    this.preloadAbort?.abort();
    this.preloadAbort = null;
    this.gaplessBuffer = null;
    this.gaplessTrack = null;
  }

  /** Drop a pending gapless buffer and stop any running bridge. */
  stopGapless(): void {
    this.clearPreload();
    if (this.gaplessSource) {
      this.gaplessSource.onended = null;
      try { this.gaplessSource.stop(); } catch { /* not running */ }
      this.gaplessSource = null;
    }
  }

  private handleEnded(): void {
    const promoted = this.gaplessBuffer !== null;
    // Element source reached its end.
    if (this.gaplessBuffer) {
      // The preloaded buffer IS the next track: play it now (gapless),
      // then let the store advance + preload the one after.
      this.startGaplessBuffer();
    } else {
      this.setState("stopped");
    }
    this.cb.onTrackEnd?.(promoted);
  }

  private handleBufferEnd(): void {
    this.gaplessSource = null;
    this.handleEnded();
  }

  private startGaplessBuffer(): void {
    const buf = this.gaplessBuffer!;
    this.gaplessBuffer = null;
    if (this.gaplessTrack) {
      this.track = this.gaplessTrack;
      this.gaplessTrack = null;
      this.notify();
    }
    const s = this.ctx!.createBufferSource();
    s.buffer = buf;
    // Both media elements and decoded bridges share the speed/EQ pipeline.
    this.seekable = true;
    s.connect(this.graphInput!);
    s.onended = () => this.handleBufferEnd();
    s.start();
    this.gaplessSource = s;
    this.gaplessStartedAt = this.ctx!.currentTime;
    this.gaplessOffset = 0;
    this.setState("playing");
  }

  private resetWorklet(): void {
    this.wsolaNode?.port.postMessage({ type: "reset" });
  }

  private applySpeedToWorklet(): void {
    this.wsolaNode?.port.postMessage({ type: "speed", value: this.speed });
  }

  // ---- state / queries ------------------------------------------------

  private setState(s: PlaybackState): void {
    if (this.state === s) return;
    this.state = s;
    this.notify();
  }

  private notify(): void {
    for (const fn of this.listeners) fn(this.snapshot());
  }

  snapshot(): EngineSnapshot {
    return {
      state: this.state,
      track: this.track,
      volumeDb: this.volumeDb,
      speed: this.speed,
      mono: this.mono,
      eqGains: [...this.eqGains],
      dspAvailable: this.element !== this.plainElement,
    };
  }

  updateTrack(path: string, patch: Partial<Track>): void {
    if (this.track?.path === path) this.track = { ...this.track, ...patch };
    if (this.gaplessTrack?.path === path) this.gaplessTrack = { ...this.gaplessTrack, ...patch };
    this.notify();
  }

  subscribe(fn: (s: EngineSnapshot) => void): () => void {
    this.listeners.add(fn);
    fn(this.snapshot());
    return () => this.listeners.delete(fn);
  }

  /** Current playback position in seconds (0 for unknown/live). */
  getPosition(): number {
    if (this.element === this.plainElement) {
      const position = this.element.currentTime;
      return Number.isFinite(position) ? position : 0;
    }
    if (!this.ctx) return 0;
    if (this.gaplessSource) {
      return this.gaplessOffset + (this.ctx.currentTime - this.gaplessStartedAt);
    }
    const t = this.element.currentTime;
    return Number.isFinite(t) ? t : 0;
  }

  /** Duration in seconds (0 for unknown/live). */
  getDuration(): number {
    if (this.gaplessSource) return this.gaplessSource.buffer?.duration ?? 0;
    const d = this.element.duration;
    return Number.isFinite(d) ? d : 0;
  }

  /** True while the current source is finite and seekable. */
  isSeekable(): boolean {
    return this.seekable && !this.track?.live && this.getDuration() > 0;
  }

  // ---- visualizer tap -------------------------------------------------

  /** 10 smoothed bands, 0..1. Updated while playing; decays while paused. */
  getBands(): Float32Array {
    return this.bands;
  }

  /** Time-domain tap for waveform visualizers; null before boot. */
  getWaveform(): Float32Array<ArrayBuffer> | null {
    return this.sampleBuf;
  }

  startTick(): void {
    if (this.tickTimer !== null || !this.ctx || !this.analyser) return;
    this.tickTimer = window.setInterval(() => {
      const ctx = this.ctx!;
      if (this.state === "stopped") {
        this.spectrum.reset();
        this.bands.fill(0);
        if (this.sampleBuf) this.sampleBuf.fill(0);
        return;
      }
      if (this.state === "playing" && ctx.state === "running") {
        this.analyser!.getFloatTimeDomainData(this.sampleBuf!);
        const raw = bandLevels(this.sampleBuf!, ctx.sampleRate);
        const smooth = this.spectrum.push(raw);
        for (let i = 0; i < this.bands.length; i++) this.bands[i] = smooth[i];
      } else {
        // Paused/buffering: feed silence so the display decays to rest.
        const smooth = this.spectrum.push(bandLevels(this.zeroBuf, ctx.sampleRate));
        for (let i = 0; i < this.bands.length; i++) this.bands[i] = smooth[i];
        if (this.sampleBuf) this.sampleBuf.fill(0);
      }
    }, 33);
  }

  stopTick(): void {
    if (this.tickTimer !== null) {
      window.clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
  }
}
