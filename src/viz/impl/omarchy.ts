/**
 * Omarchy — dithered pixel field with the Omarchy mark (port of
 * /tmp/cliamp/ui/vis_omarchy.go).
 *
 * Drifting value noise thresholded through an ordered 8x8 Bayer dither into
 * hard on/off pixels; the spectrum thickens columns from the bottom with the
 * bass at the outer edges; the Omarchy mark is stamped into the same lattice
 * (half-block art, two pixels per character cell stacked vertically).
 *
 * Stateful: the noise drift clock advances in tick. The original ticks at
 * ~60 FPS while playing and 5 FPS when idle (ui/tick.go); t advances at
 * 0.03 per animation frame, i.e. 1.8/s playing, 0.15/s idle.
 */
import type { Visualizer, VizData, VizFrame } from "../types";

// Pixels per unit of noise: how big the drifting blobs read.
const OMARCHY_CELLS_PER_NOISE = 6.0;
const OMARCHY_SPECTRUM_FLOOR = 0.06;
const OMARCHY_SPECTRUM_REACH = 0.95;
const OMARCHY_REST = 0.34;
const OMARCHY_CLEAR_REACH = 6.0;
const OMARCHY_CLEAR_CURVE = 3.0;
const OMARCHY_MAX_SCALE = 3;
const OMARCHY_MARK_MARGIN = 2;

function specTag(norm: number): number {
  if (norm >= 0.6) return 2;
  if (norm >= 0.3) return 1;
  return 0;
}

// The classic 8x8 ordered dither matrix, 0..63.
const OMARCHY_BAYER = [
  0, 32, 8, 40, 2, 34, 10, 42,
  48, 16, 56, 24, 50, 18, 58, 26,
  12, 44, 4, 36, 14, 46, 6, 38,
  60, 28, 52, 20, 62, 30, 54, 22,
  3, 35, 11, 43, 1, 33, 9, 41,
  51, 19, 59, 27, 49, 17, 57, 25,
  15, 47, 7, 39, 13, 45, 5, 37,
  63, 31, 55, 23, 61, 29, 53, 21,
];

// Value-noise field the texture drifts through, built once from a fixed
// sequence (splitmix64 LCG) so the field looks the same on every run.
const OMARCHY_NOISE_SIZE = 64;
const OMARCHY_NOISE = new Float32Array(OMARCHY_NOISE_SIZE * OMARCHY_NOISE_SIZE);
{
  let s = 0x9e3779b97f4a7c15n;
  for (let i = 0; i < OMARCHY_NOISE_SIZE * OMARCHY_NOISE_SIZE; i++) {
    s = (s * 6364136223846793005n + 1442695040888963407n) & 0xffffffffffffffffn;
    OMARCHY_NOISE[i] = Number((s >> 33n) % 100000n) / 100000;
  }
}

// Bilinear sample of the noise field with smoothstep, wrapping at the edges,
// so the texture drifts as blobs rather than loose pixels.
function omarchyNoiseAt(u: number, v: number): number {
  const size = OMARCHY_NOISE_SIZE;
  u -= Math.floor(u / size) * size;
  v -= Math.floor(v / size) * size;
  const x0 = Math.floor(u);
  const y0 = Math.floor(v);
  const x1 = (x0 + 1) % size;
  const y1 = (y0 + 1) % size;
  const fx = u - x0;
  const fy = v - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = OMARCHY_NOISE[y0 * size + x0];
  const b = OMARCHY_NOISE[y0 * size + x1];
  const c = OMARCHY_NOISE[y1 * size + x0];
  const d = OMARCHY_NOISE[y1 * size + x1];
  return (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy;
}

// Fixed per-pixel offset, held steady across frames: Bayer alone would light
// the same low-index cells everywhere; this scatters the resting field while
// the ordered structure still shows where a loud band pushes a column bright.
function omarchyJitter(row: number, col: number): number {
  let h = (Math.imul(row, 6271) + Math.imul(col, 3037) + 0x9e3779b9) | 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x45d9f3b3) | 0;
  h ^= h >>> 16;
  return (h >>> 0) % 10000 / 10000;
}

interface OmarchyGlyph {
  w: number;
  h: number;
  on: Uint8Array;
}

// The Omarchy wordmark from omacom/omarchy's logo.txt, verbatim. It is
// already half-block art: one line of art is two rows of pixels, a bitmap
// eighty-one pixels across and twenty down.
const OMARCHY_WORDMARK_ART = [
  "                 ▄▄▄",
  " ▄█████▄    ▄███████████▄    ▄███████   ▄███████   ▄███████   ▄█   █▄    ▄█   █▄",
  "███   ███  ███   ███   ███  ███   ███  ███   ███  ███   ███  ███   ███  ███   ███",
  "███   ███  ███   ███   ███  ███   ███  ███   ███  ███   █▀   ███   ███  ███   ███",
  "███   ███  ███   ███   ███ ▄███▄▄▄███ ▄███▄▄▄██▀  ███       ▄███▄▄▄███▄ ███▄▄▄███",
  "███   ███  ███   ███   ███ ▀███▀▀▀███ ▀███▀▀▀▀    ███      ▀▀███▀▀▀███  ▀▀▀▀▀▀███",
  "███   ███  ███   ███   ███  ███   ███ ██████████  ███   █▄   ███   ███  ▄██   ███",
  "███   ███  ███   ███   ███  ███   ███  ███   ███  ███   ███  ███   ███  ███   ███",
  " ▀█████▀    ▀█   ███   █▀   ███   █▀   ███   ███  ███████▀   ███   █▀    ▀█████▀",
  "                                       ███   █▀",
];

// The square-spiral Omarchy mark, for panels too narrow to hold the
// wordmark. Fifteen pixels square, from omarchy-logo.svg.
const OMARCHY_SQUARE_BITS = [
  "111111111111111",
  "100000010000001",
  "101111110001101",
  "101000000000101",
  "101000000000101",
  "101000000000101",
  "101000000000101",
  "111000000000101",
  "101000000000101",
  "101000000000101",
  "101000000000101",
  "101000000000101",
  "101111111111101",
  "100000010000001",
  "111111110111111",
];

function decodeHalfBlockArt(art: readonly string[]): OmarchyGlyph {
  let width = 0;
  for (const line of art) width = Math.max(width, [...line].length);
  const on = new Uint8Array(width * art.length * 2);
  for (let row = 0; row < art.length; row++) {
    const chars = [...art[row]];
    for (let col = 0; col < chars.length; col++) {
      const r = chars[col];
      if (r === "█" || r === "▀") on[row * 2 * width + col] = 1;
      if (r === "█" || r === "▌") on[(row * 2 + 1) * width + col] = 1;
    }
  }
  return { w: width, h: art.length * 2, on };
}

function decodeBitRows(rows: readonly string[]): OmarchyGlyph {
  let width = 0;
  for (const line of rows) width = Math.max(width, line.length);
  const on = new Uint8Array(width * rows.length);
  for (let row = 0; row < rows.length; row++) {
    for (let col = 0; col < rows[row].length; col++) {
      if (rows[row][col] === "1") on[row * width + col] = 1;
    }
  }
  return { w: width, h: rows.length, on };
}

// Marks tried in order: the wordmark is the mark, and the square is what a
// narrow panel gets instead of nothing.
const OMARCHY_MARKS: OmarchyGlyph[] = [decodeHalfBlockArt(OMARCHY_WORDMARK_ART), decodeBitRows(OMARCHY_SQUARE_BITS)];

// The whole multiple g can be drawn at inside the field, or 0 if it does not
// fit at all. Neither mark survives being scaled down.
function omarchyFitScale(g: OmarchyGlyph, pxRows: number, pxCols: number): number {
  if (pxRows < g.h + OMARCHY_MARK_MARGIN || pxCols < g.w + OMARCHY_MARK_MARGIN) return 0;
  return Math.min(
    Math.min(Math.floor((pxRows - OMARCHY_MARK_MARGIN) / g.h), Math.floor((pxCols - OMARCHY_MARK_MARGIN) / g.w)),
    OMARCHY_MAX_SCALE,
  );
}

function omarchyMarkFor(pxRows: number, pxCols: number): { g: OmarchyGlyph; scale: number } {
  for (const g of OMARCHY_MARKS) {
    const s = omarchyFitScale(g, pxRows, pxCols);
    if (s > 0) return { g, scale: s };
  }
  return { g: { w: 0, h: 0, on: new Uint8Array(0) }, scale: 0 };
}

export function makeOmarchy(): Visualizer {
  let t = 0;

  return {
    name: "Omarchy",
    init() {
      t = 0;
    },
    tick(dt: number, data: VizData) {
      t += Math.min(dt, 0.4) * (data.playing ? 1.8 : 0.15);
    },
    render(data: VizData): VizFrame {
      const rows = data.rows;
      const cols = data.cols;
      const bands = data.bands;

      const out: string[] = [];
      const tiers: number[][] = [];
      for (let r = 0; r < rows; r++) {
        out.push(" ".repeat(cols));
        tiers.push(new Array<number>(cols).fill(-1));
      }
      if (rows <= 0 || cols <= 0 || bands.length === 0) return { rows: out, tiers };

      const pxRows = rows * 2;
      const pxCols = cols;

      // The mean level, so the whole field breathes with the record.
      let amp = 0;
      for (let i = 0; i < bands.length; i++) amp += bands[i];
      amp /= bands.length;

      const { g: mark, scale } = omarchyMarkFor(pxRows, pxCols);
      const markW = mark.w * scale;
      const markH = mark.h * scale;
      const markX = Math.floor((pxCols - markW) / 2);
      const markY = Math.floor((pxRows - markH) / 2);

      // This column's band, mirrored about the middle: bass at the outer
      // edges where the field has the most room, treble in towards the mark.
      // Blended with its neighbour so the bands do not read as bars.
      const n = bands.length;
      const half = pxCols / 2;
      const levels = new Float32Array(pxCols);
      for (let pc = 0; pc < pxCols; pc++) {
        const side = Math.min(1, Math.abs(pc + 0.5 - half) / Math.max(half, 1));
        const pos = (1 - side) * n - 0.5;
        const b0 = Math.min(Math.max(Math.floor(pos), 0), n - 1);
        const b1 = Math.min(b0 + 1, n - 1);
        const mixB = Math.max(0, Math.min(1, pos - b0));
        const raw = bands[b0] * (1 - mixB) + bands[b1] * mixB;
        levels[pc] = Math.max(0, (raw - OMARCHY_SPECTRUM_FLOOR) / (1 - OMARCHY_SPECTRUM_FLOOR));
      }

      // How far the resting texture has come back from the mark at this pixel.
      const shadeAt = (pr: number, pc: number): number => {
        if (scale === 0) return 1;
        const dx = Math.max(0, Math.max(markX - pc, pc - (markX + markW - 1)));
        const dy = Math.max(0, Math.max(markY - pr, pr - (markY + markH - 1)));
        return Math.pow(Math.min(1, Math.hypot(dx, dy) / OMARCHY_CLEAR_REACH), OMARCHY_CLEAR_CURVE);
      };

      const pixel = (pr: number, pc: number): [boolean, number] => {
        // The mark is cells of this same lattice, not a layer over them.
        if (scale > 0 && pc >= markX && pr >= markY && pc < markX + markW && pr < markY + markH &&
            mark.on[(Math.floor((pr - markY) / scale)) * mark.w + Math.floor((pc - markX) / scale)]) {
          return [true, specTag(0.34 + levels[pc] * 0.35 + amp * 0.45)];
        }

        const shade = shadeAt(pr, pc);
        if (shade < 0.004) return [false, 0];

        // The spectrum thickens the column from the bottom up, as high as the
        // band is loud, easing off towards the top so the body stays full.
        let spec = 0;
        const level = levels[pc];
        if (level > 0) {
          const up = pxRows - 1 - pr;
          const tall = level * pxRows * OMARCHY_SPECTRUM_REACH;
          if (up < tall) spec = level * Math.pow(1 - up / tall, 0.85);
        }

        const u = pc / OMARCHY_CELLS_PER_NOISE;
        const w = pr / OMARCHY_CELLS_PER_NOISE;
        const base = 0.6 * omarchyNoiseAt(u + t * 0.14, w - t * 0.055) +
          0.4 * omarchyNoiseAt(u * 0.55 - t * 0.08, w * 0.55 + t * 0.06);
        // Each pixel also blinks on its own rhythm, so one appearing is a
        // local event rather than the whole pattern drifting past.
        const tw = 0.5 + 0.5 * Math.sin(t * 1.1 + omarchyJitter(pr, pc) * 2 * Math.PI);
        const lum = shade * (0.3 + 0.52 * base * base + 0.18 * tw + amp * 0.22) * OMARCHY_REST +
          spec * 0.72 * Math.min(1, shade * 3);

        // The 8x8 Bayer tile repeats often at this width, so the jitter
        // carries more of the weight; the ordered structure only surfaces
        // where a loud band pushes a column bright.
        const threshold = 0.55 * (OMARCHY_BAYER[(pr & 7) * 8 + (pc & 7)] + 0.5) / 64 +
          0.45 * omarchyJitter(pr + 7, pc + 13);
        if (lum <= threshold) return [false, 0];
        return [true, specTag(spec * 0.55 + amp * 0.12)];
      };

      for (let row = 0; row < rows; row++) {
        let line = "";
        const tierRow: number[] = [];
        for (let col = 0; col < pxCols; col++) {
          const [upLit, upTier] = pixel(row * 2, col);
          const [loLit, loTier] = pixel(row * 2 + 1, col);

          let glyph = " ";
          let cellTag = -1;
          if (upLit && loLit) {
            glyph = "█";
            cellTag = Math.max(upTier, loTier);
          } else if (upLit) {
            glyph = "▀";
            cellTag = upTier;
          } else if (loLit) {
            glyph = "▌";
            cellTag = loTier;
          }
          line += glyph;
          tierRow.push(cellTag);
        }
        out[row] = line.slice(0, cols).padEnd(cols, " ");
        tiers[row] = tierRow.slice(0, cols);
      }
      return { rows: out, tiers };
    },
  };
}
