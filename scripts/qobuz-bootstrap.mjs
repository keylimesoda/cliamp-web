// Adapted from cliamp v2.4.0 external/qobuz/bundle.go (MIT).
// Public web-player application material only; never account credentials.
import { writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

export function parseQobuzBundle(text, fallbackOauthKey) {
  const appId = text.match(/production:\{api:\{appId:"(\d{9})",appSecret:"\w{32}"/)?.[1];
  if (!appId) throw new Error("Qobuz public app identity was not found");
  const groups = new Map();
  for (const match of text.matchAll(/[a-z]\.initialSeed\("([\w=]+)",window\.utimezone\.([a-z]+)\)/g)) {
    const parts = groups.get(match[2]) || []; parts.push(match[1]); groups.set(match[2], parts);
  }
  for (const match of text.matchAll(/name:"\w+\/([A-Za-z]+)",info:"([\w=]+)",extras:"([\w=]+)"/g)) {
    groups.get(match[1].toLowerCase())?.push(match[2], match[3]);
  }
  const secrets = [...groups.values()].flatMap((parts) => {
    const joined = parts.join(""); if (joined.length <= 44) return [];
    const secret = Buffer.from(joined.slice(0, -44), "base64").toString("utf8");
    return secret ? [secret] : [];
  });
  const oauthKey = text.match(/(?:privateKey|private_key|oauthKey|clientSecret):\s*"([A-Za-z0-9+/=_-]{6,128})"/)?.[1] || fallbackOauthKey;
  if (!secrets.length || !oauthKey) throw new Error("Qobuz public signing material was not found");
  return { appId, secrets: [...new Set(secrets)], oauthKey };
}

async function read(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`Qobuz bootstrap download failed (${response.status})`);
  const text = await response.text();
  if (text.length > 20 * 1024 * 1024) throw new Error("Qobuz bootstrap exceeds the size limit");
  return text;
}

export async function prepareQobuzBootstrap() {
  const html = await read("https://play.qobuz.com/login");
  const path = html.match(/<script src="(\/resources\/\d+\.\d+\.\d+-[a-z]\d{3}\/bundle\.js)"><\/script>/)?.[1];
  if (!path) throw new Error("Qobuz bundle address was not found");
  const source = new URL(path, "https://play.qobuz.com").href;
  const bundle = await read(source);
  // Same public compatibility fallback used by the pinned native release.
  const native = await read("https://raw.githubusercontent.com/bjarneo/cliamp/a8386f83cf0d3a0c71cda7b3cf1288eea1e3aaef/external/qobuz/bundle.go");
  const fallback = native.match(/const fallbackPrivateKey = "([^"]+)"/)?.[1];
  return { ...parseQobuzBundle(bundle, fallback), source, sha256: createHash("sha256").update(bundle).digest("hex"), generatedAt: new Date().toISOString() };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await writeFile("public/qobuz-bootstrap.json", JSON.stringify(await prepareQobuzBootstrap()));
  console.log("Qobuz public web-client bootstrap prepared; no account credentials included.");
}
