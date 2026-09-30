/**
 * Matrix — falling "digital rain" character streams
 * (port of /tmp/cliamp/ui/vis_matrix.go).
 *
 * Half-width katakana and digits fall down band columns with a bright head
 * (tier 2), a mid trail (tier 1) and a dim tail (tier 0). Column activation
 * is re-rolled every ~1 s; band energy controls how many columns are active.
 * Trail characters mutate ~every 0.2 s.
 */
import type { Visualizer, VizData, VizFrame } from "../types";

const BANDS = 10;
const MATRIX_CHARS =
  "ｦｧｨｩｪｫｬｭｮｯｰｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄ0123456789";

export function makeMatrix(): Visualizer {
  let colBand: number[] = [];
  let headY = new Float32Array(0);
  let speed = new Float32Array(0);
  let trailLen = new Uint8Array(0);
  let active = new Uint8Array(0);
  let nextGate = new Float32Array(0);
  let mutateT = new Float32Array(0);
  let chars: string[][] = [];
  let tAcc = 0;
  let seed = 0x8e7c41;
  let initedW = -1;
  let initedH = -1;

  const rng = (): number => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  function rollChars(c: number): void {
    const n = trailLen[c] + 1;
    chars[c] = new Array<string>(n);
    for (let d = 0; d < n; d++) {
      chars[c][d] = MATRIX_CHARS[Math.floor(rng() * MATRIX_CHARS.length)];
    }
  }

  function rollDrop(c: number): void {
    // Fixed speed per column: 2-4 frames per row at 20 FPS -> 20/speed rows/s.
    speed[c] = 20 / (2 + Math.floor(rng() * 3));
    // Trail length: 3-5 characters.
    trailLen[c] = 3 + Math.floor(rng() * 3);
    headY[c] = -trailLen[c] - 1 - rng() * 4;
    rollChars(c);
  }


  function ensureState(cols: number, rows: number): void {
    if (initedW === cols && initedH === rows) return;
    initedW = cols;
    initedH = rows;
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
    headY = new Float32Array(cols);
    speed = new Float32Array(cols);
    trailLen = new Uint8Array(cols);
    active = new Uint8Array(cols);
    nextGate = new Float32Array(cols);
    mutateT = new Float32Array(cols);
    chars = new Array<string[]>(cols);
    tAcc = 0;
    for (let i = 0; i < cols; i++) {
      nextGate[i] = rng() * 1.0;
      rollDrop(i);
      active[i] = rng() < 0.1 ? 1 : 0;
    }
  }

  function tick(dt: number, data: VizData): void {
    ensureState(data.cols, data.rows);
    tAcc += dt;
    const rows = data.rows;
    for (let c = 0; c < colBand.length; c++) {
      if (colBand[c] < 0) continue;
      if (tAcc >= nextGate[c]) {
        const energy = data.bands[colBand[c]];
        const on = rng() < Math.min(1, energy * 1.5 + 0.1) ? 1 : 0;
        if (on === 1 && active[c] === 0) rollDrop(c);
        active[c] = on;
        nextGate[c] = tAcc + 0.8 + rng() * 0.4;
      }
      if (active[c] === 1) {
        mutateT[c] += dt;
        while (mutateT[c] >= 0.2) {
          mutateT[c] -= 0.2;
          for (let d = 0; d <= trailLen[c]; d++) {
            chars[c][d] = MATRIX_CHARS[Math.floor(rng() * MATRIX_CHARS.length)];
          }
        }
        headY[c] += dt * speed[c];
        if (headY[c] > rows + 1) rollDrop(c);
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
        if (colBand[c] >= 0 && active[c] === 1) {
          const dist = headY[c] - r;
          if (dist >= 0 && dist <= trailLen[c]) {
            const d = Math.min(trailLen[c], Math.floor(dist));
            ch = chars[c][d];
            tier = d === 0 ? 2 : d <= 2 ? 1 : 0;
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
    name: "Matrix",
    init(cols, rows) {
      initedW = -1;
      initedH = -1;
      ensureState(cols, rows);
    },
    tick,
    render,
  };
}