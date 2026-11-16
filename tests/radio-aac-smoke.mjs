// Run against tests/preview-server.mjs after building the app.
// Pass a raw HE-AAC ADTS sample as the first argument.
import { chromium, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

const bytes = await readFile(process.argv[2]);
const icy = process.argv.includes("--icy");
const interval = 1024;
const metadata = Buffer.alloc(33);
metadata[0] = 2;
metadata.write("StreamTitle='AAC fixture';", 1);
const parts = [];
if (icy) {
  for (let offset = 0; offset < bytes.length; offset += interval) {
    const chunk = bytes.subarray(offset, offset + interval);
    parts.push(chunk);
    if (chunk.length === interval) parts.push(metadata);
  }
}
const stream = "https://radio-fixture.test/live";
const listedStream = stream.replace("https:", "http:");
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ["--mute-audio"] });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  if (process.env.DEBUG_RADIO_TEST) {
    page.on("console", (message) => console.log(message.text()));
    page.on("response", (response) => console.log(response.status(), response.url()));
  }
  await page.addInitScript((streamUrl) => {
    localStorage.setItem("cliamp-web:audio-debug", "1");
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      if (this.src === streamUrl) return Promise.reject(new DOMException("Fixture native rejection", "NotSupportedError"));
      return play.call(this);
    };
    const start = AudioBufferSourceNode.prototype.start;
    window.radioBuffers = [];
    AudioBufferSourceNode.prototype.start = function (...args) {
      window.radioBuffers.push(this.buffer.getChannelData(0).some((sample) => Math.abs(sample) > 0.001));
      return start.apply(this, args);
    };
  }, listedStream);
  await page.route("https://radio.cliamp.stream/**", (route) => route.fulfill({
    json: { stations: [{ id: "aac", name: "AAC fixture", stream: listedStream }] },
  }));
  await page.route(listedStream, (route) => route.abort());
  await page.route(stream, (route) => route.fulfill({
    body: icy ? Buffer.concat(parts) : bytes,
    headers: {
      "Content-Type": "audio/aacp", "Access-Control-Allow-Origin": "*",
      ...(icy ? { "Icy-Metaint": String(interval), "Access-Control-Expose-Headers": "Icy-Metaint" } : {}),
    },
  }));
  await page.goto("http://127.0.0.1:4173/cliamp-web/");
  await page.getByRole("button", { name: "Radio", exact: true }).click();
  await page.getByRole("button", { name: "AAC fixture", exact: true }).click();
  await page.getByRole("button", { name: "Now Playing", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.radioBuffers.filter(Boolean).length), { timeout: 10000 }).toBeGreaterThan(8);
  await page.getByRole("button", { name: "Play/Pause", exact: true }).click();
  await expect(page.locator(".time-status .state")).toHaveText("Paused");
  const count = await page.evaluate(() => window.radioBuffers.length);
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => window.radioBuffers.length)).toBe(count);
  expect(errors).toEqual([]);
  console.log(`FFmpeg WASM decoded AAC${icy ? " with ICY metadata" : ""} and stopped scheduling on pause.`);
} finally {
  await browser.close();
}
