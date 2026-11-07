// Fictional live station; use a production build in an isolated omabox.
// Requires tests/preview-server.mjs on 4173/4174.
import { chromium, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium", headless: true,
  args: ["--no-sandbox", "--mute-audio", "--disable-dev-shm-usage", "--disable-gpu"] });
const context = await browser.newContext({ viewport: { width: 804, height: 638 }, hasTouch: true, deviceScaleFactor: 1.96 });
const page = await context.newPage(), errors = [], mediaRequests = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("request", (r) => { if (r.url().endsWith(".wav")) mediaRequests.push(r.url()); });
await page.addInitScript(() => {
  window.__media = [];
  const Original = window.Audio;
  window.Audio = function (...args) { const m = new Original(...args); window.__media.push(m); return m; };
  window.Audio.prototype = Original.prototype;
});
const origin = "http://127.0.0.1:4173", app = origin + "/cliamp-web/";
await page.route("https://radio.cliamp.stream/**", (route) => {
  const path = new URL(route.request().url()).pathname;
  return route.fulfill({ json: path === "/stations" ? { stations: [
    { id: "visual", name: "Visualizer fixture", stream: origin + "/spoken-visual.wav" },
  ] } : { stations: {} } });
});
const button = (name) => page.getByRole("button", { name, exact: true });
const canvas = page.locator("canvas.visualizer");
const full = button("Open full visualizer");
const expectMode = async (name) => expect(canvas).toHaveAttribute("aria-label", `Visualizer: ${name}. Tap to switch.`);
try {
  await page.goto(app);
  await button("Radio").tap(); await button("Visualizer fixture").tap(); await button("Now Playing").tap();
  await expect(page.locator(".time-status .state")).toHaveText("Playing");
  const before = await page.evaluate(() => window.__media.find((m) => !m.paused)?.currentTime);
  const requests = mediaRequests.length;
  await expect(page.locator(".viz-name, .visualizer-picker")).toHaveCount(0);
  await expect(page.locator(".transport-row .viz-full-toggle")).toHaveCount(0);
  const checkPosition = async () => {
    const v = await canvas.boundingBox(), b = await full.boundingBox();
    expect(b.width).toBeGreaterThanOrEqual(56); expect(b.height).toBeGreaterThanOrEqual(56);
    expect(b.x).toBeGreaterThanOrEqual(v.x);
    expect(b.x + b.width).toBeLessThan(v.x + v.width / 2);
    expect(b.x + b.width).toBeLessThanOrEqual(v.x + v.width);
    expect(b.y).toBeGreaterThanOrEqual(v.y);
    expect(b.y + b.height).toBeLessThanOrEqual(v.y + v.height);
  };
  const checkClose = async (suffix) => {
    await button("MORE").tap();
    const close = button("Close playback options"), header = page.locator(".advanced-header");
    await expect(close).toBeInViewport();
    const c = await close.boundingBox(), h = await header.boundingBox();
    expect(c.width).toBeGreaterThanOrEqual(56); expect(c.height).toBeGreaterThanOrEqual(56);
    expect(c.x).toBeGreaterThanOrEqual(h.x); expect(c.x + c.width).toBeLessThan(h.x + h.width / 2);
    expect(await header.locator(":scope > :first-child").getAttribute("aria-label")).toBe("Close playback options");
    await page.screenshot({ path: process.env.HOME + "/cliamp-viz-controls-evidence/driver-controls-" + suffix + ".png" });
    await close.tap(); await expect(close).not.toBeVisible();
  };
  await checkPosition(); await expectMode("Bars");
  const screenshotDir = process.env.HOME + "/cliamp-viz-controls-evidence"; await mkdir(screenshotDir, { recursive: true });
  await page.screenshot({ path: screenshotDir + "/visualizer-controls-804x638.png" });
  await checkClose("804x638");
  await full.tap(); await expect(page.locator(".immersive-app")).toBeVisible();
  await expectMode("Bars"); await expect(full).toHaveCount(0);
  await expect(page.locator(".viz-name, .visualizer-picker")).toHaveCount(0);
  await canvas.tap({ position: { x: 130, y: 30 } }); await expectMode("BarsDot");
  await canvas.press("Enter"); await expectMode("Rain");
  await canvas.press("Space"); await expectMode("BarsOutline");
  await button("Exit immersive visualizer").tap(); await expectMode("BarsOutline");
  await checkPosition();
  expect(mediaRequests.length).toBe(requests);
  expect(await page.evaluate(() => window.__media.find((m) => !m.paused)?.currentTime)).toBeGreaterThan(before);
  await full.focus(); await full.press("Enter");
  await expect(page.locator(".immersive-app")).toBeVisible(); await expectMode("BarsOutline");
  await button("Exit immersive visualizer").tap();
  await canvas.tap({ position: { x: 130, y: 30 } }); await expectMode("Bricks");
  await page.reload(); await expectMode("Bricks");
  await page.setViewportSize({ width: 360, height: 740 }); await checkPosition();
  await checkClose("360x740");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await full.tap(); await expect(page.locator(".immersive-app")).toBeVisible();
  await button("Exit immersive visualizer").tap();
  await page.screenshot({ path: screenshotDir + "/visualizer-controls-360x740.png" });
  await page.setViewportSize({ width: 804, height: 638 });
  await button("Settings").tap(); await page.getByRole("combobox", { name: "Theme", exact: true }).selectOption("catppuccin-latte");
  await button("Now Playing").tap(); await checkPosition();
  await page.screenshot({ path: screenshotDir + "/visualizer-controls-light-804x638.png" });
  await checkClose("light-804x638");
  expect(errors).toEqual([]);
  console.log(JSON.stringify({ passed: true, checks: ["no named picker", "V on upper-left with 56px touch target", "Close on left with matching DOM/focus order", "V opens immersive without cycling", "audio continues without reloading", "canvas tap/keyboard cycling in both views", "choice persists", "mobile and light theme"], screenshots: screenshotDir }));
} finally { await context.close(); await browser.close(); }
