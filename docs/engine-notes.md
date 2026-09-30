# Audio engine notes

## Cross-origin taint (verified in Chromium, 2026-09-30)

A cross-origin `<audio>` source **without CORS headers** plays, but the browser
zero-fills the entire downstream Web Audio subgraph: `MediaElementAudioSource`
→ worklet inputs, `AnalyserNode` reads, everything. The audio is audible only
on paths that do not "read" the data (plain GainNode → destination).

Consequences (engine design, `src/core/audio/engine.ts`):

- `load()` sets `crossOrigin="anonymous"` first. CORS-permitting servers get
  the **full chain**: WSOLA worklet (speed 0.25–2.0x) + analyser (visualizer).
- On failure it retries once without `crossOrigin` (tainted mode) and routes
  the element through a bypass gain around the worklet. Audio plays; speed
  and visualizer are unavailable for that source. The stale CORS error event
  is swallowed by a one-shot `staleError` flag (it can fire after the
  fallback starts playing).
- `radio.cliamp.stream` (built-in channels + streams.m3u) sends
  `Access-Control-Allow-Origin: *` → full chain.
- Radio-browser stations: CORS depends on the station server; expect a mix.
  Stations without CORS still play (tainted path), without speed/visualizer.
- `armGapless` uses `fetch` (needs CORS to read bytes) — gapless preload only
  works for CORS-permitting finite sources; otherwise the plain element end
  fires and the store advances normally.

## Verified behaviors (browser smoke, real Chromium)

- Live stream through worklet → 10 biquads → analyser: position advances
  1:1, 10-band spectrum matches content (bass-heavy lofi profile), pause
  honored (position arithmetic), speed/EQ/mono toggles apply, zero console
  errors.
- Gapless (5 s WAVs): A→B handover at t=5.00 s with no silence (band energy
  continuous across the boundary), track identity follows the buffer, clean
  stop when the list is exhausted.
- Tainted (cross-origin, no CORS): element plays through the bypass, position
  advances, analyser reads zero, no spurious error callback, clean stop.

## WSOLA parity

`public/worklets/wsola.js` mirrors `cliamp/player/speed.go` (wsolaFrame):
frame = [crossfade 512][direct 3072] = 3584 out samples per frame; tail
(last 512 of the 4096 source window) is only ever crossfaded, never emitted;
cursor advances 3584 × speed; offset search = normalized cross-correlation
of the saved tail vs candidate heads, ±1024, coarse stride 8 keeping top 8,
full-resolution refinement, fallback to expected. One `Wsola` instance per
channel in the worklet (per-channel matching; stereo preserved end-to-end).
`reset` message clears per-track state (no cross-track tail crossfade).
