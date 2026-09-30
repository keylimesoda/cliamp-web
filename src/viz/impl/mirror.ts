/**
 * Mirror — braille bars mirrored about a horizontal center axis
 * (port of /tmp/cliamp/ui/vis_mirror.go).
 *
 * One vertical bar per spectrum slot is drawn symmetrically around a
 * persistent horizontal axis line in a fine 4x2 dot grid. A slow two-sine
 * wobble and overall loudness drive each bar's radius; bars taper toward
 * the edges. Tiers: green axis, yellow bar body, red tips. The grid is
 * rebuilt per frame (Go clears its braille grid in ensure).
 */
import type { Visualizer, VizData, VizFrame } from "../types";

// (dot row, dot col) in a 4x2 braille cell → bit value, matching Go's brailleBit.
const BRAILLE_BITS = [
  [0x01, 0x08],
  [0x02, 0x10],
  [0x04, 0x20],
  [0x40, 0x80],
] as const;
const SPAN_PERCENT = 84;

export function makeMirror(): Visualizer {
  return {
    name: "Mirror",
    tick() {},
    render(data: VizData): VizFrame {
      const { rows, cols, bands, t } = data;
      const dotRows = rows * 4;
      const dotCols = cols * 2;
      const cells = new Int8Array(dotRows * dotCols);

      const set = (x: number, y: number, tier: number): void => {
        if (x < 0 || x >= dotCols || y < 0 || y >= dotRows) return;
        const idx = y * dotCols + x;
        if (tier > cells[idx]) cells[idx] = tier;
      };

      const span = Math.max(2, Math.floor((dotCols * SPAN_PERCENT) / 100));
      const spanAdj = Math.min(dotCols, span - (span % 2));
      const barCount = Math.max(1, Math.floor(spanAdj / 2));
      const x0 = Math.floor((dotCols - spanAdj) / 2);
      const axisY = Math.floor(dotRows / 2);
      const maxRadius = Math.min(axisY, dotRows - 1 - axisY);

      // Persistent horizontal axis line.
      for (let x = x0; x < x0 + spanAdj; x++) set(x, axisY, 1);

      let env = 0;
      for (let i = 0; i < bands.length; i++) env += Math.max(0, Math.min(1, bands[i]));
      if (bands.length > 0) env /= bands.length;

      const halfBars = (barCount - 1) / 2;
      for (let i = 0; i < barCount; i++) {
        let distance = 0;
        if (halfBars > 0) distance = Math.abs(i - halfBars) / halfBars;
        const wobble = 0.4 + 0.6 * Math.abs(Math.sin(t * 4.6 + i * 0.42) * Math.sin(t * 1.9 - i * 0.13));
        const amplitude = dotRows * 0.8 * (1 - distance * 0.55) * (0.3 + 0.7 * env) * (0.35 + 0.65 * wobble);
        const radius = Math.min(maxRadius, Math.max(1, Math.round(amplitude)));
        const x = x0 + i * 2 + 1;
        for (let y = axisY - radius; y <= axisY + radius; y++) {
          // Bar body is mid tier; the outer quarter of the radius is high.
          let tier = 2;
          const distanceToAxis = Math.abs(y - axisY);
          if (distanceToAxis / radius >= 0.75) tier = 3;
          set(x, y, tier);
        }
      }

      // Pack 4x2 dot blocks into braille glyphs; cell tier is the highest
      // tier any dot carries (Go's brailleGrid.render).
      const out: string[] = [];
      const tiers: number[][] = [];
      for (let r = 0; r < rows; r++) {
        let line = "";
        const tierRow: number[] = [];
        for (let c = 0; c < cols; c++) {
          let braille = 0x2800;
          let cellTag = -1;
          for (let dr = 0; dr < 4; dr++) {
            for (let dc = 0; dc < 2; dc++) {
              const tv = cells[(r * 4 + dr) * dotCols + (c * 2 + dc)];
              if (tv === 0) continue;
              braille |= BRAILLE_BITS[dr][dc];
              if (tv - 1 > cellTag) cellTag = tv - 1;
            }
          }
          line += String.fromCharCode(braille);
          tierRow.push(cellTag < 0 ? -1 : cellTag);
        }
        out.push(line);
        tiers.push(tierRow);
      }
      return { rows: out, tiers };
    },
  };
}
