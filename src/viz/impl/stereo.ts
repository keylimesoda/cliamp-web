/**
 * Stereo — L/R horizontal LED peak meters (port of /tmp/cliamp/ui/vis_stereo.go).
 *
 * Two stacked meter banks: lit ▮ cells for the level, a ■ peak cap that
 * holds for 450 ms then falls, resting cells as ·. The original reads L/R
 * sample windows; the web tap is mono, so both banks are driven from
 * data.waveform (RMS/peak in dB, as the original) blended with the spectrum
 * bands — the low half feeding L, the high half feeding R for variety.
 *
 * Stateful: per-channel level, peak cap and peak-hold live in the closure
 * and advance in tick with the original's rise/fall rates
 * (36 dB-ish/s rise, 10/s fall; cap falls 0.65/s).
 */
import type { Visualizer, VizData, VizFrame } from "../types";

const STEREO_FLOOR_DB = -48;
const STEREO_RISE_RATE = 36;
const STEREO_FALL_RATE = 10;
const STEREO_PEAK_HOLD = 0.45; // seconds
const STEREO_PEAK_FALL_RATE = 0.65; // per second
const STEREO_MAX_SMOOTH_DT = 0.16; // maxSmoothDtFrames * TickAnim

function specTag(norm: number): number {
  if (norm >= 0.6) return 2;
  if (norm >= 0.3) return 1;
  return 0;
}

/** Maps an amplitude 0..1 to a 0..1 level on a -48 dB floor (stereoDBLevel). */
function dbLevel(amplitude: number): number {
  if (amplitude <= 0) return 0;
  const db = 20 * Math.log10(amplitude);
  return Math.max(0, Math.min(1, (db - STEREO_FLOOR_DB) / -STEREO_FLOOR_DB));
}

function meanRange(bands: Float32Array, lo: number, hi: number): number {
  let sum = 0;
  let n = 0;
  for (let i = lo; i < hi && i < bands.length; i++) {
    sum += bands[i];
    n++;
  }
  return n > 0 ? sum / n : 0;
}

export function makeStereo(): Visualizer {
  const level = [0, 0];
  const peak = [0, 0];
  const hold = [0, 0];
  const targetLevel = [0, 0];
  const targetPeak = [0, 0];

  return {
    name: "Stereo",
    init() {
      level[0] = level[1] = 0;
      peak[0] = peak[1] = 0;
      hold[0] = hold[1] = 0;
      targetLevel[0] = targetLevel[1] = 0;
      targetPeak[0] = targetPeak[1] = 0;
    },
    tick(dt: number, data: VizData) {
      const wave = data.waveform;
      const bands = data.bands;
      if (data.playing && wave.length > 0) {
        let sumSquares = 0;
        let maxAbs = 0;
        for (let i = 0; i < wave.length; i++) {
          const v = wave[i];
          sumSquares += v * v;
          const a = v < 0 ? -v : v;
          if (a > maxAbs) maxAbs = a;
        }
        const rms = Math.sqrt(sumSquares / wave.length);
        const dbRms = dbLevel(rms);
        const dbPk = dbLevel(maxAbs);

        // Mono tap drives both banks: waveform as the common signal, bands
        // split low→L / high→R for variety.
        targetLevel[0] = 0.5 * dbRms + 0.5 * meanRange(bands, 0, 5);
        targetLevel[1] = 0.5 * dbRms + 0.5 * meanRange(bands, 5, 10);
        let lPeakBand = 0;
        let rPeakBand = 0;
        for (let i = 0; i < bands.length; i++) {
          const b = bands[i];
          if (i < 5 && b > lPeakBand) lPeakBand = b;
          if (i >= 5 && b > rPeakBand) rPeakBand = b;
        }
        targetPeak[0] = Math.max(dbPk, lPeakBand);
        targetPeak[1] = Math.max(dbPk, rPeakBand);
      } else {
        targetLevel[0] = targetLevel[1] = 0;
        targetPeak[0] = targetPeak[1] = 0;
      }

      let dtSeconds = dt;
      if (dtSeconds <= 0 || dtSeconds > STEREO_MAX_SMOOTH_DT) dtSeconds = 0.016;

      for (let channel = 0; channel < 2; channel++) {
        const rate = targetLevel[channel] > level[channel] ? STEREO_RISE_RATE : STEREO_FALL_RATE;
        level[channel] += (targetLevel[channel] - level[channel]) * (1 - Math.exp(-rate * dtSeconds));

        if (targetPeak[channel] > peak[channel]) {
          peak[channel] = targetPeak[channel];
          hold[channel] = STEREO_PEAK_HOLD;
        } else if (hold[channel] > 0) {
          hold[channel] = Math.max(0, hold[channel] - dtSeconds);
        } else {
          peak[channel] = Math.max(level[channel], peak[channel] - STEREO_PEAK_FALL_RATE * dtSeconds);
        }
      }
    },
    render(data: VizData): VizFrame {
      const rows = data.rows;
      const cols = data.cols;

      const meter = (label: string, lvl: number, pk: number): [string, number[]] => {
        if (cols <= 0) return ["", []];
        if (cols <= label.length) return [label.slice(0, cols), new Array<number>(cols).fill(-1)];
        const cells = cols - label.length;
        const lit = Math.min(cells, Math.round(lvl * cells));
        const peakCell = pk > 0 ? Math.min(cells - 1, Math.max(0, Math.round(pk * cells) - 1)) : -1;
        const line: string[] = [];
        const tierRow: number[] = [];
        for (let c = 0; c < label.length; c++) {
          line.push(label[c]);
          tierRow.push(-1);
        }
        for (let cell = 0; cell < cells; cell++) {
          let glyph = "·";
          let tag = -1;
          if (cell < lit) {
            glyph = "▮";
            tag = specTag(cell / Math.max(1, cells - 1));
          }
          if (cell === peakCell) {
            glyph = "■";
            tag = specTag(cell / Math.max(1, cells - 1));
          }
          line.push(glyph);
          tierRow.push(tag);
        }
        return [line.join("").slice(0, cols), tierRow.slice(0, cols)];
      };

      const out: string[] = [];
      const tiers: number[][] = [];
      for (let r = 0; r < rows; r++) {
        out.push(" ".repeat(cols));
        tiers.push(new Array<number>(cols).fill(-1));
      }
      if (rows <= 0) return { rows: out, tiers };

      const fill = (row: number, label: string, lvl: number, pk: number) => {
        const [line, tierRow] = meter(label, lvl, pk);
        if (row < 0 || row >= rows) return;
        out[row] = line.padEnd(cols, " ");
        tiers[row] = tierRow.concat(new Array<number>(Math.max(0, cols - tierRow.length)).fill(-1)).slice(0, cols);
      };

      if (rows === 1) {
        fill(0, "L ", level[0], peak[0]);
        return { rows: out, tiers };
      }

      const thickness = Math.floor(rows / 2);
      for (let i = 0; i < thickness; i++) {
        fill(i, i === thickness / 2 ? "L " : "  ", level[0], peak[0]);
      }
      let row = thickness;
      if (rows % 2 !== 0) row++;
      for (let i = 0; i < thickness; i++) {
        fill(row + i, i === thickness / 2 ? "R " : "  ", level[1], peak[1]);
      }
      return { rows: out, tiers };
    },
  };
}
