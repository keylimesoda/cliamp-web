/**
 * BarsDot — spectrum bars filled with braille dot stipple instead of solid
 * blocks (port of /tmp/cliamp/ui/vis_bars_dot.go).
 *
 * Each character cell maps to a 4x2 braille dot grid; dots are lit from the
 * bottom up proportional to the band level, giving a stippled texture. Rows
 * are colored by vertical tier like the bars mode (green low → red high).
 */
import type { Visualizer, VizData, VizFrame } from "../types";

// (dot row, dot col) in a 4x2 braille cell → bit value, matching Go's brailleBit.
const BRAILLE_BITS = [
  [0x01, 0x08],
  [0x02, 0x10],
  [0x04, 0x20],
  [0x40, 0x80],
] as const;

function specTag(norm: number): number {
  if (norm >= 0.6) return 2;
  if (norm >= 0.3) return 1;
  return 0;
}

function dotStipple(level: number, row: number, rows: number): string {
  const dotRows = rows * 4;
  let braille = 0x2800;
  for (let dr = 0; dr < 4; dr++) {
    for (let dc = 0; dc < 2; dc++) {
      const dotRow = row * 4 + dr;
      const dotY = (dotRows - 1 - dotRow) / dotRows;
      if (dotY < level) braille |= BRAILLE_BITS[dr][dc];
    }
  }
  return String.fromCharCode(braille);
}

export function makeBarsDot(): Visualizer {
  return {
    name: "BarsDot",
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
        const tier = specTag((rows - 1 - r) / rows);
        let line = "";
        const tierRow: number[] = [];
        for (let i = 0; i < bandCount; i++) {
          const dot = dotStipple(bands[i], r, rows);
          for (let k = 0; k < base; k++) {
            line += dot;
            tierRow.push(tier);
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
