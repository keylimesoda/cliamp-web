/**
 * Firefly — a meadow at dusk (port of /tmp/cliamp/ui/vis_firefly.go).
 *
 * A low grass silhouette sits at the bottom while many fireflies drift on
 * slow, per-fly Lissajous curves seeded per index so they never collide
 * rigidly. High-frequency energy raises the chance any given firefly is
 * "lit" this frame; bass tilts a gentle wind that nudges them sideways.
 * Lit flies carry a soft one-dot halo. Motion is a deterministic function
 * of the frame counter, which is the mode's state.
 */
import type { Visualizer, VizData, VizFrame } from "../types";

const BIT = [1, 8, 2, 16, 4, 32, 64, 128];
const NUM_FLIES = 26;

function bandAvg(bands: Float32Array, lo: number, hi: number): number {
  const s = Math.max(0, lo);
  const e = Math.min(bands.length, hi);
  if (e <= s) return 0;
  let sum = 0;
  for (let i = s; i < e; i++) sum += bands[i];
  return sum / (e - s);
}

export function makeFirefly(): Visualizer {
  let frame = 0;
  let dotRows = 0;
  let dotCols = 0;
  let grass = new Uint8Array(0);
  let dim = new Uint8Array(0);
  let bright = new Uint8Array(0);

  const ensure = (rows: number, cols: number) => {
    const w = cols * 2;
    const h = rows * 4;
    if (dotRows !== h || dotCols !== w) {
      dotRows = h;
      dotCols = w;
      grass = new Uint8Array(dotRows * dotCols);
      dim = new Uint8Array(dotRows * dotCols);
      bright = new Uint8Array(dotRows * dotCols);
    }
  };

  const compute = (data: VizData) => {
    ensure(data.rows, data.cols);
    const bands = data.bands;
    const bandCount = bands.length;
    const bass = bandAvg(bands, 0, Math.floor(bandCount / 3));
    const high = bandAvg(bands, Math.floor((2 * bandCount) / 3), bandCount);

    // Grass silhouette: bottom rows with a ragged edge from summed sines.
    grass.fill(0);
    for (let x = 0; x < dotCols; x++) {
      const gh = 1 + Math.trunc(2.5 + 1.5 * Math.sin(x * 0.41) + Math.sin(x * 0.17 + 2.3));
      for (let d = 0; d < gh; d++) {
        const y = dotRows - 1 - d;
        if (y >= 0) grass[y * dotCols + x] = 1;
      }
    }

    dim.fill(0);
    bright.fill(0);
    const wind = bass * 1.5;
    for (let i = 0; i < NUM_FLIES; i++) {
      const seed = i * 2246822519 + 11;
      // Two slightly incommensurate frequencies for Lissajous wandering.
      const fx = 0.012 + (seed % 17) / 3500;
      const fy = 0.018 + (Math.floor(seed / 16) % 19) / 2900;
      const phx = (seed % 1000) / 1000 * Math.PI * 2;
      const phy = (Math.floor(seed / 256) % 1000) / 1000 * Math.PI * 2;

      const baseX = dotCols / 2 + Math.cos(frame * fx + phx) * (dotCols - 6) * 0.45;
      const baseY = (dotRows - 4) * 0.5 + Math.sin(frame * fy + phy) * (dotRows - 6) * 0.4;
      const x = Math.trunc(baseX + wind * Math.sin(frame * 0.02 + phx));
      const y = Math.trunc(baseY);
      if (x < 0 || x >= dotCols || y < 0 || y >= dotRows - 1) continue;
      const idx = y * dotCols + x;
      if (grass[idx] === 1) continue; // skip flies that land in the grass

      // Blink: chance of being "on" depends on per-fly phase plus high band.
      const blinkPhase = Math.sin(frame * 0.18 + i * 1.31) * 0.5;
      if (blinkPhase + 0.5 + high * 0.4 <= 0.55) {
        dim[idx] = 1; // half-brightness: the fly is faintly there
        continue;
      }
      bright[idx] = 1;
      // Glow halo: a one-dot ring around the lit fly.
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
        const gx = x + dx;
        const gy = y + dy;
        if (gx < 0 || gx >= dotCols || gy < 0 || gy >= dotRows) continue;
        const gi = gy * dotCols + gx;
        if (grass[gi] === 0) dim[gi] = 1;
      }
    }
  };

  return {
    name: "Firefly",
    init(cols: number, rows: number) {
      frame = 0;
      ensure(rows, cols);
    },
    tick(_dt: number, data: VizData) {
      frame++;
      compute(data);
    },
    render(data: VizData): VizFrame {
      const { rows, cols } = data;
      compute(data); // idempotent per frame; covers render before tick
      const out: string[] = [];
      const tiers: number[][] = [];
      for (let row = 0; row < rows; row++) {
        let line = "";
        const tierRow: number[] = [];
        for (let col = 0; col < cols; col++) {
          let br = 0;
          let cellTag = -1;
          for (let dr = 0; dr < 4; dr++) {
            for (let dc = 0; dc < 2; dc++) {
              const idx = (row * 4 + dr) * dotCols + col * 2 + dc;
              let t = -1;
              if (bright[idx] === 1) t = 2;
              else if (dim[idx] === 1) t = 1;
              else if (grass[idx] === 1) t = 0;
              if (t >= 0) {
                br |= BIT[dr * 2 + dc];
                if (t > cellTag) cellTag = t;
              }
            }
          }
          if (br === 0) {
            line += " ";
            tierRow.push(-1);
          } else {
            line += String.fromCharCode(0x2800 + br);
            tierRow.push(cellTag < 0 ? 0 : cellTag);
          }
        }
        out.push(line.slice(0, cols).padEnd(cols, " "));
        tiers.push(tierRow.slice(0, cols));
      }
      return { rows: out, tiers };
    },
  };
}
