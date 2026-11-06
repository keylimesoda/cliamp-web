/**
 * Player store — the glue between the audio engine, playlist model,
 * providers, and React UI (zustand).
 *
 * The AudioEngine is the single source of truth for playback state,
 * volume, speed, mono, and EQ; the store mirrors it via engine.subscribe.
 * The Playlist model owns queue/shuffle/repeat. Providers resolve tracks
 * to playable sources. Settings and a resume snapshot persist to
 * localStorage so the app can pick up where the driver left off.
 */
import { create } from "zustand";
import {
  AudioEngine,
  SPEED_MAX,
  SPEED_MIN,
} from "../core/audio/engine";
import {
  clearMediaSession,
  updateMediaSession,
  type MediaSessionHandlers,
} from "../core/audio/mediasession";
import { EQ_PRESET_CYCLE, presetGains } from "../core/eq";
import { Playlist } from "../core/playlist";
import type {
  PlaybackState,
  RepeatMode,
  ResolvedSource,
  ShuffleMode,
  Track,
} from "../core/types";
import { resolveTrack } from "../providers/registry";
import { useHistoryStore } from "./history";
import { navidromeBrowse } from "../providers/navidrome";
import { useServers } from "./servers";
import { useListening } from "./listening";
import { findProgress, listeningKey, resumePosition } from "../core/listening";
import { PlaybackRecovery, type RecoveryStatus } from "../core/audio/recovery";

// ---- module singletons (not reactive) --------------------------------
let engine: AudioEngine | null = null;
let playlist: Playlist | null = null;
let posTimer: number | null = null;
let scrobbled = false;
let playGeneration = 0;
let preloadGeneration = 0;
let wantsPlayback = false;
let transitioning = false;
let lastPosition = 0;
let lastAdvanceAt = Date.now();
let stableSince = Date.now();
let recoveryPosition = 0;

function online(): boolean { return typeof navigator === "undefined" || navigator.onLine !== false; }
const recovery = new PlaybackRecovery({
  online,
  status: (status) => setState({ recovery: status, ...(status ? { state: "buffering" } : {}) }),
  exhausted: (reason) => {
    wantsPlayback = false;
    engine?.pause();
    setState({ error: `${reason}. Tap Retry to reconnect.`, recovery: null, state: "paused" });
  },
  reconnect: async () => {
    const track = usePlayerStore.getState().track;
    if (!track || !wantsPlayback) return;
    const generation = ++playGeneration;
    transitioning = true;
    engine!.pause();
    engine!.clearPreload();
    const position = track.live ? 0 : recoveryPosition;
    try {
      await deadline((async () => {
        const src = await resolveTrack(track);
        if (generation !== playGeneration || !wantsPlayback) return;
        await engine!.load(track, src, position);
      })());
      if (generation !== playGeneration || !wantsPlayback) return;
      engine!.startTick();
      lastPosition = position; lastAdvanceAt = stableSince = Date.now();
      setState({ state: engine!.snapshot().state, error: null, position, seekable: engine!.isSeekable() });
      syncMediaSession();
      void armNextGapless();
    } catch (e) {
      if (generation !== playGeneration || !wantsPlayback) return;
      engine!.pause();
      throw e;
    } finally { if (generation === playGeneration) transitioning = false; }
  },
});

async function deadline<T>(operation: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([operation, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("Connection timed out")), 15000);
    })]);
  } finally { if (timer !== undefined) clearTimeout(timer); }
}

function connectionFailed(message: string): void {
  if (!wantsPlayback) return;
  const s = usePlayerStore.getState();
  const activePosition = engine?.snapshot().track?.path === s.track?.path ? engine?.getPosition() : s.position;
  recoveryPosition = s.track?.live ? 0 : activePosition || recoveryPosition;
  stableSince = Date.now();
  recovery.request(message);
}

function saveProgress(ended = false): void {
  const s = usePlayerStore.getState();
  if (!s.track || !engine || engine.snapshot().track?.path !== s.track.path) return;
  if (!ended && s.state === "stopped") return;
  useListening.getState().record(s.track, engine.getPosition(), engine.getDuration() || s.track.durationSecs || 0, ended);
}

export function getEngine(): AudioEngine | null {
  return engine;
}
export function getPlaylist(): Playlist | null {
  return playlist;
}

// ---- persistence -----------------------------------------------------
const SETTINGS_KEY = "cliamp-web:settings";
const RESUME_KEY = "cliamp-web:resume";

interface PersistedSettings {
  volumeDb?: number;
  speed?: number;
  mono?: boolean;
  eqGains?: number[];
  eqPreset?: string;
  shuffle?: ShuffleMode;
  repeat?: RepeatMode;
  theme?: string;
}
interface PersistedResume {
  track: Track;
  position: number;
  at: number;
}

function readJson<T>(key: string): T | null {
  try {
    const s = localStorage.getItem(key);
    return s ? (JSON.parse(s) as T) : null;
  } catch {
    return null;
  }
}
function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage full / unavailable — non-fatal
  }
}

function persistSettings(): void {
  const s = usePlayerStore.getState();
  writeJson(SETTINGS_KEY, {
    volumeDb: s.volumeDb,
    speed: s.speed,
    mono: s.mono,
    eqGains: s.eqGains,
    eqPreset: s.eqPreset,
    shuffle: s.shuffle,
    repeat: s.repeat,
    theme: s.theme,
  } satisfies PersistedSettings);
}
function persistResume(): void {
  const eng = engine;
  const s = usePlayerStore.getState();
  if (!eng || !s.track || eng.snapshot().track?.path !== s.track.path) return;
  saveProgress();
  if (s.track.stream) {
    // live streams have no resumable position
    try { localStorage.removeItem(RESUME_KEY); } catch { /* unavailable */ }
    return;
  }
  writeJson(RESUME_KEY, {
    track: s.track,
    position: eng.getPosition(),
    at: Date.now(),
  } satisfies PersistedResume);
}

// ---- store shape -----------------------------------------------------
export interface PlayerState {
  booted: boolean;
  // playback
  track: Track | null;
  state: PlaybackState;
  position: number;
  duration: number;
  seekable: boolean;
  // settings
  volumeDb: number;
  speed: number;
  mono: boolean;
  eqGains: number[];
  eqPreset: string;
  theme: string;
  // playlist
  tracks: Track[];
  currentDisplay: number; // display index of current, -1 if none
  shuffle: ShuffleMode;
  repeat: RepeatMode;
  queueCount: number;
  queueEntries: { track: Track; displayPos: number }[];
  recovery: RecoveryStatus | null;
  // ui
  error: string | null;
  ratingBusy: boolean;

  // actions
  boot: () => Promise<void>;
  loadPlaylist: (tracks: Track[], startDisplay?: number, autoplay?: boolean) => Promise<void>;
  playDisplay: (pos: number) => Promise<void>;
  playTrack: (track: Track, startAtSec?: number) => Promise<void>;
  retry: () => Promise<void>;
  enqueueTrack: (track: Track) => Promise<void>;
  queueRemove: (index: number) => void;
  queueMove: (from: number, to: number) => void;
  queueClear: () => void;
  removeTrack: (displayPos: number) => void;
  moveTrack: (from: number, to: number) => void;
  undoPlaylist: () => void;
  play: () => Promise<void>;
  pause: () => void;
  toggle: () => Promise<void>;
  seek: (sec: number) => void;
  next: () => Promise<void>;
  prev: () => Promise<void>;
  setVolume: (db: number) => void;
  setSpeed: (s: number) => void;
  setMono: (on: boolean) => void;
  setEqGains: (gains: number[]) => void;
  applyPreset: (name: string) => void;
  cyclePreset: (direction?: 1 | -1) => void;
  reversePlaylist: () => void;
  setTrackRating: (rating: number) => Promise<void>;
  toggleShuffle: () => void;
  cycleRepeat: () => void;
  queueToggle: (displayPos: number) => void;
  setTheme: (name: string) => void;
  clearError: () => void;
}

// ---- internal sync helpers (module-level) ----------------------------
function setState(partial: Partial<PlayerState>): void {
  usePlayerStore.setState(partial);
}

function indexOfTrack(pl: Playlist, track: Track): number {
  for (let i = 0; i < pl.count; i++) {
    if (pl.track(i)?.path === track.path) return i;
  }
  return -1;
}

function syncPlaylistUI(): void {
  const pl = playlist;
  if (!pl) return;
  setState({
    tracks: pl.displayOrder().map((i) => pl.track(i)!),
    currentDisplay: pl.currentIndex === -1 ? -1 : pl.displayAt(pl.currentIndex),
    shuffle: pl.shuffle,
    repeat: pl.repeat,
    queueCount: pl.queueCount,
    queueEntries: pl.queueIndices().map((i) => ({ track: pl.track(i)!, displayPos: pl.displayAt(i) })),
  });
}

function syncMediaSession(): void {
  const s = usePlayerStore.getState();
  if (!s.track) {
    clearMediaSession();
    return;
  }
  const handlers: MediaSessionHandlers = {
    play: () => void usePlayerStore.getState().play(),
    pause: () => usePlayerStore.getState().pause(),
    next: () => void usePlayerStore.getState().next(),
    prev: () => void usePlayerStore.getState().prev(),
  };
  if (s.seekable) {
    handlers.seekForward = () =>
      usePlayerStore.getState().seek(Math.min(s.position + 10, s.duration || 0));
    handlers.seekBackward = () => usePlayerStore.getState().seek(Math.max(s.position - 10, 0));
    handlers.seekTo = (t: number) => usePlayerStore.getState().seek(t);
  }
  updateMediaSession(s.track, s.state, handlers);
}

function startPositionPolling(): void {
  if (posTimer !== null) window.clearInterval(posTimer);
  posTimer = window.setInterval(() => {
    const eng = engine;
    if (!eng) return;
    const s = usePlayerStore.getState();
    if (transitioning) return;
    const pos = eng.getPosition();
    const dur = eng.getDuration();
    if (pos !== s.position || dur !== s.duration) {
      setState({ position: pos, duration: dur, seekable: eng.isSeekable() });
    }
    // Scrobble once a finite track passes 50% (cliamp parity).
    if (wantsPlayback && !transitioning && !s.recovery) {
      const now = Date.now();
      if (pos > lastPosition + 0.05 || pos < lastPosition - 1) {
        lastPosition = pos; recoveryPosition = pos; lastAdvanceAt = now;
        if (now - stableSince >= 10000) recovery.stable();
      } else if (now - lastAdvanceAt >= 12000) {
        connectionFailed("Playback stalled");
        lastAdvanceAt = now;
      }
    }
    const cur = s.track;
    if (
      cur &&
      !scrobbled &&
      !cur.stream &&
      !cur.live &&
      dur > 0 &&
      pos >= dur * 0.5
    ) {
      scrobbled = true;
      useHistoryStore.getState().record(cur);
    }
  }, 250);
}

/** Index of the track that would play next, without advancing. */
function nextTrackIndex(): number {
  const pl = playlist;
  if (!pl || pl.currentIndex === -1) return -1;
  return pl.peekNextIndex();
}

/** Preload the next finite track for gapless playback (no-op for streams). */
async function armNextGapless(): Promise<void> {
  const eng = engine;
  const pl = playlist;
  if (!eng || !pl) return;
  const generation = ++preloadGeneration;
  eng.clearPreload();
  if (usePlayerStore.getState().track?.path !== pl.currentTrack?.path) return;
  const idx = nextTrackIndex();
  if (idx === -1) return;
  const next = pl.track(idx);
  if (!next || next.live || listeningKey(next)) return;
  try {
    const src = await resolveTrack(next);
    if (generation === preloadGeneration && src.seekable && !src.direct) eng.armGapless(next, src.url, src.headers);
  } catch {
    // gapless preload is best-effort; playback continues without it
  }
}

async function playSource(track: Track, src: ResolvedSource, startAtSec: number, generation: number): Promise<void> {
  const eng = engine!;
  try {
    await deadline(eng.load(track, src, startAtSec));
    eng.startTick();
  } catch (e) {
    if (generation !== playGeneration) return;
    transitioning = false;
    eng.pause();
    if (e instanceof DOMException && e.name === "NotAllowedError") {
      wantsPlayback = false; recovery.stop(); setState({ error: "Tap Play to start audio", state: "paused" });
    } else connectionFailed(e instanceof Error ? e.message : "Playback failed");
    return;
  }
  if (generation !== playGeneration) return;
  transitioning = false;
  lastPosition = recoveryPosition = startAtSec;
  lastAdvanceAt = stableSince = Date.now();
  const previous = findProgress(useListening.getState().entries, track);
  if (previous?.completed && startAtSec === 0) useListening.getState().restart(track);
  scrobbled = false;
  const pl = playlist!;
  const curIdx = pl.currentIndex;
  if (curIdx !== -1 && pl.track(curIdx)?.path !== track.path) {
    const disp = pl.displayAt(indexOfTrack(pl, track));
    if (disp !== -1) pl.playDisplay(disp);
  }
  syncPlaylistUI();
  setState({
    track,
    state: eng.snapshot().state,
    position: startAtSec,
    duration: eng.getDuration(),
    seekable: eng.isSeekable(),
  });
  syncMediaSession();
  void armNextGapless();
  persistResume();
}

function onVisibility(): void {
  if (document.visibilityState === "hidden") persistResume();
}

export const usePlayerStore = create<PlayerState>()((set, get) => ({
  booted: false,
  track: null,
  state: "stopped",
  position: 0,
  duration: 0,
  seekable: false,
  volumeDb: 0,
  speed: 1,
  mono: false,
  eqGains: new Array(10).fill(0),
  eqPreset: "Flat",
  theme: "winamp",
  tracks: [],
  currentDisplay: -1,
  shuffle: "off",
  repeat: "off",
  queueCount: 0,
  queueEntries: [],
  recovery: null,
  error: null,
  ratingBusy: false,

  async boot() {
    if (get().booted) return;
    playlist = new Playlist();
    engine = new AudioEngine({
      onTrackEnd: (promoted) => {
        // The gapless buffer (if any) is now the playing track.
        saveProgress(true);
        recovery.stop();
        const eng = engine!;
        const now = eng.snapshot().track;
        if (promoted && now && playlist) {
          // Advance through the model so a play-next entry is consumed once.
          playlist.next();
          scrobbled = false;
          syncPlaylistUI();
          setState({ track: now, position: 0, duration: eng.getDuration(), seekable: eng.isSeekable() });
          void armNextGapless();
          syncMediaSession();
        } else if (playlist && (playlist.currentTrack?.path !== now?.path
          ? Boolean(playlist.currentTrack) : playlist.next())) {
          syncPlaylistUI();
          void get().playTrack(playlist!.currentTrack!, 0);
        } else {
          // natural end with nothing preloaded
          wantsPlayback = false;
          setState({ state: "stopped", position: 0 });
          clearMediaSession();
          try { localStorage.removeItem(RESUME_KEY); } catch { /* unavailable */ }
        }
      },
      onError: connectionFailed,
    });
    let previousEngineState: PlaybackState = "stopped";
    engine.subscribe((s) => {
      const becamePaused = s.state === "paused" && previousEngineState !== "paused";
      previousEngineState = s.state;
      if (becamePaused && wantsPlayback && !transitioning) { wantsPlayback = false; recovery.stop(); saveProgress(); }
      set({
        state: s.state,
        track: s.track ?? get().track,
        volumeDb: s.volumeDb,
        speed: s.speed,
        mono: s.mono,
        eqGains: s.eqGains,
      });
    });

    // restore persisted settings
    const saved = readJson<PersistedSettings>(SETTINGS_KEY);
    if (saved) {
      set({
        volumeDb: saved.volumeDb ?? 0,
        speed: saved.speed ?? 1,
        mono: saved.mono ?? false,
        eqGains: saved.eqGains ?? new Array(10).fill(0),
        eqPreset: saved.eqPreset ?? "Flat",
        shuffle: saved.shuffle ?? "off",
        repeat: saved.repeat ?? "off",
        theme: saved.theme ?? "winamp",
      });
      engine.setVolumeDb(saved.volumeDb ?? 0);
      engine.setSpeed(saved.speed ?? 1);
      engine.setMono(saved.mono ?? false);
      if (saved.eqGains) engine.setEqGains(saved.eqGains);
      playlist.setShuffle(saved.shuffle ?? "off");
      playlist.setRepeat(saved.repeat ?? "off");
    }
    // restore resume (track + position) without starting audio
    const resume = readJson<PersistedResume>(RESUME_KEY);
    if (resume?.track) {
      set({ track: resume.track, state: "stopped", position: resume.position });
    }

    syncPlaylistUI();
    startPositionPolling();
    window.setInterval(persistResume, 5000);
    window.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("beforeunload", persistResume);
    window.addEventListener("pagehide", persistResume);
    window.addEventListener("online", () => { if (wantsPlayback && get().recovery) recovery.request("Connection restored"); });

    set({ booted: true });
  },

  async loadPlaylist(tracks, startDisplay = 0, autoplay = true) {
    const st = get();
    if (!st.booted) await st.boot();
    ++preloadGeneration;
    engine?.clearPreload();
    playlist!.load(tracks, startDisplay);
    syncPlaylistUI();
    if (autoplay) {
      const t = playlist!.currentTrack;
      if (t) await get().playTrack(t);
    }
  },

  async playDisplay(pos) {
    if (!get().booted) await get().boot();
    const pl = playlist!;
    const t = pl.track(pl.indexAtDisplay(pos));
    if (t) {
      saveProgress();
      pl.playDisplay(pos);
      syncPlaylistUI();
      await get().playTrack(t);
    }
  },

  async playTrack(track, startAtSec) {
    saveProgress();
    wantsPlayback = true;
    recovery.start();
    transitioning = true;
    const generation = ++playGeneration;
    const st = get();
    if (!st.booted) await st.boot();
    ++preloadGeneration;
    engine!.pause();
    engine!.clearPreload();
    // Create/resume the context while the initiating touch still has activation.
    const initialized = track.provider === "podcast" ? Promise.resolve() : engine!.init();
    const start = startAtSec ?? resumePosition(findProgress(useListening.getState().entries, track));
    recoveryPosition = start;
    set({ error: null, track, position: start, state: "buffering" });
    let src: ResolvedSource;
    try {
      [src] = await deadline(Promise.all([resolveTrack(track), initialized]));
    } catch (e) {
      if (generation !== playGeneration) return;
      transitioning = false;
      connectionFailed(e instanceof Error ? e.message : "Could not resolve source");
      return;
    }
    if (generation !== playGeneration) return;
    await playSource(track, src, start, generation);
  },

  async play() {
    const st = get();
    if (!st.booted) await st.boot();
    const eng = engine!;
    wantsPlayback = true;
    recovery.start();
    lastAdvanceAt = stableSince = Date.now();
    if (eng.snapshot().track) {
      try { await deadline(eng.play()); } catch (e) {
        if (e instanceof DOMException && e.name === "NotAllowedError") { wantsPlayback = false; recovery.stop(); set({ error: "Tap Play to start audio" }); }
        else connectionFailed(e instanceof Error ? e.message : "Playback failed");
      }
      return;
    }
    // no active engine track: resume the persisted track if we have one
    if (!st.track && playlist?.currentTrack) { await get().next(); return; }
    if (!st.track) { wantsPlayback = false; recovery.stop(); return; }
    if (listeningKey(st.track)) { await get().playTrack(st.track); return; }
    if (st.track) {
      const resume = readJson<PersistedResume>(RESUME_KEY);
      if (resume?.track?.path === st.track.path) {
        await get().playTrack(st.track, resume.position);
      } else await get().playTrack(st.track);
    }
  },

  async retry() {
    const track = get().track;
    if (track) await get().playTrack(track, track.live ? 0 : recoveryPosition);
  },

  pause() {
    saveProgress();
    wantsPlayback = false;
    recovery.stop();
    transitioning = false;
    ++playGeneration;
    engine?.pause();
    persistResume();
  },

  async toggle() {
    if (wantsPlayback) get().pause();
    else await get().play();
  },

  seek(sec) {
    const eng = engine;
    if (!eng || !eng.isSeekable()) return;
    eng.seek(sec);
    lastPosition = recoveryPosition = sec;
    lastAdvanceAt = Date.now();
    void armNextGapless();
    set({ position: sec });
    persistResume();
  },

  async next() {
    if (!get().booted) await get().boot();
    const pl = playlist!;
    saveProgress();
    if ((pl.currentTrack?.path !== get().track?.path && !pl.queueCount) ? Boolean(pl.currentTrack) : pl.next()) {
      const t = pl.currentTrack!;
      syncPlaylistUI();
      await get().playTrack(t);
    } else {
      get().pause(); set({ state: "stopped" }); clearMediaSession();
    }
  },

  async prev() {
    if (!get().booted) await get().boot();
    const pl = playlist!;
    if (pl.prev()) {
      const t = pl.currentTrack!;
      syncPlaylistUI();
      await get().playTrack(t);
    }
  },

  setVolume(db) {
    engine?.setVolumeDb(db);
    persistSettings();
  },
  setSpeed(s) {
    engine?.setSpeed(Math.min(SPEED_MAX, Math.max(SPEED_MIN, s)));
    persistSettings();
  },
  setMono(on) {
    engine?.setMono(on);
    persistSettings();
  },
  setEqGains(gains) {
    engine?.setEqGains(gains);
    set({ eqPreset: "Custom" });
    persistSettings();
  },
  applyPreset(name) {
    const g = presetGains(name);
    if (!g) return;
    engine?.setEqGains([...g]);
    set({ eqPreset: name });
    persistSettings();
  },
  cyclePreset(direction = 1) {
    const current = get().eqPreset;
    const i = EQ_PRESET_CYCLE.findIndex((p) => p.toLowerCase() === current.toLowerCase());
    const nextName = i === -1 ? "Flat" : EQ_PRESET_CYCLE[(i + direction + EQ_PRESET_CYCLE.length) % EQ_PRESET_CYCLE.length];
    get().applyPreset(nextName);
  },
  reversePlaylist() {
    playlist?.reverse();
    syncPlaylistUI();
    void armNextGapless();
  },
  async setTrackRating(rating) {
    const track = get().track;
    if (!track || track.provider !== "navidrome" || get().ratingBusy) return;
    const config = useServers.getState().getConfig("navidrome");
    const pl = playlist;
    set({ ratingBusy: true, error: null });
    try {
      await navidromeBrowse.setRating(track, rating);
      if (config !== useServers.getState().getConfig("navidrome")) return;
      if (pl === playlist) { pl?.updateTrack(track.path, { rating }); syncPlaylistUI(); }
      engine?.updateTrack(track.path, { rating });
      if (get().track?.path === track.path) set({ track: { ...get().track!, rating } });
    } catch (e) {
      if (get().track?.path === track.path) set({ error: e instanceof Error ? e.message : "Rating failed" });
    } finally { set({ ratingBusy: false }); }
  },
  toggleShuffle() {
    playlist?.setShuffle(get().shuffle === "on" ? "off" : "on");
    syncPlaylistUI();
    void armNextGapless();
    persistSettings();
  },
  cycleRepeat() {
    playlist?.cycleRepeat();
    syncPlaylistUI();
    void armNextGapless();
    persistSettings();
  },
  queueToggle(displayPos) {
    playlist?.queueToggle(displayPos);
    syncPlaylistUI();
    void armNextGapless();
  },
  async enqueueTrack(track) {
    if (!get().booted) await get().boot();
    let index = indexOfTrack(playlist!, track);
    if (index < 0) index = playlist!.add([track]);
    playlist!.enqueueNext(playlist!.displayAt(index));
    syncPlaylistUI(); void armNextGapless();
  },
  queueRemove(index) { playlist?.queueRemove(index); syncPlaylistUI(); void armNextGapless(); },
  queueMove(from, to) { playlist?.queueMove(from, to); syncPlaylistUI(); void armNextGapless(); },
  queueClear() { playlist?.queueClear(); syncPlaylistUI(); void armNextGapless(); },
  removeTrack(pos) { playlist?.removeDisplay(pos); syncPlaylistUI(); void armNextGapless(); },
  moveTrack(from, to) {
    try { playlist?.moveDisplay(from, to); syncPlaylistUI(); void armNextGapless(); }
    catch (e) { set({ error: e instanceof Error ? e.message : "Could not move track" }); }
  },
  undoPlaylist() { playlist?.undo(); syncPlaylistUI(); void armNextGapless(); },
  setTheme(name) {
    set({ theme: name });
    persistSettings();
  },
  clearError() {
    set({ error: null });
  },
}));
