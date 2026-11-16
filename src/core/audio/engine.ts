/**
 * Audio engine — the Web Audio pipeline, parity with cliamp's player:
 *
 *   <audio> → MediaElementSource → WSOLA worklet (pitch-preserving speed)
 *           → 10 peaking biquads (70 Hz … 16 kHz, Q 1.4)
 *           → analyser (mono tap for the visualizer)
 *           → volume gain → stereo out → destination
 *                          ↘ mono downmix → upmix → mono out → destination
 *
 * Spoken media uses native pitch-preserving playbackRate before Web Audio;
 * the worklet stays at unity so source time and audio consumption agree.
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
import { isSpokenTrack } from "../listening";
import type { PlaybackState, ResolvedSource, Track } from "../types";
import { HlsPlaylistError } from "./stream-error";
import type { PcmOutput } from "./aac-stream";

class HlsMediaError extends Error {}

function mediaDecodeFailed(error: MediaError | null): boolean {
  return error?.code === 3 || error?.code === 4;
}

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
  private softwareStop: (() => void) | null = null;
  private hlsStop: (() => void) | null = null;
  private softwarePosition: (() => number) | null = null;

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
        const active = () => this.element === el && !this.gaplessSource && !this.softwareStop;
        for (const event of ["loadstart", "playing", "pause", "waiting", "stalled", "ended", "error"]) {
          el.addEventListener(event, () => {
            try { if (localStorage.getItem("cliamp-web:audio-debug") !== "1") return; }
            catch { return; }
            console.debug("[audio]", { event, active: active(), generation: this.loadGeneration,
              state: this.state, loading: this.loading, readyState: el.readyState,
              networkState: el.networkState, currentTime: el.currentTime,
              errorCode: el.error?.code, processed: el === this.processedElement });
          });
        }
        el.addEventListener("playing", () => { if (active() && !el.paused) this.setState("playing"); });
        el.addEventListener("pause", () => {
          if (!active() || this.loading || this.state === "stopped" || el.ended) return;
          // A failed media resource can queue `pause` before `error`. Keep the
          // store from mistaking that browser-generated pause for user intent;
          // the error path should own the transition and start recovery.
          if (el.error) {
            if (this.hlsStop && mediaDecodeFailed(el.error)) return;
            this.cb.onError?.(el.error.message || "playback error");
            return;
          }
          this.setState("paused");
        });
        el.addEventListener("waiting", () => { if (active() && !el.paused) this.setState("buffering"); });
        el.addEventListener("seeking", () => { if (active()) this.setState("seeking"); });
        el.addEventListener("seeked", () => { if (active()) this.setState(el.paused ? "paused" : "playing"); });
        el.addEventListener("ended", () => {
          if (!active()) return;
          if (this.track?.live || this.track?.stream) {
            if (!this.loading && this.state !== "paused") this.cb.onError?.("Live stream ended");
          }
          else this.handleEnded();
        });
        el.addEventListener("error", () => {
          if (this.hlsStop && mediaDecodeFailed(el.error)) return;
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
    this.softwareStop?.();
    this.hlsStop?.();
    // Podcast enclosures use the standalone element immediately: they do not
    // need a worklet or CORS permission and retain the initiating touch gesture.
    if (src.direct) {
      this.loading = true;
      this.element.pause();
      this.resumeCleanup?.();
      this.track = track;
      this.applySpeedToWorklet();
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
    this.applySpeedToWorklet();
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
      catch (e) {
        if (generation !== this.loadGeneration) return;
        try {
          const url = new URL(src.url, document.baseURI);
          if (track.provider !== "radio" || !track.live || url.username || url.password ||
              (url.protocol !== "https:" && url.protocol !== "http:")) throw e;
          if (e instanceof DOMException && (e.name === "NotAllowedError" || e.name === "AbortError")) throw e;
          if (/\.m3u8$/i.test(url.pathname)) {
            await this.playHls(url.href, generation);
          } else {
            if (!(e instanceof DOMException && e.name === "NotSupportedError")) throw e;
            // A plain audio element can auto-upgrade HTTP media, but fetch()
            // needs an explicit HTTPS URL to read bytes for the AAC decoder.
            const httpFallback = url.protocol === "http:" ? url.href : undefined;
            url.protocol = "https:";
            try {
              await this.playSoftwareAudio(async (signal, output) => {
                const { decodeAacStream } = await import("./aac-stream");
                await decodeAacStream(url.href, signal, output, httpFallback);
              });
            }
            catch (error) {
              if (!(error instanceof HlsPlaylistError) || generation !== this.loadGeneration) throw error;
              await this.playHls(error.url, generation);
            }
          }
        } finally {
          if (generation === this.loadGeneration) this.loading = false;
        }
      }
    }
    if (generation !== this.loadGeneration) return;
    this.loading = false;
    this.notify();
  }

  private async playHls(source: string, generation: number): Promise<void> {
    const url = new URL(source);
    if (document.location.protocol === "https:" && url.protocol === "http:") url.protocol = "https:";
    const playSoftware = () => this.playSoftwareAudio(async (signal, output) => {
      const { decodeHlsAudio } = await import("./hls-software");
      await decodeHlsAudio(url.href, signal, output);
    });
    try {
      await this.playHlsMedia(url.href, generation, playSoftware);
    } catch (error) {
      if (generation !== this.loadGeneration || !(error instanceof HlsMediaError)) throw error;
      await playSoftware();
    }
  }

  private async playHlsMedia(source: string, generation: number, playSoftware: () => Promise<void>): Promise<void> {
    const { default: Hls } = await import("hls.js");
    if (generation !== this.loadGeneration) return;
    if (!Hls.isSupported()) throw new HlsMediaError("Browser HLS unavailable");
    for (const media of [this.processedElement, this.plainElement]) {
      media.pause();
      media.removeAttribute("src");
      media.load();
    }
    const el = this.processedElement;
    this.element = el;
    el.crossOrigin = "anonymous";
    this.setState("buffering");
    const hls = new Hls();
    await new Promise<void>((resolve, reject) => {
      let started = false;
      this.hlsStop = () => {
        this.hlsStop = null;
        el.removeEventListener("error", onMediaError);
        hls.destroy();
        if (!started) reject(new DOMException("Playback cancelled", "AbortError"));
      };
      const fail = (error: Error) => {
        if (generation !== this.loadGeneration || !this.hlsStop) return;
        if (!started) reject(error);
        this.hlsStop();
        if (!started) return;
        if (error instanceof HlsMediaError) {
          void playSoftware().catch((failure: unknown) => {
            if (generation === this.loadGeneration) {
              this.cb.onError?.(failure instanceof Error ? failure.message : "Stream unavailable");
            }
          });
        } else {
          this.cb.onError?.(error.message);
        }
      };
      const onMediaError = () => {
        if (mediaDecodeFailed(el.error)) fail(new HlsMediaError(el.error!.message));
      };
      el.addEventListener("error", onMediaError);
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (!data.fatal) return;
        const error = data.error ?? new Error("Stream unavailable");
        fail(data.type === Hls.ErrorTypes.MEDIA_ERROR ? new HlsMediaError(error.message) : error);
      });
      hls.once(Hls.Events.MANIFEST_PARSED, () => {
        void el.play().then(() => {
          if (generation !== this.loadGeneration || !this.hlsStop) return;
          started = true;
          resolve();
        }, (error: Error) => {
          const unsupported = error.name === "NotSupportedError" || mediaDecodeFailed(el.error);
          fail(unsupported ? new HlsMediaError(error.message) : error);
        });
      });
      hls.once(Hls.Events.MEDIA_ATTACHED, () => hls.loadSource(source));
      hls.attachMedia(el);
    });
  }

  private async playSoftwareAudio(decode: (signal: AbortSignal, output: PcmOutput) => Promise<void>): Promise<void> {
    const ctx = this.ctx!;
    const controller = new AbortController();
    const { signal } = controller;
    const scheduled = new Set<AudioBufferSourceNode>();
    let next = 0;
    let firstSampleAt = 0;
    let started = false;
    this.softwarePosition = () => Math.max(0, Math.min(ctx.currentTime, next) - firstSampleAt);
    this.softwareStop = () => {
      controller.abort();
      for (const node of scheduled) { node.onended = null; node.stop(); node.disconnect(); }
      scheduled.clear();
      this.softwareStop = null;
      this.softwarePosition = null;
    };
    for (const media of [this.processedElement, this.plainElement]) {
      media.removeAttribute("src");
      media.load();
    }
    this.element = this.processedElement;
    this.setState("buffering");
    await new Promise<void>((resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      void decode(signal, async (planes, rate) => {
        while (next - ctx.currentTime > 0.75) {
          signal.throwIfAborted();
          await new Promise((done) => setTimeout(done, 50));
        }
        signal.throwIfAborted();
        const buffer = ctx.createBuffer(planes.length, planes[0].length, rate);
        planes.forEach((plane, channel) => buffer.getChannelData(channel).set(plane));
        const node = ctx.createBufferSource();
        node.buffer = buffer;
        node.connect(this.graphInput!);
        scheduled.add(node);
        node.onended = () => {
          scheduled.delete(node);
          node.disconnect();
          if (!scheduled.size && !signal.aborted) this.setState("buffering");
        };
        const at = Math.max(next, ctx.currentTime + (next > ctx.currentTime ? 0 : 0.12));
        if (!started) firstSampleAt = at;
        node.start(at);
        next = at + buffer.duration;
        this.setState("playing");
        started = true;
        resolve();
      }).catch((error: unknown) => {
        if (signal.aborted) return;
        try {
          if (localStorage.getItem("cliamp-web:audio-debug") === "1") console.debug("[audio] WASM failed", error);
        } catch { /* Diagnostics are optional. */ }
        if (!started) reject(error);
        this.softwareStop?.();
        if (started) this.cb.onError?.(error instanceof Error ? error.message : "Stream unavailable");
      });
    });
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
    this.softwareStop?.();
    this.hlsStop?.();
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
    if (!track.durationSecs || track.durationSecs > 600 || track.live || isSpokenTrack(track) || isSpokenTrack(this.track)) return;
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
    // A real-time media input cannot feed WSOLA faster than the media clock.
    // Spoken audio uses the browser's pitch-preserving transport rate, keeping
    // the clock, seeking, duration and track boundaries in source seconds.
    const spoken = isSpokenTrack(this.track);
    this.processedElement.preservesPitch = true;
    this.plainElement.preservesPitch = true;
    this.processedElement.defaultPlaybackRate = spoken ? this.speed : 1;
    this.plainElement.defaultPlaybackRate = this.speed;
    this.processedElement.playbackRate = spoken ? this.speed : 1;
    this.plainElement.playbackRate = this.speed;
    this.wsolaNode?.port.postMessage({ type: "speed", value: spoken ? 1 : this.speed });
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
    if (this.softwarePosition) return this.softwarePosition();
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
    if (this.softwareStop) return 0;
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
