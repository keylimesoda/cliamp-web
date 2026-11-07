// Native l/L fixtures, including RSS parsing. Run inside omabox after build.
import { chromium, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
const app = process.env.APP_URL || "http://127.0.0.1:4173/cliamp-web/";
const origin = "https://podcast-latest.fixture";
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium", headless: true,
  args: ["--no-sandbox", "--mute-audio", "--disable-dev-shm-usage", "--disable-gpu"] });
const context = await browser.newContext({ viewport: { width: 804, height: 638 }, hasTouch: true, deviceScaleFactor: 1.96 });
const page = await context.newPage(), errors = [], mediaRequests = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("request", (r) => { if (r.url().endsWith(".wav")) mediaRequests.push(r.url()); });
await page.addInitScript(() => {
  window.__media = []; const Audio = window.Audio;
  window.Audio = function (...args) { const m = new Audio(...args); window.__media.push(m); return m; };
  window.Audio.prototype = Audio.prototype;
});
const alpha = "Alpha — a long saved show title that should leave every action reachable";
const shows = [alpha, "Beta", "Blocked show", "Empty show"].map((name, i) => ({ name, feedUrl: origin + ["/alpha.xml", "/beta.xml", "/blocked.xml", "/empty.xml"][i] }));
const track = (id) => ({ path: `${origin}/${id}.wav`, title: id, provider: "podcast", kind: "podcast", feed: origin + "/existing.xml", guid: id, durationSecs: 180 });
const existing = [track("Current"), track("Album next"), track("Already queued")];
await context.addInitScript(({ shows, existing }) => {
  if (localStorage.getItem("latest-fixture-seeded")) return;
  localStorage.setItem("latest-fixture-seeded", "1");
  localStorage.setItem("cliamp-web:podcast-subs", JSON.stringify(shows));
  const feed = shows[0].feedUrl;
  localStorage.setItem("cliamp-web:listening-progress", JSON.stringify({ version: 1, entries: [{
    key: JSON.stringify(["podcast", feed, "Alpha latest"]), kind: "podcast", position: 180, duration: 180, completed: true,
    updatedAt: Date.now(), title: "Alpha latest", show: "Fixture", feed }] }));
  localStorage.setItem("cliamp-web:session", JSON.stringify({ version: 1,
    playlist: { tracks: existing, order: [0, 1, 2], current: 0, cursor: 0, queuedCurrent: -1, queue: [2], shuffle: "off", repeat: "off" },
    track: existing[0], position: 0, duration: 180, at: Date.now() }));
}, { shows, existing });
await page.route("https://itunes.apple.com/**", (r) => r.fulfill({ json: { feed: { entry: [] }, results: [] } }));
await page.route("https://radio.cliamp.stream/**", (r) => r.fulfill({ json: { stations: [] } }));
const rate = 8000, frames = rate * 180, wav = Buffer.alloc(44 + frames * 2);
wav.write("RIFF"); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8); wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28);
wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(frames * 2, 40);
for (let i = 0; i < frames; i++) wav.writeInt16LE(Math.round(Math.sin(i * Math.PI * 880 / rate) * 12000), 44 + i * 2);
const rss = (items) => `<rss version="2.0"><channel><title>Fixture</title>${items.map(([id, date]) => `<item><title>${id}</title><guid>${id}</guid>${date ? `<pubDate>${date}</pubDate>` : ""}<enclosure url="${origin}/${id}.wav" type="audio/wav" /></item>`).join("")}</channel></rss>`;
let holdAlpha = true, releaseAlpha, alphaLoads = 0;
await page.route(origin + "/**", async (route) => {
  const path = new URL(route.request().url()).pathname;
  if (path.endsWith(".wav")) {
    const range = route.request().headers().range?.match(/^bytes=(\d+)-(\d*)$/);
    const a = range ? Number(range[1]) : 0, z = range?.[2] ? Number(range[2]) : wav.length - 1;
    return route.fulfill({ status: range ? 206 : 200, body: wav.subarray(a, z + 1), headers: {
      "Content-Type": "audio/wav", "Accept-Ranges": "bytes", "Access-Control-Allow-Origin": "*",
      ...(range ? { "Content-Range": `bytes ${a}-${z}/${wav.length}` } : {}) } });
  }
  if (path === "/blocked.xml") return route.fulfill({ status: 403, body: "Fixture denial" });
  if (path === "/alpha.xml") {
    alphaLoads++;
    if (holdAlpha) await new Promise((resolve) => { releaseAlpha = resolve; });
    return route.fulfill({ contentType: "text/xml", body: rss([["Alpha old", "Thu, 05 Nov 2026 10:00:00 GMT"], ["Alpha latest", "Fri, 06 Nov 2026 01:00:00 GMT"], ["Alpha same day", "Fri, 06 Nov 2026 22:00:00 GMT"]]) });
  }
  return route.fulfill({ contentType: "text/xml", body: rss(path === "/beta.xml" ? [["Beta first"], ["Beta second"]] : []) });
});
const button = (name) => page.getByRole("button", { name, exact: true });
const session = () => page.evaluate(() => JSON.parse(localStorage.getItem("cliamp-web:session")));
const all = () => button("Add latest from all");
const latest = (name) => button(`Queue latest from ${name}`);
const status = page.getByRole("status");
try {
  await page.goto(app); await button("Play/Pause").tap();
  await expect(page.locator(".time-status .state")).toHaveText("Playing");
  const before = await page.evaluate(() => window.__media.find((m) => !m.paused).currentTime), requests = mediaRequests.length;
  await button("Favorites").tap(); await latest(alpha).tap();
  await expect(latest(alpha)).toBeDisabled(); await expect(all()).toBeDisabled();
  await expect.poll(() => Boolean(releaseAlpha)).toBe(true);
  await button("Podcasts").tap(); await expect(all()).toBeDisabled();
  holdAlpha = false; releaseAlpha();
  await expect(status).toContainText("Queued Alpha latest."); expect(alphaLoads).toBe(1);
  let saved = await session();
  expect(saved.playlist.tracks.map((t) => t.title)).toEqual(["Current", "Album next", "Already queued", "Alpha latest"]);
  expect(saved.playlist.queue).toEqual([2, 3]); expect(saved.track.title).toBe("Current");
  expect(mediaRequests.length).toBe(requests);
  expect(await page.evaluate(() => window.__media.find((m) => !m.paused).currentTime)).toBeGreaterThan(before);
  // The latest episode is already marked played; native still appends it again.
  await all().tap(); await expect(status).toContainText("Added the newest episode of 2 show(s).");
  await expect(status).toContainText("2 show(s) failed to load: Blocked show.");
  saved = await session();
  expect(saved.playlist.tracks.map((t) => t.title)).toEqual(["Current", "Album next", "Already queued", "Alpha latest", "Alpha latest", "Beta first"]);
  expect(saved.playlist.queue).toEqual([2, 3]); expect(saved.track.title).toBe("Current");
  const shots = process.env.HOME + "/cliamp-podcast-latest-evidence"; await mkdir(shots, { recursive: true });
  await page.screenshot({ path: shots + "/podcast-latest-podcasts-804x638.png" });
  await button("Favorites").tap();
  await page.screenshot({ path: shots + "/podcast-latest-804x638.png" });
  await latest("Empty show").tap(); await expect(status).toContainText("No playable episodes in Empty show.");
  expect((await session()).playlist.tracks).toHaveLength(6);
  await latest("Blocked show").tap(); await expect(status).toContainText("feed 403"); await expect(all()).toBeEnabled();
  // Show buttons still open the correct feed for subscriptions without Apple IDs.
  await button("Beta").tap(); await expect(button("Beta first")).toBeVisible();
  await button("Back").tap(); await button(alpha).tap(); await expect(button("Alpha latest")).toBeVisible();
  await button("Favorites").tap(); await page.setViewportSize({ width: 360, height: 740 });
  await expect(latest(alpha)).toBeInViewport();
  expect(await page.locator(".subscription-row button").evaluateAll((buttons) => buttons.every((button) => {
    const b = button.getBoundingClientRect(), r = button.closest(".subscription-row").getBoundingClientRect();
    return b.top >= r.top && b.bottom <= r.bottom + 1 && b.left >= r.left && b.right <= r.right + 1;
  }))).toBe(true);
  const b = await latest(alpha).boundingBox(); expect(b.height).toBeGreaterThanOrEqual(56); expect(b.width).toBeGreaterThanOrEqual(56);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: shots + "/podcast-latest-360x740.png" });
  await button("Now Playing").tap(); await button("Play/Pause").tap(); // pause
  await button("Favorites").tap(); await latest("Beta").tap(); await expect(status).toContainText("Queued Beta first.");
  await button("Now Playing").tap(); await expect(page.locator(".time-status .state")).toHaveText("Paused");
  expect((await session()).playlist.queue).toEqual([2, 3, 6]);
  await page.reload(); expect((await session()).playlist.queue).toEqual([2, 3, 6]);
  // Loading into an empty stopped playlist must not autoplay or skip the first item on Play.
  await page.addInitScript(() => {
    if (localStorage.getItem("latest-empty-fixture")) {
      localStorage.removeItem("cliamp-web:session"); localStorage.removeItem("cliamp-web:resume");
      localStorage.removeItem("latest-empty-fixture");
    }
  });
  await page.evaluate(() => localStorage.setItem("latest-empty-fixture", "1"));
  await page.reload(); await button("Favorites").tap(); await all().tap();
  await expect(status).toContainText("Added the newest episode of 2 show(s).");
  saved = await session(); expect(saved.playlist.queue).toEqual([]); expect(saved.playlist.tracks).toHaveLength(2);
  expect(await page.evaluate(() => window.__media.every((m) => m.paused))).toBe(true);
  await button("Now Playing").tap(); await button("Play/Pause").tap(); await expect(page.locator(".track-line")).toContainText("Alpha latest");
  await expect(page.locator(".time-status .state")).toHaveText("Playing");
  expect(errors).toEqual([]);
  console.log(JSON.stringify({ passed: true, checks: ["native date/tie/feed-order selection", "single latest FIFO queue append", "batch appends in subscription order without queueing", "duplicates and played episodes retained", "shared busy guard across navigation", "partial/empty/error feedback", "audio continuity and pause retention", "persisted playlist/queue", "no autoplay from empty playlist", "ID-less saved show navigation", "804×638 and 360×740 touch layout"], screenshots: shots }));
} finally { await context.close(); await browser.close(); }
