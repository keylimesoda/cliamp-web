/**
 * Pulse — pulsating Braille ellipse (port of /tmp/cliamp/ui/vis_pulse.go).
 *
 * The radius at each angle blends per-band frequency energy (cosine
 * interpolated around the shape) with the overall level, so the whole shape
 * surges on every beat while deforming per frequency. A shockwave ring
 * radiates outward on transients. Per-dot distance/angle values are cached
 * for the current grid size and rebuilt lazily on resize, so the hot render
 * loop skips the sqrt/atan2 work. A green->yellow->red radial gradient
 * (specTag of the filled radius) colors the shape.
 */
import type { Visualizer, VizData, VizFrame } from "../types";

const BRAILLE_BITS = [
  [0x01, 0x08], // row 0
  [0x02, 0x10], // row 1
  [0x04, 0x20], // row 2
  [0x40, 0x80], // row 3
] as const;

const TWO_PI = 2 * Math.PI;

function specTag(norm: number): number {
  if (norm >= 0.6) return 2;
  if (norm >= 0.3) return 1;
  return 0;
}

/**
 * Pseudo-random value in [0, 1) for a dot position and frame, mirroring the
 * Go reference's 64-bit mix in 32 bits (used for the anti-aliased edge).
 */
function scatterHash(band: number, row: number, col: number, frame: number): number {
  const f = Math.floor((frame + (row * 3 + col)) / 3);
  let h = (band * 7919 + row * 6271 + col * 3037 + f * 104729) >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x45d9f3b3) >>> 0;
  h ^= h >>> 16;
  return (h % 10000) / 10000;
}

export function makePulse(): Visualizer {
  // Animation frame counter; Go reference runs at ~60 FPS.
  let frame = 0;

  // Per-dot coordinates, cached for the current grid size.
  let cacheW = 0;
  let cacheH = 0;
  let dist = new Float64Array(0);
  let angle = new Float64Array(0);
  let maxR = 0;

  function ensure(cols: number, rows: number): void {
    if (cacheW === cols && cacheH === rows) return;
    cacheW = cols;
    cacheH = rows;
    const dotRows = rows * 4;
    const dotCols = cols * 2;
    const centerX = dotCols / 2;
    const centerY = dotRows / 2;
    const xScale = centerY / centerX;
    maxR = centerY - 1;

    dist = new Float64Array(cols * rows * 8);
    angle = new Float64Array(cols * rows * 8);
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        for (let dr = 0; dr < 4; dr++) {
          for (let dc = 0; dc < 2; dc++) {
            const dx = (col * 2 + dc - centerX) * xScale;
            const dy = row * 4 + dr - centerY;
            const idx = ((row * cols + col) * 4 + dr) * 2 + dc;
            dist[idx] = Math.sqrt(dx * dx + dy * dy);
            let a = Math.atan2(dy, dx);
            if (a < 0) a += TWO_PI;
            angle[idx] = a;
          }
        }
      }
    }
  }

  return {
    name: "Pulse",
    init(cols: number, rows: number): void {
      frame = 0;
      cacheW = 0;
      cacheH = 0;
      ensure(cols, rows);
    },
    tick(dt: number): void {
      frame += dt * 60;
    },
    render(data: VizData): VizFrame {
      const { rows, cols, bands } = data;
      ensure(cols, rows);
      const bandCount = bands.length;
      const frameInt = Math.floor(frame);

      let totalEnergy = 0;
      for (let i = 0; i < bandCount; i++) {
        totalEnergy += bands[i];
      }
      const avgEnergy = totalEnergy / bandCount;

      // Shockwave: expanding ring that fades as it grows.
      const shockPhase = (frame * 0.1) % 1;
      const shockR = maxR * (0.3 + 0.7 * shockPhase);
      const shockStrength = avgEnergy * avgEnergy * (1 - shockPhase * shockPhase);

      // Gentle breathing keeps the shape alive during silence.
      const breath = Math.sin(frame * 0.05) * 0.02;

      // Per-frame rotation offset, added uniformly to every cached angle.
      const rotOffset = frame * (0.015 + avgEnergy * 0.04);
      const bandScale = bandCount / TWO_PI;

      const out: string[] = [];
      const tiers: number[][] = [];
      for (let row = 0; row < rows; row++) {
        let line = "";
        const tierRow: number[] = [];
        for (let col = 0; col < cols; col++) {
          let bits = 0;
          let maxNorm = 0;

          for (let dr = 0; dr < 4; dr++) {
            for (let dc = 0; dc < 2; dc++) {
              const idx = ((row * cols + col) * 4 + dr) * 2 + dc;
              const d = dist[idx];

              let rotAngle = angle[idx] + rotOffset;
              rotAngle -= Math.floor(rotAngle / TWO_PI) * TWO_PI;

              // Cosine-interpolated band mapping.
              const bandPos = rotAngle * bandScale;
              const bandIdx = Math.floor(bandPos) % bandCount;
              const nextBand = (bandIdx + 1) % bandCount;
              const frac = bandPos - Math.floor(bandPos);
              const t = (1 - Math.cos(frac * Math.PI)) / 2;
              const energy = bands[bandIdx] * (1 - t) + bands[nextBand] * t;

              // Blend per-band with overall so the whole shape beats.
              const blended = energy * 0.6 + avgEnergy * 0.4;
              const punch = blended * blended;
              const r = maxR * (0.08 + breath + 0.92 * punch);

              // Solid fill.
              if (r > 0.5 && d <= r) {
                const norm = d / r;
                if (norm > maxNorm) maxNorm = norm;
                bits |= BRAILLE_BITS[dr][dc];
              } else if (r > 0.5 && d < r + 1.5) {
                // Anti-aliased edge.
                const edgeFade = 1 - (d - r) / 1.5;
                if (scatterHash(bandIdx, row * 4 + dr, col * 2 + dc, frameInt) < edgeFade * 0.7) {
                  bits |= BRAILLE_BITS[dr][dc];
                  if (maxNorm < 0.9) maxNorm = 0.9;
                }
              }

              // Shockwave ring.
              if (shockStrength > 0.05) {
                const shockDist = Math.abs(d - shockR);
                const shockThick = 0.6 + shockStrength * 1.5;
                if (shockDist < shockThick) {
                  const fade = 1 - shockDist / shockThick;
                  if (fade > 0.4) {
                    bits |= BRAILLE_BITS[dr][dc];
                    if (maxNorm < 0.65) maxNorm = 0.65;
                  }
                }
              }
            }
          }

          // Radial gradient: green core -> yellow -> red edge.
          tierRow.push(bits === 0 ? -1 : specTag(maxNorm));
          line += String.fromCharCode(0x2800 | bits);
        }
        out.push(line.slice(0, cols).padEnd(cols, " "));
        tiers.push(tierRow.slice(0, cols));
      }
      return { rows: out, tiers };
    },
  };
}
