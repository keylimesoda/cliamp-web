# Streaming providers (out of scope for the static PWA)

The six streaming services from cliamp — **Tidal, Qobuz, Yandex Music,
NetEase Cloud Music, SoundCloud, Mixcloud** — are **not implemented** in
cliamp-web. Each is incompatible with the PWA's constraints (static, zero
backend, no companion server, no Pyodide/yt-dlp, no librespot), not omitted by
oversight. This is documented per the porting goal: out-of-scope providers are
named and explained, not silently dropped.

Why each is out of scope:

| Provider | Blocking requirement | Why a static PWA can't meet it |
| --- | --- | --- |
| **Tidal** | OAuth device-flow sign-in (`auth.tidal.com`), `Authorization` + `x-tidal-client-version` on every API call, CORS-gated API | A signed-in Tidal account is required. The device/redirect flow and the CORS-gated API cannot be completed from a browser origin with no backend to hold the OAuth exchange. |
| **Qobuz** | OAuth localhost-redirect sign-in, app-id/secret extracted from the `play.qobuz.com` bundle, `X-App-Id`/`X-User-Auth-Token` headers, CORS preflight | Account sign-in via a localhost redirect is not reusable in a static PWA; the app-secret extraction is a cross-origin fetch. Both need server-side handling. |
| **Yandex Music** | Account OAuth token, `Authorization` + `X-Yandex-Music-Client` headers, CORS preflight; signed CDN URLs | Requires a signed-in Yandex Music account and preflight-allowed custom headers. No account → no playback. |
| **NetEase Cloud Music** | Browser cookie session, browser-restricted `Referer`/`Cookie` headers, CORS | The API expects the browser's own cookies and a `Referer` the browser will not let cross-origin JS set. Media resolution also depends on yt-dlp in cliamp. |
| **SoundCloud** | yt-dlp extractor for media resolution (no REST client in cliamp), optional browser cookies | cliamp resolves SoundCloud audio server-side with yt-dlp. The PWA has no yt-dlp, and cross-origin media reads are subject to SoundCloud's source/range policy. |
| **Mixcloud** | Public GET JSON API **without** `Access-Control-Allow-Origin`, plus yt-dlp for media resolution | The API sends no CORS header (verified), so the browser blocks cross-origin JSON reads; and playback still needs yt-dlp to turn a cloudcast page into a stream. |

## What works out of the box (for contrast)

These sources need no account and no backend, so they are implemented and
browser-verified:

- **Radio** — Radio Browser API + built-in `radio.cliamp.stream` channels.
- **Podcasts** — Apple top charts / search / RSS enclosures.
- **Navidrome** — self-hosted Subsonic server (sends CORS headers by default).

## What works with the user's server (CORS required)

These are implemented and wired to the Servers screen, but require the user's
server to permit the PWA origin via CORS (only Navidrome does this by default):

- **Jellyfin / Emby** (shared embyapi), **Plex**, **Audiobookshelf**,
  **Lyrion (LMS)** — see `src/providers/` and the Servers screen.

A future revision could add a companion proxy (out of scope here) to satisfy
the OAuth/cookie/yt-dlp requirements for the streaming services.
