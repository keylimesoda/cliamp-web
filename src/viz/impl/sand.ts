/**
 * Sand — a falling-sand cellular automaton (port of
 * /tmp/cliamp/ui/vis_sand.go).
 *
 * Each frame, new grains drop from the top — colored by which spectrum band
 * triggered them (bass red, mid yellow, treble green) — and existing grains
 * fall straight down or, if blocked, slide diagonally onto piles. Bass
 * kicks throw the whole bed upward, sustained bass churns it, and when the
 * bed accumulates past ~30% capacity the next kick blows everything sky-high
 * in a ballistic explosion before starting over.
 */
import type { Visualizer, VizData, VizFrame } from "../types";

const BIT = [1, 8, 2, 16, 4, 32, 64, 128];

interface Grain {
  x: number;
  y: number;
  vx: number;
  vy: number;
  tier: number;
}

function bandAvg(bands: Float32Array, lo: number, hi: number): number {
  const s = Math.max(0, lo);
  const e = Math.min(bands.length, hi);
  if (e <= s) return 0;
  let sum = 0;
  for (let i = s; i < e; i++) sum += bands[i];
  return sum / (e - s);
}

export function makeSand(): Visualizer {
  let dotRows = 0;
  let dotCols = 0;
  // 0 = empty; 1 = green tier; 2 = yellow; 3 = red.
  let grid = new Int8Array(0);
  let frame = 0;
  let prevBass = 0;
  let rng = 0x5a4d5a4d; // low 32 bits of the Go seed
  let particles: Grain[] = [];
  let explosionTTL = 0;

  const rand = () => {
    rng = (Math.imul(rng, 0x6d2b79f5) + 0x168ed33d) | 0;
    return (rng >>> 10) / 0x100000;
  };

  const ensure = (rows: number, cols: number) => {
    const w = cols * 2;
    const h = rows * 4;
    if (dotRows !== h || dotCols !== w || grid.length !== dotRows * dotCols) {
      dotRows = h;
      dotCols = w;
      grid = new Int8Array(dotRows * dotCols);
    }
  };

  // Convert every grain into a ballistic particle and enter the
  // multi-frame explosion phase. Bottom grains carry more upward energy
  // (they're closer to the speaker cone), so the burst peaks from below.
  const startExplosion = () => {
    particles = [];
    for (let y = 0; y < dotRows; y++) {
      const depthFrac = y / Math.max(1, dotRows - 1); // 0=top, 1=bottom
      for (let x = 0; x < dotCols; x++) {
        const g = grid[y * dotCols + x];
        if (g === 0) continue;
        grid[y * dotCols + x] = 0;
        particles.push({
          x,
          y,
          vx: (rand() - 0.5) * 8,
          vy: -(2 + rand() * 5 + depthFrac * 2),
          tier: g,
        });
      }
    }
    // Generous TTL — particles mostly fall off earlier; the natural end is
    // when the list empties. The TTL is a safety cap.
    explosionTTL = 80;
  };

  // Advance all in-flight particles one frame: gravity pulls them down,
  // drag slows lateral motion, and anything leaving the panel is removed.
  // The grid is fully rebuilt from the survivors.
  const tickExplosion = () => {
    grid.fill(0);
    const live: Grain[] = [];
    for (const p of particles) {
      p.vy += 0.5;
      p.vx *= 0.985;
      p.x += p.vx;
      p.y += p.vy;
      const ix = Math.trunc(p.x);
      const iy = Math.trunc(p.y);
      if (iy < 0 || iy >= dotRows || ix < 0 || ix >= dotCols) continue;
      grid[iy * dotCols + ix] = p.tier;
      live.push(p);
    }
    particles = live;
    if (explosionTTL > 0) explosionTTL--;
    if (particles.length === 0) explosionTTL = 0;
  };

  return {
    name: "Sand",
    init(cols: number, rows: number) {
      frame = 0;
      prevBass = 0;
      particles = [];
      explosionTTL = 0;
      ensure(rows, cols);
    },
    tick(_dt: number, data: VizData) {
      const { rows, cols, bands } = data;
      ensure(rows, cols);
      const bandCount = bands.length;
      const bass = bandAvg(bands, 0, Math.max(1, Math.floor(bandCount / 3)));

      // Explosion phase: suspend the normal simulation and animate the
      // burst. The grid is re-derived from particle positions.
      if (explosionTTL > 0 || particles.length > 0) {
        tickExplosion();
        prevBass = bass;
        frame++;
        return;
      }

      // Spawn grains: each band emits at a column proportional to its index,
      // with a small spread so neighbours don't stack into one tower.
      if (bandCount > 0) {
        for (let b = 0; b < bandCount; b++) {
          const level = bands[b];
          if (level < 0.1) continue;
          // Probability of emitting this frame scales with band level.
          if (rand() > level * 0.85) continue;
          const centre = Math.floor(((b * 2 + 1) * dotCols) / (2 * bandCount));
          let spread = Math.floor(dotCols / (bandCount * 2));
          if (spread < 1) spread = 1;
          let x = centre + Math.floor(rand() * (2 * spread)) - spread;
          if (x < 0) x = 0;
          else if (x >= dotCols) x = dotCols - 1;
          // Tier mapping: low bands → red (hot bass), mid → yellow,
          // high → green.
          let tier = 1;
          if (b < Math.floor(bandCount / 3)) tier = 3;
          else if (b < Math.floor((2 * bandCount) / 3)) tier = 2;
          if (grid[x] === 0) grid[x] = tier;
        }
      }

      const delta = bass - prevBass;
      prevBass = bass;

      // 0. Explosion check: fires before the bump branches so the grid is
      // cleared *instead* of being merely shaken when overfilled.
      if (delta > 0.06 && bass > 0.15) {
        let fill = 0;
        for (let i = 0; i < grid.length; i++) {
          if (grid[i] !== 0) fill++;
        }
        if (fill / grid.length > 0.3) {
          startExplosion();
          frame++;
          return;
        }
      }

      // 1. Transient bump: the speaker-cone slap — violent vertical lift
      // across the whole bed on the rising edge of bass. Process top-down so
      // a lifted grain isn't visited again this frame.
      if (delta > 0.06 && bass > 0.15) {
        let strength = delta * 3.5 + bass * 0.8;
        if (strength > 1.4) strength = 1.4;
        for (let y = 0; y < dotRows; y++) {
          const depthFrac = y / Math.max(1, dotRows - 1); // 0 at top
          let liftProb = strength * (0.3 + 0.7 * depthFrac);
          if (liftProb > 0.95) liftProb = 0.95;
          const liftMax = 2 + Math.floor(strength * 7 * (0.4 + 0.6 * depthFrac));
          const jitterRange = 1 + Math.floor(strength * 5);
          for (let x = 0; x < dotCols; x++) {
            const g = grid[y * dotCols + x];
            if (g === 0 || rand() > liftProb) continue;
            const lift = 1 + Math.floor(rand() * liftMax);
            const jitter = Math.floor(rand() * (2 * jitterRange + 1)) - jitterRange;
            let ny = y - lift;
            if (ny < 0) ny = 0;
            let nx = x + jitter;
            if (nx < 0) nx = 0;
            else if (nx >= dotCols) nx = dotCols - 1;
            if (grid[ny * dotCols + nx] === 0) {
              grid[ny * dotCols + nx] = g;
              grid[y * dotCols + x] = 0;
            }
          }
        }
      }

      // 2. Sustained rumble: every frame jitters grains a little while bass
      // stays high, so the bed keeps dancing instead of settling still.
      if (bass > 0.3) {
        let rumble = (bass - 0.3) * 1.8;
        if (rumble > 0.6) rumble = 0.6;
        // Only churn the bottom half — that's what's coupled to the speaker.
        const minY = Math.floor(dotRows / 2);
        for (let y = minY; y < dotRows; y++) {
          const depthFrac = (y - minY) / Math.max(1, dotRows - 1 - minY);
          const prob = rumble * (0.15 + 0.55 * depthFrac);
          for (let x = 0; x < dotCols; x++) {
            const g = grid[y * dotCols + x];
            if (g === 0 || rand() > prob) continue;
            const lift = 1 + Math.floor(rand() * 2);
            const jitter = Math.floor(rand() * 5) - 2;
            let ny = y - lift;
            if (ny < 0) ny = 0;
            let nx = x + jitter;
            if (nx < 0) nx = 0;
            else if (nx >= dotCols) nx = dotCols - 1;
            if (grid[ny * dotCols + nx] === 0) {
              grid[ny * dotCols + nx] = g;
              grid[y * dotCols + x] = 0;
            }
          }
        }
      }

      // Falling pass: bottom-up so a grain we just moved into y+1 isn't
      // moved twice this frame. Alternate the horizontal scan direction each
      // frame so piles don't lean permanently to one side.
      for (let y = dotRows - 2; y >= 0; y--) {
        const leftFirst = frame % 2 === 0;
        const startX = leftFirst ? 0 : dotCols - 1;
        const endX = leftFirst ? dotCols : -1;
        const stepX = leftFirst ? 1 : -1;
        for (let x = startX; x !== endX; x += stepX) {
          const g = grid[y * dotCols + x];
          if (g === 0) continue;
          // Try straight down.
          if (grid[(y + 1) * dotCols + x] === 0) {
            grid[(y + 1) * dotCols + x] = g;
            grid[y * dotCols + x] = 0;
            continue;
          }
          // Diagonal: pick the first direction by coin flip for symmetry.
          const first = rand() < 0.5 ? 1 : -1;
          for (let k = 0; k < 2; k++) {
            const nx = x + (k === 0 ? first : -first);
            if (nx < 0 || nx >= dotCols) continue;
            if (grid[(y + 1) * dotCols + nx] === 0) {
              grid[(y + 1) * dotCols + nx] = g;
              grid[y * dotCols + x] = 0;
              break;
            }
          }
        }
      }

      // Floor: grains in the very bottom row drift off-screen at a slow rate
      // so the grid doesn't pack up over a long session.
      for (let x = 0; x < dotCols; x++) {
        if (grid[(dotRows - 1) * dotCols + x] !== 0 && rand() < 0.04) {
          grid[(dotRows - 1) * dotCols + x] = 0;
        }
      }
      frame++;
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
              const g = grid[(row * 4 + dr) * dotCols + col * 2 + dc];
              if (g === 0) continue;
              const t = g - 1; // 1=green(0), 2=yellow(1), 3=red(2)
              br |= BIT[dr * 2 + dc];
              if (t > cellTag) cellTag = t;
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
