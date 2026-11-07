# MoE Lofi: native versus browser audio

Investigation: 2026-11-06. Native reference: cliamp v2.4.0. The owner reports
ads in the web app on both a computer and a Tesla, with native cliamp remaining
ad-free on the same computer/network. Ads occur at startup and after 5–15 minutes.

## Reproduced difference

Changing only the HTTP `User-Agent` changes the opening audio returned by Zeno.
This was reproduced in two simultaneous native/browser capture trials on the
same machine and network, using the same HTTPS station URL:

`https://stream.zeno.fm/3u1qndyk8rhvv`

The directory currently lists this mount for MoE Lofi. Its original and resolved
URLs are identical except that both are HTTP; the browser upgrades the media
request to HTTPS. The controlled comparison used HTTPS for both identities to
remove that difference. Both reached `stream-283.surfernetwork.com`.

| Player identity | ICY metadata requested | Opening audio |
| --- | --- | --- |
| `cliamp/1.0 (https://github.com/bjarneo/cliamp)` | Yes | Native reference |
| Same cliamp identity | No | Matches native reference byte for byte |
| Ordinary Chrome identity | Yes | Different opening content |
| Same Chrome identity | No | Matches the Chrome/ICY audio |

After removing ICY framing, the first long exact native/browser match began at
approximately 30 seconds:

| Trial | Native byte offset | Browser byte offset | Approximate audio offsets at 128 kbit/s |
| --- | ---: | ---: | --- |
| 1 | 489,216 | 492,559 | 30.58 s / 30.78 s |
| 2 | 489,216 | 481,693 | 30.58 s / 30.11 s |

The remainder of the first capture shared about 150 KB of identical MP3 data.
Chromaprint comparison of the first 29 seconds found unrelated content, while
the shared tail matched. This rules out a simple encoding difference or small
start-time offset as the explanation for the opening discrepancy.

The observations, together with the reported audible ads, strongly identify
browser-targeted pre-roll insertion. The captured speech was not transcribed;
no advertiser identity is claimed.

## Where the server distinguishes the clients

Zeno's initial redirect issues a signed `zt` session token. Without altering or
replaying tokens, inspecting the public payload showed:

| User-Agent | Payload difference |
| --- | --- |
| cliamp | `tm: false` |
| Chrome 142 or Chrome 155 | No `tm` field |
| HeadlessChrome 155 | `tm: false` |
| VLC | No `tm` field |

The distinction remains when identical `Origin`, `Referer`, and `Range` headers
are supplied. The meaning of `tm` is undocumented here; do not treat the field
name alone as proof of its internal meaning. The audio comparison independently
establishes that the identity changes the returned content.

This is specific to the tested identities. Do not generalize it to all desktop
players. Headless Chromium's default identity can also hide the behavior during
testing; ordinary Chrome identities were used for the content comparison.

## Browser limitation

A real Chromium Fetch request explicitly supplied the cliamp `User-Agent`.
Network inspection showed Chromium sending its own browser identity instead,
both to Zeno and to the redirected audio server. A JavaScript header assignment
therefore does not reproduce native behavior on Chromium.

Native playback supplies its headers in `player/decode.go`; the web app uses
an HTML audio element. A WASM component or service worker does not by itself
remove the browser networking restriction. No proxy, token rewriting, stream
replacement, or ad-removal logic has been introduced into the app.

## Mid-session investigation

An ordinary-Chrome browser session and a native-style HTTP/ICY session were
captured together for approximately 11½ minutes. The browser used the published
app, with actual media bytes recorded through Chromium DevTools. The native
request used cliamp's exact User-Agent and ICY header.

The captures matched through normal listening. Around ten minutes in, about
30 seconds of native audio no longer appeared in the browser capture, after
which exact matching resumed. Thirty consecutive one-second native anchors
were absent (native MP3 offsets corresponding to approximately 628–657 seconds).
This is consistent with a mid-roll replacing the live audio and then rejoining it.

Throughout that interval the browser had one audio response/connection, with
no additional media request, no request failure, no page error, and no change
from Playing in the sampled state. Its initial two requests were the ordinary
Zeno redirect and the resulting audio connection. An app reconnect did not
cause this event.

Together, the controlled User-Agent experiment and the uninterrupted browser
capture identify server-side, client-dependent audio replacement as the cause.
The specific internal ad-selection rules and the meaning of the opaque token
flag remain undocumented. Ad fill is variable: the long session did not get a
startup replacement even though the earlier short trials did.

## References

- [Zeno describes pre-roll and mid-roll insertion](https://help.zeno.fm/en/article/audio-visual-ads-g1wc69/).
- [Zeno describes mid-roll scheduling and targeting](https://help.zeno.fm/en/article/how-to-enable-mid-roll-ads-for-monetization-tjvko1/).
- [Chromium's User-Agent override limitation](https://developer.mozilla.org/en-US/docs/Glossary/Forbidden_request_header).
- [Native stream headers](https://github.com/bjarneo/cliamp/blob/v2.4.0/player/decode.go).

Raw audio and short-lived redirect tokens are diagnostic artifacts, not
repository assets, and are not included in this report.
