/**
 * Geyser — a bass-driven particle fountain (port of
 * /tmp/cliamp/ui/vis_geyser.go).
 *
 * A fountain rooted at the bottom centre of the panel: sustained loudness
 * keeps a steady column of mist, bass transients launch thick vertical jets,
 * and every particle arcs back down under gravity with a touch of lateral
 * spray. Particles inherit a tier from the band that produced them, so dense
 * bass passages paint the column red and treble embellishments add green
 * sparkles to the canopy.
 */
import type { Visualizer, VizData, VizFrame } from "../types";

const BIT = [1, 8, 2, 16, 4, 32, 64, 128];

interface Drop {
  x: number;
  y: number;
  vx: number;
  vy: number;
  tier: number;
  life: number;
}

function bandAvg(bands: Float32Array, lo: number, hi: number): number {
  const s = Math.max(0, lo);
  const e = Math.min(bands.length, hi);
  if (e <= s) return 0;
  let sum = 0;
  for (let i = s; i < e; i++) sum += bands[i];
  return sum / (e - s);
}

export function makeGeyser(): Visualizer {
  let dotRows = 0;
  let dotCols = 0;
  let rng = 0xFEED5EED; // the Go seed
  let dots = new Int8Array(0);
  let drops: Drop[] = [];
  let prevBass = 0;

  const rand = () => {
    rng = (Math.imul(rng, 0x6d2b79f5) + 0x168ed33d) | 0;
    return (rng >>> 10) / 0x100000;
  };

  const ensure = (rows: number, cols: number) => {
    const w = cols * 2;
    const h = rows * 4;
    if (dotRows !== h || dotCols !== w || dots.length !== dotRows * dotCols) {
      dotRows = h;
      dotCols = w;
      dots = new Int8Array(dotRows * dotCols);
    }
  };

  const spawn = (x: number, y: number, spread: number, vy: number, bass: number, mid: number) => {
    const jx = x + Math.floor(rand() * (2 * spread + 1)) - spread;
    const vyJ = vy * (0.6 + rand() * 0.5);
    const vxJ = (rand() - 0.5) * (1 + vy * 0.4);
    // Tier from the band mix: bass → red, mid → yellow, else green.
    const r = rand();
    let tier = 1;
    if (r < bass) tier = 3;
    else if (r < bass + mid) tier = 2;
    drops.push({ x: jx, y, vx: vxJ, vy: -vyJ, tier, life: 0 });
  };

  return {
    name: "Geyser",
    init(cols: number, rows: number) {
      drops = [];
      prevBass = 0;
      ensure(rows, cols);
    },
    tick(_dt: number, data: VizData) {
      const { rows, cols, bands } = data;
      ensure(rows, cols);
      dots.fill(0);
      const bandCount = bands.length;
      if (bandCount === 0) return;

      const bass = bandAvg(bands, 0, Math.max(1, Math.floor(bandCount / 3)));
      const mid = bandAvg(bands, Math.floor(bandCount / 3), Math.floor((2 * bandCount) / 3));
      const high = bandAvg(bands, Math.floor((2 * bandCount) / 3), bandCount);
      const delta = bass - prevBass;
      prevBass = bass;

      const jetX = Math.floor(dotCols / 2);
      const jetSpread = Math.max(2, Math.floor(dotCols / 16));

      // Steady drizzle: spawn rate scales with overall loudness so quiet
      // passages idle a thin trickle and loud ones keep a column going.
      const steady = bass * 0.85 + mid * 0.25 + high * 0.08;
      for (let i = 0; i < Math.floor(steady * 6); i++) {
        spawn(jetX, dotRows - 1, jetSpread, 1.5 + steady * 4.5, bass, mid);
      }

      // Transient kick: shoot a thick burst. Triggers on small deltas so even
      // gentler kick drums register.
      if (delta > 0.06 && bass > 0.15) {
        const burst = 40 + Math.floor(delta * 180);
        for (let i = 0; i < burst; i++) {
          spawn(jetX, dotRows - 1, jetSpread * 2, 4.5 + delta * 10 + bass * 4, bass, mid);
        }
      }

      // Advance particles: gravity pulls them down, drag damps lateral
      // motion; cull anything off-panel or past its lifetime.
      const live: Drop[] = [];
      for (const p of drops) {
        p.vy += 0.3;
        p.vx *= 0.992;
        p.x += p.vx;
        p.y += p.vy;
        p.life++;
        const ix = Math.trunc(p.x);
        let iy = Math.trunc(p.y);
        if (iy >= dotRows || ix < 0 || ix >= dotCols || p.life > 200) continue;
        if (iy < 0) iy = 0;
        const idx = iy * dotCols + ix;
        if (p.tier > dots[idx]) dots[idx] = p.tier;
        live.push(p);
      }
      drops = live;
    },
    render(data: VizData): VizFrame {
      const { rows, cols } = data;
      ensure(rows, cols);
      const out: string[] = [];
      const tiers: number[][] = [];
      for (let row = 0; row < rows; row++) {
        let line = "";
        const tierRow: number[] = [];
        for (let col = 0; col < cols; col++) {
          let br = 0;
          let cellTag = -1;
          for (let dr = 0; dr < 4; dr++) {
            for (let dc = 0; dc < 2; dc++) {
              const t = dots[(row * 4 + dr) * dotCols + col * 2 + dc];
              if (t === 0) continue;
              br |= BIT[dr * 2 + dc];
              if (t - 1 > cellTag) cellTag = t - 1;
            }
          }
          if (br === 0) {
            line += " ";
            tierRow.push(-1);
          } else {
            line += String.fromCharCode(0x2800 + br);
            tierRow.push(cellTag < 0 ? 0 : cellTag);
          }
        }
        out.push(line.slice(0, cols).padEnd(cols, " "));
        tiers.push(tierRow.slice(0, cols));
      }
      return { rows: out, tiers };
    },
  };
}
