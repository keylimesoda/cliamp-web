// Fictional Plex account and media server. Run inside omabox after building.
import { chromium, expect } from "@playwright/test";
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium", headless: true,
  args: ["--no-sandbox", "--mute-audio", "--disable-dev-shm-usage", "--disable-gpu"] });
const context = await browser.newContext({ viewport: { width: 804, height: 638 }, hasTouch: true, deviceScaleFactor: 1.96 });
const page = await context.newPage(), errors = [], requests = [];
await page.addInitScript(() => {
  window.__mediaLog = [];
  const Original = window.Audio;
  window.Audio = function(...args) {
    const audio = new Original(...args);
    for (const event of ["playing", "pause", "error", "ended", "waiting"]) audio.addEventListener(event, () => window.__mediaLog.push({ event, src: audio.currentSrc, time: audio.currentTime, error: audio.error?.message }));
    return audio;
  };
  window.Audio.prototype = Original.prototype;
});
page.on("pageerror", (e) => errors.push(e.message));
page.on("request", (r) => requests.push(r.url()));
const wav = await (await context.request.get("http://127.0.0.1:4173/a.wav")).body();
let approved = false, polls = 0;
await page.route("https://plex.tv/api/v2/**", async (route) => {
  const url = new URL(route.request().url());
  expect(url.searchParams.get("X-Plex-Client-Identifier")).toBeTruthy();
  if (url.pathname === "/api/v2/pins") return route.fulfill({ json: { id: 123, code: "ABCD", expiresIn: 300 } });
  if (url.pathname === "/api/v2/pins/123") { polls++; return route.fulfill({ json: { authToken: approved ? "account-token" : null } }); }
  expect(url.pathname).toBe("/api/v2/resources");
  expect(url.searchParams.get("X-Plex-Token")).toBe("account-token");
  return route.fulfill({ json: [{ name: "Home music", clientIdentifier: "home", provides: "server", accessToken: "server-token", connections: [{ uri: "https://plex.fixture", local: false }] }] });
});
const tracks = [1, 2].map((i) => ({ ratingKey: String(i), title: `Plex song ${i}`, grandparentTitle: "Fixture artist", parentTitle: "Fixture album", duration: 4000,
  Media: [{ Part: [{ key: `/library/parts/${i}/file.wav` }] }] }));
await page.route("https://plex.fixture/**", async (route) => {
  const url = new URL(route.request().url());
  if (url.searchParams.get("X-Plex-Token") === "invalid-token") return route.fulfill({ status: 401, json: {} });
  expect(url.searchParams.get("X-Plex-Token")).toBe("server-token");
  expect(url.pathname).not.toContain("//");
  if (url.pathname.startsWith("/library/parts/")) return route.fulfill({ contentType: "audio/wav", headers: { "Access-Control-Allow-Origin": "*" }, body: wav });
  let container = {};
  if (url.pathname === "/library/sections") container = { machineIdentifier: "home", Directory: [{ key: "1", title: "Music", type: "artist" }, { key: "2", title: "Movies", type: "movie" }] };
  else if (url.pathname === "/playlists") container = { Metadata: [{ ratingKey: "road", title: "Road trip", playlistType: "audio" }, { ratingKey: "film", title: "Film playlist", playlistType: "video" }] };
  else if (url.pathname === "/library/sections/1/all") {
    expect(url.searchParams.get("type")).toBe("9");
    container = { Metadata: [{ ratingKey: "album-1", title: "Fixture album", parentTitle: "Fixture artist" }] };
  } else if (url.pathname === "/library/metadata/album-1/children" || url.pathname === "/playlists/road/items") container = { Metadata: tracks };
  else if (url.pathname === "/library/search") container = { Metadata: [tracks[1]] };
  else throw new Error(`Unexpected Plex request: ${url.pathname}`);
  return route.fulfill({ json: { MediaContainer: container } });
});
const button = (name) => page.getByRole("button", { name, exact: true });
const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem("cliamp-web:servers") || "{}"));
try {
  await page.goto("http://127.0.0.1:4173/cliamp-web/"); await button("Servers").tap(); await button("Plex").tap();
  await button("Use server URL and token").tap();
  await page.getByLabel("Plex server URL", { exact: true }).fill("https://plex.fixture");
  await page.getByLabel("Plex token", { exact: true }).fill("invalid-token");
  await button("Connect to Plex server").tap(); await expect(page.getByRole("alert")).toContainText("Cannot reach");
  expect((await stored()).plex).toBeUndefined(); await button("Hide manual setup").tap();
  await button("Link Plex account").tap(); await expect(page.getByLabel("Plex linking code")).toHaveText("ABCD");
  await button("Back").tap(); await page.waitForTimeout(2200);
  expect(polls).toBe(0); expect((await stored()).plex).toBeUndefined();
  await button("Plex").tap(); await button("Link Plex account").tap();
  await expect(page.getByLabel("Plex linking code")).toHaveText("ABCD"); approved = true;
  await button("Connect to Home music").tap();
  await expect(button("Music")).toBeVisible(); await expect(button("Road trip")).toBeVisible();
  await expect(button("Movies")).toHaveCount(0); await expect(button("Film playlist")).toHaveCount(0);
  expect((await stored()).plex).toMatchObject({ token: "server-token", url: "https://plex.fixture", serverId: "home" });
  expect(JSON.stringify(await stored())).not.toContain("account-token");
  await button("Music").tap(); await button("Fixture album").tap();
  await expect(button("Plex song 2")).toBeVisible(); await button("Plex song 1").tap(); await button("Now Playing").tap();
  await expect(page.locator(".track-line")).toContainText("Plex song 1");
  await expect(page.locator(".time-status .state")).toHaveText("Playing");
  await expect(page.locator(".track-line")).toContainText("Plex song 2", { timeout: 10000 });
  await button("Play/Pause").tap(); await page.reload(); await button("Servers").tap(); await button("Plex").tap();
  await expect(button("Music")).toBeVisible(); // Saved server opens without another account link.
  await button("Road trip").tap(); await expect(button("Plex song 1")).toBeVisible();
  await page.getByLabel("Search Plex music").fill("song 2"); await button("Search").tap();
  await expect(button("Plex song 2")).toBeVisible(); await expect(button("Plex song 1")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(requests.some((r) => r.includes("/library/parts/"))).toBe(true); expect(errors).toEqual([]);
  console.log(JSON.stringify({ passed: true, checks: ["phone PIN and cancellation", "account discovery uses server-scoped token", "verified connection persistence", "only music libraries/audio playlists", "album browsing and contextual playback", "two-track progression", "saved server on reload", "playlist browsing and search", "804×638 touch/no overflow or page errors"] }));
} catch (e) { console.error(JSON.stringify({ status: await page.locator(".status-row").allTextContents(), errors, media: await page.evaluate(() => window.__mediaLog), paths: requests.map((r) => new URL(r).pathname) })); throw e; }
finally { await context.close(); await browser.close(); }
