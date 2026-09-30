/**
 * BarsOutline — only the top edge of each bar is drawn as a horizontal line,
 * with empty space below — a minimal line-graph style visualizer
 * (port of /tmp/cliamp/ui/vis_bars_outline.go).
 */
import type { Visualizer, VizData, VizFrame } from "../types";

function specTag(norm: number): number {
  if (norm >= 0.6) return 2;
  if (norm >= 0.3) return 1;
  return 0;
}

export function makeBarsOutline(): Visualizer {
  return {
    name: "BarsOutline",
    tick() {},
    render(data: VizData): VizFrame {
      const { rows, cols, bands } = data;
      const bandCount = bands.length;
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
          // The row containing the band level carries the outline; rows at or
          // above the peak and below it are empty (Go: level >= rowTop →
          // empty, level > rowBottom → '─', else empty).
          const isEdge = bands[i] > rowBottom && bands[i] < rowTop;
          const ch = isEdge ? "─" : " ";
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
