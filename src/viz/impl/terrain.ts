/**
 * Terrain — a scrolling side-view mountain range (port of
 * /tmp/cliamp/ui/vis_terrain.go).
 *
 * Terrain height is the current spectrum energy: new columns enter from the
 * right at the band average (with slight per-column noise for organic ridge
 * edges) and scroll left, creating a moving mountain silhouette. Braille
 * dots give smooth sub-cell edges; rows are colored by height — green base,
 * yellow middle, red peaks.
 */
import type { Visualizer, VizData, VizFrame } from "../types";

const BIT = [1, 8, 2, 16, 4, 32, 64, 128];

// Deterministic per-column hash that changes every 3 frames — the original's
// scatterHash with band and row fixed to 0.
function scatterHash(col: number, frame: number): number {
  const stagger = Math.floor((frame + col) / 3);
  let h = (stagger * 104729 + col * 3037) | 0;
  h = Math.imul(h, 0x45d9f3b3) ^ (h >>> 16);
  h = Math.imul(h, 0x45d9f3b3) ^ (h >>> 13);
  return (h >>> 0) % 10000 / 10000;
}

export function makeTerrain(): Visualizer {
  let dotCols = 0;
  let buf = new Float32Array(0);
  let frame = 0;

  // Keep the profile buffer at the current width, preserving the rightmost
  // (newest) columns across a resize.
  const resize = (w: number) => {
    if (w <= 0) {
      buf = new Float32Array(0);
      dotCols = 0;
      return;
    }
    if (buf.length !== w) {
      const next = new Float32Array(w);
      const copyLen = Math.min(buf.length, w);
      if (copyLen > 0) next.set(buf.subarray(buf.length - copyLen), w - copyLen);
      buf = next;
    }
    dotCols = w;
  };

  return {
    name: "Terrain",
    init(cols: number) {
      frame = 0;
      resize(cols * 2);
    },
    tick(_dt: number, data: VizData) {
      const { cols, bands } = data;
      resize(cols * 2);
      if (buf.length < 2) return;

      // Scroll left by 2 dot columns per frame for visible movement.
      for (let i = 0; i < dotCols - 2; i++) buf[i] = buf[i + 2];

      // New rightmost height from average smoothed spectrum energy so
      // successive scrolled columns glide instead of stepping.
      const n = bands.length;
      let total = 0;
      for (let i = 0; i < n; i++) total += bands[i];
      const avg = n > 0 ? total / n : 0;

      // Two new columns with slight noise for organic ridge edges.
      const h0 = avg + scatterHash(0, frame) * 0.12;
      const h1 = avg + scatterHash(1, frame) * 0.12;
      buf[dotCols - 2] = h0 > 1 ? 1 : h0;
      buf[dotCols - 1] = h1 > 1 ? 1 : h1;
      frame++;
    },
    render(data: VizData): VizFrame {
      const { rows, cols } = data;
      resize(cols * 2);
      const dotRows = rows * 4;
      const out: string[] = [];
      const tiers: number[][] = [];
      for (let row = 0; row < rows; row++) {
        // Color by row height: green base, yellow middle, red peaks.
        const rowNorm = (rows - 1 - row) / rows;
        const rowTier = rowNorm >= 0.6 ? 2 : rowNorm >= 0.3 ? 1 : 0;
        let line = "";
        const tierRow: number[] = [];
        for (let ch = 0; ch < cols; ch++) {
          let br = 0;
          for (let dc = 0; dc < 2; dc++) {
            const x = ch * 2 + dc;
            const terrainH = x < buf.length ? buf[x] : 0;
            // Top dot position — invert so 0 is the bottom.
            const topDot = dotRows - 1 - Math.floor(terrainH * (dotRows - 1));
            for (let dr = 0; dr < 4; dr++) {
              if (row * 4 + dr >= topDot) br |= BIT[dr * 2 + dc];
            }
          }
          if (br === 0) {
            line += " ";
            tierRow.push(-1);
          } else {
            line += String.fromCharCode(0x2800 + br);
            tierRow.push(rowTier);
          }
        }
        out.push(line.slice(0, cols).padEnd(cols, " "));
        tiers.push(tierRow.slice(0, cols));
      }
      return { rows: out, tiers };
    },
  };
}
