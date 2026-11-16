# FFmpeg WebAssembly radio decoder

The optional AAC fallback loads the libav.js fat variant (npm version 4.10.6).
The [matching release archive](https://github.com/Yahweasel/libav.js/releases/download/v4.10.6.1.1/libav.js-4.10.6.1.1.zip)
contains its corresponding sources and license notices. See also the
[libav.js source and build instructions](https://github.com/Yahweasel/libav.js/tree/v4.10.6.1.1).

# cliamp-derived code and assets

Audio algorithms, themes, visualizer adaptations and bundled Lua examples derive
from [bjarneo/cliamp](https://github.com/bjarneo/cliamp), pinned in `upstream.json`.
Their upstream license and attribution follow.

```text
MIT License

Copyright (c) Bjarne Øverli

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## hls.js

The browser HLS fallback uses hls.js under the Apache License 2.0.
The deployed build includes `hls.js-LICENSE.txt`.
Source: https://github.com/video-dev/hls.js .

The software HLS fallback parses playlists with m3u8-parser under the
Apache License 2.0. The deployed build includes `m3u8-parser-LICENSE.txt`
and `hls.js-LICENSE.txt` contains the full Apache License.
Source: https://github.com/videojs/m3u8-parser .

## GNU FreeMono (visualizer font)

The published GitHub Pages build includes GNU FreeMono from Ubuntu's
`fonts-freefont-ttf` package. Copyright 2002–2012 GNU FreeFont contributors.
The font is distributed under GPL-3.0-or-later with the GNU FreeFont special
font exception. The deployed build includes `FreeMono-LICENSE.txt` from the
font package. Source: https://savannah.gnu.org/projects/freefont/ .
The half-width Katakana glyphs in Matrix are not covered by FreeMono.
