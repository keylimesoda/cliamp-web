# Lua plugin system (web port)

cliamp plugins are Lua 5.1 scripts that hook playback events and can control
the player. This port ships a **compact, self-contained Lua 5.1 interpreter in
TypeScript** (lexer + parser + tree-walk VM under `src/lua/`) — no WASM, no
emscripten, no external runtime. The bundled plugins and the plugin API are
ported for full parity; the differences specific to a browser PWA are
documented below.

## Architecture

- `src/lua/lexer.ts` — tokenizer (numbers incl. hex/exponent, strings + escapes,
  long `[[…]]`/`[==[…]==]`, line/long comments, all operators/keywords).
- `src/lua/parser.ts` — produces an AST (statements, expressions, function
  defs with implicit `self` for `:` methods, table constructors, `for`/`while`/
  `repeat`, `…` varargs).
- `src/lua/vm.ts` — tree-walk interpreter. Values: nil→`null`, native
  boolean/number/string, tables→`LuaTable`, functions→`LuaFunction` (native
  host or closure). Closures capture the enclosing environment, so upvalues
  resolve. The `string`, `table`, and `math` standard libraries plus
  `pairs`/`ipairs`/`select`/`pcall`/`tostring`/`tonumber`/`type`/`error`/
  `setmetatable` are implemented.
- `src/lua/host.ts` — installs the `plugin`, `cliamp`, and `utf8` globals and
  manages plugin registration, event dispatch, and the message/log streams.
- `src/lua/plugins.ts` — vendors the four bundled plugins (raw text).
- `src/store/plugins.ts` — React wrapper: wires the host to the player store
  through a bridge, loads plugins, dispatches events, and exposes state to the
  UI.

## API surface (parity with cliamp)

- `plugin.register({name, type, version, description, permissions})` → `p`
- `p:on(event, cb)`, `p:config(key)`, `p:publish(topic, payload, opts?)`,
  `p:bind(key, cb|desc, cb)`, `p:unbind(key)`, `p:command(name, cb)`
- `cliamp.player` — read (`state`, `position`, `duration`, `volume`, `speed`,
  `mono`, `repeat_mode`, `shuffle`, `eq_preset`, `eq_bands`) + control
  (`next`, `prev`, `play_pause`, `stop`, `toggle_mono`, `set_volume`,
  `set_speed`, `seek`, `set_eq_preset`, `set_eq_band`). **Control requires the
  `control` permission** (enforced; a plugin without it gets a logged denial).
- `cliamp.track` — read (`title`, `artist`, `album`, `genre`, `path`, `year`,
  `track_number`, `duration_secs`, `is_stream`, `is_live`).
- `cliamp.queue`, `cliamp.http.post/get`, `cliamp.json.encode/decode`,
  `cliamp.crypto.md5`, `cliamp.store.get/set`, `cliamp.log.{debug,info,warn,
  error}`, `cliamp.message(text, dur)`, `cliamp.notify(title, artist?)`.
- Host globals `plugin`, `cliamp`, `utf8`. `prog.Send` is **not** exposed
  (matches cliamp's plugin sandbox).

### Events dispatched

`app.start`, `track.change` (track table), `playback.state` (`{status}`),
`track.scrobble`. The others cliamp defines (`player.seek`, `player.volume`,
`player.eq`, `player.mode`, `queue.change`, `queue.end`, `app.quit`) are
accepted by `p:on` but not currently fired by the web player.

## Bundled plugins

Vendored from cliamp and loaded at boot:

- **auto-eq** — switches the EQ preset by track genre (uses `control`).
- **now-playing** — writes "Artist — Title" via `cliamp.fs` and notifies on
  track change.
- **status-messages** — surfaces playback events as transient status-bar
  messages (`cliamp.message`).
- **webhook** — POSTs track info on track change (no-op unless a `url` is
  configured).

The **Plugins** screen lists them with enable/disable and a live log.

## Web adaptations (intentional differences)

- **`cliamp.exec` is unsupported** — a PWA has no shell. `cliamp.exec(cmd)`
  returns `(nil, "exec not supported on web")` and logs a warning; it does not
  throw, so plugins that probe it keep running. Any plugin that *requires*
  `exec` (none of the bundled ones do) will not function on the web.
- **`cliamp.fs.*` maps to `localStorage`** (no real filesystem). `write`/
  `read`/`remove` use keys prefixed `cliamp-web:fs:`.
- **`cliamp.http.post/get` are fire-and-forget** — the interpreter is
  synchronous, so the fetch is issued and `(nil, nil)` is returned
  immediately; the request completes in the background. (Cross-origin targets
  still need CORS.)
- **`cliamp.sleep` is a no-op** and **`cliamp.timer` is inert** — the VM is
  synchronous (no thread to block, no timer callback re-entry).
- **`cliamp.bind`/`unbind` (keymap) are stored but inert** — the car UI has no
  keyboard.
- **`cliamp.notify`** surfaces as a status message rather than a desktop
  notification (mako/notify-send don't exist in a browser).

## Verification

The interpreter is unit-tested (see `src/lua/vm.test.ts`) for closures/
upvalues, `:` method calls, all loop forms, varargs, multi-value returns,
string method calls (`s:lower()`, `s:find()`), and the `string`/`table`/`math`
libraries. The host + bundled plugins are verified in the browser: all four
bundled plugins load cleanly, playing a genre-tagged track fires
`track.change`, auto-eq switches the EQ preset to the mapped preset (Rock→Rock,
Jazz→Jazz) and logs `EQ -> <preset> (genre: <g>)`, and status-messages shows
"Now playing: <artist> — <title>" — with zero console errors.
