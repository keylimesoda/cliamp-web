/**
 * Query Google's Safe Browsing v5 URL Lookup API against the published app.
 * Requires SAFE_BROWSING_API_KEY in the environment. Never runs in the PWA.
 *
 * Exit status: 0 = no listed threats returned, 1 = threat matches,
 *              2 = lookup could not complete (not a clean result).
 */
import { appendFile } from "node:fs/promises";

const urls = [
  "https://keylimesoda.github.io/cliamp-web/",
  "https://keylimesoda.github.io/cliamp-web/index.html",
  "https://keylimesoda.github.io/",
];

async function summary(markdown) {
  if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(process.env.GITHUB_STEP_SUMMARY, markdown + "\n");
  }
}

const timestamp = new Date().toISOString();
const apiKey = process.env.SAFE_BROWSING_API_KEY;
if (!apiKey) {
  const message = "NOT CHECKED: Set the SAFE_BROWSING_API_KEY Actions secret to run this monitor.";
  console.error(message);
  await summary(`### Google Safe Browsing: not configured\n\n${message}`);
  process.exitCode = 2;
} else {
  try {
    const endpoint = new URL("https://safebrowsing.googleapis.com/v5/urls:search");
    endpoint.searchParams.set("key", apiKey);
    for (const url of urls) endpoint.searchParams.append("urls", url);
    const response = await fetch(endpoint, {
      headers: { Accept: "application/json", "User-Agent": "cliamp-web-reputation-monitor/1.0" },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(`Safe Browsing API returned HTTP ${response.status}`);
    const result = await response.json();
    const threats = result.threats ?? [];
    if (!Array.isArray(threats)) throw new Error("Unexpected API response: threats is not an array");

    const report = [
      `### Google Safe Browsing URL lookup — ${timestamp}`,
      "",
      "Checked the deployed app URL, its index.html, and the GitHub Pages account root:",
      ...urls.map((url) => `- \`${url}\``),
      "",
      threats.length ? "**Threat matches returned:**" : "**No listed threats returned for these URLs.**",
      ...threats.map((threat) =>
        `- \`${threat.url ?? "(unspecified URL)"}\`: ${(threat.threatTypes ?? ["UNKNOWN"]).join(", ")}`),
      "",
      "A negative API result does **not** guarantee that all Chrome configurations will omit an interstitial.",
      "Search Console and affected Chrome clients remain complementary evidence.",
    ].join("\n");
    console.log(report);
    await summary(report);
    process.exitCode = threats.length ? 1 : 0;
  } catch (error) {
    // Deliberately do not print the request URL; it contains the API key.
    const message = error instanceof Error ? error.message : String(error);
    console.error(`LOOKUP FAILED: ${message}`);
    await summary(`### Google Safe Browsing: lookup failed — ${timestamp}\n\n${message}\n\nThis is **not** a clean result.`);
    process.exitCode = 2;
  }
}
