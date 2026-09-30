/**
 * Wave — Braille waveform oscilloscope (port of /tmp/cliamp/ui/vis_wave.go).
 *
 * The raw time-domain tap is downsampled to one y-position per dot column of
 * a 2-wide x 4-tall Braille dot grid, so each character cell holds a
 * 2x4 sub-pixel slice of the waveform. Consecutive columns are connected
 * vertically so the trace is continuous. Rows are colored by vertical tier
 * (specTag): green low, yellow mid, red high.
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

export function makeWave(): Visualizer {
  return {
    name: "Wave",
    tick() {},
    render(data: VizData): VizFrame {
      const { rows, cols, waveform } = data;
      const dotRows = rows * 4;
      const dotCols = cols * 2;
      const n = waveform.length;

      // One y-position per horizontal dot column.
      const ypos = new Int32Array(dotCols);
      for (let x = 0; x < dotCols; x++) {
        let sample = 0;
        if (n > 0) {
          let idx = Math.floor((x * n) / dotCols);
          if (idx >= n) idx = n - 1;
          sample = waveform[idx];
        }
        // Map sample [-1, 1] to dot row [0, dotRows-1].
        const y = Math.floor(((1 - sample) * (dotRows - 1)) / 2);
        ypos[x] = Math.max(0, Math.min(dotRows - 1, y));
      }

      const out: string[] = [];
      const tiers: number[][] = [];
      for (let row = 0; row < rows; row++) {
        const tier = specTag((rows - 1 - row) / rows);
        let line = "";
        const tierRow: number[] = [];
        for (let ch = 0; ch < cols; ch++) {
          let bits = 0;
          for (let dc = 0; dc < 2; dc++) {
            const x = ch * 2 + dc;
            const y = ypos[x];
            // Connect to the previous point so the waveform is continuous.
            const prevY = x > 0 ? ypos[x - 1] : y;
            const yMin = Math.min(y, prevY);
            const yMax = Math.max(y, prevY);
            for (let dr = 0; dr < 4; dr++) {
              const dotY = row * 4 + dr;
              if (dotY >= yMin && dotY <= yMax) {
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
