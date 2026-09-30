/**
 * Bricks — solid brick columns: every cell below a bar's level is a
 * half-height block (▄), so each bar reads as stacked bricks with the empty
 * top halves forming mortar lines between rows (port of
 * /tmp/cliamp/ui/vis_bricks.go).
 */
import type { Visualizer, VizData, VizFrame } from "../types";

function specTag(norm: number): number {
  if (norm >= 0.6) return 2;
  if (norm >= 0.3) return 1;
  return 0;
}

export function makeBricks(): Visualizer {
  return {
    name: "Bricks",
    tick() {},
    render(data: VizData): VizFrame {
      const { rows, cols, bands } = data;
      const bandCount = bands.length;
      const gapCount = Math.min(bandCount - 1, Math.max(0, cols - bandCount));
      const base = Math.max(1, (cols - gapCount) / bandCount);

      const out: string[] = [];
      const tiers: number[][] = [];
      for (let r = 0; r < rows; r++) {
        const rowThreshold = (rows - 1 - r) / rows;
        const tier = specTag(rowThreshold);
        let line = "";
        const tierRow: number[] = [];
        for (let i = 0; i < bandCount; i++) {
          const ch = bands[i] > rowThreshold ? "▄" : " ";
          for (let k = 0; k < base; k++) {
            line += ch;
            tierRow.push(ch === " " ? -1 : tier);
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
