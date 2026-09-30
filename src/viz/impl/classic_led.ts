/**
 * ClassicLED — Winamp 2.9-style LED matrix: 2-cell-wide bars of half-block
 * LEDs with falling peak caps (port of /tmp/cliamp/ui/vis_classic_led.go).
 *
 * Body LEDs light with a fast attack and medium decay; the peak cap holds at
 * the apex briefly, then falls at a constant rate, quantized into LED rows
 * at render time. State (body/peak/hold per column) lives in the closure
 * and advances in tick.
 */
import type { Visualizer, VizData, VizFrame } from "../types";

const BAR_WIDTH = 2;
const BAR_GAP = 1;
const FPS = 30;
const RISE_RATE = 60.0;
const FALL_RATE = 16.0;
const PEAK_HOLD = 0.45;
const PEAK_FALL = 0.55;

function specTag(norm: number): number {
  if (norm >= 0.6) return 2;
  if (norm >= 0.3) return 1;
  return 0;
}

// Linear sample of the band array at a fractional position (Go's
// sampleBandLinear).
function sampleBandLinear(bands: Float32Array, pos: number): number {
  const n = bands.length;
  if (n === 0) return 0;
  if (n === 1) return bands[0];
  if (pos <= 0) return bands[0];
  const last = n - 1;
  if (pos >= last) return bands[n - 1];
  const idx = Math.floor(pos);
  const frac = pos - idx;
  return bands[idx] * (1 - frac) + bands[idx + 1] * frac;
}

// Resample bands to totalCols LED columns (Go's resampleBandsLinear).
function resampleBandsLinear(bands: Float32Array, totalCols: number): number[] {
  if (totalCols <= 0 || bands.length === 0) return [];
  if (bands.length === totalCols) return Array.from(bands);
  const out = new Array<number>(totalCols);
  if (totalCols === 1) {
    out[0] = sampleBandLinear(bands, (bands.length - 1) / 2);
    return out;
  }
  const last = bands.length - 1;
  for (let col = 0; col < totalCols; col++) {
    out[col] = sampleBandLinear(bands, (col / (totalCols - 1)) * last);
  }
  return out;
}

export function makeClassicLed(): Visualizer {
  let body: number[] = [];
  let peak: number[] = [];
  let hold: number[] = [];

  return {
    name: "ClassicLED",
    init() {
      body = [];
      peak = [];
      hold = [];
    },
    tick(dt: number, data: VizData): void {
      const barCount = Math.max(1, Math.floor((data.cols + BAR_GAP) / (BAR_WIDTH + BAR_GAP)));
      const levels = resampleBandsLinear(data.bands, barCount);
      if (body.length !== levels.length || peak.length !== levels.length || hold.length !== levels.length) {
        body = levels.slice();
        peak = levels.slice();
        hold = new Array<number>(levels.length).fill(0);
        return;
      }
      let step = dt;
      const frame = 1 / FPS;
      // Clamp long gaps (sleep, overlay dismiss) to one fixed frame.
      if (!(step > 0) || step > 10 * frame) step = frame;
      for (let i = 0; i < levels.length; i++) {
        const target = levels[i];
        const rate = target > body[i] ? RISE_RATE : FALL_RATE;
        body[i] += (target - body[i]) * (1 - Math.exp(-rate * step));

        if (body[i] >= peak[i]) {
          peak[i] = body[i];
          hold[i] = PEAK_HOLD;
        } else if (hold[i] > 0) {
          hold[i] = Math.max(0, hold[i] - step);
        } else {
          peak[i] = Math.max(body[i], peak[i] - PEAK_FALL * step);
        }
      }
    },
    render(data: VizData): VizFrame {
      const { rows, cols } = data;
      const barCount = Math.max(1, Math.floor((cols + BAR_GAP) / (BAR_WIDTH + BAR_GAP)));
      const levels = resampleBandsLinear(data.bands, barCount);
      const hasState = body.length === barCount && peak.length === barCount;
      const b = hasState ? body : levels;
      const p = hasState ? peak : levels;
      const renderWidth = barCount * (BAR_WIDTH + BAR_GAP) - BAR_GAP;
      const rowPad = Math.max(0, cols - renderWidth);

      const out: string[] = [];
      const tiers: number[][] = [];
      for (let r = 0; r < rows; r++) {
        const rowBottom = (rows - 1 - r) / rows;
        const tier = specTag(rowBottom);
        // Row position from the bottom: 0 == lowest LED row, rows-1 == top.
        const rfb = rows - 1 - r;
        let line = " ".repeat(rowPad);
        const tierRow: number[] = new Array<number>(rowPad).fill(-1);
        for (let i = 0; i < barCount; i++) {
          const lit = Math.floor(b[i] * rows + 1e-6);
          let peakSeg = Math.floor(p[i] * rows + 1e-6);
          if (peakSeg >= rows) peakSeg = rows - 1;
          // A peak only renders when strictly above the bar body.
          const showPeak = p[i] > b[i] + 0.5 / rows && peakSeg >= lit;
          let glyph = " ";
          if (rfb < lit) glyph = "▄";
          else if (showPeak && rfb === peakSeg) glyph = "▀";
          line += glyph.repeat(BAR_WIDTH);
          for (let k = 0; k < BAR_WIDTH; k++) tierRow.push(glyph === " " ? -1 : tier);
          if (i < barCount - 1) {
            line += " ".repeat(BAR_GAP);
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
