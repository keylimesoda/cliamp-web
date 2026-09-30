/**
 * Scatter — twinkling braille particle field (port of
 * /tmp/cliamp/ui/vis_scatter.go).
 *
 * Each dot of each band column rolls a staggered hash per frame; dots light
 * when the hash falls below the band's squared energy, weighted by a gravity
 * bias toward the bottom. The stagger (row/col offset over a 3-frame window)
 * keeps individual dots lit for a few frames — a twinkle. The frame counter
 * is the animation state; it lives in the closure and advances in tick.
 * Rows are colored by vertical tier (specTag).
 */
import type { Visualizer, VizData, VizFrame } from "../types";

const BRAILLE_BITS = [
  [0x01, 0x08], // row 0
  [0x02, 0x10], // row 1
  [0x04, 0x20], // row 2
  [0x40, 0x80], // row 3
] as const;

function specTag(norm: number): number {
  if (norm >= 0.6) return 2;
  if (norm >= 0.3) return 1;
  return 0;
}

/**
 * Pseudo-random value in [0, 1) for a dot position and frame, mirroring the
 * Go reference's 64-bit mix in 32 bits. Dots persist for a few frames
 * (staggered) to create the twinkling effect.
 */
function scatterHash(band: number, row: number, col: number, frame: number): number {
  const f = Math.floor((frame + (row * 3 + col)) / 3);
  let h = (band * 7919 + row * 6271 + col * 3037 + f * 104729) >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x45d9f3b3) >>> 0;
  h ^= h >>> 16;
  return (h % 10000) / 10000;
}

export function makeScatter(): Visualizer {
  // Animation frame counter; Go reference runs at ~60 FPS.
  let frame = 0;

  return {
    name: "Scatter",
    init(): void {
      frame = 0;
    },
    tick(dt: number): void {
      frame += dt * 60;
    },
    render(data: VizData): VizFrame {
      const { rows, cols, bands } = data;
      const dotRows = rows * 4;
      const bandCount = bands.length;
      const frameInt = Math.floor(frame);

      // visBandWidth layout: wide columns per band with a gap between bands.
      const visibleBands = Math.min(bandCount, cols);
      const gapCount = Math.min(visibleBands - 1, Math.max(0, cols - visibleBands));
      const base = Math.floor((cols - gapCount) / visibleBands);
      const extra = (cols - gapCount) % visibleBands;

      const out: string[] = [];
      const tiers: number[][] = [];
      for (let row = 0; row < rows; row++) {
        const tier = specTag((rows - 1 - row) / rows);
        let line = "";
        const tierRow: number[] = [];
        for (let b = 0; b < bandCount; b++) {
          const width = b < visibleBands ? (b < extra ? base + 1 : base) : 0;
          for (let c = 0; c < width; c++) {
            let bits = 0;
            for (let dr = 0; dr < 4; dr++) {
              for (let dc = 0; dc < 2; dc++) {
                const dotRow = row * 4 + dr;
                const dotCol = c * 2 + dc;
                const h = scatterHash(b, dotRow, dotCol, frameInt);

                // Gravity bias: more particles settle near the bottom.
                const heightFactor = 0.5 + (0.5 * dotRow) / (dotRows - 1);
                const threshold = bands[b] * bands[b] * heightFactor;

                if (h < threshold) {
                  bits |= BRAILLE_BITS[dr][dc];
                }
              }
            }
            line += String.fromCharCode(0x2800 | bits);
            tierRow.push(bits === 0 ? -1 : tier);
          }
          if (b < bandCount - 1) {
            line += " ";
            tierRow.push(-1);
          }
        }
        out.push(line.slice(0, cols).padEnd(cols, " "));
        tiers.push(tierRow.slice(0, cols));
      }
      return { rows: out, tiers };
    },
  };
}
