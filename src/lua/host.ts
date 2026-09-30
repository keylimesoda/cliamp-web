/**
 * Lua plugin host — runs bundled + user plugins against the player.
 *
 * The host owns a single VM and installs the `plugin`, `cliamp`, and `utf8`
 * globals that cliamp plugins are written against. It is deliberately
 * framework-agnostic: the player is reached through a `PlayerBridge` that the
 * React layer installs (see store/plugins.ts), so there is no import cycle.
 *
 * Web adaptations (documented in docs/lua-plugins.md):
 *   - cliamp.fs.* maps to localStorage (no real filesystem in a PWA).
 *   - cliamp.exec is unsupported (no shell) — returns an error, does not throw.
 *   - cliamp.sleep is a no-op (the interpreter is synchronous; there is no
 *     thread to block). Timers via cliamp.timer are unsupported for the same
 *     reason.
 *   - cliamp.bind/unbind (keymap) are stored but inert (no keyboard in car).
 */
import { VM, LuaTable, LuaFunction, LuaError, type Value } from "./vm";
import { parse } from "./parser";
import { md5Hex } from "../core/md5";

export interface TrackInfo {
  title: string;
  artist: string;
  album: string;
  genre: string;
  path: string;
  year: number;
  trackNumber: number;
  durationSecs: number;
  isStream: boolean;
  isLive: boolean;
}

export interface PlayerSnapshot {
  track: TrackInfo | null;
  state: string; // "stopped" | "playing" | "paused" | "buffering" | "seeking"
  position: number;
  duration: number;
  volumeDb: number;
  speed: number;
  mono: boolean;
  repeat: string; // "off" | "all" | "one"
  shuffle: string; // "off" | "on"
  eqPreset: string;
  eqGains: number[];
}

/** The bridge the React layer installs to connect the host to the player. */
export interface PlayerBridge {
  snapshot(): PlayerSnapshot;
  /** Control actions (gated on the caller plugin's "control" permission). */
  control(action: string, args: unknown[]): void;
}

export interface PluginMeta {
  name: string;
  type: string; // "hook" | "visualizer"
  version?: string;
  description?: string;
  permissions?: string[];
}

export interface Message { text: string; level: "info" | "warn" | "error" | "notify"; at: number; }

type Handler = Value; // a LuaFunction

interface PluginRecord {
  meta: PluginMeta;
  enabled: boolean;
  table: LuaTable;
  handlers: Map<string, Handler[]>;
  config: Record<string, Value>;
  commands: Map<string, Handler>;
  bindings: Map<string, Handler>;
}

// ---- JS <-> Lua value conversion --------------------------------------
function jsToLua(v: unknown): Value {
  if (v === null || v === undefined) return null;
  if (typeof v === "boolean" || typeof v === "number" || typeof v === "string") return v;
  if (Array.isArray(v)) {
    const t = new LuaTable();
    v.forEach((x, i) => t.set(i + 1, jsToLua(x)));
    return t;
  }
  if (typeof v === "object") {
    const t = new LuaTable();
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) t.set(k, jsToLua(val));
    return t;
  }
  return String(v);
}

/** Public conversion: JS/TS value -> Lua value (for event payloads). */
export function toLua(v: unknown): Value { return jsToLua(v); }
function luaToStr(v: Value | undefined): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  return "<" + (v instanceof LuaTable ? "table" : "value") + ">";
}
function luaKeyStr(k: Value): string {
  if (typeof k === "number") return String(k);
  return luaToStr(k);
}
// Convert a Lua value to a JS value (for JSON bodies / payloads).
function luaTableToJs(v: Value): unknown {
  if (v === null || v === undefined) return null;
  if (typeof v === "boolean" || typeof v === "number" || typeof v === "string") return v;
  if (!(v instanceof LuaTable)) return null;
  if (v.arr.length && Object.keys(v.hash).length === 0) return v.arr.map((x) => luaTableToJs(x));
  const out: Record<string, unknown> = {};
  for (const k of v.keys()) out[luaKeyStr(k)] = luaTableToJs(v.get(k));
  return out;
}

// localStorage-backed "filesystem" for cliamp.fs.*
const FS_PREFIX = "cliamp-web:fs:";
function fsRead(path: string): string | null {
  try { return localStorage.getItem(FS_PREFIX + path); } catch { return null; }
}
function fsWrite(path: string, text: string): void {
  try { localStorage.setItem(FS_PREFIX + path, text); } catch { /* quota */ }
}
function fsRemove(path: string): void {
  try { localStorage.removeItem(FS_PREFIX + path); } catch { /* ignore */ }
}
// Per-plugin config, persisted.
const CFG_PREFIX = "cliamp-web:plugin-cfg:";
function readConfig(name: string): Record<string, Value> {
  try {
    const raw = localStorage.getItem(CFG_PREFIX + name);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, Value>;
  } catch { return {}; }
}
function writeConfig(name: string, cfg: Record<string, Value>): void {
  try { localStorage.setItem(CFG_PREFIX + name, JSON.stringify(cfg)); } catch { /* ignore */ }
}
void writeConfig; // config setter reserved for a future settings UI

export class LuaHost {
  private vm = new VM();
  private records: PluginRecord[] = [];
  private bridge: PlayerBridge | null = null;
  private messageSubs = new Set<(m: Message) => void>();
  private logSubs = new Set<(m: Message) => void>();
  /** Tracks which plugin is currently executing (for permission checks). */
  activePlugin: PluginRecord | null = null;
  constructor() { this.install(); }

  setBridge(bridge: PlayerBridge): void { this.bridge = bridge; }

  onMessage(cb: (m: Message) => void): () => void {
    this.messageSubs.add(cb);
    return () => { this.messageSubs.delete(cb); };
  }
  onLog(cb: (m: Message) => void): () => void {
    this.logSubs.add(cb);
    return () => { this.logSubs.delete(cb); };
  }
  private emitMessage(text: string, level: Message["level"]): void {
    const m: Message = { text, level, at: Date.now() };
    this.messageSubs.forEach((cb) => cb(m));
  }
  private emitLog(text: string, level: Message["level"]): void {
    const m: Message = { text, level, at: Date.now() };
    this.logSubs.forEach((cb) => cb(m));
  }

  listPlugins(): { name: string; meta: PluginMeta; enabled: boolean }[] {
    return this.records.map((r) => ({ name: r.meta.name, meta: r.meta, enabled: r.enabled }));
  }

  setEnabled(name: string, enabled: boolean): void {
    const r = this.records.find((x) => x.meta.name === name);
    if (r) r.enabled = enabled;
  }

  /** Parse + run a plugin source. Returns all registered plugin names. */
  load(src: string): string[] {
    try {
      this.vm.run(parse(src));
    } catch (e) {
      this.emitLog("plugin load failed: " + (e instanceof Error ? e.message : String(e)), "error");
    }
    return this.records.map((r) => r.meta.name);
  }

  /** Dispatch an event to all enabled plugins' handlers. */
  dispatch(event: string, payload?: Value): void {
    const table = payload ?? null;
    for (const r of this.records) {
      if (!r.enabled) continue;
      const list = r.handlers.get(event);
      if (!list) continue;
      for (const h of list) {
        if (!(h instanceof LuaFunction)) continue;
        this.activePlugin = r;
        try { h.call(null, table === null ? [] : [table], this.vm); }
        catch (e) { this.emitLog(`[${r.meta.name}] ${event}: ` + (e instanceof Error ? e.message : String(e)), "error"); }
      }
    }
    this.activePlugin = null;
  }

  // ---- global installation -------------------------------------------
  private install(): void {
    this.vm.setGlobal("utf8", this.buildUtf8());
    this.vm.setGlobal("plugin", this.buildPlugin());
    this.vm.setGlobal("cliamp", this.buildCliamp());
  }

  private buildUtf8(): LuaTable {
    const t = new LuaTable();
    t.set("encode", new LuaFunction((_, a) => [luaToStr(a[0])]));
    t.set("decode", new LuaFunction((_, a) => {
      const v = a[0];
      if (typeof v === "number") return [String.fromCharCode(v)];
      return [luaToStr(v)];
    }));
    return t;
  }

  private buildPlugin(): LuaTable {
    const self = this;
    const plugin = new LuaTable();
    plugin.set("register", new LuaFunction((_, a) => {
      const metaTable = a[0];
      if (!(metaTable instanceof LuaTable)) throw new LuaError("plugin.register: expected a table");
      const version = metaTable.get("version");
      const description = metaTable.get("description");
      const perms = metaTable.get("permissions");
      const meta: PluginMeta = {
        name: luaToStr(metaTable.get("name")) || "unnamed",
        type: luaToStr(metaTable.get("type")) || "hook",
        version: version === null ? undefined : luaToStr(version),
        description: description === null ? undefined : luaToStr(description),
        permissions: perms instanceof LuaTable ? perms.arr.map((x) => luaToStr(x)) : undefined,
      };
      const rec: PluginRecord = {
        meta,
        enabled: true,
        table: new LuaTable(),
        handlers: new Map(),
        config: readConfig(meta.name),
        commands: new Map(),
        bindings: new Map(),
      };
      for (const k of metaTable.keys()) rec.table.set(k, metaTable.get(k));

      rec.table.set("on", new LuaFunction((_, args) => {
        const ev = luaToStr(args[0]);
        const cb = args[1];
        if (!(cb instanceof LuaFunction)) throw new LuaError("p:on: handler must be a function");
        const list = rec.handlers.get(ev) ?? [];
        list.push(cb);
        rec.handlers.set(ev, list);
        return [];
      }));
      rec.table.set("config", new LuaFunction((_, args) => {
        const key = luaToStr(args[0]);
        return [rec.config[key] ?? null];
      }));
      rec.table.set("publish", new LuaFunction((_, args) => {
        self.emitLog(`[${meta.name}] publish ${luaToStr(args[0])}`, "info");
        return [];
      }));
      rec.table.set("bind", new LuaFunction((_, args) => {
        // p:bind(key, cb) or p:bind(key, description, cb)
        const key = luaToStr(args[0]);
        const cb = args[args.length - 1];
        if (cb instanceof LuaFunction) rec.bindings.set(key, cb);
        return [];
      }));
      rec.table.set("unbind", new LuaFunction((_, args) => {
        rec.bindings.delete(luaToStr(args[0]));
        return [];
      }));
      rec.table.set("command", new LuaFunction((_, args) => {
        const name = luaToStr(args[0]);
        const cb = args[1];
        if (cb instanceof LuaFunction) rec.commands.set(name, cb);
        return [];
      }));

      self.records.push(rec);
      self.emitLog(`loaded plugin ${meta.name}`, "info");
      return [rec.table];
    }));
    return plugin;
  }

  private hasControl(rec: PluginRecord): boolean {
    return rec.meta.permissions?.includes("control") === true;
  }

  private buildCliamp(): LuaTable {
    const self = this;
    const c = new LuaTable();

    const snap = (): PlayerSnapshot => self.bridge?.snapshot() ?? {
      track: null, state: "stopped", position: 0, duration: 0, volumeDb: 0, speed: 1,
      mono: false, repeat: "off", shuffle: "off", eqPreset: "Flat", eqGains: new Array(10).fill(0),
    };

    // cliamp.player — read + control (control gated on permission).
    const player = new LuaTable();
    player.set("state", new LuaFunction(() => [snap().state]));
    player.set("position", new LuaFunction(() => [snap().position]));
    player.set("duration", new LuaFunction(() => [snap().duration]));
    player.set("volume", new LuaFunction(() => [snap().volumeDb]));
    player.set("speed", new LuaFunction(() => [snap().speed]));
    player.set("mono", new LuaFunction(() => [snap().mono]));
    player.set("repeat_mode", new LuaFunction(() => [snap().repeat]));
    player.set("shuffle", new LuaFunction(() => [snap().shuffle]));
    player.set("eq_preset", new LuaFunction(() => [snap().eqPreset]));
    player.set("eq_bands", new LuaFunction(() => [jsToLua(snap().eqGains)]));
    const control = (action: string) => new LuaFunction((_, args) => {
      const rec = self.activePlugin;
      if (rec && !self.hasControl(rec)) { self.emitLog(`[${rec.meta.name}] control denied (no "control" permission)`, "warn"); return []; }
      self.bridge?.control(action, args.map((x) => luaTableToJs(x)));
      return [];
    });
    player.set("next", control("next"));
    player.set("prev", control("prev"));
    player.set("play_pause", control("play_pause"));
    player.set("stop", control("stop"));
    player.set("toggle_mono", control("toggle_mono"));
    player.set("set_volume", control("set_volume"));
    player.set("set_speed", control("set_speed"));
    player.set("seek", control("seek"));
    player.set("set_eq_preset", control("set_eq_preset"));
    player.set("set_eq_band", control("set_eq_band"));
    c.set("player", player);

    // cliamp.track — read the current track's fields.
    const track = new LuaTable();
    const trackField = (f: keyof TrackInfo) => new LuaFunction(() => {
      const t = snap().track;
      if (!t) return [null];
      return [jsToLua(t[f])];
    });
    track.set("title", trackField("title"));
    track.set("artist", trackField("artist"));
    track.set("album", trackField("album"));
    track.set("genre", trackField("genre"));
    track.set("path", trackField("path"));
    track.set("year", trackField("year"));
    track.set("track_number", trackField("trackNumber"));
    track.set("duration_secs", trackField("durationSecs"));
    track.set("is_stream", trackField("isStream"));
    track.set("is_live", trackField("isLive"));
    c.set("track", track);

    // cliamp.fs — localStorage-backed.
    const fs = new LuaTable();
    fs.set("write", new LuaFunction((_, a) => { fsWrite(luaToStr(a[0]), luaToStr(a[1])); return []; }));
    fs.set("read", new LuaFunction((_, a) => [fsRead(luaToStr(a[0])) ?? null]));
    fs.set("remove", new LuaFunction((_, a) => { fsRemove(luaToStr(a[0])); return []; }));
    c.set("fs", fs);

    // cliamp.http — the VM is synchronous, so fetches are fired fire-and-forget;
    // (body, status) return (nil, nil). The request still completes in the background.
    const http = new LuaTable();
    http.set("post", new LuaFunction((_, a) => {
      const url = luaToStr(a[0]);
      const opts = a[1];
      const body = opts instanceof LuaTable ? luaTableToJs(opts) : null;
      void fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
        .catch((e) => self.emitLog(`http.post ${url}: ` + (e instanceof Error ? e.message : String(e)), "warn"));
      return [null, null];
    }));
    http.set("get", new LuaFunction((_, a) => {
      const url = luaToStr(a[0]);
      void fetch(url).catch((e) => self.emitLog(`http.get ${url}: ` + (e instanceof Error ? e.message : String(e)), "warn"));
      return [null, null];
    }));
    c.set("http", http);

    // cliamp.log
    const log = new LuaTable();
    const logFn = (level: Message["level"]) => new LuaFunction((_, a) => {
      const msg = luaToStr(a[0]);
      self.emitLog(msg, level);
      if (level === "error") console.error("[lua]", msg);
      else if (level === "warn") console.warn("[lua]", msg);
      else console.log("[lua]", msg);
      return [];
    });
    log.set("debug", logFn("info"));
    log.set("info", logFn("info"));
    log.set("warn", logFn("warn"));
    log.set("error", logFn("error"));
    c.set("log", log);

    // cliamp.message(text, duration?) — transient UI message.
    c.set("message", new LuaFunction((_, a) => { self.emitMessage(luaToStr(a[0]), "info"); return []; }));
    // cliamp.notify(title, artist?) — desktop notification; on web, surfaced as a message.
    c.set("notify", new LuaFunction((_, a) => {
      const title = luaToStr(a[0]);
      const artist = a[1] === null || a[1] === undefined ? "" : luaToStr(a[1]);
      self.emitMessage(artist ? `${title} — ${artist}` : title, "notify");
      return [];
    }));

    // cliamp.json
    const json = new LuaTable();
    json.set("encode", new LuaFunction((_, a) => [JSON.stringify(luaTableToJs(a[0] ?? null))]));
    json.set("decode", new LuaFunction((_, a) => {
      try { return [jsToLua(JSON.parse(luaToStr(a[0])) as unknown)]; }
      catch { return [null]; }
    }));
    c.set("json", json);

    // cliamp.crypto
    const crypto = new LuaTable();
    crypto.set("md5", new LuaFunction((_, a) => [md5Hex(luaToStr(a[0]))]));
    c.set("crypto", crypto);

    // cliamp.store — tiny persistent kv (localStorage).
    const store = new LuaTable();
    store.set("get", new LuaFunction((_, a) => {
      try { return [jsToLua(JSON.parse(localStorage.getItem("cliamp-web:lua-store:" + luaToStr(a[0])) ?? "null") as unknown)]; }
      catch { return [null]; }
    }));
    store.set("set", new LuaFunction((_, a) => {
      try { localStorage.setItem("cliamp-web:lua-store:" + luaToStr(a[0]), JSON.stringify(luaTableToJs(a[1] ?? null))); } catch { /* ignore */ }
      return [];
    }));
    c.set("store", store);

    // cliamp.timer / cliamp.sleep — unsupported on the synchronous web VM.
    const timer = new LuaTable();
    timer.set("after", new LuaFunction(() => [null]));
    c.set("timer", timer);
    c.set("sleep", new LuaFunction(() => []));

    // cliamp.exec — unsupported (no shell). Returns an error, does not throw.
    c.set("exec", new LuaFunction((_, a) => {
      self.emitLog(`exec not supported on web: ${luaToStr(a[0])}`, "warn");
      return [null, "exec not supported on web"];
    }));

    return c;
  }
}

/** Module singleton host. */
export const luaHost = new LuaHost();
