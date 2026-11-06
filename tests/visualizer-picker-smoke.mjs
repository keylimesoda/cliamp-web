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
const trigger = () => page.getByRole("button", { name: /^Choose visualizer:/ });
const picker = page.getByRole("dialog", { name: "Choose visualizer", exact: true });
const mode = page.locator(".viz-name");
const choose = async (name) => { await trigger().tap(); await picker.getByRole("button", { name, exact: true }).tap(); await expect(mode).toHaveText(name); };
try {
  await page.goto(app);
  await button("Radio").tap(); await button("Visualizer fixture").tap(); await button("Now Playing").tap();
  await expect(page.locator(".time-status .state")).toHaveText("Playing");
  const before = await page.evaluate(() => window.__media.find((m) => !m.paused)?.currentTime);
  const requests = mediaRequests.length;
  await trigger().tap(); await expect(mode).toHaveText("Bars"); // opening must not cycle
  await expect(picker.locator(".visualizer-picker-options button")).toHaveCount(35);
  await expect(picker.getByRole("button", { name: "Bars", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(picker.getByRole("button", { name: "Bars", exact: true })).toBeFocused();
  const boxes = await picker.locator(".visualizer-picker-options button").evaluateAll((buttons) => buttons.map((b) => {
    const r = b.getBoundingClientRect(); return { width: r.width, height: r.height, clipped: b.scrollWidth > b.clientWidth };
  }));
  expect(boxes.every((r) => r.width >= 56 && r.height >= 56 && !r.clipped)).toBe(true);
  const screenshotDir = process.env.HOME + "/cliamp-viz-picker-evidence"; await mkdir(screenshotDir, { recursive: true });
  await page.screenshot({ path: screenshotDir + "/visualizer-picker-804x638.png" });
  await picker.getByRole("button", { name: "Ethereal", exact: true }).tap();
  await expect(picker).not.toBeVisible(); await expect(mode).toHaveText("Ethereal");
  expect(await page.evaluate(() => localStorage.getItem("cliamp-web:viz"))).toBe("Ethereal");
  expect(mediaRequests.length).toBe(requests);
  expect(await page.evaluate(() => window.__media.find((m) => !m.paused)?.currentTime)).toBeGreaterThan(before);
  await choose("None");
  await page.getByRole("button", { name: "Visualizer: None. Tap to switch.", exact: true }).tap({ position: { x: 20, y: 30 } });
  await expect(mode).toHaveText("Bars");
  await page.getByRole("button", { name: "Visualizer: Bars. Tap to switch.", exact: true }).press("Enter");
  await expect(mode).toHaveText("BarsDot");
  await page.getByRole("button", { name: "Visualizer: BarsDot. Tap to switch.", exact: true }).press("Space");
  await expect(mode).toHaveText("Rain");
  await trigger().press("Enter"); await page.keyboard.press("Escape");
  await expect(picker).not.toBeVisible(); await expect(trigger()).toBeFocused(); await expect(mode).toHaveText("Rain");
  await trigger().tap(); await button("Close visualizer picker").tap();
  await expect(trigger()).toBeFocused(); await expect(mode).toHaveText("Rain");
  await button("Open full visualizer").tap();
  await choose("YinYang"); await expect(page.locator(".immersive-app")).toBeVisible();
  await trigger().tap(); await page.screenshot({ path: screenshotDir + "/visualizer-picker-immersive-804x638.png" });
  await picker.getByRole("button", { name: "None", exact: true }).tap();
  await button("Exit immersive visualizer").tap(); await expect(mode).toHaveText("None");
  await page.reload(); await expect(mode).toHaveText("None");
  await page.setViewportSize({ width: 360, height: 740 });
  await trigger().tap();
  await expect(picker.getByRole("button", { name: "None", exact: true })).toBeFocused();
  await expect(button("Close visualizer picker")).toBeInViewport();
  expect(await picker.evaluate((d) => d.scrollHeight > d.clientHeight)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: screenshotDir + "/visualizer-picker-360x740.png" });
  await picker.getByRole("button", { name: "ClassicPeak", exact: true }).tap(); await expect(mode).toHaveText("ClassicPeak");
  await page.setViewportSize({ width: 804, height: 638 });
  await button("Settings").tap(); await page.getByRole("combobox", { name: "Theme", exact: true }).selectOption("catppuccin-latte");
  await button("Now Playing").tap(); await trigger().tap();
  await expect(picker.getByRole("button", { name: "ClassicPeak", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.screenshot({ path: screenshotDir + "/visualizer-picker-light-804x638.png" });
  await page.keyboard.press("Escape");
  expect(errors).toEqual([]);
  console.log(JSON.stringify({ passed: true, checks: ["35 named choices including None", "opening name button does not cycle", "selection persists by name", "canvas tap and keyboard cycling", "Escape/Close return focus", "audio continues without reloading", "immersive selection", "selected mode scrolls into view on mobile", "large touch targets and unclipped labels", "light and dark themes", "no overflow or page errors"], screenshots: screenshotDir }));
} finally { await context.close(); await browser.close(); }
