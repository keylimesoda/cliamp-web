import type { Track } from "./types";

export interface FeedShow { name: string; feedUrl: string }

// Native compares YYYY-MM-DD publication dates, retaining feed order on ties
// and using the first playable episode when no valid dates are supplied.
export function latestEpisode(tracks: Track[]): Track | undefined {
  const date = (t: Track) => {
    const raw = t.providerMeta?.pubDate;
    const time = typeof raw === "string" ? Date.parse(raw) : NaN;
    if (!Number.isFinite(time) || typeof raw !== "string") return "";
    // Keep the feed's calendar date, as Go mail.ParseDate(...).Format(DateOnly)
    // does; converting a late-night offset timestamp to UTC can change its day.
    const iso = raw.match(/^\d{4}-\d{2}-\d{2}T/);
    if (iso) return raw.slice(0, 10);
    const mail = raw.match(/^(?:[A-Za-z]{3},\s*)?(\d{1,2})\s+([A-Za-z]{3})\s+(\d{2,4})\s/);
    return mail ? new Date(Date.parse(`${mail[1]} ${mail[2]} ${mail[3]} 00:00:00 GMT`)).toISOString().slice(0, 10) : "";
  };
  let best = tracks[0], bestDate = best ? date(best) : "";
  for (const track of tracks.slice(1)) {
    const published = date(track);
    if (published > bestDate) { best = track; bestDate = published; }
  }
  return best;
}

/** Native's six-worker sweep: retain subscription order despite fetch order. */
export async function latestFromShows(shows: FeedShow[], load: (show: FeedShow) => Promise<Track[]>) {
  const results: (Track | undefined)[] = Array(shows.length);
  const failed: boolean[] = Array(shows.length).fill(false);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(6, shows.length) }, async () => {
    while (next < shows.length) {
      const index = next++;
      try {
        results[index] = latestEpisode(await load(shows[index]));
        failed[index] = !results[index];
      } catch { failed[index] = true; }
    }
  }));
  return { tracks: results.filter((t): t is Track => Boolean(t)), failed: shows.filter((_, i) => failed[i]).map((s) => s.name) };
}
