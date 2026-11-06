// Run inside omabox: npm run test:browser (build first).
import { chromium, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium", headless: true,
  args: ["--no-sandbox", "--mute-audio", "--disable-dev-shm-usage", "--disable-gpu"] });
const context = await browser.newContext({ viewport: { width: 804, height: 638 }, hasTouch: true, deviceScaleFactor: 1.96 });
const page = await context.newPage();
await page.addInitScript(() => {
  window.__workletUrls = [];
  window.__mediaElements = [];
  const OriginalAudio = window.Audio;
  window.Audio = function (...args) { const media = new OriginalAudio(...args); window.__mediaElements.push(media); return media; };
  window.Audio.prototype = OriginalAudio.prototype;
  const Original = window.AudioContext;
  window.AudioContext = class extends Original {
    constructor(...args) {
      super(...args);
      const addModule = this.audioWorklet.addModule.bind(this.audioWorklet);
      this.audioWorklet.addModule = (url, ...options) => { window.__workletUrls.push(String(url)); return addModule(url, ...options); };
    }
  };
});
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const origin = "http://127.0.0.1:4173";
const app = origin + "/cliamp-web/";
const requests = [];
page.on("request", (r) => requests.push(r.url()));
const send = (route, body) => route.fulfill({ json: body });
await page.route("https://radio.cliamp.stream/**", (route) => {
  const path = new URL(route.request().url()).pathname;
  if (path === "/stations") return send(route, { stations: [
    { id: "demo", name: "Demo channel", stream: origin + "/live.wav", tracks: 3, tracks_url: "https://radio.cliamp.stream/demo/tracks" },
    { id: "plain", name: "No-CORS live", stream: "http://127.0.0.1:4174/long.wav" },
  ] });
  if (path.endsWith("statistics")) return send(route, { stations: { demo: { active_listeners: 2 } } });
  return send(route, { tracks: [
    { url: origin + "/a.wav", title: "Fixture A", duration: 4 },
    { url: origin + "/b.wav", title: "Fixture B", duration: 4 },
    { url: origin + "/long.wav", title: "Fixture C", duration: 30 },
  ] });
});
try {
  await page.goto(app);
  const playerVolume = page.getByRole("slider", { name: "Player volume", exact: true });
  await expect(playerVolume).not.toBeVisible();
  await page.getByRole("button", { name: "MORE", exact: true }).tap();
  await expect(playerVolume).toHaveValue("0");
  await playerVolume.focus(); await playerVolume.press("ArrowLeft");
  await expect(playerVolume).toHaveValue("-1");
  await page.reload();
  await expect(playerVolume).not.toBeVisible();
  await page.getByRole("button", { name: "MORE", exact: true }).tap();
  await expect(playerVolume).toHaveValue("-1");
  await page.getByRole("button", { name: "Reset player volume", exact: true }).tap();
  await expect(playerVolume).toHaveValue("0");
  const band70 = page.getByRole("slider", { name: "EQ 70 Hz", exact: true });
  await band70.tap({ position: { x: 30, y: 30 } });
  const customGain = Number(await band70.inputValue());
  expect(customGain).toBeGreaterThan(0);
  await expect(page.getByRole("button", { name: "EQ preset: Custom", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Save custom EQ", exact: true }).tap();
  await expect(page.getByRole("status")).toContainText("Custom EQ saved");
  const eqScreenshots = join(process.env.HOME, "cliamp-browser-evidence"); await mkdir(eqScreenshots, { recursive: true });
  await page.screenshot({ path: join(eqScreenshots, "eq-controls-804x638.png") });
  await page.getByRole("button", { name: "EQ preset: Custom", exact: true }).tap();
  const eqDialog = page.getByRole("dialog", { name: "Choose EQ preset" });
  await expect(eqDialog).toBeVisible();
  await page.screenshot({ path: join(eqScreenshots, "eq-presets-804x638.png") });
  await eqDialog.getByRole("button", { name: "Rock", exact: true }).tap();
  await expect(eqDialog).not.toBeVisible();
  await expect(band70).toHaveValue("5");
  await page.getByRole("button", { name: "EQ preset: Rock", exact: true }).tap();
  await eqDialog.getByRole("button", { name: "Saved custom EQ", exact: true }).tap();
  await expect(band70).toHaveValue(String(customGain));
  await page.reload();
  await page.getByRole("button", { name: "MORE", exact: true }).tap();
  await expect(band70).toHaveValue(String(customGain));
  await expect(page.getByRole("button", { name: "Save custom EQ", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "EQ preset: Custom", exact: true }).tap();
  await page.keyboard.press("Escape");
  await expect(eqDialog).not.toBeVisible();
  await expect(page.getByRole("button", { name: "EQ preset: Custom", exact: true })).toBeFocused();
  await page.getByRole("button", { name: "Close playback options", exact: true }).tap();
  await expect(playerVolume).not.toBeVisible();
  await page.getByRole("button", { name: "Radio", exact: true }).tap();
  await page.getByRole("button", { name: "Demo channel", exact: true }).tap();
  await page.getByRole("button", { name: "Now Playing", exact: true }).tap();
  await expect(page.locator(".track-line")).toContainText("Fixture A");
  await expect(page.locator(".time-status .state")).toHaveText("Playing");
  await expect(page.locator(".track-line")).toContainText("Fixture B", { timeout: 10000 });
  await expect(page.locator(".track-line")).toContainText("Fixture C", { timeout: 10000 });
  await page.getByRole("button", { name: "MORE", exact: true }).tap();
  await page.getByRole("button", { name: /EQ preset:/ }).tap();
  await page.getByRole("dialog", { name: "Choose EQ preset" }).getByRole("button", { name: "Flat", exact: true }).tap();
  await expect(page.locator(".time-status .state")).toHaveText("Playing");
  await expect(page.getByText("EQ is unavailable for this source.", { exact: false })).not.toBeVisible();
  await page.getByRole("button", { name: "Close playback options", exact: true }).tap();
  await expect(page.getByRole("button", { name: "Open queue", exact: true })).not.toBeVisible();
  await page.getByRole("button", { name: "MORE", exact: true }).tap();
  await page.getByRole("button", { name: "Open queue", exact: true }).tap();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await page.getByRole("button", { name: "Play next: Fixture A", exact: true }).evaluate((el) => el.getBoundingClientRect().height)).toBeGreaterThanOrEqual(56);
  await page.getByRole("button", { name: "Play next: Fixture A", exact: true }).tap();
  await page.getByRole("button", { name: /Play next \(1\)/ }).tap();
  await expect(page.getByRole("button", { name: "Play: Fixture A", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Play queue", exact: true }).tap();
  await expect(page.getByRole("button", { name: /Play next \(0\)/ })).toBeVisible();
  await page.getByRole("button", { name: "Back to playback", exact: true }).tap();
  await expect(page.locator(".track-line")).toContainText("Fixture A");
  await page.getByRole("button", { name: "MORE", exact: true }).tap();
  await page.getByRole("button", { name: "Open queue", exact: true }).tap();
  await page.getByRole("button", { name: "Save playlist", exact: true }).tap();
  await page.getByRole("textbox", { name: "Playlist name" }).fill("Tesla commute");
  await page.getByRole("button", { name: "Save", exact: true }).tap();
  await page.getByRole("button", { name: "Saved playlists", exact: true }).tap();
  await expect(page.getByRole("button", { name: "Play playlist: Tesla commute", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Playlist (3)", exact: true }).tap();
  await page.getByRole("button", { name: "Play: Fixture C", exact: true }).tap();
  await page.getByRole("button", { name: "Back to playback", exact: true }).tap();
  await page.getByRole("button", { name: "Play/Pause", exact: true }).tap();
  await expect(page.locator(".time-status .state")).toHaveText("Paused");
  await page.getByRole("button", { name: "MORE", exact: true }).tap();
  const beforeReverse = await page.locator(".list .row .title").allTextContents();
  await page.getByRole("button", { name: "Reverse list", exact: true }).tap();
  expect(await page.locator(".list .row .title").allTextContents()).toEqual(beforeReverse.toReversed());
  await expect(page.locator(".track-line")).toContainText("Fixture C");
  await page.getByRole("button", { name: /EQ preset:/ }).tap();
  await page.getByRole("dialog", { name: "Choose EQ preset" }).getByRole("button", { name: "Small Speakers", exact: true }).tap();
  await expect(page.getByRole("button", { name: "EQ preset: Small Speakers", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Close playback options" }).tap();
  expect(await page.evaluate(() => window.__workletUrls)).toContain(app + "worklets/wsola.js");
  expect(requests).not.toContain(origin + "/worklets/wsola.js");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const transport = await page.getByRole("button", { name: "Play/Pause", exact: true }).boundingBox();
  expect(transport.y + transport.height).toBeLessThan(558); // stays above bottom navigation
  const row = await page.locator(".list .row").first().boundingBox();
  const list = await page.locator(".list").boundingBox();
  expect(row.y + row.height).toBeLessThanOrEqual(list.y + list.height + 1);
  // Each new mode remains selected on reload, including a migrated legacy None.
  for (const name of ["YinYang", "Ethereal", "None"]) {
    await page.evaluate((n) => localStorage.setItem("cliamp-web:viz", n), name); await page.reload();
    await expect(page.locator("canvas.visualizer")).toHaveAttribute("aria-label", `Visualizer: ${name}. Tap to switch.`);
  }
  await page.evaluate(() => localStorage.setItem("cliamp-web:viz", "32")); await page.reload();
  await expect(page.locator("canvas.visualizer")).toHaveAttribute("aria-label", "Visualizer: None. Tap to switch.");
  await page.getByRole("button", { name: "Radio", exact: true }).tap();
  await page.getByRole("button", { name: "No-CORS live", exact: true }).tap();
  await page.getByRole("button", { name: "Now Playing", exact: true }).tap();
  await expect(page.locator(".track-line")).toContainText("No-CORS live");
  await expect(page.locator(".time-status .state")).toHaveText("Playing");
  await expect(page.locator(".time-status")).toContainText("0:01", { timeout: 5000 });
  await page.getByRole("button", { name: "Play/Pause", exact: true }).tap();
  // Fixture Navidrome credentials and song; no personal server is contacted.
  await page.addInitScript((origin) => {
    if (sessionStorage.getItem("fixture:navidrome-seeded")) return;
    sessionStorage.setItem("fixture:navidrome-seeded", "1");
    localStorage.setItem("cliamp-web:servers", JSON.stringify({ navidrome: { url: origin, user: "fixture", password: "fixture" } }));
    localStorage.setItem("cliamp-web:resume", JSON.stringify({ track: { path: "navidrome://song/1", title: "Rated fixture", provider: "navidrome", providerMeta: { songId: "1" }, rating: 2 }, position: 0, at: Date.now() }));
    localStorage.removeItem("cliamp-web:session");
  }, origin);
  let rating = 2;
  await page.route("**/rest/setRating?*", async (route) => {
    rating = Number(new URL(route.request().url()).searchParams.get("rating")); await send(route, { "subsonic-response": { status: "ok" } });
  });
  await page.reload();
  await page.getByRole("button", { name: "Play/Pause", exact: true }).tap();
  await expect(page.locator(".time-status .state")).toHaveText("Playing");
  await page.getByRole("button", { name: "MORE", exact: true }).tap();
  await page.getByRole("combobox", { name: "Track rating" }).selectOption("5");
  await expect(page.getByRole("combobox", { name: "Track rating" })).toHaveValue("5");
  expect(rating).toBe(5);
  await page.getByRole("button", { name: "Close playback options" }).tap();
  await page.getByRole("button", { name: "Play/Pause", exact: true }).tap();
  await page.getByRole("button", { name: "MORE", exact: true }).tap();
  await page.getByRole("button", { name: /EQ preset:/ }).tap();
  await page.getByRole("dialog", { name: "Choose EQ preset" }).getByRole("button", { name: "Rock", exact: true }).tap();
  await expect(page.getByRole("combobox", { name: "Track rating" })).toHaveValue("5");
  await page.route("**/rest/setRating?*", (route) => send(route, { "subsonic-response": { status: "failed", error: { message: "Fixture denial" } } }));
  await page.getByRole("combobox", { name: "Track rating" }).selectOption("1");
  await expect(page.getByRole("combobox", { name: "Track rating" })).toHaveValue("5");
  await expect(page.locator(".status-row.is-error")).toContainText("Fixture denial");
  await page.getByRole("button", { name: "Close playback options" }).tap();
  const screenshots = join(process.env.HOME, "cliamp-browser-evidence"); await mkdir(screenshots, { recursive: true });
  await expect(page.locator(".status-row.is-error")).toBeInViewport();
  await page.screenshot({ path: join(screenshots, "touch-804x638.png") });
  for (const name of ["YinYang", "Ethereal"]) {
    await page.evaluate((n) => localStorage.setItem("cliamp-web:viz", n), name); await page.reload();
    await page.getByRole("button", { name: "Play/Pause", exact: true }).tap();
    await expect(page.locator(".time-status .state")).toHaveText("Playing");
    await expect(page.locator("canvas.visualizer")).toHaveAttribute("aria-label", `Visualizer: ${name}. Tap to switch.`);
    await page.evaluate(() => new Promise(requestAnimationFrame));
    await page.screenshot({ path: join(screenshots, `${name.toLowerCase()}-804x638.png`) });
  }
  // Theme selection is reachable from playback and Settings without stopping audio.
  await page.getByRole("button", { name: "Open full visualizer", exact: true }).tap();
  await expect(page.getByRole("button", { name: "Exit immersive visualizer", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Volume down", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Volume up", exact: true })).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Primary" })).toHaveCount(0);
  await page.getByRole("button", { name: "Exit immersive visualizer", exact: true }).tap();
  await page.getByRole("button", { name: "MORE", exact: true }).tap();
  await page.getByRole("button", { name: "Choose theme: winamp", exact: true }).tap();
  const themePicker = page.getByRole("combobox", { name: "Theme", exact: true });
  await expect(themePicker).toBeInViewport();
  await expect(themePicker.locator("option")).toHaveCount(22);
  const themeBox = await themePicker.boundingBox();
  expect(themeBox.height).toBeGreaterThanOrEqual(56);
  await themePicker.selectOption("catppuccin");
  await expect(themePicker).toHaveValue("catppuccin");
  expect(await page.evaluate(() => document.documentElement.style.getPropertyValue("--accent"))).toBe("#89b4fa");
  await page.getByRole("button", { name: "Now Playing", exact: true }).tap();
  await page.getByRole("button", { name: "MORE", exact: true }).tap();
  await expect(page.getByRole("button", { name: "Choose theme: catppuccin", exact: true })).toBeVisible();
  await expect(page.locator(".time-status .state")).toHaveText("Playing");
  await page.reload();
  await page.getByRole("button", { name: "MORE", exact: true }).tap();
  await expect(page.getByRole("button", { name: "Choose theme: catppuccin", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Settings", exact: true }).tap();
  await expect(themePicker).toHaveValue("catppuccin");
  await expect(page.getByRole("heading", { name: "Plugins", exact: true })).toBeVisible();
  const plugin = page.getByRole("button", { name: /webhook.*ENABLED/ });
  await plugin.tap();
  await expect(page.getByRole("button", { name: /webhook.*DISABLED/ })).toHaveAttribute("aria-pressed", "false");
  await themePicker.selectOption("catppuccin-latte");
  expect(await page.evaluate(() => document.documentElement.style.getPropertyValue("--bg"))).toBe("#eff1f5");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await themePicker.selectOption("catppuccin");
  await page.locator(".list").evaluate((el) => { el.scrollTop = 0; });
  await page.evaluate(() => new Promise(requestAnimationFrame));
  await page.screenshot({ path: join(screenshots, "theme-picker-804x638.png") });
  await page.getByRole("button", { name: "Radio", exact: true }).tap();
  await page.getByRole("button", { name: "No-CORS live", exact: true }).getByRole("button", { name: "Favorite station", exact: true }).tap();
  await page.getByRole("button", { name: "Favorites", exact: true }).tap();
  await expect(page.getByRole("button", { name: "No-CORS live", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "No-CORS live", exact: true }).tap();
  await page.getByRole("button", { name: "Now Playing", exact: true }).tap();
  await expect(page.locator(".track-line")).toContainText("No-CORS live");
  await expect(page.locator(".time-status .state")).toHaveText("Playing");
  await page.getByRole("button", { name: "Play/Pause", exact: true }).tap();
  await page.addInitScript((origin) => localStorage.setItem("cliamp-web:podcast-subs", JSON.stringify([{ name: "Saved fixture show", feedUrl: origin + "/feed.xml", collectionId: 77 }])), origin);
  await page.route("**/feed.xml", (route) => route.fulfill({ contentType: "application/rss+xml", body: `<rss version="2.0"><channel><title>Saved fixture show</title><item><title>Fixture episode</title><guid>fixture-1</guid><enclosure url="${origin}/spoken.wav" type="audio/wav" /></item></channel></rss>` }));
  await page.reload();
  await page.getByRole("button", { name: "Favorites", exact: true }).tap();
  await page.getByRole("button", { name: "Saved fixture show", exact: true }).tap();
  await expect(page.getByRole("button", { name: "Fixture episode", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Fixture episode", exact: true }).tap();
  await page.getByRole("button", { name: "Now Playing", exact: true }).tap();
  await expect(page.locator(".track-line")).toContainText("Fixture episode");
  await expect(page.locator(".time-status .state")).toHaveText("Playing");
  await page.getByRole("button", { name: "MORE", exact: true }).tap();
  await expect(page.getByText("EQ is unavailable for this source.", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Close playback options", exact: true }).tap();
  await page.waitForFunction(() => window.__mediaElements.some((m) => !m.paused && m.duration >= 25 && m.currentTime >= 16), null, { timeout: 25000 });
  await page.getByRole("button", { name: "Play/Pause", exact: true }).tap();
  const savedProgress = await page.evaluate(() => JSON.parse(localStorage.getItem("cliamp-web:listening-progress")));
  expect(savedProgress.entries).toHaveLength(1);
  expect(savedProgress.entries[0].position).toBeGreaterThanOrEqual(14);
  await page.reload();
  await page.getByRole("button", { name: "Play/Pause", exact: true }).tap();
  await expect(page.locator(".track-line")).toContainText("Fixture episode");
  await expect(page.locator(".time-status .state")).toHaveText("Playing");
  const resumeAt = Math.max(0, savedProgress.entries[0].position - 5);
  expect(await page.evaluate((position) => window.__mediaElements.some((m) => !m.paused && m.duration >= 120 && Math.abs(m.currentTime - position) < 2), resumeAt)).toBe(true);
  expect(errors).toEqual([]);
  console.log(JSON.stringify({ passed: true, viewport: "804×638 touch, DPR 1.96", checks: ["subpath worklet", "three-track automatic progression", "queue play-next ordering and consumption", "saved playlist creation", "pause", "playlist reversal", "EQ preset dialog and Escape focus return", "touch frequency adjustment", "preset change during playback", "direct-source EQ availability notice", "saved custom EQ across presets and reload", "volume under MORE with persisted gain and reset", "visualizer persistence", "legacy None migration", "non-CORS media progression", "rating success/failure and metadata retention", "22-theme picker via playback and Settings", "live theme application without stopping playback", "theme persistence", "light and dark themes", "plugin toggles remain accessible", "Tesla FAVS station playback", "saved podcast opens and plays", "podcast progress persistence and five-second rewind", "immersive enter/exit", "no horizontal overflow", "no uncaught JS errors"], screenshots }));
} finally { await context.close(); await browser.close(); }
