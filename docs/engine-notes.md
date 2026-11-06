# Audio engine notes

The web engine is an adaptation of cliamp, not the native audio backend.
See the [v2.4.0 parity audit](feature-parity-v2.4.0.md#playback-and-audio).

## Processing and CORS

CORS-permitting media uses a MediaElementAudioSource feeding the WSOLA worklet,
ten peaking biquads (70–16k Hz, Q 1.4), an analyser tap, volume, and stereo or
mono output. Settings configured before graph creation are applied when the
graph initializes. The worklet URL resolves against `document.baseURI`, so
`/cliamp-web/` deployments load `/cliamp-web/worklets/wsola.js`.

A cross-origin media element without CORS cannot be made audible by routing
its MediaElementAudioSource around a worklet: the browser silences the source
itself. The old engine's bypass claim was incorrect. The fallback now uses a
second audio element that is never connected to Web Audio. It supports native
media playback, element volume (at most unity) and element playbackRate, but
not the EQ, analyser or mono graph. Permission/activation and aborted loads
are not retried as CORS failures. Source/load/preload generations prevent late
callbacks from replacing a newer request.

## Track transitions

Finite, CORS-readable sources with known metadata durations of at most ten
minutes can be fetched/decoded for a best-effort next-track bridge. Encoded
downloads are capped at 32 MiB. Preloads are invalidated on track, seek and
order changes. Both normal media and decoded buffers enter the same DSP
graph. A natural end without a preload still advances through the playlist;
successful promotions consume the play-next queue once. The end of a decoded
bridge also reports completion, even if another preload is unavailable.

When a resolver or media engine reports an error, or a playing position stops
advancing for twelve seconds, the player retries after 1, 2, 4, 8, and 16
seconds. It waits while offline, cancels retries when paused or changing tracks,
and exposes a manual Retry after the bounded attempts. Stable playback resets
the retry budget. Browser fixture coverage currently validates playback and
queue interactions; retry timing, cancellation and exhaustion are covered by
the `PlaybackRecovery` unit tests.

Podcasts and Audiobookshelf files save their own progress in local browser
storage. Resume rewinds five seconds, restarts items stopped in the first
fifteen seconds, and marks short items played at halfway or longer items in
their last minute. This state does not sync to an Audiobookshelf server.

This does not establish sample-accurate gapless behavior. Native MP3 delay/
padding trimming is not implemented. Non-1× clock alignment, worklet drain,
source buffer sizing and audible track boundaries need further measurement.
Do not infer those properties from the existence of the WSOLA algorithm.

## Verification on November 5, 2026

`src/core/audio/engine.test.ts` covers deployment subpaths, fallback
routing, stale load/preload replies, permission errors, promotion and bridge
completion. Player/model tests cover queue consumption, natural advancement,
late source resolution, reversal and repeat behavior. DSP tests exercise the
standalone WSOLA algorithm and spectrum logic.

`tests/browser-smoke.mjs` runs Chromium with fictional stations, synthetic
WAVs and fictional server credentials, inside omabox. It checks a GitHub
Pages-style subpath, A→B→C playback, queue play-next and saved playlist
creation, podcast progress persistence/five-second rewind, pause, reversal,
persisted visualizer names, a cross-origin/no-CORS media request, and
accepted/rejected ratings at 804×638 CSS pixels with touch and DPR 1.96. Audio is muted: these checks
prove browser media progression and state, not audible output, DSP quality,
sample-accurate transitions, production server compatibility or Tesla hardware.
