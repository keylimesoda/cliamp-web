import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./registry", () => ({ registerProvider: vi.fn() }));

let mod: typeof import("./audiobookshelf");
let servers: typeof import("../store/servers").useServers;
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

beforeEach(async () => {
  vi.resetModules();
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {}, removeItem: () => {} });
  mod = await import("./audiobookshelf");
  ({ useServers: servers } = await import("../store/servers"));
  servers.getState().saveConfig("audiobookshelf", { url: "https://abs.test", token: "fixture-token" });
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("Audiobookshelf native API contract", () => {
  it("reads wrapped libraries and lists, expands multipart books, and builds authenticated media URLs", async () => {
    const fetcher = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/libraries")) return reply({ libraries: [{ id: "lib-1", name: "Books" }] });
      if (url.includes("/api/libraries/lib-1/items")) return reply({ results: [{ id: "book-1", title: "Raw", media: { metadata: { title: "Book", authorName: "Writer" } } }] });
      if (url.includes("api/items/book-1?expanded=1")) return reply({ id: "book-1", mediaType: "book", title: "Book", media: { metadata: { title: "Book", authorName: "Writer" }, tracks: [{ ino: 11, duration: 120, title: "Part one" }, { ino: 12, duration: 90 }] } });
      throw new Error(`Unexpected URL ${url}`);
    });
    vi.stubGlobal("fetch", fetcher);
    await expect(mod.absBrowse.libraries()).resolves.toEqual([{ id: "lib-1", name: "Books" }]);
    await expect(mod.absBrowse.items("lib-1")).resolves.toMatchObject([{ id: "book-1", title: "Book", author: "Writer" }]);
    const tracks = await mod.absBrowse.tracks("book-1");
    expect(tracks).toMatchObject([
      { kind: "audiobook", title: "Part one", durationSecs: 120, providerMeta: { ino: "11", itemId: "book-1" } },
      { kind: "audiobook", title: "Book · Part 2", providerMeta: { ino: "12" } },
    ]);
    await expect(mod.audiobookshelfProvider.resolveSource(tracks[0])).resolves.toMatchObject({
      url: "https://abs.test/api/items/book-1/file/11?token=fixture-token", seekable: true,
    });
    expect(fetcher.mock.calls.every(([, init]) => new Headers(init?.headers).get("Authorization") === "Bearer fixture-token")).toBe(true);
  });

  it("accepts native nested login tokens and returns newest podcast episodes as distinct tracks", async () => {
    servers.getState().saveConfig("audiobookshelf", { url: "https://abs.test", user: "u", password: "p" });
    const fetcher = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/login")) return reply({ user: { token: "session-token" } });
      if (url.includes("api/items/show?expanded=1")) return reply({ id: "show", mediaType: "podcast", title: "Show", media: { metadata: { title: "Show" }, episodes: [
        { id: "old", title: "Old", publishedAt: 1, audioFile: { ino: 1 } },
        { id: "new", title: "New", publishedAt: 2, audioFile: { ino: 2, duration: 60 } },
      ] } });
      throw new Error(`Unexpected URL ${url}`);
    });
    vi.stubGlobal("fetch", fetcher);
    const tracks = await mod.absBrowse.tracks("show");
    expect(tracks.map((track) => track.title)).toEqual(["New", "Old"]);
    expect(tracks[0]).toMatchObject({ kind: "podcast", providerMeta: { episodeId: "new", ino: "2" } });
    expect(fetcher.mock.calls[0][1]?.method).toBe("POST");
    expect(fetcher.mock.calls[1][1]?.headers).toMatchObject({ Authorization: "Bearer session-token" });
  });
});
