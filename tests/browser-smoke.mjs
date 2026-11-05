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
  await page.getByRole("button", { name: "📡 Radio", exact: true }).tap();
  await page.getByRole("button", { name: "Demo channel", exact: true }).tap();
  await page.getByRole("button", { name: "♫ Now Playing", exact: true }).tap();
  await expect(page.locator(".track-line")).toContainText("Fixture A");
  await expect(page.locator(".time-status .state")).toHaveText("Playing");
  await expect(page.locator(".track-line")).toContainText("Fixture B", { timeout: 10000 });
  await expect(page.locator(".track-line")).toContainText("Fixture C", { timeout: 10000 });
  await page.getByRole("button", { name: "Play/Pause", exact: true }).tap();
  await expect(page.locator(".time-status .state")).toHaveText("Paused");
  const beforeReverse = await page.locator(".list .row .title").allTextContents();
  await page.getByRole("button", { name: "Reverse list", exact: true }).tap();
  expect(await page.locator(".list .row .title").allTextContents()).toEqual(beforeReverse.toReversed());
  await expect(page.locator(".track-line")).toContainText("Fixture C");
  await page.getByRole("button", { name: "Previous EQ preset" }).tap();
  await expect(page.getByRole("button", { name: "EQ Small Speakers", exact: true })).toBeVisible();
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
    await expect(page.locator(".viz-name")).toHaveText(name);
  }
  await page.evaluate(() => localStorage.setItem("cliamp-web:viz", "32")); await page.reload();
  await expect(page.locator(".viz-name")).toHaveText("None");
  await page.getByRole("button", { name: "📡 Radio", exact: true }).tap();
  await page.getByRole("button", { name: "No-CORS live", exact: true }).tap();
  await page.getByRole("button", { name: "♫ Now Playing", exact: true }).tap();
  await expect(page.locator(".track-line")).toContainText("No-CORS live");
  await expect(page.locator(".time-status .state")).toHaveText("Playing");
  await expect(page.locator(".time-status")).toContainText("0:01", { timeout: 5000 });
  await page.getByRole("button", { name: "Play/Pause", exact: true }).tap();
  // Fixture Navidrome credentials and song; no personal server is contacted.
  await page.addInitScript((origin) => {
    localStorage.setItem("cliamp-web:servers", JSON.stringify({ navidrome: { url: origin, user: "fixture", password: "fixture" } }));
    localStorage.setItem("cliamp-web:resume", JSON.stringify({ track: { path: "navidrome://song/1", title: "Rated fixture", provider: "navidrome", providerMeta: { songId: "1" }, rating: 2 }, position: 0, at: Date.now() }));
  }, origin);
  let rating = 2;
  await page.route("**/rest/setRating?*", async (route) => {
    rating = Number(new URL(route.request().url()).searchParams.get("rating")); await send(route, { "subsonic-response": { status: "ok" } });
  });
  await page.reload();
  await page.getByRole("button", { name: "Play/Pause", exact: true }).tap();
  await expect(page.locator(".time-status .state")).toHaveText("Playing");
  await page.getByRole("combobox", { name: "Track rating" }).selectOption("5");
  await expect(page.getByRole("combobox", { name: "Track rating" })).toHaveValue("5");
  expect(rating).toBe(5);
  await page.getByRole("button", { name: "Play/Pause", exact: true }).tap();
  await page.getByRole("button", { name: "EQ Flat", exact: true }).tap();
  await expect(page.getByRole("combobox", { name: "Track rating" })).toHaveValue("5");
  await page.route("**/rest/setRating?*", (route) => send(route, { "subsonic-response": { status: "failed", error: { message: "Fixture denial" } } }));
  await page.getByRole("combobox", { name: "Track rating" }).selectOption("1");
  await expect(page.getByRole("combobox", { name: "Track rating" })).toHaveValue("5");
  await expect(page.locator(".status-row.is-error")).toContainText("Fixture denial");
  const screenshots = join(process.env.HOME, "cliamp-browser-evidence"); await mkdir(screenshots, { recursive: true });
  await expect(page.locator(".status-row.is-error")).toBeInViewport();
  await page.screenshot({ path: join(screenshots, "touch-804x638.png") });
  for (const name of ["YinYang", "Ethereal"]) {
    await page.evaluate((n) => localStorage.setItem("cliamp-web:viz", n), name); await page.reload();
    await page.getByRole("button", { name: "Play/Pause", exact: true }).tap();
    await expect(page.locator(".time-status .state")).toHaveText("Playing");
    await expect(page.locator(".viz-name")).toHaveText(name);
    await page.evaluate(() => new Promise(requestAnimationFrame));
    await page.screenshot({ path: join(screenshots, `${name.toLowerCase()}-804x638.png`) });
  }
  expect(errors).toEqual([]);
  console.log(JSON.stringify({ passed: true, viewport: "804×638 touch, DPR 1.96", checks: ["subpath worklet", "three-track automatic progression", "pause", "playlist reversal", "previous EQ preset", "visualizer persistence", "legacy None migration", "non-CORS media progression", "rating success/failure and metadata retention", "no horizontal overflow", "no uncaught JS errors"], screenshots }));
} finally { await context.close(); await browser.close(); }
