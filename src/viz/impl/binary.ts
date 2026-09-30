/**
 * Binary — streaming columns of 0s and 1s (port of /tmp/cliamp/ui/vis_binary.go).
 *
 * Every band column is a stream of bit particles falling at a speed
 * proportional to the column's band energy (higher energy = faster data flow).
 * New bits spawn at the top with P(1) driven by energy; higher-energy bands
 * emit more 1s and glow brighter.
 */
import type { Visualizer, VizData, VizFrame } from "../types";

const BANDS = 10;

export function makeBinary(): Visualizer {
  let colBand: number[] = [];
  let topY = new Float32Array(0);
  let vals: number[][] = [];
  let H = 0;
  let seed = 0x1d4c9e;
  let initedW = -1;
  let initedH = -1;

  const rng = (): number => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  function spawnBit(c: number, energy: number): void {
    const oneProb = energy * 0.6 + 0.15;
    vals[c].unshift(rng() < oneProb ? 1 : 0);
    if (vals[c].length > H + 3) vals[c].pop();
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
    topY = new Float32Array(cols);
    vals = new Array<number[]>(cols);
    for (let i = 0; i < cols; i++) {
      topY[i] = -1 - rng();
      vals[i] = new Array<number>(H + 3);
      for (let j = 0; j < H + 3; j++) {
        vals[i][j] = rng() < 0.3 ? 1 : 0;
      }
    }
  }

  function tick(dt: number, data: VizData): void {
    ensureState(data.cols, data.rows);
    for (let c = 0; c < colBand.length; c++) {
      if (colBand[c] < 0) continue;
      const energy = data.bands[colBand[c]];
      // Scroll speed: higher energy = faster data flow (20 FPS reference).
      const speed = 20 / Math.max(1, 4 - Math.floor(energy * 3));
      topY[c] += dt * speed;
      while (topY[c] > 0) {
        topY[c] -= 1;
        spawnBit(c, energy);
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
      let line = "";
      const tierRow: number[] = [];
      for (let c = 0; c < cols; c++) {
        let ch = " ";
        let tier = -1;
        const b = colBand[c];
        if (b >= 0) {
          const idx = Math.floor(r - topY[c] + 0.5);
          if (idx >= 0 && idx < vals[c].length) {
            const v = vals[c][idx];
            const energy = data.bands[b];
            ch = v === 1 ? "1" : "0";
            // 1s on high-energy bands glow bright; 0s stay dim.
            if (v === 1 && energy > 0.4) tier = 2;
            else if (v === 1 || energy > 0.3) tier = 1;
            else tier = 0;
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
    name: "Binary",
    init(cols, rows) {
      initedW = -1;
      initedH = -1;
      ensureState(cols, rows);
    },
    tick,
    render,
  };
}
