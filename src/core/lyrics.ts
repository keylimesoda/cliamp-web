/**
 * Lyrics — LRC parsing + LRCLIB lookup.
 * Synced mode (timestamped lines + known position) auto-scrolls and highlights
 * the active line; scroll mode (plain lyrics or live streams) shows static text.
 */

export interface LyricLine {
  time: number; // seconds; -1 for plain (untimestamped) lines
  text: string;
}
export interface LyricsResult {
  synced: boolean;
  lines: LyricLine[];
  source: "lrclib" | "none";
}

// LRC timestamp: [mm:ss.xx] or [mm:ss.xxx] (minutes >= 0, seconds 00-59).
const LRC_TS = /\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]/;

/** Parse LRC text into lines. Returns {synced, lines}. Plain text -> synced=false. */
export function parseLRC(text: string): { synced: boolean; lines: LyricLine[] } {
  const out: LyricLine[] = [];
  let synced = false;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    // collect all timestamps on the line (a line may carry several)
    let m: RegExpExecArray | null;
    let rest = line;
    const times: number[] = [];
    const re = new RegExp(LRC_TS.source, "g");
    while ((m = re.exec(line)) !== null) {
      const min = parseInt(m[1], 10);
      const sec = parseInt(m[2], 10);
      const fracRaw = m[3] ?? "0";
      const frac = parseInt(fracRaw.padEnd(2, "0"), 10); // hundredths
      times.push(min * 60 + sec + frac / 100);
    }
    if (times.length > 0) {
      synced = true;
      // text is what remains after the last timestamp tag
      const last = times.length;
      rest = line.replace(new RegExp("^(?:\\s*" + LRC_TS.source + ")+"), "").trim();
      for (let i = 0; i < last; i++) {
        out.push({ time: times[i], text: rest });
      }
    } else {
      // meta tags like [offset:], [artist:] — skip
      if (line.startsWith("[") && line.includes(":") && line.endsWith("]")) continue;
      out.push({ time: -1, text: line });
    }
  }
  if (synced) {
    out.sort((a, b) => a.time - b.time);
  }
  return { synced, lines: out };
}

function buildQuery(artist?: string, title?: string): string {
  const a = (artist ?? "").trim();
  const t = (title ?? "").trim();
  if (a && t) return `${a} ${t}`;
  return t || a;
}

/** Look up lyrics on LRCLIB. Returns a result or source:"none" if not found. */
export async function fetchLyrics(artist: string | undefined, title: string | undefined): Promise<LyricsResult> {
  const q = buildQuery(artist, title);
  if (!q) return { synced: false, lines: [], source: "none" };
  const url = `https://lrclib.net/api/search?q=${encodeURIComponent(q)}`;
  interface LrcResult {
    plainLyrics?: string;
    syncedLyrics?: string;
    instrumental?: boolean;
  }
  let data: LrcResult[];
  try {
    const res = await fetch(url);
    if (!res.ok) return { synced: false, lines: [], source: "none" };
    data = (await res.json()) as LrcResult[];
  } catch {
    return { synced: false, lines: [], source: "none" };
  }
  if (!Array.isArray(data) || data.length === 0) return { synced: false, lines: [], source: "none" };
  // prefer the first result with timestamped (synced) lyrics
  for (const r of data) {
    if (r.instrumental) continue;
    const lrc = parseLRC(r.syncedLyrics ?? "");
    if (lrc.synced && lrc.lines.length > 0) return { synced: true, lines: lrc.lines, source: "lrclib" };
  }
  // otherwise the first result with plain lyrics
  for (const r of data) {
    if (r.instrumental) continue;
    const lrc = parseLRC(r.plainLyrics ?? "");
    if (lrc.lines.length > 0) return { synced: false, lines: lrc.lines, source: "lrclib" };
  }
  return { synced: false, lines: [], source: "none" };
}

/** Index of the active line for a given position in synced mode. */
export function activeLineIndex(lines: LyricLine[], position: number): number {
  let idx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].time >= 0 && lines[i].time <= position) idx = i;
    else if (lines[i].time > position) break;
  }
  return idx;
}
