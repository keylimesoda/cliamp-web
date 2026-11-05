import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useServers } from "../store/servers";
import { navidromeBrowse } from "./navidrome";
import { plexBrowse } from "./plex";
import { radioBrowse } from "./radio";

const mockFetch = vi.fn<typeof fetch>();
const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch);
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {}, removeItem: () => {} });
  useServers.getState().saveConfig("navidrome", { url: "https://music.test", user: "demo", password: "test" });
  useServers.getState().saveConfig("plex", { url: "https://plex.test", token: "test" });
});
afterEach(() => { vi.unstubAllGlobals(); mockFetch.mockReset(); });
describe("Navidrome wire protocol", () => {
  it("reads real Subsonic envelopes and user ratings", async () => {
    mockFetch.mockResolvedValue(json({ "subsonic-response": { status: "ok", searchResult3: { song: [{ id: "42", title: "Song", userRating: 4 }] } } }));
    const tracks = await navidromeBrowse.search("song");
    expect(tracks[0]).toMatchObject({ path: "navidrome://song/42", rating: 4 });
  });
  it("sets and clears ratings only through an accepted server response", async () => {
    const t = { path: "navidrome://song/42", title: "Song", provider: "navidrome", providerMeta: { songId: "42" } };
    mockFetch.mockResolvedValue(json({ "subsonic-response": { status: "ok" } }));
    await navidromeBrowse.setRating(t, 0);
    const url = new URL(String(mockFetch.mock.calls[0][0]));
    expect(url.pathname).toBe("/rest/setRating"); expect(url.searchParams.get("id")).toBe("42"); expect(url.searchParams.get("rating")).toBe("0");
    mockFetch.mockResolvedValue(json({ "subsonic-response": { status: "failed", error: { message: "Denied" } } }));
    await expect(navidromeBrowse.setRating(t, 5)).rejects.toThrow("Denied");
    await expect(navidromeBrowse.setRating(t, 6)).rejects.toThrow("0–5");
  });
  it("reads nested artists, albums and playlists using the API's actual field names", async () => {
    mockFetch.mockResolvedValueOnce(json({ "subsonic-response": { status: "ok", artists: { index: [{ artist: [{ id: "a", name: "Artist" }] }] } } }))
      .mockResolvedValueOnce(json({ "subsonic-response": { status: "ok", albumList2: { album: [{ id: "b" }] } } }))
      .mockResolvedValueOnce(json({ "subsonic-response": { status: "ok", playlists: { playlist: [{ id: "c" }] } } }))
      .mockResolvedValueOnce(json({ "subsonic-response": { status: "ok", playlist: { entry: [{ id: "d", title: "Track" }] } } }));
    expect((await navidromeBrowse.listArtists())[0].id).toBe("a");
    expect((await navidromeBrowse.listAlbums())[0].id).toBe("b");
    expect((await navidromeBrowse.listPlaylists())[0].id).toBe("c");
    expect((await navidromeBrowse.playlistTracks("c"))[0].path).toBe("navidrome://song/d");
  });
});
describe("Plex metadata", () => {
  it("reads the artist, album, and album year sent on playlist tracks", async () => {
    mockFetch.mockResolvedValue(json({ MediaContainer: { Metadata: [{ ratingKey: "42", title: "Song", grandparentTitle: "Artist", parentTitle: "Album", parentYear: 1979 }] } }));
    expect((await plexBrowse.playlistItems("1"))[0]).toMatchObject({ title: "Song", artist: "Artist", album: "Album", year: 1979 });
  });
  it("prefers an explicit year and reads Directory sections", async () => {
    mockFetch.mockResolvedValueOnce(json({ MediaContainer: { Metadata: [{ ratingKey: "42", title: "Song", year: 2000, parentYear: 1979 }] } }))
      .mockResolvedValueOnce(json({ MediaContainer: { Directory: [{ key: "1", title: "Music", type: "artist" }] } }));
    expect((await plexBrowse.playlistItems("1"))[0].year).toBe(2000);
    expect((await plexBrowse.sections())[0].title).toBe("Music");
  });
});
describe("cliamp radio", () => {
  it("opens channels as finite songs when available, retaining live-only channels", async () => {
    mockFetch.mockResolvedValueOnce(json({ stations: [{ id: "omarchy", name: "Omarchy", stream: "https://radio.test/live", tracks: 2, tracks_url: "https://radio.test/tracks" }] }))
      .mockResolvedValueOnce(json({ tracks: [{ url: "https://radio.test/song", title: "Song", duration: 180 }, { url: "file:///bad", title: "Bad" }] }));
    const [channel] = await radioBrowse.listBuiltins();
    const [track] = await radioBrowse.channelTracks(channel);
    expect(track).toMatchObject({ path: "https://radio.test/song", durationSecs: 180 }); expect(track.live).toBeUndefined();
    expect(await radioBrowse.channelTracks({ path: "https://radio.test/live", title: "Live" })).toHaveLength(1);
  });
  it("sums live and playlist listeners and tolerates unavailable playlist counts", async () => {
    mockFetch.mockResolvedValueOnce(json({ stations: { lofi: { active_listeners: 3 } } }))
      .mockResolvedValueOnce(json({ stations: { lofi: { active_listeners: 2 }, jazz: { active_listeners: 1 } } }));
    expect(await radioBrowse.listenerCounts()).toEqual({ lofi: 5, jazz: 1 });
    mockFetch.mockResolvedValueOnce(json({ stations: { lofi: { active_listeners: 3 } } })).mockRejectedValueOnce(new Error("Offline"));
    expect(await radioBrowse.listenerCounts()).toEqual({ lofi: 3 });
  });
});
