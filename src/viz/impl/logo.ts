/**
 * Logo — "CLIAMP" pixel text in Braille dots (port of /tmp/cliamp/ui/vis_logo.go).
 *
 * 5x7 block-font bitmaps for the six letters, scaled to fill the panel.
 * Each letter is tied to a frequency band: loud passages fill the text
 * solid, silence dissolves it into scattered pixels. A gentle traveling
 * wave plus a band-driven bounce keep the mark alive.
 *
 * Stateful: the frame counter drives the wave/bounce and the scatter
 * twinkle. The original ticks at 20 FPS while playing and 5 FPS when idle
 * (ui/tick.go); the counter advances proportionally to dt.
 *
 * Rows wear the spectrum tier of their vertical position (specWrap).
 */
import type { Visualizer, VizData, VizFrame } from "../types";

const BRAILLE_BITS = [0x01, 0x08, 0x02, 0x10, 0x04, 0x20, 0x40, 0x80] as const; // [dr*2+dc]

// 5x7 bitmaps for "CLIAMP"; bit 4 (0x10) is the leftmost pixel of each row.
const LOGO_GLYPHS = [
  0x0e, 0x10, 0x10, 0x10, 0x10, 0x10, 0x0e, // C
  0x10, 0x10, 0x10, 0x10, 0x10, 0x10, 0x1f, // L
  0x1f, 0x04, 0x04, 0x04, 0x04, 0x04, 0x1f, // I
  0x0e, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11, // A
  0x11, 0x1b, 0x15, 0x11, 0x11, 0x11, 0x11, // M
  0x1e, 0x11, 0x11, 0x1e, 0x10, 0x10, 0x10, // P
] as const;

const LOGO_LETTER_W = 5;
const LOGO_LETTER_H = 7;
const LOGO_NUM_LETTERS = 6;
const LOGO_GAP = 2; // pixel gap between letters
const LOGO_TOTAL_W = LOGO_NUM_LETTERS * LOGO_LETTER_W + (LOGO_NUM_LETTERS - 1) * LOGO_GAP; // 40

// Map the 6 letters across the 10 frequency bands.
const LETTER_BANDS = [0, 2, 4, 5, 7, 9] as const;

function specTag(norm: number): number {
  if (norm >= 0.6) return 2;
  if (norm >= 0.3) return 1;
  return 0;
}

/**
 * Pseudo-random value in [0, 1) for a dot position and frame, staggered per
 * dot so dots twinkle instead of flipping in lockstep (vis_logo scatterHash).
 */
function scatterHash(band: number, row: number, col: number, frame: number): number {
  const f = Math.floor((frame + row * 3 + col) / 3);
  let h = (Math.imul(band, 7919) + Math.imul(row, 6271) + Math.imul(col, 3037) + Math.imul(f, 104729)) | 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x45d9f3b3) | 0;
  h ^= h >>> 16;
  return (h >>> 0) % 10000 / 10000;
}

export function makeLogo(): Visualizer {
  let frame = 0;

  return {
    name: "Logo",
    init() {
      frame = 0;
    },
    tick(dt: number, data: VizData) {
      frame += Math.min(dt, 0.4) * (data.playing ? 20 : 5);
    },
    render(data: VizData): VizFrame {
      const rows = data.rows;
      const cols = data.cols;
      const bands = data.bands;

      const out: string[] = [];
      const tiers: number[][] = [];
      for (let r = 0; r < rows; r++) {
        out.push(" ".repeat(cols));
        tiers.push(new Array<number>(cols).fill(-1));
      }
      if (rows <= 0 || cols <= 0 || bands.length === 0) return { rows: out, tiers };

      const dotRows = rows * 4;
      const dotCols = cols * 2;
      const grid = new Uint8Array(dotRows * dotCols);

      // Scale letters to fill the panel (75% of height for bounce headroom).
      let scaleX = Math.floor(dotCols / LOGO_TOTAL_W);
      let scaleY = Math.floor(Math.floor((dotRows * 3) / 4) / LOGO_LETTER_H);
      if (scaleX < 1) scaleX = 1;
      if (scaleY < 1) scaleY = 1;

      const renderedW = LOGO_TOTAL_W * scaleX;
      const renderedH = LOGO_LETTER_H * scaleY;
      const offsetX = Math.floor((dotCols - renderedW) / 2);
      const baseOffsetY = Math.floor((dotRows - renderedH) / 2);

      for (let li = 0; li < LOGO_NUM_LETTERS; li++) {
        const energy = bands[LETTER_BANDS[li]] ?? 0;

        // Gentle traveling wave for life during silence + subtle bounce.
        const wave = Math.sin(frame * 0.06 + li * 0.9) * 1.5;
        const bounce = Math.trunc(energy * baseOffsetY * 0.3 + wave);

        const letterX = offsetX + li * (LOGO_LETTER_W + LOGO_GAP) * scaleX;
        const letterY = baseOffsetY - bounce;

        for (let py = 0; py < LOGO_LETTER_H; py++) {
          const rowBits = LOGO_GLYPHS[li * LOGO_LETTER_H + py];
          for (let px = 0; px < LOGO_LETTER_W; px++) {
            if ((rowBits & (1 << (LOGO_LETTER_W - 1 - px))) === 0) continue;

            // Each dot's visibility is gated by energy: loud fills the text
            // solid, silence dissolves it to scattered pixels.
            const fill = energy * energy * 0.75 + 0.15;
            for (let sy = 0; sy < scaleY; sy++) {
              const dy = letterY + py * scaleY + sy;
              if (dy < 0 || dy >= dotRows) continue;
              for (let sx = 0; sx < scaleX; sx++) {
                const dx = letterX + px * scaleX + sx;
                if (dx < 0 || dx >= dotCols) continue;
                if (scatterHash(li, py * scaleY + sy, px * scaleX + sx, frame) > fill) continue;
                grid[dy * dotCols + dx] = 1;
              }
            }
          }
        }
      }

      // Convert the dot grid to Braille characters.
      for (let row = 0; row < rows; row++) {
        const rowBottom = (rows - 1 - row) / rows;
        const tier = specTag(rowBottom);
        let line = "";
        const tierRow: number[] = [];
        for (let ch = 0; ch < cols; ch++) {
          let code = 0;
          for (let dr = 0; dr < 4; dr++) {
            const dy = row * 4 + dr;
            if (dy >= dotRows) break;
            for (let dc = 0; dc < 2; dc++) {
              if (grid[dy * dotCols + ch * 2 + dc]) code |= BRAILLE_BITS[dr * 2 + dc];
            }
          }
          line += code !== 0 ? String.fromCharCode(0x2800 | code) : " ";
          tierRow.push(code !== 0 ? tier : -1);
        }
        out[row] = line.slice(0, cols).padEnd(cols, " ");
        tiers[row] = tierRow.slice(0, cols);
      }
      return { rows: out, tiers };
    },
  };
}
