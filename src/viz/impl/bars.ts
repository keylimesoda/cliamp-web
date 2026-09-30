/**
 * Bars — default smooth spectrum with fractional Unicode blocks
 * (port of /tmp/cliamp/ui/vis_bars.go).
 *
 * 10 bands are laid out as wide columns with gaps, each column filled with
 * fractional block elements by height. Rows are colored by vertical tier:
 * low (green) at the bottom, mid (yellow), high (red) at the top — the
 * original's specTag/specWrap spectrum tiers.
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

export function makeBars(): Visualizer {
  return {
    name: "Bars",
    tick() {},
    render(data: VizData): VizFrame {
      const { rows, cols, bands } = data;
      const bandCount = bands.length;
      // Wide columns per band with a gap between bands (visBandWidth).
      const gapCount = Math.min(bandCount - 1, Math.max(0, cols - bandCount));
      const base = Math.max(1, (cols - gapCount) / bandCount);

      const out: string[] = [];
      const tiers: number[][] = [];
      for (let r = 0; r < rows; r++) {
        const rowBottom = (rows - 1 - r) / rows;
        const rowTop = (rows - r) / rows;
        const tier = specTag(rowBottom);
        let line = "";
        const tierRow: number[] = [];
        for (let i = 0; i < bandCount; i++) {
          const block = fracBlock(bands[i], rowBottom, rowTop);
          for (let k = 0; k < base; k++) {
            line += block;
            tierRow.push(block === " " ? -1 : tier);
          }
          if (i < bandCount - 1) {
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
