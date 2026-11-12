/** Adapted from cliamp v2.4.0 ui/vis_ethereal.go (MIT, Bjarne Øverli). */
import type { Visualizer } from "../types";
import { Pixels } from "../pixels";
import { omarchyNoiseAt as noise } from "./omarchy";

const clamp = (x: number) => Math.min(1, Math.max(0, x));
const hash = (x: number, y: number) => {
  let h = Math.imul(y, 6271) + Math.imul(x, 3037);
  h = Math.imul(h, 0x45d9f3b3) ^ (h >>> 16);
  h = Math.imul(h, 0x45d9f3b3) ^ (h >>> 13);
  return (h >>> 0) % 10000 / 10000;
};

function cloud(x: number, y: number, t: number, bass: number, mid: number): number {
  const u = x * 6.8, v = y * 3.2;
  const warp = noise(u * 0.7 + t * 0.09, v * 0.8 - t * 0.06);
  const n = 0.60 * noise(u + warp * 1.8 - t * 0.12, v + t * 0.08)
    + 0.28 * noise(u * 2.3 + t * 0.07, v * 2.3 - warp)
    + 0.12 * noise(u * 5.1 - t * 0.05, v * 5.1 + t * 0.11);
  const centre = 0.53 + 0.16 * Math.sin(x * 6.2 + t * 0.13) + 0.06 * Math.sin(x * 13 - t * 0.09);
  const distance = Math.abs(y - centre + (warp - 0.5) * 0.3);
  const body = Math.max(0, (n - 0.30) * 1.4), rim = Math.max(0, 1 - Math.abs(n - 0.53) * 13);
  return clamp(Math.max(0, 1 - distance / 0.5) * (0.06 + body * 0.25)
    + Math.max(0, 1 - distance / (0.18 + 0.13 * bass)) * (body * 0.38 + rim * (0.42 + 0.30 * bass + 0.30 * mid)));
}

export function makeEthereal(): Visualizer {
  let elapsed = 0;
  return {
    name: "Ethereal",
    init() { elapsed = 0; },
    tick(dt, data) { if (data.playing) elapsed += Math.min(dt, 0.1); },
    render(data) {
      const p = new Pixels(data.cols, data.rows);
      const avg = (start: number, end: number) => {
        let value = 0;
        for (let i = start; i < end; i++) value += data.bands[i] ?? 0;
        return clamp(value / Math.max(1, end - start));
      };
      const n = data.bands.length;
      const bass = avg(0, Math.max(1, Math.floor(n / 3)));
      const mid = avg(Math.floor(n / 3), Math.max(1, Math.floor(2 * n / 3)));
      const high = avg(Math.floor(2 * n / 3), n);
      for (let y = 0; y < p.height; y++) for (let x = 0; x < p.width; x++) {
        const light = cloud((x + 0.5) / p.width, y / p.height, elapsed, bass, mid);
        if (light >= 0.1 && hash(x, y) <= (light - 0.08) * 1.5)
          p.set(x, y, light >= 0.70 ? 5 : light >= 0.52 ? 4 : light >= 0.35 ? 3 : light >= 0.20 ? 2 : 1);
      }
      for (let i = 0; i < data.cols * data.rows; i++) {
        if (hash(i, 173) >= 0.035) continue;
        const x = (i % data.cols) * 2, y = Math.floor(i / data.cols) * 4;
        const glow = 0.5 + 0.5 * Math.sin(elapsed * (0.4 + hash(i, 19) * 0.7) + hash(i, 37) * 2 * Math.PI);
        if (glow + high * 0.35 <= 0.36) continue;
        const tag = glow + high * 0.15 > 1.02 ? 7 : glow + high * 0.25 > 0.78 ? 6 : 2;
        if (tag === 7) for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) p.set(x + dx, y + dy, tag);
        p.set(x, y, tag);
      }
      return p.frame(["", "dim", "low", "mid", "high", "text", "accent", "text"]);
    },
  };
}
