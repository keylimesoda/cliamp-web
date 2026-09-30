/**
 * Butterfly — mirrored Rorschach/butterfly spectrum in Braille (port of
 * /tmp/cliamp/ui/vis_butterfly.go).
 *
 * Each dot row maps to a band (interpolated between neighbors), and the
 * pattern extends wingWidth dots left and right of the center axis, gated by
 * a hash threshold that is dense near the spine and flickers at the wing
 * edges. A sine wobble over frame + row gives the organic ink-blot motion.
 * The central spine is drawn while there is energy. Rows are colored by a
 * top-to-bottom gradient (specTag of the row position).
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
 * Go reference's 64-bit mix in 32 bits.
 */
function scatterHash(band: number, row: number, col: number, frame: number): number {
  const f = Math.floor((frame + (row * 3 + col)) / 3);
  let h = (band * 7919 + row * 6271 + col * 3037 + f * 104729) >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x45d9f3b3) >>> 0;
  h ^= h >>> 16;
  return (h % 10000) / 10000;
}

export function makeButterfly(): Visualizer {
  // Animation frame counter; Go reference runs at ~60 FPS.
  let frame = 0;

  return {
    name: "Butterfly",
    init(): void {
      frame = 0;
    },
    tick(dt: number): void {
      frame += dt * 60;
    },
    render(data: VizData): VizFrame {
      const { rows, cols, bands } = data;
      const dotRows = rows * 4;
      const dotCols = cols * 2;
      const centerX = dotCols / 2;
      const bandCount = bands.length;
      const frameThird = Math.floor(frame / 3);

      const grid = new Uint8Array(dotRows * dotCols);

      for (let dy = 0; dy < dotRows; dy++) {
        // Map vertical position to a band index (interpolated).
        const bandF = (dy / Math.max(1, dotRows - 1)) * (bandCount - 1);
        const bi = Math.floor(bandF);
        const frac = bandF - bi;
        const energy =
          bi >= bandCount - 1 ? bands[bandCount - 1] : bands[bi] * (1 - frac) + bands[bi + 1] * frac;

        // Wing width: how far from center the pattern extends.
        const wobble = Math.sin(frame * 0.08 + dy * 0.3) * 0.15;
        const wingWidth = Math.floor(centerX * (energy + wobble) * 0.9);

        for (let dx = 0; dx < wingWidth; dx++) {
          // Distance from center normalized to wing width.
          const norm = dx / Math.max(1, wingWidth);

          // Organic edge: denser near center, sparser at the edges.
          let threshold = (1 - norm * norm) * energy;
          // Frame-based flicker at the edges.
          if (norm > 0.6) {
            threshold *= 0.5 + 0.5 * Math.sin(frame * 0.1 + dy * 0.5 + dx * 0.3);
          }

          if (scatterHash(bi, dy, dx, frameThird) < threshold) {
            // Right wing.
            const rx = centerX + dx;
            if (rx < dotCols) grid[dy * dotCols + rx] = 1;
            // Left wing (mirror).
            const lx = centerX - 1 - dx;
            if (lx >= 0) grid[dy * dotCols + lx] = 1;
          }
        }

        // Central spine, drawn while there is energy.
        if (energy > 0.05) {
          grid[dy * dotCols + centerX] = 1;
          if (centerX > 0) grid[dy * dotCols + centerX - 1] = 1;
        }
      }

      // Braille with a top-to-bottom color gradient.
      const out: string[] = [];
      const tiers: number[][] = [];
      for (let row = 0; row < rows; row++) {
        const tier = specTag(row / Math.max(1, rows - 1));
        let line = "";
        const tierRow: number[] = [];
        for (let ch = 0; ch < cols; ch++) {
          let bits = 0;
          for (let dr = 0; dr < 4; dr++) {
            for (let dc = 0; dc < 2; dc++) {
              if (grid[(row * 4 + dr) * dotCols + ch * 2 + dc]) {
                bits |= BRAILLE_BITS[dr][dc];
              }
            }
          }
          line += String.fromCharCode(0x2800 | bits);
          tierRow.push(bits === 0 ? -1 : tier);
        }
        out.push(line.slice(0, cols).padEnd(cols, " "));
        tiers.push(tierRow.slice(0, cols));
      }
      return { rows: out, tiers };
    },
  };
}
