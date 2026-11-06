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
let tagFailure = false, tagLoads = 0;
const station = (name, votes) => ({ name, votes, url: "https://radio-tags.fixture/live.wav", stationuuid: String(votes), countrycode: "US", tags: "lofi" });
await page.route("https://radio.cliamp.stream/**", (r) => r.fulfill({ json: { stations: [] } }));
await page.route("https://de1.api.radio-browser.info/**", (route) => {
  const u = new URL(route.request().url()); directoryRequests.push(u);
  if (u.pathname.endsWith("/tags")) {
    tagLoads++;
    return tagFailure ? route.fulfill({ status: 503, body: "fixture unavailable" }) : route.fulfill({ json: tags });
  }
  if (u.searchParams.has("tag")) return route.fulfill({ json: u.searchParams.get("order") === "clickcount"
    ? [station("Listener favorite", 10)] : [station("Quiet Circuits", 100)] });
  return route.fulfill({ json: [station("Name search result", 1)] });
});
const wav = Buffer.alloc(44 + 8000 * 2 * 30);
wav.write("RIFF"); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8); wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28);
wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(wav.length - 44, 40);
await page.route("https://radio-tags.fixture/**", (r) => r.fulfill({ body: wav, contentType: "audio/wav" }));
const button = (name) => page.getByRole("button", { name, exact: true });
const filter = () => page.getByRole("searchbox", { name: "Filter genres & tags", exact: true });
const nameSearches = () => directoryRequests.filter((u) => u.searchParams.has("name"));
const lastTagRequest = () => directoryRequests.filter((u) => u.searchParams.has("tag")).at(-1);
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
  await stationRow.tap(); await button("Now Playing").tap();
  await expect(page.locator(".track-line")).toContainText("Quiet Circuits"); await expect(page.locator(".time-status .state")).toHaveText("Playing");
  await button("Favorites").tap(); await expect(button("Quiet Circuits")).toBeVisible();
  expect(errors).toEqual([]);
  console.log(JSON.stringify({ passed: true, checks: ["complete tag list beyond 300", "case-insensitive trimmed local filter", "no station-name requests while filtering tags", "exact-tag Most Voted request", "sort changes", "Back retains tag filter", "clear and no matches stay in tags", "tag errors and retry", "home station-name search retained", "station playback and FAVS", "804×638 / 360×740 touch layout"], screenshots: shots }));
} finally { await context.close(); await browser.close(); }
