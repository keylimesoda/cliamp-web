import { describe, expect, it } from "vitest";
import { findProgress, listeningKey, makeProgress, resumePosition } from "./listening";
import type { Track } from "./types";
const episode: Track = { provider: "podcast", feed: "https://feed.test/rss", guid: "ep-1", path: "https://cdn.test/old", title: "Episode", artist: "Show" };
describe("independent listening progress", () => {
  it("recognizes an episode across enclosure changes but keeps other episodes separate", () => {
    const p = makeProgress(episode, 125, 1800)!;
    expect(findProgress({ [p.key]: p }, { ...episode, path: "https://cdn.test/new" })).toBe(p);
    expect(findProgress({ [p.key]: p }, { ...episode, title: "Other", guid: "ep-2" })).toBeUndefined();
    expect(resumePosition(p)).toBe(120);
  });
  it("restarts the first fifteen seconds and finished episodes", () => {
    expect(resumePosition(makeProgress(episode, 14, 1800)!)).toBe(0);
    expect(resumePosition(makeProgress(episode, 15, 1800)!)).toBe(10);
    expect(resumePosition(makeProgress(episode, 1750, 1800)!)).toBe(0);
    expect(makeProgress(episode, 30, 60)?.completed).toBe(true);
    expect(makeProgress(episode, 25, 60)?.completed).toBe(false);
    expect(makeProgress(episode, 1, 0, true)?.completed).toBe(true);
  });
  it("migrates only a unique same-show/title match with compatible publication dates", () => {
    const p = makeProgress({ ...episode, providerMeta: { pubDate: "date-a" } }, 125, 1800)!;
    const changed = { ...episode, guid: "new-id", path: "new-url" };
    expect(findProgress({ [p.key]: p }, changed)).toBe(p);
    expect(findProgress({ [p.key]: p }, { ...changed, providerMeta: { pubDate: "date-b" } })).toBeUndefined();
    expect(findProgress({ [p.key]: p, other: { ...p, key: "other" } }, changed)).toBeUndefined();
  });
  it("scopes book parts and server accounts independently", () => {
    const book: Track = { path: "book", title: "Part", provider: "audiobookshelf", kind: "audiobook", providerMeta: { itemId: "book-1", ino: "12", serverUrl: "https://a.test" } };
    expect(listeningKey(book)).not.toBe(listeningKey({ ...book, providerMeta: { ...book.providerMeta, ino: "13" } }));
    expect(listeningKey(book)).not.toBe(listeningKey({ ...book, providerMeta: { ...book.providerMeta, serverUrl: "https://b.test" } }));
  });
  it("ignores music, live streams and invalid positions", () => {
    expect(makeProgress({ path: "song", title: "Song" }, 20, 60)).toBeNull();
    expect(makeProgress({ ...episode, live: true }, 20, 60)).toBeNull();
    expect(makeProgress(episode, NaN, 60)).toBeNull();
    expect(makeProgress(episode, -1, 60)).toBeNull();
  });
});
