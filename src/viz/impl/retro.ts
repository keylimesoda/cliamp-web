/**
 * Retro — 80s synthwave scene (port of /tmp/cliamp/ui/vis_retro.go).
 *
 * A striped setting sun above the horizon, an audio-reactive wave at the
 * horizon, and a perspective grid floor that scrolls toward the viewer.
 * Rendered at 4x2 dot-per-cell resolution through Braille characters.
 *
 * Stateful: the grid scroll offset advances in tick. The original ticks at
 * 20 FPS while playing and 5 FPS when idle (ui/tick.go); the frame counter
 * is advanced proportionally to dt so motion speed matches.
 *
 * Tier mapping (original style runs): wave = high (red), sun = mid (yellow),
 * grid = low (green).
 */
import type { Visualizer, VizData, VizFrame } from "../types";

const BRAILLE_BITS = [0x01, 0x08, 0x02, 0x10, 0x04, 0x20, 0x40, 0x80] as const; // [dr*2+dc]

function braille(code: number): string {
  return String.fromCharCode(0x2800 | code);
}

export function makeRetro(): Visualizer {
  let frame = 0;

  return {
    name: "Retro",
    init() {
      frame = 0;
    },
    tick(dt: number, data: VizData) {
      frame += Math.min(dt, 0.4) * (data.playing ? 20 : 5);
    },
    render(data: VizData): VizFrame {
      const rows = data.rows;
      const cols = data.cols;
      const bands = data.bands;
      const bandCount = bands.length;
      const dotRows = rows * 4;
      const dotCols = cols * 2;

      const out: string[] = [];
      const tiers: number[][] = [];
      if (rows <= 0 || cols <= 0 || dotRows < 4 || dotCols < 2) {
        for (let r = 0; r < rows; r++) {
          out.push(" ".repeat(cols));
          tiers.push(new Array<number>(cols).fill(-1));
        }
        return { rows: out, tiers };
      }

      const grid = new Uint8Array(dotRows * dotCols); // 0 empty, 1 grid, 2 wave, 3 sun

      // Horizon at 40% from top — room for wave and sun above.
      const horizonDot = Math.max(Math.floor((dotRows * 2) / 5), 2);
      const floorRows = dotRows - horizonDot;
      const centerX = (dotCols - 1) / 2;

      // ── SUN ── striped semicircle above the horizon.
      const sunR = horizonDot * 0.85;
      for (let dy = 0; dy < horizonDot; dy++) {
        const rowDist = horizonDot - dy; // dots above horizon
        if (rowDist > sunR) continue;
        const halfW = Math.sqrt(sunR * sunR - rowDist * rowDist);

        // Bottom half of the sun has horizontal stripe gaps.
        if (rowDist < sunR * 0.5) {
          const sw = Math.max(1, Math.floor(sunR * 0.15));
          if (Math.floor(rowDist) / sw % 2 === 1) continue;
        }

        const left = Math.max(0, Math.floor(centerX - halfW));
        const right = Math.min(dotCols - 1, Math.floor(centerX + halfW));
        const off = dy * dotCols;
        for (let dx = left; dx <= right; dx++) grid[off + dx] = 3;
      }

      // ── HORIZON LINE ──
      for (let dx = 0; dx < dotCols; dx++) grid[horizonDot * dotCols + dx] = 1;

      // ── PERSPECTIVE GRID FLOOR ──

      // Vertical lines converging to the vanishing point at (centerX, horizonDot).
      const numVLines = 18;
      for (let i = 0; i <= numVLines; i++) {
        const bottomX = (i * (dotCols - 1)) / numVLines;
        for (let dy = horizonDot + 1; dy < dotRows; dy++) {
          const t = (dy - horizonDot) / Math.max(1, floorRows - 1);
          const screenX = centerX + (bottomX - centerX) * t;
          const ix = Math.round(screenX);
          if (ix >= 0 && ix < dotCols) grid[dy * dotCols + ix] = 1;
        }
      }

      // Horizontal lines scrolling toward the viewer.
      const scroll = ((frame * 0.08) % 1 + 1) % 1;
      const numHLines = 10;
      for (let i = 0; i < numHLines; i++) {
        let z = (i + scroll) / numHLines;
        if (z > 1) z -= 1;
        // Quadratic perspective: dense near horizon, spread near viewer.
        const dy = horizonDot + 1 + Math.floor(z * z * Math.max(1, floorRows - 2));
        if (dy > horizonDot && dy < dotRows) {
          const off = dy * dotCols;
          for (let dx = 0; dx < dotCols; dx++) grid[off + dx] = 1;
        }
      }

      // ── AUDIO WAVE AT HORIZON ──
      const maxWave = horizonDot * 0.85;
      const waveY = new Int32Array(dotCols);
      for (let dx = 0; dx < dotCols; dx++) {
        const bandF = (dx / Math.max(1, dotCols - 1)) * (bandCount - 1);
        const bi = Math.floor(bandF);
        const frac = bandF - bi;

        // Cosine interpolation for a smooth curve between bands.
        const t = (1 - Math.cos(frac * Math.PI)) / 2;
        let level: number;
        if (bi >= bandCount - 1) {
          level = bands[bandCount - 1];
        } else {
          level = bands[bi] * (1 - t) + bands[bi + 1] * t;
        }

        // Small floor so the wave never fully vanishes.
        level = Math.max(0.03, level);
        waveY[dx] = Math.max(0, Math.min(dotRows - 1, horizonDot - Math.floor(level * maxWave)));
      }

      // Draw the wave with continuous line connections.
      for (let dx = 0; dx < dotCols; dx++) {
        const y = waveY[dx];
        grid[y * dotCols + dx] = 2;
        if (dx > 0) {
          const lo = Math.min(y, waveY[dx - 1]);
          const hi = Math.max(y, waveY[dx - 1]);
          for (let fy = lo; fy <= hi; fy++) grid[fy * dotCols + dx] = 2;
        }
      }

      // ── RENDER BRAILLE ──
      for (let row = 0; row < rows; row++) {
        const base = row * 4;
        let line = "";
        const tierRow: number[] = [];
        for (let ch = 0; ch < cols; ch++) {
          const colBase = ch * 2;
          let code = 0;
          let hasWave = false;
          let hasSun = false;
          for (let dr = 0; dr < 4; dr++) {
            const dy = base + dr;
            if (dy >= dotRows) break;
            for (let dc = 0; dc < 2; dc++) {
              const v = grid[dy * dotCols + colBase + dc];
              if (v === 0) continue;
              code |= BRAILLE_BITS[dr * 2 + dc];
              if (v === 2) hasWave = true;
              else if (v === 3) hasSun = true;
            }
          }
          // Priority: wave (red) > sun (yellow) > grid (green).
          const tier = hasWave ? 2 : hasSun ? 1 : code !== 0 ? 0 : -1;
          line += code !== 0 ? braille(code) : " ";
          tierRow.push(tier);
        }
        out.push(line.slice(0, cols).padEnd(cols, " "));
        tiers.push(tierRow.slice(0, cols));
      }
      return { rows: out, tiers };
    },
  };
}
