/**
 * Scope — Lissajous XY oscilloscope in Braille (port of
 * /tmp/cliamp/ui/vis_scope.go).
 *
 * The mono tap is plotted against a phase-delayed copy of itself: x = sample,
 * y = sample delayed by a slowly oscillating offset, so the figure keeps
 * evolving (circles for pure tones, knots for music). The frame counter is
 * the Lissajous phase; it lives in the closure and advances in tick.
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

export function makeScope(): Visualizer {
  // Animation frame counter (the Lissajous phase); Go reference runs at ~60 FPS.
  let frame = 0;

  return {
    name: "Scope",
    init(): void {
      frame = 0;
    },
    tick(dt: number): void {
      frame += dt * 60;
    },
    render(data: VizData): VizFrame {
      const { rows, cols, waveform } = data;
      const dotRows = rows * 4;
      const dotCols = cols * 2;
      const n = waveform.length;

      const grid = new Uint8Array(dotRows * dotCols);

      if (n > 1) {
        // Phase delay slowly oscillates for evolving Lissajous patterns.
        const baseDelay = Math.floor(n / 4);
        const wobble = Math.floor(Math.sin(frame * 0.02) * (n / 8));
        const delay = Math.max(1, Math.min(n - 1, baseDelay + wobble));

        // Plot up to 512 XY pairs for a dense, smooth figure.
        const plotPoints = Math.min(n - delay, 512);
        const step = Math.max(1, Math.floor((n - delay) / plotPoints));

        let prevDotX = 0;
        let prevDotY = 0;
        let first = true;

        for (let i = 0; i + delay < n; i += step) {
          const x = waveform[i];
          const y = waveform[i + delay];

          // Map [-1, 1] to dot coordinates.
          let dotX = Math.floor((x + 1) * 0.5 * (dotCols - 1));
          let dotY = Math.floor((1 - y) * 0.5 * (dotRows - 1));
          dotX = Math.max(0, Math.min(dotCols - 1, dotX));
          dotY = Math.max(0, Math.min(dotRows - 1, dotY));

          grid[dotY * dotCols + dotX] = 1;

          // Interpolate between consecutive points for smoother curves.
          if (!first) {
            const dx = dotX - prevDotX;
            const dy = dotY - prevDotY;
            const steps = Math.max(Math.abs(dx), Math.abs(dy));
            if (steps > 0 && steps < 30) {
              for (let s = 1; s < steps; s++) {
                const mx = prevDotX + (dx * s) / steps;
                const my = prevDotY + (dy * s) / steps;
                if (mx >= 0 && mx < dotCols && my >= 0 && my < dotRows) {
                  grid[Math.trunc(my) * dotCols + Math.trunc(mx)] = 1;
                }
              }
            }
          }

          prevDotX = dotX;
          prevDotY = dotY;
          first = false;
        }
      }

      // Convert the dot grid to Braille characters.
      const out: string[] = [];
      const tiers: number[][] = [];
      for (let row = 0; row < rows; row++) {
        const tier = specTag((rows - 1 - row) / rows);
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
