/**
 * Firework — exploding firework bursts on a Braille dot grid
 * (port of /tmp/cliamp/ui/vis_firework.go).
 *
 * Each burst launches from the bottom with a rising trail, then explodes
 * into a sphere of particles that drift downward under gravity and fade.
 * Band energy drives the number of simultaneous bursts (5 quiet, up to 14
 * loud) and the size of each explosion. Rows are spectrum-tiered: bright
 * (red) at the top, green at the bottom — fireworks in a night sky.
 */
import type { Visualizer, VizData, VizFrame } from "../types";

const CYCLE = 2.4; // 48 frames at 20 FPS
const LAUNCH = 0.5; // 10 frames at 20 FPS
const BANDS = 10;

const BRAILLE_BITS = [
  [0x01, 0x08],
  [0x02, 0x10],
  [0x04, 0x20],
  [0x40, 0x80],
] as const;

// Deterministic per-dot hash in [0, 1) — stochastic twinkle without a
// per-frame RNG draw (port of scatterHash).
function scatterHash(band: number, row: number, col: number, frame: number): number {
  const f = Math.floor((frame + row * 3 + col) / 3);
  let h = (band * 7919 + row * 6271 + col * 3037 + f * 104729) >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x45d9f3b3) >>> 0;
  h ^= h >>> 16;
  return (h % 10000) / 10000;
}

export function makeFirework(): Visualizer {
  let W = 0;
  let H = 0;
  let dotCols = 0;
  let dotRows = 0;
  let grid = new Uint8Array(0);
  let bursts: { t: number; cx: number; cy: number; band: number; parts: { a: number; s: number }[] }[] = [];
  let tAcc = 0;
  let seed = 0x77b2e0;
  let initedW = -1;
  let initedH = -1;

  const rng = (): number => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  function specTag(norm: number): number {
    if (norm >= 0.6) return 2;
    if (norm >= 0.3) return 1;
    return 0;
  }

  function rollBurst(b: { t: number; cx: number; cy: number; band: number; parts: { a: number; s: number }[] }, energy: number): void {
    // Burst center — spread across the panel, upper portion.
    b.cx = Math.floor(rng() * dotCols);
    b.cy = Math.floor(rng() * (dotRows / 2)) + dotRows / 8;
    b.band = Math.floor(rng() * BANDS);
    // Particle sphere: uniform angles, jittered radial speeds.
    const n = 18 + Math.floor(energy * 18);
    b.parts = new Array<{ a: number; s: number }>(n);
    for (let i = 0; i < n; i++) {
      b.parts[i] = {
        a: (i / n) * Math.PI * 2 + rng() * 0.5,
        s: 0.6 + rng() * 0.4,
      };
    }
  }

  function ensureState(cols: number, rows: number): void {
    if (initedW === cols && initedH === rows) return;
    initedW = cols;
    initedH = rows;
    W = cols;
    H = rows;
    dotCols = cols * 2;
    dotRows = rows * 4;
    grid = new Uint8Array(dotRows * dotCols);
    bursts = [];
    tAcc = 0;
  }

  function tick(dt: number, data: VizData): void {
    ensureState(data.cols, data.rows);
    tAcc += dt;
    let total = 0;
    for (let i = 0; i < data.bands.length; i++) total += data.bands[i];
    const avgEnergy = total / data.bands.length;
    // Number of simultaneous bursts: 5 quiet, up to 14 loud.
    const target = 5 + Math.floor(avgEnergy * 9);
    while (bursts.length < target) {
      const b = { t: 0, cx: 0, cy: 0, band: 0, parts: [] as { a: number; s: number }[] };
      rollBurst(b, avgEnergy);
      // Stagger starts so bursts don't all fire simultaneously.
      b.t = rng() * CYCLE;
      bursts.push(b);
    }
    while (bursts.length > target) bursts.pop();
    for (const b of bursts) {
      b.t += dt;
      if (b.t >= CYCLE) {
        b.t -= CYCLE;
        rollBurst(b, avgEnergy);
      }
    }
  }

  function brailleChar(row: number, ch: number): string {
    let bits = 0;
    for (let dr = 0; dr < 4; dr++) {
      for (let dc = 0; dc < 2; dc++) {
        if (grid[(row * 4 + dr) * dotCols + ch * 2 + dc] === 1) {
          bits |= BRAILLE_BITS[dr][dc];
        }
      }
    }
    return bits === 0 ? " " : String.fromCharCode(0x2800 + bits);
  }

  function setDot(x: number, y: number): void {
    if (x >= 0 && x < dotCols && y >= 0 && y < dotRows) {
      grid[y * dotCols + x] = 1;
    }
  }

  function render(data: VizData): VizFrame {
    ensureState(data.cols, data.rows);
    grid.fill(0);
    const frame = Math.floor(tAcc * 20);
    for (const b of bursts) {
      const energy = data.bands[b.band];
      if (b.t < LAUNCH) {
        // Rising trail from bottom to burst center.
        const progress = b.t / LAUNCH;
        const trailY = Math.round(dotRows - 1 - (dotRows - 1 - b.cy) * progress);
        for (let dy = 0; dy < 4; dy++) setDot(b.cx, trailY + dy);
      } else {
        // Burst expansion and fade.
        const burstT = (b.t - LAUNCH) / (CYCLE - LAUNCH);
        const maxRadius = 3 + energy * 8;
        // Fast expansion, then slow drift.
        const radius = maxRadius * Math.min(burstT * 3, 1);
        // Gravity pulls particles down over time.
        const gravity = burstT * burstT * 5;
        // Particles fade out over time.
        const fade = Math.max(0, 1 - burstT * 1.3);
        for (let i = 0; i < b.parts.length; i++) {
          const p = b.parts[i];
          // Stochastic twinkle — more particles disappear as time passes.
          if (scatterHash(b.band, i, b.cx, frame) > fade) continue;
          const px = Math.round(b.cx + Math.cos(p.a) * radius * p.s);
          const py = Math.round(b.cy + Math.sin(p.a) * radius * p.s + gravity);
          setDot(px, py);
        }
      }
    }
    const out: string[] = [];
    const tiers: number[][] = [];
    for (let row = 0; row < H; row++) {
      const tier = specTag((H - 1 - row) / H);
      let line = "";
      const tierRow: number[] = [];
      for (let ch = 0; ch < W; ch++) {
        const cell = brailleChar(row, ch);
        line += cell;
        tierRow.push(cell === " " ? -1 : tier);
      }
      out.push(line);
      tiers.push(tierRow);
    }
    return { rows: out, tiers };
  }

  return {
    name: "Firework",
    init(cols, rows) {
      initedW = -1;
      initedH = -1;
      ensureState(cols, rows);
    },
    tick,
    render,
  };
}
