// Run against tests/preview-server.mjs after building the app.
import { chromium, expect } from "@playwright/test";

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH,
  args: ["--mute-audio"],
});
const origin = "http://127.0.0.1:4173";
try {
  for (const mode of ["end", "drop", "stall"]) {
    const page = await browser.newPage();
    await page.addInitScript((mode) => {
      window.nativeRadioPlayed = false;
      const play = HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play = async function () {
        if (mode === "stall") delete this.currentTime;
        await play.call(this);
        if (!this.src.includes("/radio-recovery.wav")) return;
        if (!window.nativeRadioPlayed && mode === "drop") {
          // Chromium can repair a dropped HTTP connection before reporting a
          // media error. Deliver that error at the browser API boundary.
          setTimeout(() => {
            Object.defineProperty(this, "error", {
              configurable: true,
              value: { code: 2, message: "Fixture network error" },
            });
            this.dispatchEvent(new Event("error"));
            delete this.error;
          }, 500);
        }
        if (!window.nativeRadioPlayed && mode === "stall") {
          setTimeout(() => {
            Object.defineProperty(this, "currentTime", { configurable: true, value: this.currentTime });
            this.dispatchEvent(new Event("waiting"));
          }, 500);
        }
        window.nativeRadioPlayed = true;
      };
    }, mode);
    const url = origin + "/radio-recovery.wav?mode=" + mode;
    const requests = [];
    page.on("request", (request) => { if (request.url() === url) requests.push(request); });
    await page.route("https://radio.cliamp.stream/**", (route) => route.fulfill({
      json: { stations: [
        { id: mode, name: "Recovery fixture", stream: url },
        { id: "next", name: "Next station", stream: origin + "/long.wav" },
      ] },
    }));
    await page.goto(origin + "/cliamp-web/");
    await page.getByRole("button", { name: "Radio", exact: true }).click();
    await page.getByRole("button", { name: "Recovery fixture", exact: true }).click();
    await page.getByRole("button", { name: "Now Playing", exact: true }).click();
    const recovery = page.locator(".recovery-controls");
    await expect.poll(() => page.evaluate(() => window.nativeRadioPlayed)).toBe(true);
    await expect(recovery).toContainText("Reconnecting", { timeout: 20000 });
    await expect.poll(() => requests.length, { timeout: 6000 }).toBeGreaterThan(1);
    await expect(page.locator(".track-line")).toContainText("Recovery fixture");
    await page.getByRole("button", { name: "Play/Pause", exact: true }).click();
    await expect(recovery).toHaveCount(0);
    await expect(page.locator(".time-status .state")).toHaveText("Paused");
    await page.close();
    console.log(`Radio recovery passed for ${mode}`);
  }
} finally {
  await browser.close();
}
