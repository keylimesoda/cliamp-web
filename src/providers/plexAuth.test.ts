import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkPlexPin, createPlexPin, discoverPlexServers, plexServerConfig } from "./plexAuth";
import { connectPlexServer, plexClientId, plexUrl, verifyPlexConfig } from "./plexConnection";
const fetcher = vi.fn<typeof fetch>();
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
const music = { MediaContainer: { machineIdentifier: "home", Directory: [{ key: "1", type: "artist", title: "Music" }] } };
beforeEach(() => {
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (k: string) => storage.get(k) || null, setItem: (k: string, v: string) => storage.set(k, v) });
  vi.stubGlobal("fetch", fetcher); fetcher.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

describe("Plex linking and connection contracts", () => {
  it("keeps a distinct stable client ID and obtains a short device PIN", async () => {
    const id = plexClientId(); expect(plexClientId()).toBe(id);
    fetcher.mockResolvedValue(json({ id: 12, code: "ABCD", expiresIn: 60 }));
    const pin = await createPlexPin(new AbortController().signal);
    expect(pin.code).toBe("ABCD"); expect(pin.expiresAt).toBeGreaterThan(Date.now());
    const [url, options] = fetcher.mock.calls[0];
    expect(new URL(String(url)).searchParams.get("X-Plex-Client-Identifier")).toBe(id);
    expect(options?.method).toBe("POST");
    expect(new URL(String(url)).searchParams.has("strong")).toBe(false);
  });
  it("does not poll expired pins and propagates rejected sign-in", async () => {
    await expect(checkPlexPin({ id: 1, code: "ABCD", expiresAt: 0 }, new AbortController().signal)).rejects.toThrow("expired");
    expect(fetcher).not.toHaveBeenCalled();
    fetcher.mockResolvedValue(json({}, 401));
    await expect(createPlexPin(new AbortController().signal)).rejects.toThrow("401");
  });
  it("discovers only secure servers with their own access tokens and relay flags", async () => {
    fetcher.mockResolvedValue(json([
      { clientIdentifier: "home", name: "Home", provides: "server", accessToken: "server-token", connections: [
        { uri: "http://192.168.1.1:32400" }, { uri: "https://relay.test", relay: true }, { uri: "https://home.test" },
      ] },
      { clientIdentifier: "player", provides: "player", accessToken: "player-token", connections: [{ uri: "https://player.test" }] },
    ]));
    const servers = await discoverPlexServers("account-token", new AbortController().signal);
    expect(servers).toHaveLength(1);
    expect(plexServerConfig(servers[0])).toMatchObject({ url: "https://home.test", token: "server-token", serverId: "home", relayUrls: ["https://relay.test"] });
    expect(new URL(String(fetcher.mock.calls[0][0])).searchParams.get("X-Plex-Token")).toBe("account-token");
  });
  it("rejects invalid tokens, non-music libraries, and another server identity", async () => {
    const config = { url: "https://home.test", token: "server-token", serverId: "home" };
    fetcher.mockResolvedValueOnce(json({}, 401)).mockResolvedValueOnce(json({ MediaContainer: { Directory: [{ type: "movie" }] } }))
      .mockResolvedValueOnce(json({ ...music, MediaContainer: { ...music.MediaContainer, machineIdentifier: "other" } }));
    await expect(verifyPlexConfig(config)).rejects.toThrow("401");
    await expect(verifyPlexConfig(config)).rejects.toThrow("no accessible music");
    await expect(verifyPlexConfig(config)).rejects.toThrow("identity changed");
  });
  it("falls back from inaccessible direct connections to a secure relay", async () => {
    fetcher.mockImplementation(async (input) => String(input).startsWith("https://home.test") ? json({}, 503) : json(music));
    const config = await connectPlexServer({ url: "https://home.test", connectionUrls: ["https://relay.test"], relayUrls: ["https://relay.test"], token: "server-token", serverId: "home" });
    expect(config.url).toBe("https://relay.test");
    expect(fetcher.mock.calls).toHaveLength(2);
    const cancelled = new AbortController(); cancelled.abort();
    await expect(connectPlexServer(config, cancelled.signal)).rejects.toThrow();
  });
  it("builds authenticated media URLs without double slashes or leaking tokens to another origin", () => {
    const url = new URL(plexUrl("https://home.test/", "/library/parts/1/file.mp3?download=1", "secret"));
    expect(url.pathname).toBe("/library/parts/1/file.mp3");
    expect(url.searchParams.get("download")).toBe("1"); expect(url.searchParams.get("X-Plex-Token")).toBe("secret");
    expect(() => plexUrl("https://home.test", "//other.test/file.mp3", "secret")).toThrow("another server");
  });
});
