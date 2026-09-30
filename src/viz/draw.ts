/**
 * Canvas drawer for character-grid visualizer frames.
 *
 * Scales a cols x rows monospace grid to fit the canvas, resolving each
 * cell's color from the frame's `tiers`/`cells` (falling back to the mode's
 * base color), and batches consecutive same-color characters into single
 * fillText calls — the canvas analogue of the original's ANSI style runs.
 */
import type { VizColors, VizData, VizFrame } from "./types";

const TIER_KEYS = ["low", "mid", "high"] as const;

function palette(c: VizColors): Record<string, string> {
  return {
    text: c.text,
    dim: c.dim,
    low: c.spectrumLow,
    mid: c.spectrumMid,
    high: c.spectrumHigh,
    red: c.red,
    white: c.white,
  };
}

/**
 * Draw a frame onto the canvas. The grid is fitted to the canvas with
 * monospace character proportions (~0.62 width per em) and centered.
 */
export function drawFrame(canvas: HTMLCanvasElement, frame: VizFrame, data: VizData, base: string): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;
  const { cols, rows } = data;
  const pal = palette(data.colors);
  const tiers = frame.tiers;
  const cells = frame.cells;

  ctx.fillStyle = data.colors.bg;
  ctx.fillRect(0, 0, w, h);

  // Fit the grid: character cell is ~0.62 em wide.
  const size = Math.min(h / rows, w / (cols * 0.62));
  const cellW = size * 0.62;
  const cellH = size;
  const offX = (w - cellW * cols) / 2;
  const offY = (h - cellH * rows) / 2;

  ctx.font = `${Math.max(4, Math.floor(size))}px monospace`;
  ctx.textBaseline = "top";

  for (let r = 0; r < rows; r++) {
    const line = frame.rows[r] ?? "";
    let run = "";
    let runColor: string | null = null;
    const flush = (x: number) => {
      if (runColor !== null && run.length > 0) {
        ctx.fillStyle = runColor;
        ctx.fillText(run, x, 0);
      }
      run = "";
      runColor = null;
    };
    ctx.save();
    ctx.translate(0, offY + r * cellH + size * 0.12);
    for (let c = 0; c < cols; c++) {
      const ch = c < line.length ? line[c] : " ";
      if (ch === " ") {
        flush(offX + c * cellW);
        continue;
      }
      let color: string;
      if (cells && cells[r] && c < cells[r].length) {
        const key = cells[r][c];
        color = pal[key] ?? base;
      } else if (tiers && tiers[r] && c < tiers[r].length) {
        const tier = tiers[r][c];
        color = pal[TIER_KEYS[tier >= 0 && tier <= 2 ? tier : 0]] ?? base;
      } else {
        color = base;
      }
      if (color === runColor) {
        run += ch;
      } else {
        flush(offX + c * cellW);
        run = ch;
        runColor = color;
      }
    }
    flush(offX + cols * cellW);
    ctx.restore();
  }
}
