/**
 * Audio engine — the Web Audio pipeline, parity with cliamp's player:
 *
 *   <audio> → MediaElementSource → WSOLA worklet (pitch-preserving speed)
 *           → 10 peaking biquads (70 Hz … 16 kHz, Q 1.4)
 *           → analyser (mono tap for the visualizer)
 *           → volume gain → stereo out → destination
 *                          ↘ mono downmix → upmix → mono out → destination
 *
 * Gapless: the next finite track is fetched + decoded ahead of time;
 * when the current track ends, the decoded buffer is played through the
 * same EQ/volume chain while the element loads the next source in the
 * background, then hands over seamlessly.
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
  onTrackEnd?: () => void;
  onError?: (message: string) => void;
}

export interface EngineSnapshot {
  state: PlaybackState;
  track: Track | null;
  volumeDb: number;
  speed: number;
  mono: boolean;
  eqGains: number[];
}

export class AudioEngine {
  private cb: EngineCallbacks;
  private ctx: AudioContext | null = null;
  private element = new Audio();
  private directElement = new Audio();
  private directMode = false;
  private wsolaNode: AudioWorkletNode | null = null;
  private eqFilters: BiquadFilterNode[] = [];
  private chainIn: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private volumeGain: GainNode | null = null;
  private stereoOut: GainNode | null = null;
  private monoOut: GainNode | null = null;
  private wsolaGain: GainNode | null = null;
  private bypassGain: GainNode | null = null;
  private corsMode = true; // true: crossOrigin="anonymous", worklet path
  private staleError = false; // one-shot: swallows the CORS-attempt error event

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
    this.directElement.preload = "auto";
    this.directElement.addEventListener("playing", () => {
      if (this.directMode) this.setState("playing");
    });
    this.directElement.addEventListener("pause", () => {
      if (
        this.directMode &&
        (this.state === "playing" || this.state === "buffering" || this.state === "seeking")
      ) {
        this.setState("paused");
      }
    });
    this.directElement.addEventListener("waiting", () => {
      if (this.directMode) this.setState("buffering");
    });
    this.directElement.addEventListener("seeking", () => {
      if (this.directMode) this.setState("seeking");
    });
    this.directElement.addEventListener("ended", () => {
      if (!this.directMode) return;
      this.setState("stopped");
      this.cb.onTrackEnd?.();
    });
    this.directElement.addEventListener("error", () => {
      if (this.directMode && this.directElement.error) {
        this.cb.onError?.(this.directElement.error.message || "playback error");
      }
    });
  }

  // ---- lifecycle ------------------------------------------------------

  /** Create the AudioContext and graph. Idempotent. Call from a user gesture. */
  async init(): Promise<void> {
    if (this.initPromise) return this.initPromise;
    this.initPromise = (async () => {
      const ctx = new AudioContext({ latencyHint: "interactive" });
      this.ctx = ctx;
      const workletUrl = new URL("worklets/wsola.js", document.baseURI).href;
      await ctx.audioWorklet.addModule(workletUrl);

      const source = ctx.createMediaElementSource(this.element);

      const chainIn = ctx.createGain();
      this.chainIn = chainIn;

      // Dual routing: the WSOLA worklet path (full features) and a plain
      // bypass (for tainted cross-origin sources, where the worklet would
      // receive zero-filled input). Exactly one is active at a time.
      const wsolaGain = ctx.createGain();
      this.wsolaGain = wsolaGain;
      wsolaGain.gain.value = 1;
      const bypassGain = ctx.createGain();
      this.bypassGain = bypassGain;
      bypassGain.gain.value = 0;
      const wsola = new AudioWorkletNode(ctx, "wsola");
      this.wsolaNode = wsola;
      source.connect(wsolaGain);
      wsolaGain.connect(wsola);
      wsola.connect(chainIn);
      source.connect(bypassGain);
      bypassGain.connect(chainIn);

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
      monoDown.channelInterpretation = "discrete";
      const monoUp = ctx.createGain();
      monoUp.channelCount = 2;
      monoUp.channelInterpretation = "discrete";
      const monoOut = ctx.createGain();
      this.monoOut = monoOut;
      monoOut.gain.value = 0;
      volume.connect(monoDown);
      monoDown.connect(monoUp);
      monoUp.connect(monoOut);
      monoOut.connect(ctx.destination);

      this.sampleBuf = new Float32Array(analyser.fftSize);

      this.element.addEventListener("playing", () => this.setState("playing"));
      this.element.addEventListener("pause", () => {
        if (this.state === "playing" || this.state === "buffering") this.setState("paused");
      });
      this.element.addEventListener("waiting", () => this.setState("buffering"));
      this.element.addEventListener("seeking", () => this.setState("seeking"));
      this.element.addEventListener("ended", () => this.handleEnded());
      this.element.addEventListener("error", () => {
        if (this.staleError) {
          this.staleError = false;
          return; // CORS-attempt error, already handled by the fallback
        }
        if (this.element.error && this.state !== "stopped") {
          this.cb.onError?.(this.element.error.message ?? "playback error");
        }
      });
      this.applySpeedToWorklet();
    })();
    return this.initPromise;
  }

  // ---- transport ------------------------------------------------------

  /** Load and play a track from a resolved source. */
  async load(track: Track, src: ResolvedSource, startAtSec = 0): Promise<void> {
    this.track = track;
    this.stopGapless();
    this.setState("stopped");

    // Some podcast/CDN enclosures intentionally do not grant CORS access.
    // A MediaElementSource connected to Web Audio is silent for those URLs,
    // even though a plain <audio> element is allowed to play them. Keep a
    // separate element for those sources so playback stays inside the user's
    // original tap gesture and never enters the doomed Web Audio path first.
    if (src.direct) {
      this.directMode = true;
      this.element.pause();
      this.bands.fill(0);
      if (this.sampleBuf) this.sampleBuf.fill(0);
      const el = this.directElement;
      el.volume = Math.min(1, dbToGain(this.volumeDb));
      el.playbackRate = this.speed;
      el.src = src.url;
      el.load();
      this.applyResume(el, src, startAtSec);
      await el.play();
      this.notify();
      return;
    }

    this.directMode = false;
    this.directElement.pause();
    await this.init();
    const ctx = this.ctx!;
    this.resetWorklet();
    const el = this.element;
    await ctx.resume();
    try {
      // Prefer CORS mode: crossOrigin="anonymous" lets the worklet and
      // analyser read real samples (speed + visualizer work).
      this.corsMode = true;
      el.crossOrigin = "anonymous";
      el.src = src.url;
      el.load();
      this.applyResume(el, src, startAtSec);
      this.applyRouting();
      this.staleError = true; // armed: swallow the CORS attempt's error event if it fails
      await el.play();
      this.staleError = false; // succeeded: no stale error pending
    } catch {
      // Last-resort direct playback for sources that reject CORS.
      this.corsMode = false;
      el.pause();
      const direct = this.directElement;
      this.directMode = true;
      direct.volume = Math.min(1, dbToGain(this.volumeDb));
      direct.playbackRate = this.speed;
      direct.src = src.url;
      direct.load();
      this.applyResume(direct, src, startAtSec);
      await direct.play();
    }
    this.notify();
  }

  private applyResume(el: HTMLAudioElement, src: ResolvedSource, startAtSec: number): void {
    if (startAtSec <= 0 || !src.seekable) return;
    const onMeta = () => {
      el.currentTime = Math.min(startAtSec, Math.max(0, (el.duration || Infinity) - 1));
    };
    if (el.readyState >= 1) onMeta();
    else el.addEventListener("loadedmetadata", onMeta, { once: true });
  }

  private applyRouting(): void {
    if (this.wsolaGain && this.bypassGain) {
      this.wsolaGain.gain.value = this.corsMode ? 1 : 0;
      this.bypassGain.gain.value = this.corsMode ? 0 : 1;
    }
  }

  async play(): Promise<void> {
    if (this.directMode) {
      await this.directElement.play();
      return;
    }
    await this.init();
    const ctx = this.ctx!;
    await ctx.resume();
    if (this.gaplessSource) return; // bridge already running
    await this.element.play();
  }

  pause(): void {
    if (this.directMode) {
      this.directElement.pause();
      return;
    }
    if (!this.ctx) return;
    if (this.gaplessSource) this.ctx.suspend();
    else this.element.pause();
  }

  /** Seek within the current (finite) source. */
  seek(sec: number): void {
    if (!this.track || this.track.stream) return;
    if (this.directMode) {
      this.directElement.currentTime = Math.max(0, sec);
      return;
    }
    if (!this.ctx) return;
    if (this.gaplessSource) {
      const buffer = this.gaplessSource.buffer;
      if (!buffer) return;
      const src = this.gaplessSource;
      src.onended = null;
      try { src.stop(); } catch { /* not running */ }
      this.gaplessSource = null;
      const s = this.ctx.createBufferSource();
      s.buffer = buffer;
      s.connect(this.chainIn!);
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
    this.volumeDb = Math.min(VOLUME_MAX_DB, Math.max(VOLUME_MIN_DB, db));
    if (this.volumeGain) this.volumeGain.gain.value = dbToGain(this.volumeDb);
    this.directElement.volume = Math.min(1, dbToGain(this.volumeDb));
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
    this.speed = Math.min(SPEED_MAX, Math.max(SPEED_MIN, ratio));
    this.directElement.playbackRate = this.speed;
    this.applySpeedToWorklet();
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
    const ctx = this.ctx;
    this.gaplessTrack = track;
    fetch(url, headers ? { headers } : undefined)
      .then((res) => (res.ok ? res.arrayBuffer() : Promise.reject(new Error(String(res.status)))))
      .then((data) => ctx.decodeAudioData(data))
      .then((buf) => {
        if (buf.length > 0) this.gaplessBuffer = buf;
      })
      .catch(() => {
        this.gaplessBuffer = null; // stream or CORS — fall back to element end
      });
  }

  /** Drop a pending gapless buffer and stop any running bridge. */
  stopGapless(): void {
    this.gaplessBuffer = null;
    this.gaplessTrack = null;
    if (this.gaplessSource) {
      this.gaplessSource.onended = null;
      try { this.gaplessSource.stop(); } catch { /* not running */ }
      this.gaplessSource = null;
    }
  }

  private handleEnded(): void {
    // Element source reached its end.
    if (this.gaplessBuffer) {
      // The preloaded buffer IS the next track: play it now (gapless),
      // then let the store advance + preload the one after.
      this.startGaplessBuffer();
    } else {
      this.setState("stopped");
    }
    this.cb.onTrackEnd?.();
  }

  private handleBufferEnd(): void {
    this.gaplessSource = null;
    if (this.gaplessBuffer) {
      this.startGaplessBuffer();
      this.cb.onTrackEnd?.();
      return;
    }
    // Nothing preloaded: the store may have reloaded the element; if not, stop.
    if (this.element.paused) this.setState("stopped");
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
    s.connect(this.chainIn!);
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
    };
  }

  subscribe(fn: (s: EngineSnapshot) => void): () => void {
    this.listeners.add(fn);
    fn(this.snapshot());
    return () => this.listeners.delete(fn);
  }

  /** Current playback position in seconds (0 for unknown/live). */
  getPosition(): number {
    if (this.directMode) {
      const t = this.directElement.currentTime;
      return Number.isFinite(t) ? t : 0;
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
    if (this.directMode) {
      const d = this.directElement.duration;
      return Number.isFinite(d) ? d : 0;
    }
    if (this.gaplessSource) return this.gaplessSource.buffer?.duration ?? 0;
    const d = this.element.duration;
    return Number.isFinite(d) ? d : 0;
  }

  /** True while the current source is finite and seekable. */
  isSeekable(): boolean {
    return !this.track?.stream && this.getDuration() > 0;
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
