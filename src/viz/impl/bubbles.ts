/**
 * Bubbles — rising hollow-ring bubbles on a Braille dot grid
 * (port of /tmp/cliamp/ui/vis_bubbles.go).
 *
 * Each bubble is a hollow ring with a small specular highlight in the
 * upper-left quadrant. Bubbles spawn at the bottom, rise (bigger bubbles
 * rise slower), sway laterally — amplitude scaled by band energy — and thin
 * stochastically as they approach the top so they appear to pop. A fixed
 * count of 18 bubbles means none pop in or out of existence mid-air. Rows
 * are spectrum-tiered: warm at the top (light through the surface), cool at
 * the bottom (depth).
 */
import type { Visualizer, VizData, VizFrame } from "../types";

const NUM_BUBBLES = 18;

const BRAILLE_BITS = [
  [0x01, 0x08],
  [0x02, 0x10],
  [0x04, 0x20],
  [0x40, 0x80],
] as const;

// Deterministic per-dot hash in [0, 1) — stable pop patterns without a
// per-frame RNG draw (port of scatterHash).
function scatterHash(band: number, row: number, col: number, frame: number): number {
  const f = Math.floor((frame + row * 3 + col) / 3);
  let h = (band * 7919 + row * 6271 + col * 3037 + f * 104729) >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x45d9f3b3) >>> 0;
  h ^= h >>> 16;
  return (h % 10000) / 10000;
}

export function makeBubbles(): Visualizer {
  let W = 0;
  let H = 0;
  let dotCols = 0;
  let dotRows = 0;
  let grid = new Uint8Array(0);
  let bubbles: { x: number; y: number; radius: number; speedDiv: number; phase: number }[] = [];
  let tAcc = 0;
  let seed = 0x24a9d6;
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

  function rollBubble(b: { x: number; y: number; radius: number; speedDiv: number; phase: number }, atBottom: boolean): void {
    // Stable per-bubble radius (1.5 to 4.0 dots).
    b.radius = 1.5 + rng() * 2.5;
    // Bigger bubbles rise slower (buoyancy feels floaty): one dot every
    // speedDiv frames at 20 FPS.
    b.speedDiv = 3 + Math.floor(b.radius);
    b.x = Math.floor(rng() * dotCols);
    b.phase = rng() * Math.PI * 2;
    if (atBottom) {
      b.y = dotRows + b.radius + 2 + rng() * 8;
    } else {
      b.y = -6 + rng() * (dotRows + 20);
    }
  }

  function setDot(x: number, y: number): void {
    if (x >= 0 && x < dotCols && y >= 0 && y < dotRows) {
      grid[y * dotCols + x] = 1;
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
    bubbles = new Array(NUM_BUBBLES);
    for (let i = 0; i < NUM_BUBBLES; i++) {
      const b = { x: 0, y: 0, radius: 0, speedDiv: 0, phase: 0 };
      rollBubble(b, false);
      bubbles[i] = b;
    }
    tAcc = 0;
  }

  function tick(dt: number, data: VizData): void {
    ensureState(data.cols, data.rows);
    tAcc += dt;
    for (const b of bubbles) {
      b.y -= dt * (20 / b.speedDiv);
      // Popped at the surface — respawn at the bottom.
      if (b.y < -b.radius - 4) rollBubble(b, true);
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

  function render(data: VizData): VizFrame {
    ensureState(data.cols, data.rows);
    grid.fill(0);
    let total = 0;
    for (let i = 0; i < data.bands.length; i++) total += data.bands[i];
    const avgEnergy = total / data.bands.length;
    for (let i = 0; i < bubbles.length; i++) {
      const b = bubbles[i];
      // Horizontal sway — amplitude scales with overall energy.
      const swayAmp = 1.5 + avgEnergy * 2.5;
      const sway = Math.sin(tAcc * 0.6 + b.phase) * swayAmp;
      const x = Math.round(b.x + sway);
      const y = Math.round(b.y);
      // Pop fade — the last few rows thin the ring stochastically.
      const popZone = Math.floor(b.radius) + 3;
      const popFade = y < popZone ? Math.max(0, y / popZone) : 1;
      // Draw hollow ring.
      const rInner = b.radius - 0.9;
      const bbox = Math.floor(b.radius) + 1;
      for (let dy = -bbox; dy <= bbox; dy++) {
        for (let dx = -bbox; dx <= bbox; dx++) {
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist > b.radius || dist < rInner) continue;
          // Stable per-bubble pop pattern so the ring doesn't strobe.
          if (popFade < 1 && scatterHash(i, dy, dx, 0) > popFade) continue;
          setDot(x + dx, y + dy);
        }
      }
      // Specular highlight — small cluster in the upper-left quadrant.
      if (b.radius >= 2.0 && popFade > 0.5) {
        const hx = x - Math.round(b.radius * 0.45);
        const hy = y - Math.round(b.radius * 0.45);
        setDot(hx, hy);
        setDot(hx + 1, hy);
        setDot(hx, hy + 1);
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
    name: "Bubbles",
    init(cols, rows) {
      initedW = -1;
      initedH = -1;
      ensureState(cols, rows);
    },
    tick,
    render,
  };
}
