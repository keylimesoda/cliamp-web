// Production-build session restore with fictional radio playlists and WAV media.
// Run inside omabox, with tests/preview-server.mjs on 4173/4174.
import { chromium, expect } from "@playwright/test";

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium", headless: true,
  args: ["--no-sandbox", "--mute-audio", "--disable-dev-shm-usage", "--disable-gpu"] });
const context = await browser.newContext({ viewport: { width: 804, height: 638 }, hasTouch: true, deviceScaleFactor: 1.96 });
const page = await context.newPage(), errors = [], mediaRequests = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("request", (r) => { if (r.url().endsWith(".wav")) mediaRequests.push(r.url()); });
await page.addInitScript(() => {
  window.__mediaElements = [];
  const Original = window.Audio;
  window.Audio = function (...args) { const media = new Original(...args); window.__mediaElements.push(media); return media; };
  window.Audio.prototype = Original.prototype;
});
const origin = "http://127.0.0.1:4173", app = origin + "/cliamp-web/";
await page.route("https://radio.cliamp.stream/**", (route) => {
  const path = new URL(route.request().url()).pathname;
  if (path === "/stations") return route.fulfill({ json: { stations: [
    { id: "session", name: "Session fixture", stream: origin + "/long-live.wav", tracks: 3, tracks_url: "https://radio.cliamp.stream/session/tracks" },
    { id: "live", name: "Live fixture", stream: origin + "/long-live.wav" },
  ] } });
  if (path.endsWith("statistics")) return route.fulfill({ json: { stations: {} } });
  return route.fulfill({ json: { tracks: ["A", "B", "C"].map((name) => ({ title: `Session ${name}`, url: `${origin}/long-${name}.wav`, duration: 30 })) } });
});
const button = (name) => page.getByRole("button", { name, exact: true });
const session = () => page.evaluate(() => JSON.parse(localStorage.getItem("cliamp-web:session")));
const more = () => button("MORE").tap();
const close = () => button("Close playback options").tap();
const openQueue = async () => { await more(); await button("Open queue").tap(); };
const stopped = async () => {
  await expect(page.locator(".time-status .state")).toHaveText("Stopped");
  expect(await page.evaluate(() => window.__mediaElements.every((m) => m.paused))).toBe(true);
};
try {
  await page.goto(app);
  await button("Radio").tap(); await button("Session fixture").tap(); await button("Now Playing").tap();
  await expect(page.locator(".track-line")).toContainText("Session A");
  await page.waitForFunction(() => window.__mediaElements.some((m) => !m.paused && m.currentTime >= 2));
  await button("Play/Pause").tap();
  await openQueue();
  await button("Play next: Session C").tap(); await button("Play next: Session B").tap();
  await button("Play next (2)").tap(); await button("Move down: Session B").tap();
  await expect(page.locator(".queue-track .title")).toHaveText(["Session C", "Session B"]);
  await button("Back to playback").tap();
  const saved = await session(); expect(saved.position).toBeGreaterThanOrEqual(2);
  mediaRequests.length = 0; await page.reload(); await stopped();
  await expect(page.locator(".track-line")).toContainText("Session A");
  await expect(page.locator(".list .row .title")).toHaveText(["Session A", "Session B", "Session C"]);
  expect(mediaRequests).toEqual([]); // restoring never resolves/preloads/plays audio
  await more(); await button("Shuffle Off").tap(); await button("Repeat Off").tap(); await close();
  const shuffled = await session();
  await page.reload(); await stopped();
  const restored = await session();
  expect(restored.playlist).toEqual(shuffled.playlist);
  expect(restored.position).toBe(saved.position);
  await openQueue(); await button("Play next (2)").tap();
  await expect(page.locator(".queue-track .title")).toHaveText(["Session C", "Session B"]);
  await button("Remove: Session B").tap(); await button("Back to playback").tap();
  await page.reload(); await stopped();
  expect((await session()).playlist.queue).toHaveLength(1);
  expect((await session()).position).toBe(saved.position);
  await more(); await expect(button("Shuffle On")).toBeVisible(); await expect(button("Repeat All")).toBeVisible(); await close();
  await button("Play/Pause").tap();
  await expect(page.locator(".time-status .state")).toHaveText("Playing");
  await page.waitForFunction((position) => window.__mediaElements.some((m) => !m.paused && m.currentTime >= position - 0.5), saved.position);
  await button("Next").tap(); await expect(page.locator(".track-line")).toContainText("Session C");
  await button("Play/Pause").tap();
  await page.reload(); await stopped();
  await expect(page.locator(".track-line")).toContainText("Session C");
  expect((await session()).playlist.queue).toHaveLength(0);
  // Preserve the album cursor separately from the consumed play-next track.
  await more(); await button("Shuffle On").tap(); await close();
  await button("Play/Pause").tap(); await expect(page.locator(".time-status .state")).toHaveText("Playing");
  await button("Next").tap(); await expect(page.locator(".track-line")).toContainText("Session B");
  await button("Play/Pause").tap();
  await button("Radio").tap(); await button("Live fixture").tap(); await button("Now Playing").tap();
  await expect(page.locator(".time-status .state")).toHaveText("Playing");
  await button("Play/Pause").tap(); await page.reload(); await stopped();
  await expect(page.locator(".track-line")).toContainText("Live fixture");
  expect((await session()).position).toBe(0);
  await button("Play/Pause").tap(); await expect(page.locator(".time-status .state")).toHaveText("Playing");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
  console.log(JSON.stringify({ passed: true, viewport: "804×638 touch, DPR 1.96", checks: ["playlist and moved play-next queue restore", "exact shuffle order and repeat restore", "queue edits before Play survive another reload", "finite position resumes on tap", "consumed play-next track retains album continuation", "live station restores without seeking", "no autoplay or provider resolution on reload", "no overflow or page errors"] }));
} finally { await context.close(); await browser.close(); }
