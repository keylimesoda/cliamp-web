/**
 * ClassicPeak — thin spectrum columns with classic falling peak caps
 * (port of /tmp/cliamp/ui/vis_classic_peak.go).
 *
 * Bar bodies ease toward the band levels (fast attack / slow decay). When a
 * landed cap is overtaken by a rising bar it launches upward, pauses briefly
 * at the apex, then falls under gravity until it lands back on the bar.
 * State (bar/peak positions, velocities, hold timers) lives in the closure
 * and advances in tick.
 */
import type { Visualizer, VizData, VizFrame } from "../types";

const BAR_BLOCKS = [" ", "▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"] as const;
const CAP_GLYPHS = ["⎺", "⎻", "⎼", "⎽"] as const;

const LAUNCH_BASE = 0.8;
const LAUNCH_GAIN = 1.4;
const LAUNCH_MAX = 1.7;
const GRAVITY = 9.5;
const APEX_HOLD = 0.08;
const RISE_RATE = 34.0;
const FALL_RATE = 10.0;
const EPS = 0.01;
const TICK = 1 / 60;
const BAR_WIDTH = 1;
const BAR_GAP = 1;

function fracBlock(level: number, rowBottom: number, rowTop: number): string {
  if (level >= rowTop) return "█";
  if (level > rowBottom) {
    const frac = (level - rowBottom) / (rowTop - rowBottom);
    const idx = Math.max(0, Math.min(BAR_BLOCKS.length - 1, Math.floor(frac * (BAR_BLOCKS.length - 1))));
    return BAR_BLOCKS[idx];
  }
  return " ";
}

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

// Resample bands to totalCols display columns (Go's resampleBandsLinear).
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

// The cap's braille row and glyph for a normalized level (Go's
// classicPeakGlyph).
function capGlyph(level: number, height: number): { row: number; glyph: string } {
  const dotRows = Math.max(1, height * 4);
  const dotY = Math.round((1 - Math.min(1, level)) * (dotRows - 1));
  return { row: Math.floor(dotY / 4), glyph: CAP_GLYPHS[dotY % 4] };
}

export function makeClassicPeak(): Visualizer {
  let barPos: number[] = [];
  let peakPos: number[] = [];
  let peakVel: number[] = [];
  let peakHold: number[] = [];

  function animating(levels: number[]): boolean {
    if (levels.length !== barPos.length || levels.length !== peakPos.length) return false;
    for (let i = 0; i < levels.length; i++) {
      if (Math.abs(barPos[i] - levels[i]) > EPS || peakVel[i] !== 0 || peakPos[i] > barPos[i] + EPS) {
        return true;
      }
    }
    return false;
  }

  function advance(levels: number[], dtRaw: number): void {
    let dt = dtRaw;
    // Clamp long gaps (pause, stalled frame) to one fixed timestep.
    if (!(dt > 0) || dt > 10 * TICK) dt = TICK;
    for (let i = 0; i < levels.length; i++) {
      const level = levels[i];
      const rate = level > barPos[i] ? RISE_RATE : FALL_RATE;
      barPos[i] = barPos[i] + (level - barPos[i]) * (1 - Math.exp(-rate * dt));

      if (peakHold[i] > 0) {
        peakHold[i] = Math.max(0, peakHold[i] - dt);
        if (peakHold[i] > 0) continue;
      }

      const prevVel = peakVel[i];
      peakPos[i] += peakVel[i] * dt;
      peakVel[i] -= GRAVITY * dt;
      if (peakPos[i] > 1) peakPos[i] = 1;
      if (prevVel > 0 && peakVel[i] <= 0 && peakPos[i] > barPos[i] + EPS) {
        // Apex: pause before the fall.
        peakVel[i] = 0;
        peakHold[i] = APEX_HOLD;
        continue;
      }
      if (peakPos[i] <= barPos[i]) {
        peakPos[i] = barPos[i];
        peakVel[i] = 0;
        peakHold[i] = 0;
      }
    }
  }

  return {
    name: "ClassicPeak",
    init() {
      barPos = [];
      peakPos = [];
      peakVel = [];
      peakHold = [];
    },
    tick(dt: number, data: VizData): void {
      const colCount = Math.max(1, Math.floor((data.cols + BAR_GAP) / (BAR_WIDTH + BAR_GAP)));
      const levels = resampleBandsLinear(data.bands, colCount);
      if (levels.length !== barPos.length || levels.length !== peakPos.length) {
        barPos = levels.slice();
        peakPos = levels.slice();
        peakVel = new Array<number>(levels.length).fill(0);
        peakHold = new Array<number>(levels.length).fill(0);
        return;
      }
      // Launch: a landed cap overtaken by a rising bar pops back up.
      for (let i = 0; i < levels.length; i++) {
        if (peakVel[i] === 0 && peakPos[i] <= barPos[i] + EPS && levels[i] > peakPos[i]) {
          const delta = levels[i] - peakPos[i];
          peakPos[i] = levels[i];
          peakVel[i] = Math.min(LAUNCH_MAX, LAUNCH_BASE + LAUNCH_GAIN * delta);
          peakHold[i] = 0;
        }
      }
      if (animating(levels)) advance(levels, dt);
    },
    render(data: VizData): VizFrame {
      const { rows, cols } = data;
      const colCount = Math.max(1, Math.floor((cols + BAR_GAP) / (BAR_WIDTH + BAR_GAP)));
      const levels = resampleBandsLinear(data.bands, colCount);
      const hasState = levels.length === barPos.length && levels.length === peakPos.length;
      const body = hasState ? barPos : levels;
      const peaks = hasState ? peakPos : levels;
      const renderWidth = (BAR_WIDTH + BAR_GAP) * colCount - BAR_GAP;
      const rowPad = Math.max(0, cols - renderWidth);
      const minGap = Math.max(EPS, 0.5 / Math.max(1, rows * 4));

      const out: string[] = [];
      const tiers: number[][] = [];
      for (let r = 0; r < rows; r++) {
        const rowBottom = (rows - 1 - r) / rows;
        const rowTop = (rows - r) / rows;
        const tier = specTag(rowBottom);
        let line = " ".repeat(rowPad);
        const tierRow: number[] = new Array<number>(rowPad).fill(-1);
        for (let c = 0; c < colCount; c++) {
          const cap = capGlyph(peaks[c], rows);
          const detached = peaks[c] > body[c] + minGap;
          let cell = fracBlock(body[c], rowBottom, rowTop);
          if (detached && r === cap.row) cell = cap.glyph;
          line += cell.repeat(BAR_WIDTH);
          tierRow.push(cell === " " ? -1 : tier);
          if (c < colCount - 1) {
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
