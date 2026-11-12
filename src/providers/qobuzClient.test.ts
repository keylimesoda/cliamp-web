import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QobuzClient, qobuzFileSignature } from "./qobuzClient";
import type { Track } from "../core/types";

const fetcher = vi.fn<typeof fetch>();
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const session = { appId: "fixture-app", signingSecret: "fixture-secret", userToken: "fixture-token", userId: "42" };
const track: Track = { path: "qobuz://track/5966783", title: "Fixture", provider: "qobuz", providerMeta: { trackId: "5966783", userId: "42" } };
beforeEach(() => { vi.stubGlobal("fetch", fetcher); fetcher.mockReset(); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("Qobuz browser API preparation (no enabled sign-in)", () => {
  it("matches the native v2.4.0 stream-signature test vector", () => {
    expect(qobuzFileSignature("5966783", 6, "1700000000", "deadbeefsecret")).toBe("bc7a09d686b3e5c1cd32f5268eff1030");
  });

  it("maps album-nested tracks and filters items the API marks unstreamable", async () => {
    fetcher.mockResolvedValue(reply({ id: "album", title: "Record", artist: { name: "Artist" }, release_date_original: "2026-01-01", image: { large: "https://art.test/cover.jpg" },
      tracks: { total: 2, items: [{ id: 1, title: "Playable", streamable: true, duration: 180 }, { id: 2, title: "Unavailable", streamable: false }] } }));
    const tracks = await new QobuzClient(session).albumTracks("album");
    expect(tracks).toMatchObject([{ path: "qobuz://track/1", title: "Playable", artist: "Artist", album: "Record", year: 2026, artUrl: "https://art.test/cover.jpg", providerMeta: { userId: "42" } }]);
    expect(tracks).toHaveLength(1);
  });

  it("loads all playlist pages without pre-resolving expiring audio URLs", async () => {
    fetcher.mockResolvedValueOnce(reply({ tracks: { total: 501, items: Array.from({ length: 500 }, (_, id) => ({ id: id + 1, title: `Track ${id + 1}`, streamable: true })) } }))
      .mockResolvedValueOnce(reply({ tracks: { total: 501, items: [{ id: 501, title: "Last", streamable: true }] } }));
    const tracks = await new QobuzClient(session).playlistTracks("playlist");
    expect(tracks).toHaveLength(501); expect(tracks.at(-1)?.title).toBe("Last");
    expect(fetcher.mock.calls.map(([url]) => new URL(String(url)).searchParams.get("offset"))).toEqual(["0", "500"]);
    expect(fetcher.mock.calls.every(([url]) => !String(url).includes("getFileUrl"))).toBe(true);
  });

  it("reads playlists, favorite albums and artist album lists using native-shaped envelopes", async () => {
    fetcher.mockResolvedValueOnce(reply({ playlists: { total: 1, items: [{ id: 1, name: "Road" }] } }))
      .mockResolvedValueOnce(reply({ albums: { total: 1, items: [{ id: "a", title: "Album" }] } }))
      .mockResolvedValueOnce(reply({ albums: { total: 1, items: [{ id: "b", title: "Other" }] } }));
    const client = new QobuzClient(session);
    expect((await client.playlists()).items[0].name).toBe("Road");
    expect((await client.favorites("albums")).items[0].id).toBe("a");
    expect((await client.artistAlbums("artist")).items[0].id).toBe("b");
    const headers = new Headers(fetcher.mock.calls[0][1]?.headers);
    expect(headers.get("X-App-Id")).toBe(session.appId); expect(headers.get("X-User-Auth-Token")).toBe(session.userToken);
  });

  it("rejects expired, ineligible, and mismatched accounts", async () => {
    const client = new QobuzClient(session);
    fetcher.mockResolvedValueOnce(reply({}, 401)).mockResolvedValueOnce(reply({ user: { id: 42, credential: {} } }))
      .mockResolvedValueOnce(reply({ user: { id: 99, credential: { parameters: { short_label: "Studio" } } } }));
    await expect(client.verify()).rejects.toThrow("expired");
    await expect(client.verify()).rejects.toThrow("not eligible");
    await expect(client.verify()).rejects.toThrow("account changed");
  });

  it("resolves a fresh signed URL at each play attempt and leaves the queue identity intact", async () => {
    vi.useFakeTimers(); vi.setSystemTime(1700000000000);
    fetcher.mockResolvedValueOnce(reply({ url: "https://audio.test/one.flac" })).mockResolvedValueOnce(reply({ url: "https://audio.test/two.flac" }));
    const client = new QobuzClient(session, 6);
    expect((await client.resolve(track)).url).toBe("https://audio.test/one.flac");
    vi.setSystemTime(1700000005000);
    expect((await client.resolve(track)).url).toBe("https://audio.test/two.flac");
    expect(fetcher.mock.calls.map(([url]) => new URL(String(url)).searchParams.get("request_ts"))).toEqual(["1700000000", "1700000005"]);
    expect(track.path).toBe("qobuz://track/5966783");
  });

  it("does not resolve tracks from another session or accept insecure audio URLs", async () => {
    const client = new QobuzClient(session);
    await expect(client.resolve({ ...track, providerMeta: { ...track.providerMeta, userId: "other" } })).rejects.toThrow("another Qobuz session");
    expect(fetcher).not.toHaveBeenCalled();
    fetcher.mockResolvedValue(reply({ url: "http://audio.test/file.flac" }));
    await expect(client.resolve(track)).rejects.toThrow("secure audio URL");
  });

  it("forwards cancellation and rejects malformed server responses", async () => {
    fetcher.mockResolvedValueOnce(reply({ albums: [] }));
    await expect(new QobuzClient(session).playlists()).rejects.toThrow("invalid playlist");
    const controller = new AbortController(); controller.abort();
    fetcher.mockImplementationOnce(async (_, init) => { init?.signal?.throwIfAborted(); return reply({}); });
    await expect(new QobuzClient(session).search("test", controller.signal)).rejects.toThrow();
  });
});
