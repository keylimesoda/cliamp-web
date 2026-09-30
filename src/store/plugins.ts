/**
 * Plugin store — React-facing wrapper around the Lua plugin host.
 *
 * Wires the host to the player through a bridge, loads the bundled plugins,
 * and dispatches player events (track.change, playback.state, track.scrobble,
 * app.start) to the plugins. Exposes the plugin list, transient status
 * messages (cliamp.message / cliamp.notify), and plugin logs to the UI.
 */
import { create } from "zustand";
import { luaHost, toLua, type Message, type PluginMeta } from "../lua/host";
import { BUNDLED_PLUGINS } from "../lua/plugins";
import { usePlayerStore } from "./player";
import { useHistoryStore } from "./history";
import type { Track } from "../core/types";

export interface PluginInfo {
  name: string;
  meta: PluginMeta;
  enabled: boolean;
}

interface PluginState {
  ready: boolean;
  plugins: PluginInfo[];
  /** Latest transient status message (cliamp.message / cliamp.notify). */
  status: string | null;
  /** Ring of recent plugin log lines (newest last). */
  logs: string[];
  init: () => void;
  toggle: (name: string) => void;
}

let initialized = false;
let lastTrackPath: string | null = null;
let lastState: string | null = null;

function trackToLua(t: Track) {
  return toLua({
    title: t.title ?? "",
    artist: t.artist ?? "",
    album: t.album ?? "",
    genre: t.genre ?? "",
    path: t.path,
    year: t.year ?? 0,
    track_number: t.trackNumber ?? 0,
    duration_secs: t.durationSecs ?? 0,
    is_stream: !!t.stream,
    is_live: !!t.live,
  });
}

function timeStamp(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
}

export const usePluginStore = create<PluginState>()((set, get) => ({
  ready: false,
  plugins: [],
  status: null,
  logs: [],

  init() {
    if (initialized) return;
    initialized = true;

    // Bridge: connect the host to the player store (reads + controls).
    luaHost.setBridge({
      snapshot() {
        const s = usePlayerStore.getState();
        const t = s.track;
        return {
          track: t
            ? {
                title: t.title ?? "",
                artist: t.artist ?? "",
                album: t.album ?? "",
                genre: t.genre ?? "",
                path: t.path,
                year: t.year ?? 0,
                trackNumber: t.trackNumber ?? 0,
                durationSecs: t.durationSecs ?? 0,
                isStream: !!t.stream,
                isLive: !!t.live,
              }
            : null,
          state: s.state,
          position: s.position,
          duration: s.duration,
          volumeDb: s.volumeDb,
          speed: s.speed,
          mono: s.mono,
          repeat: s.repeat,
          shuffle: s.shuffle,
          eqPreset: s.eqPreset,
          eqGains: s.eqGains,
        };
      },
      control(action, args) {
        const st = usePlayerStore.getState();
        const num0 = typeof args[0] === "number" ? (args[0] as number) : Number(args[0]);
        const str0 = typeof args[0] === "string" ? (args[0] as string) : String(args[0] ?? "");
        switch (action) {
          case "next": void st.next(); break;
          case "prev": void st.prev(); break;
          case "play_pause": void st.toggle(); break;
          case "stop": st.pause(); break;
          case "toggle_mono": st.setMono(!st.mono); break;
          case "set_volume": if (Number.isFinite(num0)) st.setVolume(num0); break;
          case "set_speed": if (Number.isFinite(num0)) st.setSpeed(num0); break;
          case "seek": if (Number.isFinite(num0)) st.seek(num0); break;
          case "set_eq_preset": st.applyPreset(str0); break;
          case "set_eq_band": {
            const band = Math.floor(num0);
            const gain = Number(args[1]);
            if (band >= 0 && band < st.eqGains.length && Number.isFinite(gain)) {
              const gains = [...st.eqGains];
              gains[band] = gain;
              st.setEqGains(gains);
            }
            break;
          }
        }
      },
    });

    // Subscribe to host messages + logs.
    luaHost.onMessage((m: Message) => set({ status: m.text }));
    luaHost.onLog((m: Message) => {
      const line = `[${timeStamp(m.at)}] ${m.text}`;
      set((s) => ({ logs: [...s.logs.slice(-79), line] }));
    });

    // Load the bundled plugins.
    for (const p of BUNDLED_PLUGINS) luaHost.load(p.source);
    set({ plugins: luaHost.listPlugins() });

    // Dispatch app.start now that plugins are loaded and the player is booted.
    luaHost.dispatch("app.start");

    // Track + state changes -> events.
    const st0 = usePlayerStore.getState();
    lastTrackPath = st0.track?.path ?? null;
    lastState = st0.state;
    usePlayerStore.subscribe((s) => {
      if (s.track && s.track.path !== lastTrackPath) {
        lastTrackPath = s.track.path;
        luaHost.dispatch("track.change", trackToLua(s.track));
      }
      if (s.state !== lastState) {
        lastState = s.state;
        luaHost.dispatch("playback.state", toLua({ status: s.state }));
      }
    });

    // Scrobbles -> track.scrobble (new history entry or a dedupe refresh).
    let h = useHistoryStore.getState();
    let histCount = h.entries.length;
    let histTop = h.entries[0]?.path ?? null;
    let histTopAt = h.entries[0]?.playedAt ?? 0;
    useHistoryStore.subscribe((hh) => {
      const top = hh.entries[0];
      if (hh.entries.length !== histCount || top?.path !== histTop || (top && top.playedAt !== histTopAt)) {
        histCount = hh.entries.length;
        histTop = top?.path ?? null;
        histTopAt = top?.playedAt ?? 0;
        luaHost.dispatch("track.scrobble");
      }
    });

    set({ ready: true });
  },

  toggle(name) {
    const cur = get().plugins.find((p) => p.name === name);
    if (!cur) return;
    luaHost.setEnabled(name, !cur.enabled);
    set({ plugins: luaHost.listPlugins() });
  },
}));
