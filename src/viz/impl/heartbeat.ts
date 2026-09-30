/**
 * Heartbeat — scrolling ECG/pulse-monitor trace in Braille (port of
 * /tmp/cliamp/ui/vis_heartbeat.go).
 *
 * The mono tap is shaped like an ECG trace (sharpened peaks, flattened
 * noise: sample * |sample|) and pushed into a scrolling per-dot-column y
 * buffer: the trace scrolls left each frame and new samples enter at the
 * right edge, for the classic hospital-monitor look. A dashed baseline runs
 * along the center. Trace dots are red (tier 2), the baseline green
 * (tier 0).
 */
import type { Visualizer, VizData, VizFrame } from "../types";

const BRAILLE_BITS = [
  [0x01, 0x08], // row 0
  [0x02, 0x10], // row 1
  [0x04, 0x20], // row 2
  [0x40, 0x80], // row 3
] as const;

export function makeHeartbeat(): Visualizer {
  let dotRows = 0;
  let dotCols = 0;
  /** Scrolling trace: one dot-row y per dot column. */
  let trace = new Int32Array(0);
  /** Fractional dot columns accumulated since the last shift. */
  let scroll = 0;

  function reset(cols: number, rows: number): void {
    dotRows = rows * 4;
    dotCols = cols * 2;
    trace = new Int32Array(dotCols);
    // Start as a flat line at the center.
    trace.fill(Math.floor(dotRows / 2));
    scroll = 0;
  }

  function ensure(cols: number, rows: number): void {
    if (dotRows === rows * 4 && dotCols === cols * 2 && trace.length === dotCols) {
      return;
    }
    reset(cols, rows);
  }

  /** Shaped ECG y-position (dot row) for dot column x from the current tap. */
  function traceY(x: number, waveform: Float32Array): number {
    const n = waveform.length;
    let sample = 0;
    if (n > 0) {
      let idx = Math.floor((x * n) / dotCols);
      if (idx >= n) idx = n - 1;
      sample = waveform[idx];
    }
    // Sharpen peaks, flatten noise (square the magnitude, keep sign).
    const shaped = sample * Math.abs(sample);
    const y = Math.floor(dotRows / 2 - shaped * dotRows * 0.45);
    return Math.max(0, Math.min(dotRows - 1, y));
  }

  return {
    name: "Heartbeat",
    init(cols: number, rows: number): void {
      reset(cols, rows);
    },
    tick(dt: number, data: VizData): void {
      ensure(data.cols, data.rows);
      // ~1 dot column per 60-FPS frame, like the original's buffer shift.
      scroll += dt * 60;
      let shift = Math.floor(scroll);
      if (shift <= 0) return;
      scroll -= shift;
      if (shift >= dotCols) {
        trace.fill(traceY(dotCols - 1, data.waveform));
        return;
      }
      for (let x = 0; x < dotCols - shift; x++) {
        trace[x] = trace[x + shift];
      }
      for (let k = 0; k < shift; k++) {
        const x = dotCols - shift + k;
        trace[x] = traceY(x, data.waveform);
      }
    },
    render(data: VizData): VizFrame {
      const { rows, cols } = data;
      ensure(cols, rows);

      const grid = new Uint8Array(dotRows * dotCols);

      // ECG trace with continuous line connections.
      for (let x = 0; x < dotCols; x++) {
        const y = trace[x];
        grid[y * dotCols + x] = 1;
        if (x > 0) {
          const lo = Math.min(y, trace[x - 1]);
          const hi = Math.max(y, trace[x - 1]);
          for (let fy = lo; fy <= hi; fy++) {
            grid[fy * dotCols + x] = 1;
          }
        }
      }

      // Dashed baseline at center: on for 6, off for 4.
      const baseY = Math.floor(dotRows / 2);
      for (let x = 0; x < dotCols; x++) {
        if (grid[baseY * dotCols + x] === 0 && Math.floor(x / 6) % 2 === 0) {
          grid[baseY * dotCols + x] = 1;
        }
      }

      const out: string[] = [];
      const tiers: number[][] = [];
      for (let row = 0; row < rows; row++) {
        let line = "";
        const tierRow: number[] = [];
        for (let ch = 0; ch < cols; ch++) {
          let bits = 0;
          let hasTrace = false;
          for (let dr = 0; dr < 4; dr++) {
            for (let dc = 0; dc < 2; dc++) {
              const dy = row * 4 + dr;
              const dx = ch * 2 + dc;
              if (grid[dy * dotCols + dx]) {
                bits |= BRAILLE_BITS[dr][dc];
                // Dots off the baseline are part of the trace.
                if (dy !== baseY) hasTrace = true;
              }
            }
          }
          line += String.fromCharCode(0x2800 | bits);
          // Green baseline, red trace, blank otherwise.
          tierRow.push(bits === 0 ? -1 : hasTrace ? 2 : 0);
        }
        out.push(line.slice(0, cols).padEnd(cols, " "));
        tiers.push(tierRow.slice(0, cols));
      }
      return { rows: out, tiers };
    },
  };
}
