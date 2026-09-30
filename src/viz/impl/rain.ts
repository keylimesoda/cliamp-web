/**
 * Rain — bar-shaped columns filled with falling rain streaks
 * (port of /tmp/cliamp/ui/vis_rain.go).
 *
 * Each band column hosts a cycling drop (head ┃, body │, tail :) falling at a
 * per-column speed; drops are only visible inside the bar, i.e. on rows below
 * the band level. Column activation is re-rolled every ~0.6 s with a
 * probability driven by the band level, so higher energy makes rainfall
 * taller and denser.
 */
import type { Visualizer, VizData, VizFrame } from "../types";

const BANDS = 10;

export function makeRain(): Visualizer {
  let H = 0;
  let colBand: number[] = [];
  let pos = new Float32Array(0);
  let speed = new Float32Array(0);
  let dropLen = new Float32Array(0);
  let active = new Uint8Array(0);
  let nextGate = new Float32Array(0);
  let tAcc = 0;
  let seed = 0x51f3a2;
  let initedW = -1;
  let initedH = -1;

  const rng = (): number => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  function rollDrop(c: number): void {
    // Per-column fall speed: 1-3 frames per row at 20 FPS -> 20/speed rows/s.
    speed[c] = 20 / (1 + Math.floor(rng() * 3));
    // Drop length: 2-4 characters.
    dropLen[c] = 2 + Math.floor(rng() * 3);
    // Cycle through the visible height with a gap before repeating.
    pos[c] = rng() * (H + dropLen[c] + 3);
  }

  function ensureState(cols: number, rows: number): void {
    if (initedW === cols && initedH === rows) return;
    initedW = cols;
    initedH = rows;
    H = rows;
    colBand = new Array<number>(cols).fill(-1);
    const gapCount = Math.min(BANDS - 1, Math.max(0, cols - BANDS));
    const base = Math.max(1, Math.floor((cols - gapCount) / BANDS));
    const extra = (cols - gapCount) % BANDS;
    let c = 0;
    for (let b = 0; b < BANDS; b++) {
      const w = base + (b < extra ? 1 : 0);
      for (let k = 0; k < w && c < cols; k++) colBand[c++] = b;
      if (b < BANDS - 1 && c < cols) c++;
    }
    pos = new Float32Array(cols);
    speed = new Float32Array(cols);
    dropLen = new Float32Array(cols);
    active = new Uint8Array(cols);
    nextGate = new Float32Array(cols);
    tAcc = 0;
    for (let i = 0; i < cols; i++) {
      nextGate[i] = rng() * 0.6;
      rollDrop(i);
      active[i] = rng() < 0.1 ? 1 : 0;
    }
  }

  function tick(dt: number, data: VizData): void {
    ensureState(data.cols, data.rows);
    tAcc += dt;
    for (let c = 0; c < colBand.length; c++) {
      if (colBand[c] < 0) continue;
      if (tAcc >= nextGate[c]) {
        const level = data.bands[colBand[c]];
        const on = rng() < Math.min(1, level * 1.6 + 0.1) ? 1 : 0;
        if (on !== active[c]) rollDrop(c);
        active[c] = on;
        nextGate[c] = tAcc + 0.5 + rng() * 0.4;
      }
      if (active[c] === 1) {
        pos[c] += dt * speed[c];
        const cycle = H + dropLen[c] + 3;
        if (pos[c] >= cycle) pos[c] -= cycle;
      }
    }
  }

  function render(data: VizData): VizFrame {
    ensureState(data.cols, data.rows);
    const rows = data.rows;
    const cols = data.cols;
    const out: string[] = [];
    const tiers: number[][] = [];
    for (let r = 0; r < rows; r++) {
      const rowNorm = (rows - 1 - r) / rows;
      let line = "";
      const tierRow: number[] = [];
      for (let c = 0; c < cols; c++) {
        let ch = " ";
        let tier = -1;
        const b = colBand[c];
        if (b >= 0 && active[c] === 1 && rowNorm < data.bands[b]) {
          const d = pos[c] - r;
          if (d >= 0 && d < dropLen[c]) {
            if (d < 0.5) {
              ch = "┃";
              tier = 2;
            } else if (d < 1.5) {
              ch = "│";
              tier = 1;
            } else {
              ch = ":";
              tier = 0;
            }
          }
        }
        line += ch;
        tierRow.push(tier);
      }
      out.push(line);
      tiers.push(tierRow);
    }
    return { rows: out, tiers };
  }

  return {
    name: "Rain",
    init(cols, rows) {
      initedW = -1;
      initedH = -1;
      ensureState(cols, rows);
    },
    tick,
    render,
  };
}
