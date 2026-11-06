# Qobuz browser-only test

This is an opt-in experiment, not an established working Tesla integration.
It adds browser OAuth handling, account/stream validation, playlists, favorite
tracks/albums/artists, artist albums, track search, quality selection, and
fresh signed stream URLs at playback. No companion service runs at home.

Test URL: `https://keylimesoda.github.io/cliamp-web/?qobuz-test=1`.
Open **Qobuz browser test** in Servers, then **Sign in to Qobuz**. The password
is entered only on Qobuz's website. After approval, Qobuz may show a **Back**
button; press it to return. A matching pending state, streaming-eligible
account response, and successful signed stream probe are required before
saving the session or showing the connected library.

The test entry is absent from ordinary navigation. After a successfully
validated session, it remains available in Servers. Sign-out removes this
app's locally stored session; it does not revoke the account at Qobuz.

## Reusing native cliamp's application identity

Native cliamp v2.4.0 does not own a Qobuz developer key. Its
`external/qobuz/bundle.go` reads application identity, candidate signing
material, and OAuth compatibility material from Qobuz's public web player.
Its `session.go` opens Qobuz's OAuth page with a localhost return address.

The experimental build runs the same public bootstrap extraction during
**build**, using `scripts/qobuz-bootstrap.mjs`. This avoids fetching a bundle
whose CORS headers do not permit JavaScript in our app to read it. The
resulting public `qobuz-bootstrap.json` contains application material already
shipped in that web client, plus its source URL, digest and build timestamp.
It contains no user account token or password, is ignored by git, and is
created only for test deployments. Public application identity is not the
same thing as a separately registered/approved cliamp-web OAuth client.

Login, API calls and audio requests run in the car's browser. A validated
personal session and selected quality are stored in that browser's
localStorage. Neither is uploaded to GitHub or a companion. Signed audio URLs
are resolved at playback instead of being persisted in playlists.

## Hosted callback and fallback

The hosted HTTPS callback is **not verified with a real account**. We observed
both localhost and hosted OAuth URLs display Qobuz's sign-in form; this does
not establish that Qobuz will approve the eventual hosted return. Automatic
callbacks without the expected state are rejected.

**Manual return option** preserves the native localhost handoff without a
listener or helper server: choose **Sign in using manual return**, approve
on Qobuz, press its Back button, copy the localhost URL from the resulting
browser error page, return to this app, and paste that URL. This is an
explicit user handoff accepted only during a pending, unexpired sign-in.
The address is parsed locally; this app does not send a request to localhost.
Copy/paste ergonomics on Tesla have not been verified. Do not share the return
URL, which contains a short-lived authorization code.

No Qobuz username/password login form, third-party CORS proxy, headless browser,
or persistent background process is added. If Qobuz rejects both authorized
handoffs or denies browser access to the API, this experiment is not a working
browser-only integration. We will need an allowed browser client flow from
Qobuz rather than treating passing mocks as real sign-in evidence.

## Limits and evidence

- Native's legacy `track/getFileUrl` path is used for complete MP3/FLAC files.
  The current encrypted/segmented web-player pipeline is not implemented.
  Signature changes or retirement of the legacy path can break playback.
- Qualities 5/6/7/27 match native MP3/CD/Hi-Res requests. Account and region
  permissions still apply; the browser output path does not promise bit-perfect
  or Hi-Res output. CD FLAC is the default.
- As in native cliamp, connection validation probes track 5966783 using MP3.
  An unavailable probe track or API change can reject an otherwise eligible
  account. No audio from this probe is played.
- Expired/revoked sessions require another sign-in. No automatic OAuth refresh,
  library write-back, Qobuz Connect, random playlist synthesis or offline media
  is implemented.
- Unit fixtures pin native's signature vector, API envelopes, pagination,
  album metadata, unstreamable filtering, account boundaries, fresh URL
  resolution, auth state/expiry, and public bootstrap parsing.
- `tests/qobuz-smoke.mjs` runs a fictional OAuth server/API and synthetic WAVs
  at 804×638 touch inside omabox. It covers callback rejection/exchange,
  session persistence, quality selection, playlists/search, automatic next,
  expiry, sign-out, and explicit manual return. It **does not** establish real
  Qobuz authorization or full-track playback.
- Live unauthenticated probes on November 5, 2026: API preflight returned 204
  with wildcard CORS and permitted app/user-token headers; unauthenticated
  API GETs returned 401 without CORS. The public web-player bundle had no
  readable cross-origin response header. The current player bundle was
  8.3.0-b029. No real Qobuz account was used.

## Building and checking

```sh
npm run build:qobuz-test  # public bootstrap download, TypeScript, Vite
npm test
node tests/preview-server.mjs
```

In another terminal:

```sh
omabox up --new --size 1024x768 --net isolated --allow 4173,4174 --no-shell
# Replace NAME with the printed box name.
omabox -b NAME run -- node tests/qobuz-smoke.mjs
omabox -b NAME down
```

The deployment workflow's `qobuz_test` input includes the optional bootstrap.
For a clean build without it, remove the ignored `public/qobuz-bootstrap.json`
before running the normal build. Refresh the test bootstrap when Qobuz changes
its public application material.

## Related Tesla and WASM findings

[TaaDa advertises Qobuz on Tesla](https://taada.top/apps/qobuz-on-tesla/), using
Android Auto on an Android phone with Bluetooth audio. That is a different
architecture; it was not tested here. Qobuz also has its own web player.
This search did not establish another dedicated, browser-only Qobuz client
whose account authorization and playback on Tesla we can verify.

yt-dlp can potentially execute under Python/WASM in a worker, but that does not
give it native networking, cross-origin page access, Google cookies, or native
subprocesses. [Pyodide documents the browser HTTP/CORS constraints](https://pyodide.org/en/stable/usage/wasm-constraints.html).
An [existing yt-dlp/Pyodide attempt](https://github.com/yt-dlp/yt-dlp/issues/11957)
hit browser networking/CORS restrictions. A worker helps keep processing off
the UI thread; it does not establish successful browser-only YouTube extraction.
Its page must remain alive, though it need not always be visible. A service
worker is not a persistent replacement: [the browser controls its lifetime](https://web.dev/learn/pwa/service-workers).

Native references: cliamp v2.4.0 `external/qobuz/{bundle,session,client}.go`
and `docs/qobuz.md`, commit `a8386f83cf0d3a0c71cda7b3cf1288eea1e3aaef`.
