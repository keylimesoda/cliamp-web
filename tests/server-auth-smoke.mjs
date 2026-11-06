// Run inside omabox against tests/preview-server.mjs after a production build.
import { chromium, expect } from "@playwright/test";

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium", headless: true,
  args: ["--no-sandbox", "--mute-audio", "--disable-dev-shm-usage", "--disable-gpu"] });
const context = await browser.newContext({ viewport: { width: 804, height: 638 }, hasTouch: true, deviceScaleFactor: 1.96 });
const page = await context.newPage(), errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const origin = "http://127.0.0.1:4173";
await page.addInitScript(() => {
  localStorage.setItem("cliamp-web:servers", JSON.stringify(Object.fromEntries(
    ["plex", "jellyfin", "emby", "lyrion"].map((id) => [id, { url: "https://unimplemented.test", token: "old-token" }]))));
});
let navAccepted = false, absAccepted = false;
await page.route("**/rest/ping?*", (route) => route.fulfill({ json: { "subsonic-response": navAccepted
  ? { status: "ok" } : { status: "failed", error: { message: "Invalid credentials" } } } }));
await page.route("**/rest/getArtists?*", (route) => route.fulfill({ json: { "subsonic-response": { status: "ok", artists: { index: [{ artist: [{ id: "a", name: "Fixture artist" }] }] } } } }));
await page.route("**/login", async (route) => {
  expect(route.request().postDataJSON()).toEqual({ username: "fixture", password: "fixture-password" });
  await route.fulfill({ status: absAccepted ? 200 : 401, json: absAccepted ? { user: { token: "session-token" } } : {} });
});
await page.route("**/api/libraries", (route) => {
  const accepted = route.request().headers().authorization === "Bearer session-token";
  return route.fulfill({ status: accepted ? 200 : 401, json: accepted ? { libraries: [{ id: "books", name: "Fixture books" }] } : {} });
});
const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem("cliamp-web:servers")));
const servers = () => page.getByRole("button", { name: "Servers", exact: true }).tap();
const button = (name) => page.getByRole("button", { name, exact: true });
try {
  await page.goto(origin + "/cliamp-web/"); await servers();
  for (const name of ["Plex", "Jellyfin", "Emby", "Lyrion (LMS)"]) await expect(button(name)).toHaveCount(0);
  await expect(button("Navidrome")).toBeVisible(); await expect(button("Audiobookshelf")).toBeVisible();
  await button("Navidrome").tap();
  await page.getByLabel("Server URL", { exact: true }).fill(origin);
  await page.getByLabel("Username", { exact: true }).fill("fixture");
  await page.getByLabel("Password", { exact: true }).fill("fixture-password");
  await button("Connect").tap(); await expect(page.getByRole("alert")).toContainText("Invalid credentials");
  expect((await stored()).navidrome).toBeUndefined();
  navAccepted = true; await button("Connect").tap();
  await expect(button("Fixture artist")).toBeVisible();
  expect((await stored()).navidrome.user).toBe("fixture");
  await button("Now Playing").tap(); await servers(); await button("Audiobookshelf").tap();
  await page.getByLabel("Server URL", { exact: true }).fill(origin);
  await page.getByLabel("Username", { exact: true }).fill("fixture");
  await page.getByLabel("Password", { exact: true }).fill("fixture-password");
  await expect(button("Connect")).toBeInViewport();
  await button("Connect").tap(); await expect(page.getByRole("alert")).toContainText("401");
  expect((await stored()).audiobookshelf).toBeUndefined();
  absAccepted = true; await button("Connect").tap(); await expect(button("Fixture books")).toBeVisible();
  await button("Now Playing").tap(); await servers(); await button("Edit Audiobookshelf").tap();
  await page.getByLabel("API token", { exact: true }).fill("invalid-token");
  await button("Connect").tap(); await expect(page.getByRole("alert")).toContainText("401");
  expect((await stored()).audiobookshelf.token).toBeFalsy();
  expect((await stored()).plex.token).toBe("old-token");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
  console.log(JSON.stringify({ passed: true, checks: ["only implemented sign-in servers shown, including with old configs", "Navidrome credentials accepted/rejected", "Audiobookshelf login and token accepted/rejected", "failed connection does not save or overwrite credentials", "old hidden-provider settings retained", "804×638 touch form fits", "no page errors"] }));
} finally { await context.close(); await browser.close(); }
