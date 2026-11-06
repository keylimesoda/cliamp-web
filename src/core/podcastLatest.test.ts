import { describe, expect, it } from "vitest";
import { latestEpisode, latestFromShows } from "./podcastLatest";
import type { Track } from "./types";
const episode = (path: string, pubDate?: string): Track => ({ path, title: path, providerMeta: { pubDate } });

describe("native latest episode selection", () => {
  it("selects by date even in oldest-first feeds and retains feed order on same-day ties", () => {
    const first = episode("first", "Fri, 06 Nov 2026 01:00:00 GMT");
    expect(latestEpisode([episode("old", "2026-11-05T23:00:00Z"), first, episode("later", "Fri, 06 Nov 2026 22:00:00 GMT")])).toBe(first);
  });
  it("retains the calendar date supplied by the feed across time zones", () => {
    const latest = episode("late", "2026-11-06T00:30:00+12:00");
    expect(latestEpisode([episode("earlier", "Thu, 05 Nov 2026 23:59:00 -1200"), latest])).toBe(latest);
  });
  it("falls back to feed order, ignores invalid dates, and prefers any valid publication date", () => {
    const first = episode("first"), dated = episode("dated", "Thu, 05 Nov 2026 23:59:00 GMT");
    expect(latestEpisode([first, episode("bad", "invalid")])).toBe(first);
    expect(latestEpisode([first, dated, episode("bad", "invalid")])).toBe(dated);
    expect(latestEpisode([])).toBeUndefined();
  });
  it("bounds concurrency at six and returns successes/failures in subscription order", async () => {
    const shows = Array.from({ length: 10 }, (_, i) => ({ name: String(i), feedUrl: String(i) }));
    let active = 0, maximum = 0;
    const result = await latestFromShows(shows, async (s) => {
      active++; maximum = Math.max(active, maximum);
      await new Promise((resolve) => setTimeout(resolve, (10 - Number(s.name)) * 2)); active--;
      if (s.name === "2") throw new Error("blocked");
      return s.name === "4" ? [] : [episode(s.name)];
    });
    expect(maximum).toBe(6);
    expect(result.tracks.map((t) => t.path)).toEqual(["0", "1", "3", "5", "6", "7", "8", "9"]);
    expect(result.failed).toEqual(["2", "4"]);
    expect(await latestFromShows([], async () => [])).toEqual({ tracks: [], failed: [] });
  });
});
