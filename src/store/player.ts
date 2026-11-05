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

// ---- module singletons (not reactive) --------------------------------
let engine: AudioEngine | null = null;
let playlist: Playlist | null = null;
let posTimer: number | null = null;
let scrobbled = false;
let playGeneration = 0;
let preloadGeneration = 0;

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
  if (!eng || !s.track) return;
  if (s.track.stream) {
    // live streams have no resumable position
    localStorage.removeItem(RESUME_KEY);
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
  // ui
  error: string | null;
  ratingBusy: boolean;

  // actions
  boot: () => Promise<void>;
  loadPlaylist: (tracks: Track[], startDisplay?: number, autoplay?: boolean) => Promise<void>;
  playDisplay: (pos: number) => Promise<void>;
  playTrack: (track: Track, startAtSec?: number) => Promise<void>;
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
    const pos = eng.getPosition();
    const dur = eng.getDuration();
    if (pos !== s.position || dur !== s.duration) {
      setState({ position: pos, duration: dur, seekable: eng.isSeekable() });
    }
    // Scrobble once a finite track passes 50% (cliamp parity).
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
  if (pl.queueCount > 0) return pl.queueIndices()[0];
  if (pl.repeat === "one") return pl.currentIndex;
  const nextDisp = pl.displayAt(pl.currentIndex) + 1;
  if (nextDisp < pl.count) return pl.indexAtDisplay(nextDisp);
  return pl.repeat === "all" ? pl.indexAtDisplay(0) : -1;
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
  if (!next || next.live) return;
  try {
    const src = await resolveTrack(next);
    if (generation === preloadGeneration && src.seekable) eng.armGapless(next, src.url, src.headers);
  } catch {
    // gapless preload is best-effort; playback continues without it
  }
}

async function playSource(track: Track, src: ResolvedSource, startAtSec: number, generation: number): Promise<void> {
  const eng = engine!;
  try {
    await eng.load(track, src, startAtSec);
    eng.startTick();
  } catch (e) {
    if (generation !== playGeneration) return;
    setState({ error: e instanceof Error ? e.message : "playback failed" });
    return;
  }
  if (generation !== playGeneration) return;
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
  error: null,
  ratingBusy: false,

  async boot() {
    if (get().booted) return;
    playlist = new Playlist();
    engine = new AudioEngine({
      onTrackEnd: (promoted) => {
        // The gapless buffer (if any) is now the playing track.
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
        } else if (playlist?.currentTrack?.path === now?.path && playlist?.next()) {
          syncPlaylistUI();
          void get().playTrack(playlist!.currentTrack!, 0);
        } else {
          // natural end with nothing preloaded
          setState({ state: "stopped", position: 0 });
          clearMediaSession();
          localStorage.removeItem(RESUME_KEY);
        }
      },
      onError: (message) => setState({ error: message }),
    });
    engine.subscribe((s) => {
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
      if (t) await get().playTrack(t, 0);
    }
  },

  async playDisplay(pos) {
    if (!get().booted) await get().boot();
    const pl = playlist!;
    const t = pl.track(pl.indexAtDisplay(pos));
    if (t) {
      pl.playDisplay(pos);
      syncPlaylistUI();
      await get().playTrack(t, 0);
    }
  },

  async playTrack(track, startAtSec = 0) {
    const generation = ++playGeneration;
    const st = get();
    if (!st.booted) await st.boot();
    ++preloadGeneration;
    engine!.pause();
    engine!.clearPreload();
    // Create/resume the context while the initiating touch still has activation.
    const initialized = engine!.init();
    set({ error: null });
    let src: ResolvedSource;
    try {
      [src] = await Promise.all([resolveTrack(track), initialized]);
    } catch (e) {
      if (generation !== playGeneration) return;
      set({ error: e instanceof Error ? e.message : "could not resolve source" });
      return;
    }
    if (generation !== playGeneration) return;
    await playSource(track, src, startAtSec, generation);
  },

  async play() {
    const st = get();
    if (!st.booted) await st.boot();
    const eng = engine!;
    if (eng.snapshot().track) {
      try { await eng.play(); } catch (e) { set({ error: e instanceof Error ? e.message : "playback failed" }); }
      return;
    }
    // no active engine track: resume the persisted track if we have one
    if (st.track) {
      const resume = readJson<PersistedResume>(RESUME_KEY);
      if (resume?.track?.path === st.track.path) {
        await get().playTrack(st.track, resume.position);
      } else await get().playTrack(st.track, 0);
    }
  },

  pause() {
    ++playGeneration;
    engine?.pause();
    persistResume();
  },

  async toggle() {
    const s = get().state;
    if (s === "playing" || s === "buffering" || s === "seeking") get().pause();
    else await get().play();
  },

  seek(sec) {
    const eng = engine;
    if (!eng || !eng.isSeekable()) return;
    eng.seek(sec);
    void armNextGapless();
    set({ position: sec });
    persistResume();
  },

  async next() {
    if (!get().booted) await get().boot();
    const pl = playlist!;
    if (pl.next()) {
      const t = pl.currentTrack!;
      syncPlaylistUI();
      await get().playTrack(t, 0);
    }
  },

  async prev() {
    if (!get().booted) await get().boot();
    const pl = playlist!;
    if (pl.prev()) {
      const t = pl.currentTrack!;
      syncPlaylistUI();
      await get().playTrack(t, 0);
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
  setTheme(name) {
    set({ theme: name });
    persistSettings();
  },
  clearError() {
    set({ error: null });
  },
}));
