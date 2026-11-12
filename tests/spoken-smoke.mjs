// Fictional podcasts/ABS books, real media clocks, and touch controls.
// Build first; run inside omabox with tests/preview-server.mjs on 4173/4174.
import { chromium, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium", headless: true,
  args: ["--no-sandbox", "--mute-audio", "--disable-dev-shm-usage", "--disable-gpu"] });
const context = await browser.newContext({ viewport: { width: 804, height: 638 }, hasTouch: true, deviceScaleFactor: 1.96 });
const page = await context.newPage(), errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const origin = "http://127.0.0.1:4173", app = origin + "/cliamp-web/";
await page.addInitScript((origin) => {
  window.__media = []; window.__analysers = []; window.__contexts = []; window.__handlers = {};
  const AudioOriginal = window.Audio;
  window.Audio = function (...args) { const media = new AudioOriginal(...args); window.__media.push(media); return media; };
  window.Audio.prototype = AudioOriginal.prototype;
  const ContextOriginal = window.AudioContext;
  window.AudioContext = class extends ContextOriginal {
    constructor(...args) {
      super(...args); window.__contexts.push(this);
      const create = this.createAnalyser.bind(this);
      this.createAnalyser = () => { const node = create(); window.__analysers.push(node); return node; };
    }
  };
  const originalHandler = navigator.mediaSession.setActionHandler.bind(navigator.mediaSession);
  navigator.mediaSession.setActionHandler = (action, handler) => { window.__handlers[action] = handler; originalHandler(action, handler); };
  if (sessionStorage.getItem("fixture:spoken-seeded")) return;
  sessionStorage.setItem("fixture:spoken-seeded", "1");
  localStorage.setItem("cliamp-web:settings", JSON.stringify({ theme: "gruvbox", spokenSpeed: 1.5 }));
  localStorage.setItem("cliamp-web:servers", JSON.stringify({ audiobookshelf: { url: origin, token: "fixture-token" } }));
  const music = { path: origin + "/long-music.wav", title: "Music fixture", provider: "url", durationSecs: 30 };
  const books = [11, 12].map((ino) => ({ path: `audiobookshelf://book/book/${ino}`, title: ino === 11 ? "The morning commute · Part one" : "Book · Part two",
    provider: "audiobookshelf", kind: "audiobook", durationSecs: ino === 11 ? 180 : 4,
    providerMeta: { itemId: "book", ino: String(ino), serverUrl: origin } }));
  const podcasts = [1, 2].map((n) => ({ path: origin + (n === 1 ? "/spoken-podcast.wav" : "/episode-two.wav"), title: `Podcast episode ${n}`,
    provider: "podcast", kind: "podcast", feed: "https://podcast.fixture/feed", guid: String(n), durationSecs: n === 1 ? 180 : 4 }));
  const radio = { path: origin + "/long-radio.wav", title: "Live radio fixture", provider: "radio", stream: true, live: true };
  localStorage.setItem("cliamp-web:playlists", JSON.stringify({ version: 1, lists: [
    { id: "books", name: "Books fixture", tracks: [...books, music], updatedAt: Date.now() },
    { id: "podcasts", name: "Podcasts fixture", tracks: [...podcasts, music], updatedAt: Date.now() },
    { id: "radio", name: "Radio fixture", tracks: [radio], updatedAt: Date.now() },
  ] }));
}, origin);
await page.route("**/api/items/book/file/*?*", async (route) => {
  const part = new URL(route.request().url()).pathname.split("/").at(-1);
  const response = await route.fetch({ url: origin + (part === "11" ? "/spoken-book.wav" : "/book-part-two.wav") });
  await route.fulfill({ response });
});
const button = (name) => page.getByRole("button", { name, exact: true });
const state = page.locator(".time-status .state");
const media = () => page.evaluate(() => window.__media.find((m) => m.src && !m.paused)?.currentTime);
const playing = () => expect(state).toHaveText("Playing");
async function playlist(name) {
  await button("MORE").tap(); await button("Open queue").tap(); await button("Saved playlists").tap();
  await button(`Play playlist: ${name}`).tap(); await playing();
}
async function rate(expected) {
  const result = await page.evaluate(async () => {
    const m = window.__media.find((m) => !m.paused && m.src), start = m.currentTime, wall = performance.now();
    await new Promise((resolve) => setTimeout(resolve, 1500)); // measure real source-time versus wall-time
    return { ratio: (m.currentTime - start) / ((performance.now() - wall) / 1000), rate: m.playbackRate, pitch: m.preservesPitch };
  });
  expect(result.rate).toBe(expected); expect(result.pitch).toBe(true);
  expect(result.ratio).toBeGreaterThan(expected - 0.2); expect(result.ratio).toBeLessThan(expected + 0.2);
}
try {
  await page.goto(app); await playlist("Books fixture");
  await expect(page.getByRole("combobox", { name: "Playback speed" })).toHaveValue("1.5");
  await rate(1.5);
  await page.getByRole("combobox", { name: "Playback speed" }).selectOption("2"); await rate(2);
  const pitch = await page.evaluate(() => {
    const node = window.__analysers.at(-1), samples = new Float32Array(node.fftSize); node.getFloatTimeDomainData(samples);
    let crossings = 0, square = 0;
    for (let i = 1; i < samples.length; i++) { if (samples[i - 1] <= 0 && samples[i] > 0) crossings++; square += samples[i] * samples[i]; }
    return { hz: crossings * window.__contexts.at(-1).sampleRate / samples.length, rms: Math.sqrt(square / samples.length) };
  });
  expect(pitch.rms).toBeGreaterThan(0.01); expect(pitch.hz).toBeGreaterThan(400); expect(pitch.hz).toBeLessThan(480);
  const screenshots = process.env.HOME + "/cliamp-spoken-evidence"; await mkdir(screenshots, { recursive: true });
  for (const locator of [button("Rewind 15 seconds"), button("Forward 30 seconds"), page.getByRole("combobox", { name: "Playback speed" })]) {
    const box = await locator.boundingBox(); expect(box.width).toBeGreaterThanOrEqual(56); expect(box.height).toBeGreaterThanOrEqual(56);
  }
  await page.screenshot({ path: screenshots + "/spoken-controls-804x638.png" });
  await button("Play/Pause").tap(); await expect(state).toHaveText("Paused");
  await button("Rewind 15 seconds").tap();
  expect(await page.evaluate(() => window.__media.find((m) => m.src)?.currentTime)).toBeLessThan(0.5);
  await button("Forward 30 seconds").tap(); await expect(state).toHaveText("Paused");
  expect(await page.evaluate(() => window.__media.find((m) => m.src)?.currentTime)).toBeCloseTo(30, 0);
  await page.evaluate(() => { const m = window.__media.find((m) => m.src); m.currentTime = 175; });
  await expect(state).toHaveText("Paused"); await button("Forward 30 seconds").tap(); await expect(state).toHaveText("Paused");
  expect(await page.evaluate(() => window.__media.find((m) => m.src)?.currentTime)).toBeCloseTo(179.9, 0);
  for (let i = 0; i < 6; i++) { await button("Rewind 15 seconds").tap(); await expect(state).toHaveText("Paused"); }
  await page.reload(); await expect(state).toHaveText("Stopped");
  await expect(button("Forward 30 seconds")).toBeDisabled();
  await expect(page.getByRole("combobox", { name: "Playback speed" })).toHaveValue("2");
  await button("Play/Pause").tap(); await playing();
  expect(await media()).toBeGreaterThan(83); expect(await media()).toBeLessThan(87); // saved book position minus five seconds
  await button("Next").tap(); await expect(page.locator(".track-line")).toContainText("Book · Part two");
  expect(await page.evaluate(() => window.__media.find((m) => !m.paused)?.playbackRate)).toBe(2);
  await expect(page.locator(".track-line")).toContainText("Music fixture", { timeout: 5000 });
  expect(await page.evaluate(() => window.__media.find((m) => !m.paused)?.playbackRate)).toBe(1);
  await expect(button("Forward 30 seconds")).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: "Playback speed" })).toHaveCount(0);
  await playlist("Podcasts fixture"); await rate(2);
  await button("Open full visualizer").tap();
  await expect(button("Rewind 15 seconds")).toBeEnabled();
  await page.getByRole("combobox", { name: "Playback speed" }).selectOption("1.25");
  await expect(page.getByRole("combobox", { name: "Playback speed" })).toHaveValue("1.25");
  await page.screenshot({ path: screenshots + "/spoken-immersive-804x638.png" });
  await page.setViewportSize({ width: 360, height: 740 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await button("Exit immersive visualizer").tap();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: screenshots + "/spoken-controls-360x740.png" });
  await page.setViewportSize({ width: 804, height: 638 });
  await page.getByRole("combobox", { name: "Playback speed" }).selectOption("2");
  await button("Next").tap(); await expect(page.locator(".track-line")).toContainText("Podcast episode 2");
  expect(await page.evaluate(() => window.__media.find((m) => !m.paused)?.playbackRate)).toBe(2);
  await expect(page.locator(".track-line")).toContainText("Music fixture", { timeout: 5000 });
  await playlist("Radio fixture");
  await expect(button("Rewind 15 seconds")).toHaveCount(0);
  expect(await page.evaluate(() => ["seekforward", "seekbackward", "seekto"].every((action) => window.__handlers[action] === null))).toBe(true);
  expect(errors).toEqual([]);
  console.log(JSON.stringify({ passed: true, checks: ["processed ABS 1.5×/2× source clocks", "440Hz pitch preserved at 2× through EQ graph", "direct podcast 2× clock", "paused relative seeking and file bounds", "speech rate persists across reload and chapters", "music returns to 1×", "natural chapter/episode progression at 2×", "immersive controls", "804×638 and 360×740 touch layout", "live MediaSession seek cleanup"], screenshots }));
} finally { await context.close(); await browser.close(); }
