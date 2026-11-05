# Feature parity audit: cliamp v2.4.0

Audited November 5, 2026, after the v0.2.0 web update. The browser app is a
separate TypeScript implementation. It does **not** have complete feature or
behavioral parity with cliamp. The original README overstated its coverage.

## Reference and method

- Native reference: [bjarneo/cliamp v2.4.0](https://github.com/bjarneo/cliamp/releases/tag/v2.4.0),
  commit `a8386f83cf0d3a0c71cda7b3cf1288eea1e3aaef`. This was the latest
  non-prerelease returned by GitHub's releases API on the audit date.
- Original browser checkout: `6a954b9`; initial implementation `b6e4a5d`,
  September 30, 2026. The old port did not record an exact native source SHA.
  Its README's `keylimesoda/cliamp` link returned 404 during this audit.
- Compared the tagged native source, documentation and provider test fixtures
  against actual browser code, UI wiring and tests. The historical JSON reports
  in `docs/recon/` describe the original investigation, not verified coverage.
- Runtime evidence: 86 automated unit/regression tests, TypeScript checking,
  production build, and Chromium fixture tests at 804×638 CSS pixels, touch
  enabled, DPR 1.96. Browser tests ran inside an isolated omabox box
  (Omarchy 4.5.0-3, virtual desktop 1024×768, no shell); fictional stations,
  synthetic WAVs and fictional credentials only.
- Real Tesla hardware, audible output, background-tab survival, live provider
  accounts, OAuth, production CORS and install/offline behavior were **not**
  validated. No numerical parity percentage is assigned: counting a method
  stub and a working source as equivalent would be misleading.

Fixture captures: [YinYang](screenshots/v2.4.0/yinyang-804x638.png) and
[Ethereal](screenshots/v2.4.0/ethereal-804x638.png). These show the browser at
the tested touch viewport and contain no personal data.

**Status:** Implemented = behavior exists with the evidence specified;
Partial = usable subset or a semantic difference; Missing = absent;
Broken = concrete source/fixture mismatch; Native = requires a browser
adaptation or companion service, rather than copying the native implementation.
An implemented client does not imply its real server has been tested.

## Changes included in the update

| Native change | Browser disposition and evidence |
| --- | --- |
| YinYang visualizer | Added a Braille/canvas adaptation of the koi, lily pad, lotus, onset reactions, circular and wide-strip paths. Uses simplified path pacing and rendering; not pixel-identical to native sextants. Grid/resize/pause tests and browser capture. |
| Ethereal visualizer | Added drifting value-noise clouds and reactive stars using the shared palette. Browser capture and grid/resize/pause tests; star layout is deterministic but not identical to Go's RNG. |
| Previous EQ preset | Added a touch button; forward/backward wrap across built-in presets. Browser test. Native's saved Custom slot remains a gap. |
| Playlist reversal | Added model operation and touch button. Preserves current track and queued identities; shuffle retains its active play order. Unit and browser tests. No saved-playlist persistence. |
| Navidrome ratings | Reads `userRating`; current-track selector sets 0–5 via `setRating`, with server acceptance, error handling and config-change guards. Unit wire fixtures plus browser accepted/rejected requests. Native can rate a selected nonplaying track too; the browser cannot yet. |
| Plex album year | Uses `parentYear` when a track has no year; also corrected artist/album keys and library sections. Native-shaped fixture tests. |
| Repeated LRC timestamps | Expands every cue and sorts it, with corrected milliseconds, BOM and long-minute handling. Regression tests. |
| cliamp radio listener counts | Sums live and song-playlist audiences, refreshes every five minutes, tolerates unavailable stats. Fixture tests. Counts do not optimistically add this listener. |
| cliamp channel song playlists | Loads `tracks_url` for channels exposing songs; live-only channels still play as streams. Song lists support normal transport and seeking. Browser three-track playback test. |
| Plugin cover metadata / relative seek | Adds `album_art_url` to track-change payload and track accessor; seek control now applies a relative offset. Other native event schemas remain incomplete. |
| MP4 audio support | No extension gate exists in this app: URLs use the browser decoder. No native FFmpeg support or codec guarantee is added; no MP4 playback test was performed. |
| Telegram, Bandcamp purchases, related-track discovery, new plugin panes/images/selectors, private-address allow lists and remote-call options | Not implemented. See source/plugin/integration tables below. |

The update also fixes port-specific defects: root-relative worklet loading on
GitHub Pages, silent non-CORS fallback, stale source/preload completions,
natural-end advancement without a preload, repeated queued gapless targets,
queue indices after deletion, prepended-track order, empty shuffled lists,
stale queue undo, and visualizer text positioning. It migrates the old numeric
None selection, keeps error text visible in the touch viewport, fixes the
Subsonic response envelope/nested lists, and updates the test/build dependencies.

## Playback and audio

Native references: [audio quality](https://github.com/bjarneo/cliamp/blob/v2.4.0/docs/audio-quality.md),
[keybindings](https://github.com/bjarneo/cliamp/blob/v2.4.0/docs/keybindings.md),
[`player/`](https://github.com/bjarneo/cliamp/tree/v2.4.0/player).
Browser evidence: `src/core/audio/engine.ts`, `wsola.test.ts`,
`engine.test.ts`, `src/store/player.test.ts`, `tests/browser-smoke.mjs`.

| Feature | Status | Finding |
| --- | --- | --- |
| Play/pause, previous/next, finite seeking, volume | Implemented | Touch controls and MediaSession adapter; native media playback/automatic progression tested with fixture WAVs. |
| Stop/reset | Missing | No Stop control; Lua `stop` currently maps to pause. |
| Automatic next / repeat / shuffle | Partial | Playlist logic tested; natural end and three-track progression verified. Most browsers open server tracks as detached single tracks, so an album click does not establish a navigable album playlist. |
| Race-safe manual selection and preload changes | Implemented | Resolver/load/preload generations and aborts; unit tests cover late replies and pause during resolution. |
| Ten-band parametric EQ and built-in curves | Partial | Frequencies, Q, gains and presets ported. UI band boxes only display gains; there are no individual gain controls or saved Custom curve. Non-CORS playback bypasses DSP entirely. |
| Playback speed 0.25–2× / pitch preservation | Partial | WSOLA algorithm and store setter exist. No speed control is exposed in the touch UI. Source time/end events still run on the media element/buffer's clock; non-1× timeline, overflow/drain and track-boundary correctness need end-to-end work. Unit DSP tests do not establish native timing parity. |
| Mono output | Partial | Web Audio downmix/upmix and touch toggle exist; actual L/R output not measured. Non-CORS fallback cannot apply mono. |
| Gapless playback | Partial | Best-effort fetch/decode bridge; no sample-accurate or audibly gapless guarantee. Limited to known durations ≤10 minutes and encoded downloads ≤32 MiB to bound car memory. Deferred/late preloads tested. Decoder delay/padding trimming and native preload scheduling are not ported. |
| Native formats / FFmpeg / HLS / ICY demux | Native | Playback depends on the browser codec/media stack. No FFmpeg, HLS adapter, ICY title stripping or chained OGG parser. A directly playable URL may work, but native format coverage is not established. |
| Output device, sample rate, buffers, resampler quality | Native | No device selector or native tuning; Web Audio/browser owns output. |
| Streaming title/now-playing metadata | Missing | Fields exist, but no ICY/provider metadata polling populates them. |
| Resume | Partial | One finite track/position and settings in localStorage, with a periodic snapshot. Playlist/queue are lost on reload; no per-episode/book progress or cross-device state. |
| Error recovery / skip unplayable / network timeout | Partial | Errors surfaced; non-CORS retry works. No comprehensive retry/backoff, stalled-stream timeout, dead-track skipping or native diagnostic pipeline. |

## Sources and provider behavior

Native inventory: [README](https://github.com/bjarneo/cliamp/blob/v2.4.0/README.md),
[`external/`](https://github.com/bjarneo/cliamp/tree/v2.4.0/external),
[`internal/subsonicapi/`](https://github.com/bjarneo/cliamp/tree/v2.4.0/internal/subsonicapi),
[`internal/embyapi/`](https://github.com/bjarneo/cliamp/tree/v2.4.0/internal/embyapi).
Browser evidence: `src/providers/`, `src/components/*Browser.tsx`,
`src/components/ServersScreen.tsx`, `src/providers/providers.test.ts`.

| Source/feature | Status | Finding |
| --- | --- | --- |
| cliamp radio channels / song playlists | Implemented | Live/song paths and stats exist. Fixture-tested; live API CORS and production stations not revalidated. |
| Radio Browser country/tag/name search and ordering | Partial | Country pins, tags, searches and five ordering options exist. Fixed directory hostname, no failover/paging; tags UI truncates at 300. No region browse or consent-based nearby-country suggestion. |
| Radio favorites | Partial | Persists only URLs and row stars. No dedicated favorites list retaining station metadata; favorite stations must be found again. |
| Custom stations / direct URL / M3U / PLS | Missing | Engine accepts URLs internally but there is no URL/add-station form, playlist parser/import/export or native saved-station format. |
| Podcast chart/search/categories/RSS/subscriptions | Partial | Apple chart/search, 19 categories and RSS enclosures; saved subscriptions. Chart country fixed to US. Search is per keystroke, not submit-only. Direct feed-URL input and Atom episode extraction are absent. CORS can block publisher feeds. |
| Podcast progress / played state / latest from subscriptions | Missing | No GUID-based progress map, five-second rewind, played markers, enqueue-latest or batch subscription actions. RSS duration parser also lacks common `HH:MM:SS` values. |
| Local files/folders / tags / embedded lyrics | Missing | “Local” means history/favorites only. No File API picker, directory import, file tags or embedded lyrics. User-mediated file import is feasible in a static app. |
| Navidrome artists/albums/search | Partial | Real Subsonic envelope/nesting corrected; fixture-tested. No real authenticated server test. No UI pagination/sort chooser, saved-playlist browse, server favorite sync, playback reporting, provider lyrics or transcoding preferences. |
| Navidrome ratings | Partial | Current-track rating works against fixture requests; selected nonplaying tracks and library-wide cached rating refresh are not implemented. |
| Plex | Partial | Token client, section browse, basic search and finite stream URLs exist; corrected metadata tested. Token setup is inaccessible in the form; saved playlists/pagination/reporting omitted. Real server unverified. |
| Jellyfin / Emby | Broken | Client exists, but login expects `SessionToken`; native fixture/API response contains `AccessToken`. Query keys use `Recursive.True` and `Album` rather than native `Recursive` / `MusicAlbum`; server routes/auth/cache behavior need a real contract pass. No playback reports or server resume. |
| Audiobookshelf | Broken | Login helper is not wired into setup and expects `access_token` instead of native nested `user.token` / `accessToken`. Library client expects a top-level array, whereas native fixtures use `{libraries:[...]}`. Generic browser passes an item ID to the library-items endpoint. No multi-file sessions/progress. |
| Lyrion/LMS | Broken | Sends a command string in `slim.request` instead of the command token array; reads `artists`/`albums`/`tracks` instead of `*_loop`. Generic browser requires credentials although URL-only is valid. Authenticated media URLs and plugin-track filtering need adaptation. |
| Server setup | Partial | URL/user/password persist. No token input despite token-dependent clients, connection test, edit/remove flow once configured, auth refresh policy or config import/export. |
| Spotify | Missing / Native | No Spotify client, sign-in, librespot playback or related-track discovery. Needs a separate browser-compatible playback/auth design or companion. |
| YouTube / YouTube Music / Bilibili / Xiaoyuzhou | Missing / Native | No search, extractor, cookies or playback adapter. Existing direct-audio URLs are not equivalent to these providers. |
| SoundCloud / Mixcloud / NetEase / Yandex Music | Missing / Native | No account/catalog/resolver integration. Native uses API/cookies and/or yt-dlp not present here. |
| Qobuz / Tidal | Missing / Native | No client, sign-in or playback integration. Browser auth/CORS/streaming support must be designed, not inferred impossible merely because OAuth is involved. |
| Bandcamp purchases / Telegram | Missing / Native | v2.4 additions have no browser counterparts; purchased library/auth/download/session handling absent. |
| SSH sources, downloads, native credentials/proxy tools | Native | No SSH, filesystem downloading, system credentials or native network configuration. |

The broken server findings are source/contract findings, not claims that those
servers were exercised. For example, compare native
[`internal/embyapi/client_test.go`](https://github.com/bjarneo/cliamp/blob/v2.4.0/internal/embyapi/client_test.go),
[`external/audiobookshelf/client_test.go`](https://github.com/bjarneo/cliamp/blob/v2.4.0/external/audiobookshelf/client_test.go)
and [`external/lyrion/client_test.go`](https://github.com/bjarneo/cliamp/blob/v2.4.0/external/lyrion/client_test.go)
with the named browser clients. These should be corrected and fixture-tested
before advertising working parity.

## Library, interface, appearance and lyrics

Native references: [playlists](https://github.com/bjarneo/cliamp/blob/v2.4.0/docs/playlists.md),
[podcasts](https://github.com/bjarneo/cliamp/blob/v2.4.0/docs/podcasts.md),
[radio](https://github.com/bjarneo/cliamp/blob/v2.4.0/docs/radio.md),
[`lyrics/lyrics.go`](https://github.com/bjarneo/cliamp/blob/v2.4.0/lyrics/lyrics.go).

| Feature | Status | Finding |
| --- | --- | --- |
| Playlist model, repeat/shuffle/reverse, queue precedence | Implemented | Pure model covered by tests, including identity preservation and queue remapping. Native list persistence is separate and absent. |
| Queue add/remove/reorder/clear/undo UI | Missing | Model methods/store toggle exist; no visible queue controls or manager use them. A model method is not a user feature. |
| Saved playlists / create / rename / sort / multi-select / search | Missing | No saved-playlist store/manager, playlist search or normal remove/reorder/undo controls. Reversal is exposed. |
| History | Partial | 200 entries; browser records at 50% and deduplicates only consecutive repeats within five minutes. Native records at track start and deduplicates by path globally. Live/unknown-duration tracks are excluded here; decoded duration is not propagated into stored track metadata. |
| Track favorites | Partial | localStorage list and playable rows; no Navidrome/Spotify favorite synchronization. Distinct from the separate radio URL list. |
| Built-in visualizer names | Implemented | All 34 native names plus None in native order; registry and rendering tests. Numeric preferences migrate to names. |
| Visualizer fidelity / analysis | Partial | Character-grid adaptations, not verified pixel/algorithm parity. Stereo meters simulate L/R from a mono tap; FFT uses ten bands even for modes whose native drivers request more. YinYang uses Braille and simplified path motion. |
| Visualizer picker / fullscreen / low power | Missing | Tap-to-cycle only. No direct picker, fullscreen visualizer, low-power preference or background playback guarantee. |
| Bundled themes | Implemented | All 22 vendored TOMLs match tagged native theme files byte-for-byte. Runtime selection/persistence. No user theme import/picker/preview. |
| LRCLIB and synced LRC | Partial | Lookup, repeated timestamps, millisecond precision, sorting and auto-scroll exist. No embedded/sidecar loader, NetEase/provider fallback, retry control, timing-offset control or native query cleaning. |
| Metadata/cover/info screens | Partial | Title, artist, time and MediaSession artwork fields; no full metadata screen, album headers or in-app cover pane. |
| Touch interface | Partial | Primary transport/settings controls and fixture viewport verified. Several stars/pins are still small nested span targets; EQ boxes are inert and the thin meter's enlarged pseudo-element is clipped by its container. This is not a full accessibility/touch audit. |
| Keyboard navigation/help | Missing | No equivalent command keymap, global hotkeys or full keyboard-operable replacement for span buttons. Intentional touch focus does not make this parity. |

Browser source evidence: `src/core/playlist.ts`, `src/store/history.ts`,
`src/store/favorites.ts`, `src/store/radioPrefs.ts`, `src/components/NowPlaying.tsx`,
`src/components/DragMeter.tsx`, `src/viz/registry.ts`, `src/viz/impl/stereo.ts`,
`src/themes/`, `src/core/lyrics.ts`, `src/components/LyricsOverlay.tsx`.

## Plugins and platform integration

Native references: [plugin API](https://github.com/bjarneo/cliamp/blob/v2.4.0/docs/plugins.md),
[remote control](https://github.com/bjarneo/cliamp/blob/v2.4.0/docs/remote-control.md),
[headless mode](https://github.com/bjarneo/cliamp/blob/v2.4.0/docs/headless.md).
Browser evidence: `src/lua/host.ts`, `src/lua/vm.ts`, `src/store/plugins.ts`,
`src/components/PluginsScreen.tsx`, `src/core/audio/mediasession.ts`, `public/sw.js`.

| Feature | Status | Finding |
| --- | --- | --- |
| Bundled hook scripts / interpreter | Partial | Four scripts load; VM syntax tests and plugin UI/logging exist. One shared synchronous VM, not native per-plugin isolated Lua execution. No complete Lua compatibility suite. |
| Events and payloads | Partial | Four event names dispatched. `track.change` uses web field names and can fire before playback succeeds; no complete native payload or scrobble-on-leave semantics. `track.scrobble` is inferred from history changes and carries no payload. Other documented native events are missing. |
| Player/track API | Partial | Most basic readers/control names exist; artwork and relative seek added. Native shuffle returns boolean, web returns a string; repeat casing and EQ-band indexing differ. `stop` pauses. No complete native custom-EQ API. |
| Queue API / custom visualizer hooks | Missing | No `cliamp.queue` host table or custom visualizer registration/render lifecycle. |
| HTTP / timers / sleep / pub-sub / commands | Partial | HTTP fires fetch without returning responses; sleep/timer are inert; publish only logs; commands/bindings are stored but never invoked. These are stubs/adaptations, not native compatibility. |
| FS / store / notifications | Partial | localStorage and in-app messages replace files/notifications. No native path rules; message duration is ignored; plugin toggle choices do not persist. |
| v2.4 image/layout/ui/vis APIs | Missing | No panes, image/text blocks, selectors or selector events. |
| Plugin management and trust/runtime limits | Missing | No source import/install/remove/trust UI or content approvals. Shared VM has no execution budget/worker isolation; control gating does not cover top-level calls without an active plugin. Arbitrary native plugins should not be advertised as compatible or sandboxed. |
| Native shell execution / filesystem / IPC / daemon | Native | No shell, native filesystem, Unix socket/V2 jobs, remote CLI or background daemon. A companion would be a separate architectural choice. |
| MediaSession | Partial | Basic metadata/control adapter is implemented. No native MPRIS/Now Playing parity claim; real Tesla steering-wheel/system behavior untested. |
| Static PWA | Partial | Install manifest, versioned app-shell worker, relative assets/worklet. Media/APIs are network-only. No offline media or offline regression test, and no guarantee of persistence/installation on Tesla. |

## Recommended follow-up order

1. **Repair provider contracts and setup.** Add token input/editing, verify
   Jellyfin/Emby auth and routes, replace ABS/LMS contract guesses, and add
   native-shaped fixtures plus optional live-server tests. This closes features
   already visible in the UI but currently broken.
2. **Make playback/library controls complete.** Load albums/search results as
   playlists, expose queue editing, stop, speed and custom EQ; add saved
   playlists and URL/file import. Measure non-1× timing and track transitions.
3. **Restore useful state.** Per-episode/book progress, proper history semantics,
   durable playlist/queue resume, radio favorites with metadata, provider
   favorites/reporting, and subscription batch actions.
4. **Treat plugin parity as its own project.** Isolate/bound execution first;
   specify the supported native API/events, then implement HTTP/timers, queue
   APIs, import/configuration and custom visualizers. Keep unsupported APIs
   explicit rather than silently stubbing them.
5. **Then decide on a companion.** OAuth/stream extraction/native codec coverage
   and account providers need source-specific design. A static-client-only
   update cannot be described as having all native sources.

The first four groups contain substantial browser-feasible work; they should
not be dismissed as intrinsic browser limitations. Actual Tesla testing should
follow the isolated fixture checks, especially for activation, long sessions,
backgrounding, audio continuity and control target sizes.

## Reproducing this audit's checks

```sh
npm ci
npm test
npm run build
npm audit
node tests/preview-server.mjs # serves fixture media on 4173/4174; leave running
```

In another terminal, from the checkout:

```sh
omabox up --new --size 1024x768 --net isolated --allow 4173,4174 --no-shell
# Use the box name printed above in place of NAME:
omabox -b NAME run -- node "$PWD/tests/browser-smoke.mjs"
omabox -b NAME down
```

The browser suite needs Chromium (`CHROMIUM_PATH` may override
`/usr/bin/chromium`) and uses `@playwright/test`; no downloaded browser is
required. It saves fictional-data captures in the box HOME. The source uses
muted audio, so passing proves media progression/state, not audible output.
The fixture server must only be used for testing and stopped afterward.
