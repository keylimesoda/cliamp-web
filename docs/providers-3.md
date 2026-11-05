# Browser source coverage

This app has no backend or native companion. Native cliamp provider code is
not linked into the browser build. The [v2.4.0 parity audit](feature-parity-v2.4.0.md#sources-and-provider-behavior)
is the current source of coverage and verification status.

Radio and podcast clients exist; production media/API CORS still depends on
the host. Navidrome's Subsonic protocol is covered by fixtures, including
ratings. Plex has basic token-client code and metadata fixtures. Jellyfin,
Emby, Audiobookshelf and Lyrion contain known contract/setup defects; their
presence in the source picker must not be read as verified working support.

These native sources are absent:

| Source | Missing integration |
| --- | --- |
| Spotify | Account/authentication, catalog and native librespot playback |
| YouTube / YouTube Music | Search, source extraction, account cookies and playback adapter |
| SoundCloud / Mixcloud / Bandcamp / Bilibili | Catalog/account handling and native yt-dlp/source resolution; Bandcamp purchased library is also absent |
| NetEase / Yandex Music | Account/session APIs, source resolution and playback integration |
| Qobuz / Tidal | Sign-in, API clients and stream resolution/playback |
| Telegram | MTProto account/session/catalog/download client added in v2.4 |
| Xiaoyuzhou | Provider-specific feed/source handling |
| Local files / SSH | No browser file picker, directory import, tags or SSH client |

Some work is feasible entirely in a browser, including user-selected local
files and many library/queue/progress features. Other sources need a
browser-compatible API/auth/media design or a companion for native protocol,
credential, extractor and codec work. OAuth alone does not prove that a
browser implementation is impossible; each provider needs separate analysis.
