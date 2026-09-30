/**
 * Flame — doom-fire heat propagation (port of /tmp/cliamp/ui/vis_flame.go).
 *
 * A heat field is fed from the bottom row by the spectrum; every cell
 * inherits its neighbour-below's heat with a small lateral wind jitter and
 * a random decay, producing continuous, lapping flames instead of a row of
 * independent columns. Bass thickens the heat source so loud passages feed
 * taller flames; quiet passages settle into a low, flickering bed of coals.
 * Yellow core, red body, stippled wispy tips.
 */
import type { Visualizer, VizData, VizFrame } from "../types";

const BIT = [1, 8, 2, 16, 4, 32, 64, 128];

function sampleBandLinear(bands: Float32Array, pos: number): number {
  const n = bands.length;
  if (n === 0) return 0;
  if (n === 1 || pos <= 0) return bands[0];
  const last = n - 1;
  if (pos >= last) return bands[n - 1];
  const idx = Math.floor(pos);
  const frac = pos - idx;
  return bands[idx] * (1 - frac) + bands[idx + 1] * frac;
}

// Deterministic per-dot hash that changes every 3 frames — the original's
// scatterHash, used to stipple the flame tips.
function scatterHash(row: number, col: number, frame: number): number {
  const stagger = Math.floor((frame + row * 3 + col) / 3);
  let h = (stagger * 104729 + row * 6271 + col * 3037) | 0;
  h = Math.imul(h, 0x45d9f3b3) ^ (h >>> 16);
  h = Math.imul(h, 0x45d9f3b3) ^ (h >>> 13);
  return (h >>> 0) % 10000 / 10000;
}

export function makeFlame(): Visualizer {
  let dotRows = 0;
  let dotCols = 0;
  let heat = new Float32Array(0);
  let frame = 0;
  let rng = 0x0badc0de; // low 32 bits of the Go seed

  const rand = () => {
    rng = (Math.imul(rng, 0x6d2b79f5) + 0x168ed33d) | 0;
    return (rng >>> 10) / 0x100000;
  };

  const ensure = (rows: number, cols: number) => {
    const w = cols * 2;
    const h = rows * 4;
    if (dotRows !== h || dotCols !== w) {
      dotRows = h;
      dotCols = w;
      heat = new Float32Array(dotRows * dotCols);
    }
  };

  return {
    name: "Flame",
    init(cols: number, rows: number) {
      frame = 0;
      ensure(rows, cols);
    },
    tick(_dt: number, data: VizData) {
      const { rows, cols, bands } = data;
      ensure(rows, cols);

      // Source (bottom) row: per-column heat seeded from a smooth spectrum
      // sample plus a small per-column sparkle so the base shimmers even on
      // quiet input.
      const bandCount = bands.length;
      if (bandCount > 0) {
        const last = bandCount - 1;
        for (let x = 0; x < dotCols; x++) {
          const src = sampleBandLinear(bands, (x / Math.max(1, dotCols - 1)) * last);
          const base = 0.3 + 0.7 * src + rand() * 0.18;
          heat[x] = base > 1.05 ? 1.05 : base;
        }
      } else {
        for (let x = 0; x < dotCols; x++) {
          heat[x] = 0.3 + rand() * 0.2;
        }
      }

      // Propagate heat upward (top→down so we always read row y-1 before it
      // is overwritten). Each cell inherits from a horizontally jittered
      // neighbour below ("wind") and loses a randomised amount of heat —
      // that randomness gives the flame its wispy texture.
      for (let y = dotRows - 1; y >= 1; y--) {
        const decayBase = 0.01 + 0.028 * (y / Math.max(1, dotRows - 1));
        for (let x = 0; x < dotCols; x++) {
          const offset = Math.floor(rand() * 3) - 1;
          let sourceX = x + offset;
          if (sourceX < 0) sourceX = 0;
          else if (sourceX >= dotCols) sourceX = dotCols - 1;
          const next = heat[(y - 1) * dotCols + sourceX] - decayBase - rand() * 0.018;
          heat[y * dotCols + x] = next < 0 ? 0 : next;
        }
      }
      frame++;
    },
    render(data: VizData): VizFrame {
      const { rows, cols } = data;
      ensure(rows, cols);
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
              // Panel y=0 is top; heat buffer y=0 is the bottom source.
              const y = row * 4 + dr;
              const x = col * 2 + dc;
              const h = heat[(dotRows - 1 - y) * dotCols + x];
              if (h < 0.1) continue;
              // Wispy tips: at low heat, only stochastically light the dot so
              // the upper edge has a soft, broken silhouette.
              if (h < 0.25 && scatterHash(y, x, frame) > h * 4) continue;
              const t = h >= 0.55 ? 1 : 2; // yellow core, red body/tips
              br |= BIT[dr * 2 + dc];
              if (t > cellTag) cellTag = t;
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
