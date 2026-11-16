// Run against tests/preview-server.mjs after building the app.
import { chromium, expect } from "@playwright/test";

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
const stream = "http://radio-fixture.test/live";
const secureStream = stream.replace("http:", "https:");

try {
  for (const { format, message, attempts } of [
    { format: "audio/unsupported", message: "Unsupported audio format", attempts: 1 },
    { format: null, message: "HTTPS unavailable", attempts: 2 },
  ]) {
    const page = await browser.newPage();
    await page.addInitScript((url) => {
      const play = HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play = function () {
        if (this.src === url) return Promise.reject(new DOMException("Fixture native rejection", "NotSupportedError"));
        return play.call(this);
      };
    }, stream);
    await page.route("https://radio.cliamp.stream/**", (route) => route.fulfill({
      json: { stations: [{ id: "failure", name: "Failure fixture", stream }] },
    }));
    await page.route(stream, (route) => route.abort());
    let secureRequests = 0;
    await page.route(secureStream, (route) => {
      secureRequests++;
      return format ? route.fulfill({
        body: "fixture",
        headers: { "Content-Type": format, "Access-Control-Allow-Origin": "*" },
      }) : route.abort();
    });
    await page.goto("http://127.0.0.1:4173/cliamp-web/");
    await page.getByRole("button", { name: "Radio", exact: true }).click();
    await page.getByRole("button", { name: "Failure fixture", exact: true }).click();
    await page.getByRole("button", { name: "Now Playing", exact: true }).click();
    const error = page.locator(".recovery-controls").getByRole("alert");
    await expect(error).toHaveText(message);
    expect(secureRequests).toBe(attempts);
    await expect(page.locator(".time-status .state")).toHaveText("Paused");
    await expect(page.getByRole("link", { name: "Open stream" })).toHaveAttribute("href", stream);
    await page.getByRole("button", { name: "Retry", exact: true }).click();
    await expect.poll(() => secureRequests).toBe(attempts * 2);
    await expect(error).toHaveText(message);
    await page.close();
    console.log(`${message}: ${attempts} HTTPS attempt(s), then paused with manual Retry.`);
  }
} finally {
  await browser.close();
}
