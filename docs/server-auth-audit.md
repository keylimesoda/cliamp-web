# Server sign-in audit — November 5, 2026

The Servers screen exposes Navidrome, Audiobookshelf and Plex. Connect validates
credentials with the server before persisting them or opening the library.
Rejected connections keep the form open and preserve existing saved settings.
Configured entries have an Edit action so credentials can be corrected.

| Server | Authentication implementation | UI decision |
| --- | --- | --- |
| Navidrome | Username/password generate salted Subsonic authentication parameters. Connect calls authenticated `rest/ping` and checks the Subsonic status envelope, including failures delivered with HTTP 200. Browse and stream requests carry fresh authentication. | Show. |
| Audiobookshelf | Username/password call `POST /login`, reading `user.token` or `accessToken`; an API token is also accepted. Connect validates bearer access to `api/libraries`. Browsing authenticates requests; playback resolves a token-bearing file URL. | Show. |
| Plex | Phone-code account linking, server discovery with server-scoped tokens, secure connection checks with relay fallback, and manual URL/token setup. Music libraries, albums and audio playlists are wired into playback. | Show. See [Plex setup and limits](plex.md). |
| Jellyfin | Login reads `SessionToken`, although the API returns `AccessToken`. Browse query keys also mismatch the native contract. | Hide. |
| Emby | Shares the broken Jellyfin login and browse client. | Hide. |
| Lyrion/LMS | Optional Basic auth exists, but JSON-RPC sends command strings instead of token arrays and reads incorrect response keys. Authenticated media playback relies on URL userinfo. | Hide. |

Hidden provider code and saved settings are retained. Removing an entry from
the visible catalog does not erase an existing user's configuration.

## Evidence and limits

The audit compared browser code, native cliamp v2.4.0 source and API fixtures.
`tests/server-auth-smoke.mjs` exercises the actual touch UI against fictional
HTTP responses: hidden entries (including previously configured ones),
accepted/rejected Navidrome credentials, Audiobookshelf password login and
token rejection, persistence only after success, credential editing, and form
layout at 804×638. Existing provider tests cover native-shaped browse/resolve
responses. These checks do not establish compatibility with a real user's
server, production CORS, external SSO, or Tesla network conditions.

Run after `npm run build`, with `node tests/preview-server.mjs` running:

```sh
omabox up --new --size 1024x768 --net isolated --allow 4173,4174 --no-shell
# Replace NAME with the printed box name.
omabox -b NAME run -- node tests/server-auth-smoke.mjs
omabox -b NAME down
```

## Native Spotify clarification

Native cliamp uses the Spotify Web API for metadata and `go-librespot` for
streamed audio, adapting its audio source into cliamp's native pipeline.
It can open a browser for authorization; music playback does not use the
Spotify Web Playback SDK. See native `external/spotify/provider.go`,
`session.go`, `streamer.go`, and `docs/spotify.md` at v2.4.0.

This port currently runs as a static browser app. A Spotify browser SDK
integration and a native companion running librespot would be different
architectures; browser DRM requirements apply to the former.
