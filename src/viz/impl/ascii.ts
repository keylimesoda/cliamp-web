/**
 * Ascii — dense shade-block columns (port of /tmp/cliamp/ui/vis_ascii.go).
 *
 * Thin single-character columns shaded by density characters (█ ▓ ▒ ░),
 * using the same dense 1-wide/1-gap layout as ClassicPeak: the 10 bands are
 * resampled to (cols+1)/2 columns. Rows are colored by vertical tier —
 * low (green) at the bottom, mid (yellow), high (red) at the top.
 */
import type { Visualizer, VizData, VizFrame } from "../types";

function specTag(norm: number): number {
  if (norm >= 0.6) return 2;
  if (norm >= 0.3) return 1;
  return 0;
}

/** Maps fractional fill within a row to a shade character: █ ▓ ▒ ░. */
function shadeBlock(level: number, rowBottom: number, rowTop: number): string {
  if (level >= rowTop) return "█";
  if (level > rowBottom) {
    const frac = (level - rowBottom) / (rowTop - rowBottom);
    if (frac >= 0.75) return "▓";
    if (frac >= 0.5) return "▒";
    if (frac >= 0.25) return "░";
  }
  return " ";
}

function sampleBandLinear(bands: Float32Array, pos: number): number {
  if (bands.length === 0) return 0;
  if (bands.length === 1 || pos <= 0) return bands[0];
  const last = bands.length - 1;
  if (pos >= last) return bands[last];
  const idx = Math.floor(pos);
  const frac = pos - idx;
  return bands[idx] * (1 - frac) + bands[idx + 1] * frac;
}

export function makeAscii(): Visualizer {
  return {
    name: "Ascii",
    tick() {},
    render(data: VizData): VizFrame {
      const { rows, cols, bands } = data;
      const out: string[] = [];
      const tiers: number[][] = [];

      for (let r = 0; r < rows; r++) {
        out.push(" ".repeat(cols));
        tiers.push(new Array<number>(cols).fill(-1));
      }
      if (rows <= 0 || cols <= 0 || bands.length === 0) return { rows: out, tiers };

      // Dense 1-wide/1-gap layout (classicPeakColsForWidth).
      const activeCols = Math.max(1, Math.floor((cols + 1) / 2));
      const last = bands.length - 1;
      const levels = new Float32Array(activeCols);
      for (let i = 0; i < activeCols; i++) {
        const pos = activeCols === 1 ? last / 2 : (i / (activeCols - 1)) * last;
        levels[i] = sampleBandLinear(bands, pos);
      }

      for (let r = 0; r < rows; r++) {
        const rowBottom = (rows - 1 - r) / rows;
        const rowTop = (rows - r) / rows;
        const tier = specTag(rowBottom);
        let line = "";
        const tierRow: number[] = [];
        for (let i = 0; i < activeCols; i++) {
          const block = shadeBlock(levels[i], rowBottom, rowTop);
          line += block;
          tierRow.push(block === " " ? -1 : tier);
          if (i < activeCols - 1) {
            line += " ";
            tierRow.push(-1);
          }
        }
        while (tierRow.length < cols) tierRow.push(-1);
        out[r] = line.slice(0, cols).padEnd(cols, " ");
        tiers[r] = tierRow.slice(0, cols);
      }
      return { rows: out, tiers };
    },
  };
}
