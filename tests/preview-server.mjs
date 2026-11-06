// Fixture-only static server: production build under a GitHub Pages subpath.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";

const root = resolve("dist");
function wav(seconds = 4) {
  const rate = 8000, frames = Math.round(rate * seconds), out = Buffer.alloc(44 + frames * 2);
  out.write("RIFF"); out.writeUInt32LE(out.length - 8, 4); out.write("WAVEfmt ", 8);
  out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20); out.writeUInt16LE(1, 22);
  out.writeUInt32LE(rate, 24); out.writeUInt32LE(rate * 2, 28); out.writeUInt16LE(2, 32);
  out.writeUInt16LE(16, 34); out.write("data", 36); out.writeUInt32LE(frames * 2, 40);
  for (let i = 0; i < frames; i++) out.writeInt16LE(Math.round(Math.sin(i * 2 * Math.PI * 440 / rate) * 12000), 44 + i * 2);
  return out;
}
const contentTypes = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".webmanifest": "application/manifest+json" };
for (const port of [4173, 4174]) createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${port}`);
  if (url.pathname.endsWith(".wav") || url.pathname === "/rest/stream") {
    const bytes = wav(url.pathname.includes("spoken") ? 180 : url.pathname.includes("long") || url.pathname === "/rest/stream" ? 30 : 4);
    const range = req.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
    const headers = { "Content-Type": "audio/wav", "Accept-Ranges": "bytes" };
    if (range) {
      const start = Number(range[1]), end = Math.min(range[2] ? Number(range[2]) : bytes.length - 1, bytes.length - 1);
      if (start > end || start >= bytes.length) { res.writeHead(416, { "Content-Range": `bytes */${bytes.length}` }); res.end(); return; }
      res.writeHead(206, { ...headers, "Content-Range": `bytes ${start}-${end}/${bytes.length}`, "Content-Length": end - start + 1 });
      res.end(bytes.subarray(start, end + 1)); return;
    }
    res.writeHead(200, { ...headers, "Content-Length": bytes.length }); res.end(bytes); return;
  }
  if (port === 4174) { res.writeHead(404); res.end(); return; }
  if (!url.pathname.startsWith("/cliamp-web/")) { res.writeHead(404); res.end(); return; }
  const path = resolve(root, url.pathname.slice("/cliamp-web/".length) || "index.html");
  if (!path.startsWith(root + sep)) { res.writeHead(403); res.end(); return; }
  try {
    const ext = path.slice(path.lastIndexOf("."));
    res.writeHead(200, { "Content-Type": contentTypes[ext] ?? "application/octet-stream" }); res.end(await readFile(path));
  } catch { res.writeHead(404); res.end(); }
}).listen(port, "0.0.0.0");
