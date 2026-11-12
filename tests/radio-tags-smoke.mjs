// Run inside omabox after a production build. All directory/media data is fictional.
import { chromium, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
const app = process.env.APP_URL || "http://127.0.0.1:4173/cliamp-web/";
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium", headless: true,
  args: ["--no-sandbox", "--mute-audio", "--disable-dev-shm-usage", "--disable-gpu"] });
const context = await browser.newContext({ viewport: { width: 804, height: 638 }, hasTouch: true, deviceScaleFactor: 1.96 });
const page = await context.newPage(), errors = [], directoryRequests = [];
page.on("pageerror", (e) => errors.push(e.message));
const tags = [...Array.from({ length: 420 }, (_, i) => ({ name: `genre-${i}`, stationcount: 1000 - i })),
  { name: "lofi", stationcount: 50 }, { name: "lofi hip hop", stationcount: 20 }, { name: "ambient", stationcount: 10 }];
let tagFailure = false, tagLoads = 0, releaseChannel;
await page.addInitScript(() => {
  if (localStorage.getItem("radio-playlist-fixture")) return;
  localStorage.setItem("radio-playlist-fixture", "1");
  const tracks = ["Prior station", "Old queued station"].map((title, i) => ({ title, path: `https://radio-tags.fixture/old-${i}.wav`, provider: "radio", live: true, stream: true }));
  localStorage.setItem("cliamp-web:session", JSON.stringify({ version: 1, playlist: {
    tracks, order: [0, 1], current: 0, cursor: 0, queuedCurrent: -1, queue: [1], shuffle: "off", repeat: "off"
  }, track: tracks[0], position: 0, duration: 0, at: Date.now() }));
});
const station = (name, votes) => ({ name, votes, url: `https://radio-tags.fixture/${votes}.wav`, stationuuid: String(votes), countrycode: "US", tags: "lofi" });
await page.route("https://radio.cliamp.stream/**", async (r) => {
  const path = new URL(r.request().url()).pathname;
  if (path === "/slow/tracks") {
    await new Promise((resolve) => { releaseChannel = resolve; });
    return r.fulfill({ json: { tracks: [{ title: "Late channel song", url: "https://radio-tags.fixture/late.wav", duration: 180 }] } });
  }
  return r.fulfill({ json: { stations: path === "/stations" ? [{ id: "slow", name: "Slow song channel", stream: "https://radio-tags.fixture/slow.wav", tracks: 1, tracks_url: "https://radio.cliamp.stream/slow/tracks" }] : {} } });
});
await page.route("https://de1.api.radio-browser.info/**", (route) => {
  const u = new URL(route.request().url()); directoryRequests.push(u);
  if (u.pathname.endsWith("/tags")) {
    tagLoads++;
    return tagFailure ? route.fulfill({ status: 503, body: "fixture unavailable" }) : route.fulfill({ json: tags });
  }
  if (u.pathname.endsWith("/countries")) return route.fulfill({ json: [{ name: "United States", iso_3166_1: "US", stationcount: 2 }] });
  if (u.searchParams.has("countrycode")) return route.fulfill({ json: [station("Country first", 800), station("Country last", 700)] });
  if (u.searchParams.has("tag")) return route.fulfill({ json: u.searchParams.get("order") === "clickcount"
    ? [station("Listener favorite", 400), station("Quiet Circuits", 300), station("Night Circuit", 100)] : [station("Quiet Circuits", 300), station("Soft Signals", 200), station("Night Circuit", 100)] });
  return route.fulfill({ json: [station("Name first", 600), station("Name search result", 500), station("Name last", 400)] });
});
const wav = Buffer.alloc(44 + 8000 * 2 * 180);
wav.write("RIFF"); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8); wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28);
wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(wav.length - 44, 40);
await page.route("https://radio-tags.fixture/**", (r) => r.fulfill({ body: wav, contentType: "audio/wav" }));
const button = (name) => page.getByRole("button", { name, exact: true });
const filter = () => page.getByRole("searchbox", { name: "Filter genres & tags", exact: true });
const nameSearches = () => directoryRequests.filter((u) => u.searchParams.has("name"));
const lastTagRequest = () => directoryRequests.filter((u) => u.searchParams.has("tag")).at(-1);
const session = () => page.evaluate(() => JSON.parse(localStorage.getItem("cliamp-web:session")));
const expectPlaying = async (name) => {
  await expect(page.locator(".track-line")).toContainText(name);
  await expect(page.locator(".time-status .state")).toHaveText("Playing");
};
const openRadioHome = async () => {
  await button("Radio").tap();
  for (let i = 0; i < 3 && !(await button("Browse genres & tags").isVisible()); i++) await button("Back").tap();
};
const openLofi = async () => {
  await openRadioHome(); await button("Browse genres & tags").tap(); await filter().fill("lofi"); await button("lofi").tap();
  await expect(button("Quiet Circuits")).toBeVisible();
};
const shots = process.env.HOME + "/cliamp-radio-tags-evidence";
try {
  await page.goto(app); await button("Radio").tap(); await button("Browse genres & tags").tap();
  await expect(page.locator(".panel .row")).toHaveCount(423); // tags past the old cap are accessible
  expect(tagLoads).toBe(1);
  await filter().fill("  LOFI  "); await expect(button("lofi")).toBeVisible(); await expect(button("lofi hip hop")).toBeVisible();
  await expect(page.locator(".panel .row")).toHaveCount(2);
  expect(tagLoads).toBe(1); expect(nameSearches()).toHaveLength(0);
  await mkdir(shots, { recursive: true }); await page.screenshot({ path: shots + "/radio-tag-filter-804x638.png" });
  await button("lofi").tap();
  const order = page.getByRole("combobox", { name: "Order" });
  await expect(order).toHaveValue("votes"); await expect(button("Quiet Circuits")).toBeVisible();
  let request = lastTagRequest();
  for (const [key, value] of Object.entries({ tag: "lofi", tagExact: "true", order: "votes", reverse: "true", limit: "200", hidebroken: "true" })) expect(request.searchParams.get(key)).toBe(value);
  await order.selectOption("clickcount"); await expect(button("Listener favorite")).toBeVisible();
  expect(lastTagRequest().searchParams.get("order")).toBe("clickcount");
  await order.selectOption("votes"); await expect(button("Quiet Circuits")).toBeVisible();
  await page.screenshot({ path: shots + "/radio-lofi-votes-804x638.png" });
  await button("Back").tap(); await expect(filter()).toHaveValue("  LOFI  "); await expect(button("lofi hip hop")).toBeVisible();
  expect(tagLoads).toBe(1);
  await filter().fill("no-such-tag"); await expect(page.getByText("no matching tags", { exact: true })).toBeVisible();
  expect(nameSearches()).toHaveLength(0);
  await filter().fill(""); await expect(page.locator(".panel .row")).toHaveCount(423); // clearing stays in tags
  await filter().fill("lofi"); await page.setViewportSize({ width: 360, height: 740 });
  await expect(button("lofi")).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect((await filter().boundingBox()).height).toBeGreaterThanOrEqual(56);
  await page.screenshot({ path: shots + "/radio-tag-filter-360x740.png" });
  await button("lofi hip hop").tap(); await expect(button("Quiet Circuits")).toBeVisible();
  expect(lastTagRequest().searchParams.get("tag")).toBe("lofi hip hop");
  await button("Back").tap(); await button("Back").tap();
  await expect(page.getByRole("searchbox", { name: "Search stations" })).toHaveValue("");
  await expect(button("Browse genres & tags")).toBeVisible();
  // A tag API failure is visible and leaving/re-entering retries it.
  tagFailure = true; await button("Browse genres & tags").tap();
  await expect(page.locator(".status-row.is-error")).toContainText("503");
  await button("Back").tap(); tagFailure = false; await button("Browse genres & tags").tap();
  await expect(button("genre-0")).toBeVisible();
  await button("Back").tap();
  await page.getByRole("searchbox", { name: "Search stations" }).fill("lofi");
  await expect(button("Name search result")).toBeVisible(); expect(nameSearches().at(-1).searchParams.get("name")).toBe("lofi");
  await button("Back").tap(); await button("Browse genres & tags").tap(); await filter().fill("lofi"); await button("lofi").tap();
  const stationRow = button("Quiet Circuits"); await stationRow.getByRole("button", { name: "Favorite station" }).tap();
  expect((await session()).playlist.queue).toEqual([1]); // browsing/favoriting leaves playback alone
  await stationRow.tap(); await button("Now Playing").tap();
  expect((await session()).playlist.tracks.map((t) => t.title)).toEqual(["Quiet Circuits", "Soft Signals", "Night Circuit"]);
  expect((await session()).playlist.queue).toEqual([]);
  await expect(page.locator(".track-line")).toContainText("Quiet Circuits"); await expect(page.locator(".time-status .state")).toHaveText("Playing");
  await button("Favorites").tap(); await expect(button("Quiet Circuits")).toBeVisible();
  // Selecting the middle result starts there, with Previous/Next scanning the result order.
  await openLofi(); await button("Soft Signals").tap(); await button("Now Playing").tap(); await expectPlaying("Soft Signals");
  expect((await session()).playlist.current).toBe(1);
  await button("Next").tap(); await expectPlaying("Night Circuit");
  await button("Previous").tap(); await expectPlaying("Soft Signals");
  await button("Previous").tap(); await expectPlaying("Quiet Circuits");
  await page.screenshot({ path: shots + "/radio-results-playlist-360x740.png" });
  // Full-screen controls use the same station list.
  await button("Open full visualizer").tap(); await button("Next track").tap();
  await expect(page.locator(".immersive-track-line")).toContainText("Soft Signals");
  await button("Previous track").tap(); await expect(page.locator(".immersive-track-line")).toContainText("Quiet Circuits");
  await button("Exit immersive visualizer").tap();
  // Persist the list and position; restoring a live station waits for Play and reconnects live.
  await page.reload(); expect((await session()).playlist.tracks).toHaveLength(3);
  await expect(page.locator(".time-status .state")).toHaveText("Stopped");
  await button("Play/Pause").tap(); await expectPlaying("Quiet Circuits");
  await button("Next").tap(); await expectPlaying("Soft Signals");
  // Reordering results does not change current playback until a station is selected.
  await openLofi(); await page.getByRole("combobox", { name: "Order" }).selectOption("clickcount");
  await expect(button("Listener favorite")).toBeVisible();
  expect((await session()).track.title).toBe("Soft Signals");
  await button("Quiet Circuits").tap(); await button("Now Playing").tap(); await expectPlaying("Quiet Circuits");
  expect((await session()).playlist.tracks.map((t) => t.title)).toEqual(["Listener favorite", "Quiet Circuits", "Night Circuit"]);
  await button("Next").tap(); await expectPlaying("Night Circuit");
  // Country and station-name search results also form contextual station playlists.
  await openRadioHome(); await button("Browse countries").tap(); await button("United States").tap();
  await button("Country first").tap(); await button("Now Playing").tap(); await expectPlaying("Country first");
  await button("Next").tap(); await expectPlaying("Country last");
  expect((await session()).playlist.tracks).toHaveLength(2);
  await openRadioHome(); await page.getByRole("searchbox", { name: "Search stations" }).fill("night");
  await button("Name search result").tap(); await button("Now Playing").tap(); await expectPlaying("Name search result");
  await button("Next").tap(); await expectPlaying("Name last");
  expect((await session()).playlist.tracks.map((t) => t.title)).toEqual(["Name first", "Name search result", "Name last"]);
  // A pending channel-song request cannot replace a subsequently selected station playlist.
  await openRadioHome(); await button("Slow song channel").tap(); await expect.poll(() => Boolean(releaseChannel)).toBe(true);
  await page.getByRole("searchbox", { name: "Search stations" }).fill("night"); await button("Name search result").tap();
  const response = page.waitForResponse("https://radio.cliamp.stream/slow/tracks"); releaseChannel(); await (await response).finished();
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await button("Now Playing").tap(); await expectPlaying("Name search result");
  expect((await session()).playlist.tracks).toHaveLength(3);
  await button("Next").tap(); await expectPlaying("Name last");
  await page.setViewportSize({ width: 804, height: 638 });
  await page.screenshot({ path: shots + "/radio-results-playlist-804x638.png" });
  expect(errors).toEqual([]);
  console.log(JSON.stringify({ passed: true, checks: ["complete tag list beyond 300", "case-insensitive trimmed local filter", "no station-name requests while filtering tags", "exact-tag Most Voted request", "sort changes", "Back retains tag filter", "clear and no matches stay in tags", "tag errors and retry", "home station-name search retained", "station playback and FAVS", "tag/country/name result playlists", "middle selection and transport order", "immersive station transport", "session restore", "sort then select", "prior queue replaced on selection", "stale channel fetch ignored", "804×638 / 360×740 touch layout"], screenshots: shots }));
} finally { await context.close(); await browser.close(); }
