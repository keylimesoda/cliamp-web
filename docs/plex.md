# Plex from the Tesla

Open **Servers → Plex → Link Plex account**. On your phone, open
**plex.tv/link**, sign in to Plex, and enter the displayed code. When the
Tesla shows your servers, select your home server. The app tests access to a
music library before saving the connection. No Plex password is entered into
cliamp-web. **Use server URL and token** remains available for manual setup.

Your server needs Remote Access and a reachable HTTPS endpoint, commonly its
`plex.direct` address. A home-only address such as `192.168.x.x` will not reach
your server over Tesla cellular. The app tries discovered secure direct
connections, then secure relays; relay availability and bandwidth depend on
your Plex setup. Failed connections leave existing settings intact.

The browser shows music libraries and audio playlists. Open a library to browse
albums; **Load more albums** pages through larger libraries. Open an album or
playlist to play its track list, or submit a music search. Playlists currently
load their first 1,000 tracks. Selecting a track loads that album/playlist as
the current queue, supporting normal next/previous and play-next controls.

## Connection behavior and limits

- Device linking follows Plex's documented short-PIN flow. PIN requests and
  polling stop on cancellation or leaving setup; expired codes can be renewed.
- Account tokens are used only to discover servers and are not persisted. The
  selected server's access token, identity, and secure connection candidates
  are saved in this browser. The client ID is generated for this browser.
- API requests and playback resolution can select another saved endpoint when
  a connection fails. Relink if the server's addresses change and none of the
  saved candidates work. This is not continuous plex.tv resource discovery.
- A selected server must expose a music library. Server identity is checked
  when provided in its response; new tracks carry server identity so switching
  servers does not silently play another server's matching item ID.
- Playback serves original files, using the browser's codecs. No Plex
  transcoding, offline downloads, play-count reporting, Home-user/profile
  switching, or Plex account sign-out/revocation UI is implemented. Use
  **Servers → Edit Plex** to relink or correct the server configuration.
- Remote Access, TLS and CORS must allow the car to reach the server. A failed
  browser connection cannot be repaired by this static app alone.

## Evidence

Unit tests cover device identifiers, PIN expiry/auth rejection, resource-token
selection, secure endpoint filtering, rejected connections, identity checks,
direct-to-relay fallback, cancellation, and media URL construction.
`tests/plex-smoke.mjs` uses fictional plex.tv and Plex Media Server responses
plus synthetic WAVs in Chromium at 804×638 with touch. It covers phone linking,
cancellation, discovery, connection persistence, music-only browsing, album and
playlist selection, search, and two-track media progression. No real Plex
account or home server is used; actual Tesla and Remote Access remain to test.

After building and starting `node tests/preview-server.mjs`:

```sh
omabox up --new --size 1024x768 --net isolated --allow 4173,4174 --no-shell
# Replace NAME with the printed box name.
omabox -b NAME run -- node tests/plex-smoke.mjs
omabox -b NAME down
```

References: [Plex authentication and PMS API](https://developer.plex.tv/pms/),
[Plex server connection discovery](https://support.plex.tv/articles/206721658-using-plex-tv-resources-information-to-troubleshoot-app-connections/).
