// Fictional Qobuz OAuth/API. This does not establish real-account OAuth support.
import { chromium, expect } from "@playwright/test";
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium", headless: true,
  args: ["--no-sandbox", "--mute-audio", "--disable-dev-shm-usage", "--disable-gpu"] });
const context = await browser.newContext({ viewport: { width: 804, height: 638 }, hasTouch: true, deviceScaleFactor: 1.96 });
const page = await context.newPage(), errors = [], formats = [];
page.on("pageerror", (e) => errors.push(e.message));
const app = "http://127.0.0.1:4173/cliamp-web/";
const wav = await (await context.request.get("http://127.0.0.1:4173/a.wav")).body();
await page.route("**/qobuz-bootstrap.json", (r) => r.fulfill({ json: { appId: "fixture-app", secrets: ["fixture-secret"], oauthKey: "fixture-key", generatedAt: new Date().toISOString() } }));
await page.route("https://www.qobuz.com/signin/oauth?*", (r) => {
  const url = new URL(r.request().url());
  expect(url.searchParams.get("ext_app_id")).toBe("fixture-app");
  const callback = new URL(url.searchParams.get("redirect_url")); callback.searchParams.set("code_autorisation", "fixture-code");
  return r.fulfill({ contentType: "text/html", body: `<script>location.replace(${JSON.stringify(callback.href)})</script>` });
});
const tracks = [1, 2].map((id) => ({ id, title: `Qobuz song ${id}`, streamable: true, duration: 4, performer: { id: 1, name: "Fixture artist" }, album: { id: "album", title: "Fixture album" } }));
let expired = false;
await page.route("https://www.qobuz.com/api.json/0.2/**", async (r) => {
  const url = new URL(r.request().url()), headers = r.request().headers();
  const send = (data, status = 200) => r.fulfill({ json: data, status, headers: { "Access-Control-Allow-Origin": "*" } });
  if (r.request().method() === "OPTIONS") return r.fulfill({ status: 204, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "x-app-id,x-user-auth-token,content-type" } });
  expect(headers["x-app-id"]).toBe("fixture-app");
  if (url.pathname.endsWith("oauth/callback")) return send({ token: "fixture-user-token" });
  expect(headers["x-user-auth-token"]).toBe("fixture-user-token");
  if (expired) return send({}, 401);
  if (url.pathname.endsWith("user/login")) return send({ user: { id: 42, credential: { parameters: { short_label: "Studio" } } } });
  if (url.pathname.endsWith("track/getFileUrl")) {
    const id = url.searchParams.get("track_id"); formats.push(url.searchParams.get("format_id"));
    expect(url.searchParams.get("request_sig")).toMatch(/^[a-f0-9]{32}$/);
    return send({ url: `https://qobuz-audio.fixture/${id}.wav` });
  }
  if (url.pathname.endsWith("playlist/getUserPlaylists")) return send({ playlists: { items: [{ id: 1, name: "Road playlist", tracks_count: 2 }], total: 1 } });
  if (url.pathname.endsWith("playlist/get")) return send({ tracks: { items: tracks, total: 2 } });
  if (url.pathname.endsWith("track/search")) return send({ tracks: { items: [tracks[0]], total: 1 } });
  if (url.pathname.endsWith("favorite/getUserFavorites")) return send({ tracks: { items: tracks, total: 2 } });
  throw new Error(`Unexpected Qobuz fixture path ${url.pathname}`);
});
await page.route("https://qobuz-audio.fixture/**", (r) => r.fulfill({ body: wav, contentType: "audio/wav", headers: { "Access-Control-Allow-Origin": "*" } }));
const button = (name) => page.getByRole("button", { name, exact: true });
try {
  await page.goto(app); await button("Servers").tap(); await expect(button("Qobuz browser test")).toHaveCount(0);
  await page.evaluate(() => sessionStorage.setItem("cliamp-web:qobuz-pending", JSON.stringify({ state: "expected", at: Date.now() })));
  await page.goto(app + "?qobuz-test=1&qobuz_state=wrong&code_autorisation=fixture-code");
  await expect(page.getByRole("alert")).toContainText("expected sign-in state");
  expect(await page.evaluate(() => localStorage.getItem("cliamp-web:qobuz-session"))).toBeNull();
  await button("Back").tap(); await button("Qobuz browser test").tap(); await button("Sign in to Qobuz").tap();
  await expect(button("Road playlist")).toBeVisible();
  expect(await page.evaluate(() => /code_autorisation|qobuz_state/.test(location.search))).toBe(false);
  await button("Road playlist").tap(); await button("Qobuz song 1").tap(); await button("Now Playing").tap();
  await expect(page.locator(".track-line")).toContainText("Qobuz song 1");
  await expect(page.locator(".time-status .state")).toHaveText("Playing");
  await expect(page.locator(".track-line")).toContainText("Qobuz song 2", { timeout: 10000 });
  await button("Play/Pause").tap(); await page.reload(); await button("Qobuz browser test").tap();
  await expect(button("Road playlist")).toBeVisible();
  await page.getByLabel("Qobuz quality", { exact: true }).selectOption("5");
  await page.getByLabel("Search Qobuz", { exact: true }).fill("song"); await button("Search").tap();
  await button("Qobuz song 1").tap(); await button("Now Playing").tap();
  await expect(page.locator(".time-status .state")).toHaveText("Playing"); expect(formats).toContain("5"); expect(formats).toContain("6");
  await button("Play/Pause").tap(); await button("Servers").tap(); await button("Qobuz browser test").tap();
  expired = true; await page.getByLabel("Search Qobuz", { exact: true }).fill("expired"); await button("Search").tap();
  await expect(page.getByRole("alert")).toContainText("session expired"); await button("Sign out of Qobuz").tap();
  expect(await page.evaluate(() => localStorage.getItem("cliamp-web:qobuz-session"))).toBeNull();
  expired = false;
  await page.evaluate(() => sessionStorage.setItem("cliamp-web:qobuz-pending", JSON.stringify({ state: "manual", at: Date.now() })));
  await button("Manual return option").tap();
  await page.getByLabel("Qobuz return URL", { exact: true }).fill("http://localhost:19873/?code_autorisation=fixture-code");
  await button("Complete sign-in").tap(); await expect(button("Road playlist")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); expect(errors).toEqual([]);
  console.log(JSON.stringify({ passed: true, realAccount: false, checks: ["hidden without opt-in", "state rejection", "OAuth callback exchange with public test bootstrap", "session validation and signature probe", "playlist playback/automatic progression", "saved session and quality", "search", "expired session and sign-out", "explicit localhost return handoff", "804×638 touch/no overflow or page errors"] }));
} finally { await context.close(); await browser.close(); }
