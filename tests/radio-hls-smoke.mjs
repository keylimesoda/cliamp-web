// Run against tests/preview-server.mjs. Pass a raw ADTS sample as the first argument.
import { chromium, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

const sample = await readFile(process.argv[2]);
const rates = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];
let offset = 0;
while (offset + 7 < sample.length && !(sample[offset] === 0xff && (sample[offset + 1] & 0xf6) === 0xf0)) offset++;
const rate = rates[(sample[offset + 2] >> 2) & 15];
const start = offset;
let frames = 0;
while (offset + 7 < sample.length && frames < 100) {
  const length = ((sample[offset + 3] & 3) << 11) | (sample[offset + 4] << 3) | (sample[offset + 5] >> 5);
  if (length < 7 || offset + length > sample.length) break;
  frames++;
  offset += length;
}
const audio = sample.subarray(start, offset);
const duration = frames * 1024 / rate;
const master = "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=64000,CODECS=\"mp4a.40.2\"\nmedia/index.m3u8\n";
const media = (shift = 0) => [
  "#EXTM3U", "#EXT-X-VERSION:3", `#EXT-X-TARGETDURATION:${Math.ceil(duration)}`, `#EXT-X-MEDIA-SEQUENCE:${100 + shift}`,
  ...Array.from({ length: 6 }, (_, index) => [`#EXTINF:${duration.toFixed(6)},`, `segment-${index + shift}.aac`]).flat(),
  "",
].join("\n");
const playlistHeaders = { "Content-Type": "application/vnd.apple.mpegurl", "Access-Control-Allow-Origin": "*" };
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ["--mute-audio"] });
try {
  const cases = [
    { path: "station.m3u8", forceFallback: true },
    { path: "listen", forceFallback: true },
    { path: "software.m3u8", forceFallback: true, software: "startup" },
    { path: "decode-error.m3u8", forceFallback: true, software: "runtime" },
  ];
  if (process.env.TEST_NATIVE_HLS) cases.push({ path: "station.m3u8", forceFallback: false });
  for (const { path, forceFallback, software } of cases) {
    const page = await browser.newPage();
    if (process.env.DEBUG_RADIO_TEST) {
      await page.addInitScript(() => localStorage.setItem("cliamp-web:audio-debug", "1"));
      page.on("console", (message) => console.log(message.text()));
      page.on("request", (request) => console.log(request.method(), request.url()));
      page.on("pageerror", (error) => console.log(error));
    }
    await page.addInitScript(({ url, forceFallback, software }) => {
      const play = HTMLMediaElement.prototype.play;
      window.hlsElements = [];
      window.decodedFrames = 0;
      const start = AudioBufferSourceNode.prototype.start;
      AudioBufferSourceNode.prototype.start = function (...args) {
        if (this.buffer?.getChannelData(0).some((sample) => Math.abs(sample) > 0.001)) window.decodedFrames++;
        return start.apply(this, args);
      };
      HTMLMediaElement.prototype.play = async function () {
        if (forceFallback && this.src === url) throw new DOMException("Fixture native rejection", "NotSupportedError");
        if (software === "startup") throw new DOMException("Fixture MSE rejection", "NotSupportedError");
        await play.call(this);
        if (forceFallback ? this.currentSrc.startsWith("blob:") || this.srcObject : this.currentSrc === url) {
          window.hlsElements.push(this);
          if (software === "runtime") {
            setTimeout(() => {
              Object.defineProperty(this, "error", { configurable: true, value: { code: 3, message: "Fixture decode error" } });
              this.dispatchEvent(new Event("error"));
              delete this.error;
            }, 250);
          }
        }
      };
    }, { url: `https://radio-fixture.test/${path}`, forceFallback, software });
    await page.route("https://radio.cliamp.stream/**", (route) => route.fulfill({
      json: { stations: [{ id: "hls", name: "HLS fixture", stream: `https://radio-fixture.test/${path}` }] },
    }));
    let refreshed = false;
    let newestSegment = 0;
    await page.route("https://radio-fixture.test/**", (route) => {
      const pathname = new URL(route.request().url()).pathname;
      if (pathname.endsWith(".aac")) {
        newestSegment = Math.max(newestSegment, Number(pathname.match(/segment-(\d+)/)?.[1]));
        const body = software === "startup" ? Buffer.concat([Buffer.from("49443304000000000000", "hex"), audio]) : audio;
        return route.fulfill({ body, headers: { "Content-Type": "audio/aac", "Access-Control-Allow-Origin": "*" } });
      }
      if (pathname === "/" + path) return route.fulfill({ body: master, headers: playlistHeaders });
      const shift = software && refreshed ? 1 : 0;
      if (newestSegment >= 5) refreshed = true;
      return route.fulfill({ body: media(shift), headers: playlistHeaders });
    });
    await page.goto("http://127.0.0.1:4173/cliamp-web/");
    await page.getByRole("button", { name: "Radio", exact: true }).click();
    await page.getByRole("button", { name: "HLS fixture", exact: true }).click();
    await page.getByRole("button", { name: "Now Playing", exact: true }).click();
    if (software) {
      await expect.poll(() => page.evaluate(() => window.decodedFrames)).toBeGreaterThan(8);
      if (software === "startup") await expect.poll(() => newestSegment, { timeout: 25000 }).toBe(6);
      await page.getByRole("button", { name: "Play/Pause", exact: true }).click();
      await expect(page.locator(".time-status .state")).toHaveText("Paused");
      const framesAfterPause = await page.evaluate(() => window.decodedFrames);
      await page.waitForTimeout(500);
      expect(await page.evaluate(() => window.decodedFrames)).toBe(framesAfterPause);
      await page.close();
      console.log(`HLS handed off to FFmpeg WASM after a ${software} failure.`);
      continue;
    }
    await expect.poll(() => page.evaluate(() => window.hlsElements.at(-1)?.currentTime ?? 0)).toBeGreaterThan(0);
    await expect(page.locator(".time-status .state")).toHaveText("Playing");
    const position = await page.evaluate(() => window.hlsElements.at(-1).currentTime);
    await expect.poll(() => page.evaluate(() => window.hlsElements.at(-1).currentTime)).toBeGreaterThan(position + 0.1);
    const toggle = page.getByRole("button", { name: "Play/Pause", exact: true });
    await toggle.click();
    await expect(page.locator(".time-status .state")).toHaveText("Paused");
    await toggle.click();
    await expect.poll(() => page.evaluate(() => window.hlsElements.length)).toBe(2);
    await expect(page.locator(".time-status .state")).toHaveText("Playing");
    await page.close();
    console.log(`Live HLS started, paused, and restarted for ${path} (${forceFallback ? "hls.js" : "native"}).`);
  }
} finally {
  await browser.close();
}
