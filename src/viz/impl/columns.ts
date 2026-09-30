/**
 * Columns — many thin full-height columns: per-column levels are interpolated
 * between neighboring bands so adjacent columns vary slightly for a dense,
 * organic look (port of /tmp/cliamp/ui/vis_columns.go).
 */
import type { Visualizer, VizData, VizFrame } from "../types";

const BAR_BLOCKS = [" ", "▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"] as const;

function fracBlock(level: number, rowBottom: number, rowTop: number): string {
  if (level >= rowTop) return "█";
  if (level > rowBottom) {
    const frac = (level - rowBottom) / (rowTop - rowBottom);
    const idx = Math.max(0, Math.min(BAR_BLOCKS.length - 1, Math.floor(frac * (BAR_BLOCKS.length - 1))));
    return BAR_BLOCKS[idx];
  }
  return " ";
}

function specTag(norm: number): number {
  if (norm >= 0.6) return 2;
  if (norm >= 0.3) return 1;
  return 0;
}

// Per-display-column levels, linearly interpolated from band b toward band
// b+1 across band b's width (Go's interpolateBandColumns).
function interpolateBandColumns(bands: Float32Array, bandCols: number[]): number[] {
  let total = 0;
  for (const width of bandCols) total += width;
  const out = new Array<number>(total).fill(0);
  let offset = 0;
  for (let b = 0; b < bandCols.length; b++) {
    const width = bandCols[b];
    if (width <= 0) continue;
    const level = bands[b];
    const nextLevel = b + 1 < bands.length ? bands[b + 1] : level;
    for (let c = 0; c < width; c++) {
      const t = c / width;
      out[offset + c] = level * (1 - t) + nextLevel * t;
    }
    offset += width;
  }
  return out;
}

export function makeColumns(): Visualizer {
  return {
    name: "Columns",
    tick() {},
    render(data: VizData): VizFrame {
      const { rows, cols, bands } = data;
      const bandCount = bands.length;
      const gapCount = Math.min(bandCount - 1, Math.max(0, cols - bandCount));
      const base = Math.max(1, (cols - gapCount) / bandCount);
      const bandCols = new Array<number>(bandCount).fill(base);
      const colLevels = interpolateBandColumns(bands, bandCols);

      const out: string[] = [];
      const tiers: number[][] = [];
      for (let r = 0; r < rows; r++) {
        const rowBottom = (rows - 1 - r) / rows;
        const rowTop = (rows - r) / rows;
        const tier = specTag(rowBottom);
        let line = "";
        let offset = 0;
        const tierRow: number[] = [];
        for (let b = 0; b < bandCount; b++) {
          for (let c = 0; c < bandCols[b]; c++) {
            const block = fracBlock(colLevels[offset + c], rowBottom, rowTop);
            line += block;
            tierRow.push(block === " " ? -1 : tier);
          }
          offset += bandCols[b];
          if (b < bandCount - 1) {
            line += " ";
            tierRow.push(-1);
          }
        }
        line = line.slice(0, cols).padEnd(cols, " ");
        out.push(line);
        tiers.push(tierRow.slice(0, cols));
      }
      return { rows: out, tiers };
    },
  };
}
