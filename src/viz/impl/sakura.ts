/**
 * Sakura — cherry-blossom petals drifting downward on a Braille dot grid
 * (port of /tmp/cliamp/ui/vis_sakura.go).
 *
 * Each petal is a small Braille silhouette with its own fall speed and gentle
 * lateral sway; petals spin through a set of teardrop shapes (large shapes
 * fall slower — close, small ones faster — distant). Band energy controls how
 * many petals are on screen: quiet passages show a sparse drift, loud music
 * fills the air. Rows are spectrum-tiered: bright (red) at top, green at
 * bottom.
 */
import type { Visualizer, VizData, VizFrame } from "../types";

const SHAPES: ReadonlyArray<ReadonlyArray<readonly [number, number]>> = [
  // Large — 6 dots, wide teardrop
  [[0, 1], [1, 0], [1, 1], [1, 2], [2, 0], [2, 1]],
  [[0, 1], [1, 0], [1, 1], [1, 2], [2, 1], [2, 2]],
  [[0, 1], [0, 2], [1, 0], [1, 1], [1, 2], [2, 1]],
  // Medium — 4 dots
  [[0, 1], [1, 0], [1, 1], [2, 0]],
  [[0, 0], [1, 0], [1, 1], [2, 1]],
  [[0, 0], [0, 1], [1, 1], [2, 1]],
  // Small — 2-3 dots, distant
  [[0, 0], [1, 1]],
  [[0, 1], [1, 0]],
  [[0, 0], [0, 1], [1, 0]],
];

const BRAILLE_BITS = [
  [0x01, 0x08],
  [0x02, 0x10],
  [0x04, 0x20],
  [0x40, 0x80],
] as const;

export function makeSakura(): Visualizer {
  let W = 0;
  let H = 0;
  let dotCols = 0;
  let dotRows = 0;
  let grid = new Uint8Array(0);
  let petals: { x: number; y: number; shape: number; fall: number; phase: number }[] = [];
  let tAcc = 0;
  let seed = 0x3c9b7a;
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

  function spawnPetal(spread: boolean): void {
    const shape = Math.floor(rng() * SHAPES.length);
    // Large shapes fall slower (close), small ones faster (distant).
    petals.push({
      x: Math.floor(rng() * dotCols),
      // Initial fill spreads across the whole panel (like the original's
      // wrapH-based baseY); later spawns drift in from above the top edge.
      y: spread ? -5 + rng() * (dotRows + 10) : -5 - rng() * 10,
      shape,
      fall: shape >= 6 ? 2 : 1,
      phase: rng() * Math.PI * 2,
    });
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
    petals = [];
    for (let i = 0; i < 12; i++) spawnPetal(true);
    tAcc = 0;
  }

  function tick(dt: number, data: VizData): void {
    ensureState(data.cols, data.rows);
    tAcc += dt;
    let total = 0;
    for (let i = 0; i < data.bands.length; i++) total += data.bands[i];
    const avgEnergy = total / data.bands.length;
    // 12 petals at silence, up to 28 when loud.
    const target = 12 + Math.floor(avgEnergy * 16);
    let spawned = 0;
    while (petals.length < target && spawned < 2) {
      spawnPetal(petals.length < 12);
      spawned++;
    }
    for (let i = petals.length - 1; i >= 0; i--) {
      const p = petals[i];
      p.y += dt * p.fall * 2.5;
      if (p.y > dotRows + 5) petals.splice(i, 1);
    }
  }

  function render(data: VizData): VizFrame {
    ensureState(data.cols, data.rows);
    grid.fill(0);
    for (const p of petals) {
      // Gentle lateral sway — each petal has its own phase.
      const sway = Math.sin(tAcc * 0.3 + p.phase) * 3;
      const gy = Math.round(p.y);
      const gx = Math.round(p.x + sway);
      const shape = SHAPES[p.shape];
      for (const [dr, dc] of shape) {
        const r = gy + dr;
        const c = gx + dc;
        if (r >= 0 && r < dotRows && c >= 0 && c < dotCols) {
          grid[r * dotCols + c] = 1;
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
    name: "Sakura",
    init(cols, rows) {
      initedW = -1;
      initedH = -1;
      ensureState(cols, rows);
    },
    tick,
    render,
  };
}
