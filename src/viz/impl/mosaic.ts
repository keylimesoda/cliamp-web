/**
 * Mosaic — a static heatmap of flickering tiles (port of
 * /tmp/cliamp/ui/vis_mosaic.go).
 *
 * The grid never scrolls: each tile sits in a fixed position and is wired
 * at startup to one spectrum band (top rows → treble, bottom → bass) plus a
 * personal ignition threshold, so loud passages light many tiles at once
 * while quiet ones light only the most sensitive — a speckled,
 * gradually-saturating pattern that tracks the music. Unlit tiles decay in
 * place and vanish into the background.
 */
import type { Visualizer, VizData, VizFrame } from "../types";

const TILE_W = 2;
const TILE_GAP = 1;
const DECAY = 0.88;

const LEVEL_GLYPH = [" ", "░", "▒", "▓", "█", "█", "█"] as const;
const LEVEL_TIER = [-1, 0, 0, 0, 0, 1, 2] as const;

function mosaicLevelFor(intensity: number): number {
  if (intensity >= 0.85) return 6;
  if (intensity >= 0.65) return 5;
  if (intensity >= 0.45) return 4;
  if (intensity >= 0.28) return 3;
  if (intensity >= 0.15) return 2;
  if (intensity >= 0.05) return 1;
  return 0;
}

function tileCount(cols: number): number {
  if (cols < TILE_W) return 0;
  // The last tile needs no trailing gap.
  return Math.floor((cols + TILE_GAP) / (TILE_W + TILE_GAP));
}

export function makeMosaic(): Visualizer {
  let rows = 0;
  let tiles = 0;
  let bandIdx = new Int16Array(0);
  let threshold = new Float32Array(0);
  let value = new Float32Array(0);
  let rng = 0;

  const rand = () => {
    rng = (Math.imul(rng, 0x6d2b79f5) + 0x168ed33d) | 0;
    return (rng >>> 10) / 0x100000;
  };

  const ensureGrid = (r: number, t: number, bandCount: number) => {
    if (rows === r && tiles === t && bandIdx.length === r * t) return;
    rows = r;
    tiles = t;
    bandIdx = new Int16Array(rows * tiles);
    threshold = new Float32Array(rows * tiles);
    value = new Float32Array(rows * tiles);
    const bc = bandCount > 0 ? bandCount : 10;
    // Re-seed on every rebuild so each visit reshuffles the pattern.
    rng = 0x1a1015d5;
    for (let rr = 0; rr < rows; rr++) {
      const baseBand =
        rows > 1 ? Math.floor(((rows - 1 - rr) * (bc - 1)) / (rows - 1)) : Math.floor(bc / 2);
      for (let c = 0; c < tiles; c++) {
        // Small jitter so neighbours don't share the same band.
        let band = baseBand + (Math.floor(rand() * 5) - 2);
        if (band < 0) band = 0;
        else if (band >= bc) band = bc - 1;
        const i = rr * tiles + c;
        bandIdx[i] = band;
        // Per-cell threshold in [0.04, 0.78] so lit-cell density rises
        // naturally with loudness — that's what produces the scattered look.
        threshold[i] = 0.04 + rand() * 0.74;
      }
    }
  };

  const decayAll = () => {
    for (let i = 0; i < value.length; i++) {
      value[i] *= DECAY;
      if (value[i] < 0.001) value[i] = 0;
    }
  };

  return {
    name: "Mosaic",
    init(cols: number, rows: number) {
      // Force a grid rebuild on next tick/render so each visit reshuffles
      // thresholds and band assignments — keeps the visualizer fresh.
      ensureGrid(rows, tileCount(cols), 10);
      value.fill(0);
    },
    tick(_dt: number, data: VizData) {
      const { rows: r, cols, bands } = data;
      const t = tileCount(cols);
      if (r <= 0 || t <= 0) return;
      ensureGrid(r, t, bands.length);
      if (bands.length === 0) {
        // Still decay so cells don't stick lit during silence.
        decayAll();
        return;
      }
      // Each cell: if its assigned band exceeds its threshold, ignite (set
      // value to the band level, clamped so spikes briefly promote into the
      // yellow/red tiers). Otherwise decay in place.
      for (let i = 0; i < bandIdx.length; i++) {
        const level = bands[bandIdx[i]] ?? 0;
        if (level > threshold[i]) {
          const ignited = level > 1.05 ? 1.05 : level;
          if (ignited > value[i]) value[i] = ignited;
        }
        value[i] *= DECAY;
        if (value[i] < 0.001) value[i] = 0;
      }
    },
    render(data: VizData): VizFrame {
      const { rows: r, cols, bands } = data;
      const t = tileCount(cols);
      ensureGrid(r, t, bands.length);
      const out: string[] = [];
      const tiers: number[][] = [];
      for (let row = 0; row < r; row++) {
        let line = "";
        const tierRow: number[] = [];
        for (let k = 0; k < t; k++) {
          const lv = mosaicLevelFor(value[row * t + k]);
          const glyph = LEVEL_GLYPH[lv];
          const tier = LEVEL_TIER[lv];
          line += glyph + glyph;
          tierRow.push(tier, tier);
          if (k < t - 1) {
            line += " ";
            tierRow.push(-1);
          }
        }
        out.push(line.slice(0, cols).padEnd(cols, " "));
        tiers.push(tierRow.slice(0, cols));
      }
      return { rows: out, tiers };
    },
  };
}
