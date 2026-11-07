# Feature parity audit: cliamp v2.4.0

Audited November 5, 2026, after the v0.2.0 web update and Tesla feature pass. The browser app is a
separate TypeScript implementation. It does **not** have complete feature or
behavioral parity with cliamp. The original README overstated its coverage.

## Deployed Tesla branch correction

The first pass examined master and missed the deployed
`tesla-804x638-layout` branch (head `51649ac`). That branch already included
FAVS with station/episode metadata and saved podcast shows, an immersive
visualizer, Tesla-sized navigation, direct podcast playback, and RSS duration
fixes. Those existing features are preserved in this PR's integration. Favorites
and immersive mode must not be treated as new missing work.

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
- Runtime evidence: 124 automated unit/regression tests, TypeScript checking,
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
| Previous EQ preset | Named preset popup above the bands replaces blind cycling; existing cycle API still wraps across built-ins. A separate saved Custom slot survives preset changes and reloads. Unit and touch-browser tests. |
| Playlist reversal | Added model operation and touch button. Preserves current track and queued identities; shuffle retains its active play order. Unit and browser tests. |
| Playback recovery | Added bounded reconnect attempts at 1/2/4/8/16 seconds, offline wait, stall detection, cancellation on pause/new selection, and manual Retry after exhaustion. Recovery unit tests; provider outage/stall behavior has not yet been browser-fixture tested. |
| Spoken-audio progress | Added per-podcast-episode and per-Audiobookshelf-file progress, five-second rewind, first-15-second restart, played/resume labels and completion/replay behavior. Unit and podcast browser checks. Browser storage only; no cross-device sync or Audiobookshelf server progress write. |
| Queue and saved playlists | Added a Tesla-sized queue view with play-next, queue reordering/removal/clear, playlist reorder/removal/undo, create/rename/delete saved playlists, and local persistence. Model and touch browser checks cover play-next and create. Search, sort and multi-select remain absent. |
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
| Play/pause, previous/next, finite seeking, volume | Implemented | Touch controls and MediaSession adapter; native media playback/automatic progression tested with fixture WAVs. Player volume is in MORE → Playback options, with a 0 dB reset; it is omitted from main and immersive controls. |
| Stop/reset | Missing | No Stop control; Lua `stop` currently maps to pause. |
| Automatic next / repeat / shuffle | Implemented | Album/search selections from Navidrome, Audiobookshelf and podcasts now load contextual track lists. Queue precedence, album-cursor continuation, repeat-one, natural end and three-track progression are covered by model/browser tests. Other provider selections may still be detached. |
| Race-safe manual selection and preload changes | Implemented | Resolver/load/preload generations and aborts; unit tests cover late replies and pause during resolution. |
| Ten-band parametric EQ and built-in curves | Partial | Frequencies, Q, gains and presets ported. Ten touch sliders adjust −12 to +12 dB, with a named preset popup and a separate saved Custom slot. Changes and the saved curve persist locally. Non-CORS/direct playback bypasses DSP; the EQ panel identifies an unavailable source while retaining the curve. |
| Playback speed 0.25–2× / pitch preservation | Partial | Podcasts/books expose −15s/+30s and a 0.5–2× picker in main and immersive playback, with an independent persisted speech rate and 1× music/radio. Spoken transport uses native pitch-preserving media rates; processed books keep EQ with unity-rate WSOLA, avoiding real-time input starvation and doubled speed processing. Browser fixtures measure direct/processed clocks at 1.5×/2×, retain a 440 Hz tone at 2×, verify paused seeking/bounds and natural chapter/episode transitions. Native global speed parity is still partial: non-1× music/decoded-bridge WSOLA timing and drain behavior remain unverified. |
| Mono output | Partial | Web Audio downmix/upmix and touch toggle exist; actual L/R output not measured. Non-CORS fallback cannot apply mono. |
| Gapless playback | Partial | Best-effort fetch/decode bridge; no sample-accurate or audibly gapless guarantee. Limited to known durations ≤10 minutes and encoded downloads ≤32 MiB to bound car memory. Deferred/late preloads tested. Decoder delay/padding trimming and native preload scheduling are not ported. |
| Native formats / FFmpeg / HLS / ICY demux | Native | Playback depends on the browser codec/media stack. No FFmpeg, HLS adapter, ICY title stripping or chained OGG parser. A directly playable URL may work, but native format coverage is not established. |
| Output device, sample rate, buffers, resampler quality | Native | No device selector or native tuning; Web Audio/browser owns output. |
| Streaming title/now-playing metadata | Missing | Fields exist, but no ICY/provider metadata polling populates them. |
| Resume | Partial | A versioned browser-local snapshot restores the entire playlist, exact play order, album cursor, currently playing queued item, remaining queue, active track, finite position and shuffle/repeat. Queue edits save immediately; progress checkpoints every five seconds and on pause/page exit. Reload waits for Play and resolves provider identities afresh. Live stations reconnect at live position; podcasts/books retain independent progress, five-second rewind and completion rules. Old single-track bookmarks migrate; invalid snapshots are ignored. No cross-device or Audiobookshelf server sync. Unit and Tesla-sized browser checks. |
| Error recovery / skip unplayable / network timeout | Partial | Playback errors and 12-second stalls trigger bounded retries (1/2/4/8/16 seconds); offline periods wait for reconnection, and exhausted retries expose Retry. Pause and track changes cancel retries. Dead-track skipping and native diagnostic reporting remain absent; recovery has unit but not outage-fixture browser coverage. |

## Sources and provider behavior

The Servers screen exposes Navidrome, Audiobookshelf and Plex. Connect
validates authentication before saving credentials. Jellyfin, Emby and
Lyrion are hidden; their remaining source-level findings below do not imply
that they are offered as working integrations. See the
[server sign-in audit](server-auth-audit.md) for decisions and fixture evidence.

Native inventory: [README](https://github.com/bjarneo/cliamp/blob/v2.4.0/README.md),
[`external/`](https://github.com/bjarneo/cliamp/tree/v2.4.0/external),
[`internal/subsonicapi/`](https://github.com/bjarneo/cliamp/tree/v2.4.0/internal/subsonicapi),
[`internal/embyapi/`](https://github.com/bjarneo/cliamp/tree/v2.4.0/internal/embyapi).
Browser evidence: `src/providers/`, `src/components/*Browser.tsx`,
`src/components/ServersScreen.tsx`, `src/providers/providers.test.ts`.

| Source/feature | Status | Finding |
| --- | --- | --- |
| cliamp radio channels / song playlists | Implemented | Live/song paths and stats exist. Fixture-tested; live API CORS and production stations not revalidated. |
| Radio Browser country/tag/name search and ordering | Partial | Country pins, complete locally filtered tag list, station-name search and five ordering options exist. Tag filtering is case-insensitive, stays in tags on clear/no matches, and Back from tag stations restores the filter. Exact-tag requests retain Most Voted and other directory ordering (up to 200 stations). Fixture checks cover tags beyond the old 300-row cap, sort requests, navigation, errors, playback and FAVS. Fixed directory hostname, no failover/paging. No region browse or consent-based nearby-country suggestion. |
| Radio favorites | Implemented | The deployed FAVS screen already keeps saved station/episode metadata and provides direct playback. Preserved and covered by browser regression checks. |
| Station-provided advertising | Different | On MoE Lofi's Zeno stream, controlled captures show that changing only the User-Agent changes the first ~30 seconds of audio. Chromium does not accept the native player's User-Agent override from page JavaScript. See the [MoE investigation](moe-lofi-ads.md); identical station URLs do not guarantee identical ad delivery. |
| Custom stations / direct URL / M3U / PLS | Missing | Engine accepts URLs internally but there is no URL/add-station form, playlist parser/import/export or native saved-station format. |
| Podcast chart/search/categories/RSS/subscriptions | Partial | Apple chart/search, 19 categories and RSS enclosures; saved subscriptions. Chart country fixed to US. Search is per keystroke, not submit-only. Direct feed-URL input and Atom episode extraction are absent. CORS can block publisher feeds. |
| Podcast progress / played state / latest from subscriptions | Partial | GUID/enclosure-based local progress, ambiguity-safe metadata migration, five-second rewind, first-15-second restart, completion/played markers and resume labels are implemented. Native `l`/`L` latest actions are implemented in Podcasts/FAVS: single latest appends and queues after existing entries; all-show latest appends without queueing. Date-only comparison/feed-order fallback, six-worker fetch limit, subscription order, duplicates/played episodes, partial errors and no-autoplay behavior match native. Remaining subscription append-all/play/queue-all actions are absent; CORS can block publisher feeds. RSS duration parsing includes the deployed branch’s `HH:MM:SS` fix. |
| Local files/folders / tags / embedded lyrics | Missing | “Local” means history/favorites only. No File API picker, directory import, file tags or embedded lyrics. User-mediated file import is feasible in a static app. |
| Navidrome artists/albums/search | Partial | Real Subsonic envelope/nesting corrected; fixture-tested. No real authenticated server test. No UI pagination/sort chooser, saved-playlist browse, server favorite sync, playback reporting, provider lyrics or transcoding preferences. |
| Navidrome ratings | Partial | Current-track rating works against fixture requests; selected nonplaying tracks and library-wide cached rating refresh are not implemented. |
| Plex | Partial | Phone-code linking, server discovery, verified secure direct/relay connections, paged album browsing, audio playlists, search and contextual playback are implemented with unit/touch fixtures. Original-file playback depends on browser codecs; no transcoding/reporting/Home-profile switching. Real server/Remote Access unverified. See [Plex setup](plex.md). |
| Jellyfin / Emby | Broken | Client exists, but login expects `SessionToken`; native fixture/API response contains `AccessToken`. Query keys use `Recursive.True` and `Album` rather than native `Recursive` / `MusicAlbum`; server routes/auth/cache behavior need a real contract pass. No playback reports or server resume. |
| Audiobookshelf | Partial | Token or username/password login, native-shaped library/list/item responses, multi-file books and podcast episodes are wired to the browser. Per-file resume is local; no server-side progress sync or live server validation. Search expands results to playable tracks. |
| Lyrion/LMS | Broken | Sends a command string in `slim.request` instead of the command token array; reads `artists`/`albums`/`tracks` instead of `*_loop`. Generic browser requires credentials although URL-only is valid. Authenticated media URLs and plugin-track filtering need adaptation. |
| Server setup | Partial | Navidrome and Audiobookshelf have verified Connect flows and credential editing; ABS also accepts a validated API token. Plex offers phone-code linking/discovery and verified URL/token setup. Other providers remain hidden. No remove flow, config import/export or comprehensive auth-refresh policy. |
| Spotify | Missing / Native | No Spotify client, sign-in, librespot playback or related-track discovery. Needs a separate browser-compatible playback/auth design or companion. |
| YouTube / YouTube Music / Bilibili / Xiaoyuzhou | Missing / Native | No search, extractor, cookies or playback adapter. Existing direct-audio URLs are not equivalent to these providers. |
| SoundCloud / Mixcloud / NetEase / Yandex Music | Missing / Native | No account/catalog/resolver integration. Native uses API/cookies and/or yt-dlp not present here. |
| Qobuz | Experimental | Opt-in browser-only OAuth/API client, playlists/favorites/search, signed MP3/FLAC resolution and quality controls have unit/touch fixtures. Reuses public web-player application material as native does. Real-account hosted callback and playback remain unverified; hidden from ordinary navigation. See [test evidence and limits](qobuz-browser-test.md). |
| Tidal | Missing | No client, sign-in or playback integration. Tesla's native app makes this lower priority for the current use case. |
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
| Playlist model, repeat/shuffle/reverse, queue precedence | Implemented | Pure model covered by tests, including identity preservation, album-cursor continuation after play-next, and queue remapping. |
| Queue add/remove/reorder/clear/undo UI | Partial | Queue view supports play-next, reorder/remove, clear with confirmation, playlist reorder/removal and undo. Queue edits are in-memory and are lost on reload. |
| Saved playlists / create / rename / sort / multi-select / search | Partial | Named playlists can be created, renamed, played and deleted; stored locally. No sort, multi-select or search. |
| History | Partial | 200 entries; browser records at 50% and deduplicates only consecutive repeats within five minutes. Native records at track start and deduplicates by path globally. Live/unknown-duration tracks are excluded here; decoded duration is not propagated into stored track metadata. |
| Track favorites | Partial | localStorage list and playable rows; no Navidrome/Spotify favorite synchronization. Distinct from the separate radio URL list. |
| Built-in visualizer modes | Implemented | All 34 native modes plus None in native order. Canvas tap/Enter/Space cycle and selection persists by name, including migrated numeric preferences. The named picker was removed after user testing; V now opens immersive playback from the upper-left of the visualization. Renderer algorithms are unchanged. |
| Visualizer fidelity / analysis | Partial | Character-grid adaptations, not verified pixel/algorithm parity. Stereo meters simulate L/R from a mono tap; FFT uses ten bands even for modes whose native drivers request more. YinYang uses Braille and simplified path motion. |
| Visualizer picker / fullscreen / low power | Partial | The deployed immersive visualizer and its touch controls are preserved, with enter/exit browser checks. No direct mode picker, low-power preference or background playback guarantee. |
| Bundled themes | Implemented | All 22 vendored TOMLs match tagged native theme files byte-for-byte. Settings → Appearance has a named picker and palette preview, reachable directly from Now Playing. Selection applies immediately and persists. Browser checks cover all options, light/dark palettes, persistence and continued playback. User theme import is absent. |
| LRCLIB and synced LRC | Partial | Lookup, repeated timestamps, millisecond precision, sorting and auto-scroll exist. No embedded/sidecar loader, NetEase/provider fallback, retry control, timing-offset control or native query cleaning. |
| Metadata/cover/info screens | Partial | Title, artist, time and MediaSession artwork fields; no full metadata screen, album headers or in-app cover pane. |
| Touch interface | Partial | Primary transport/settings controls and fixture viewport verified. Several stars/pins are still small nested span targets; EQ has touch sliders and a modal picker; the thin seek meter's enlarged pseudo-element is clipped by its container. This is not a full accessibility/touch audit. |
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
`src/components/SettingsScreen.tsx`, `src/core/audio/mediasession.ts`, `public/sw.js`.

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
| MediaSession | Partial | Basic metadata/control adapter is implemented. Spoken seek actions use fresh source positions (−15/+30), and seek handlers clear on live sources. Fixture checks cover the callbacks; real Tesla steering-wheel/system behavior and native MPRIS parity remain untested. |
| Static PWA | Partial | Install manifest, versioned app-shell worker, relative assets/worklet. Media/APIs are network-only. No offline media or offline regression test, and no guarantee of persistence/installation on Tesla. |

## Recommended follow-up order for Tesla

Full-session restore is implemented and covered by regression checks. Next:

Spoken transport controls are also implemented and verified with synthetic media.

The named visualizer picker was removed after user testing; rendering cleanup remains deferred.

Native subscription latest actions (`l`/`L`) are implemented and fixture-tested.
There is no added unplayed filter or combined episode inbox.

1. **Add station and podcast-feed URLs directly.** Allow sources missing from
   search to be saved and reused through the existing favorites UI.

Real-account Plex and browser-only Qobuz validation remain separate provider
work. Keep unimplemented providers hidden. Further plugin parity needs its own
scope: bounded execution, native API/events, HTTP/timers, queue APIs and custom
visualizers. Actual Tesla testing should follow fixture checks, especially for
activation, long sessions, backgrounding, audio continuity and touch targets.

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
omabox -b NAME run -- node "$PWD/tests/session-smoke.mjs"
omabox -b NAME run -- node "$PWD/tests/spoken-smoke.mjs"
omabox -b NAME run -- node "$PWD/tests/visualizer-controls-smoke.mjs"
omabox -b NAME run -- node "$PWD/tests/podcast-latest-smoke.mjs"
omabox -b NAME run -- node "$PWD/tests/radio-tags-smoke.mjs"
omabox -b NAME down
```

The browser suite needs Chromium (`CHROMIUM_PATH` may override
`/usr/bin/chromium`) and uses `@playwright/test`; no downloaded browser is
required. It saves fictional-data captures in the box HOME. The source uses
muted audio, so passing proves media progression/state, not audible output.
The fixture server must only be used for testing and stopped afterward.
