/**
 * Shared visualizer contract for cliamp-web.
 *
 * Every visualizer is a character-grid renderer, mirroring the original
 * cliamp terminal visualizers (ui/vis_*.go): each frame is a cols x rows
 * monospace grid of characters. A shared canvas drawer scales the grid to
 * the canvas and draws it with per-run colors.
 *
 * Color model:
 * - Monochrome modes (the majority) use `colors.text`.
 * - Spectrum-style modes set `tiers` per cell: 0 = spectrumLow,
 *   1 = spectrumMid, 2 = spectrumHigh — the original's green/yellow/red tiers.
 *   Dimmed characters use the `cells` palette with a "dim" key.
 * - Multi-color modes (e.g. red-sector) set `cells` with palette keys.
 */

export interface VizColors {
  /** Monochrome visualizer foreground (theme text). */
  text: string;
  dim: string;
  spectrumLow: string;
  spectrumMid: string;
  spectrumHigh: string;
  red: string;
  white: string;
  bg: string;
}

export interface VizData {
  /** 10 smoothed magnitude bands, 0..1 (low→high frequency). */
  bands: Float32Array;
  /** Time-domain samples, -1..1 (mono tap). Flat zero while stopped. */
  waveform: Float32Array;
  /** Monotonic time in seconds. */
  t: number;
  /** Seconds since the previous frame. */
  dt: number;
  /** True while audio is actively playing. */
  playing: boolean;
  /** Grid width in character cells. */
  cols: number;
  /** Grid height in character cells. */
  rows: number;
  colors: VizColors;
}

export interface VizFrame {
  /** Exactly `rows` rows; each row exactly `cols` characters. */
  rows: string[];
  /**
   * Optional per-cell spectrum tier: 0 = spectrumLow, 1 = spectrumMid,
   * 2 = spectrumHigh. Cells without an entry render in the base color.
   */
  tiers?: number[][];
  /**
   * Optional per-cell palette key ("text" | "dim" | "low" | "mid" | "high" |
   * "red" | "white") for multi-color modes.
   */
  cells?: string[][];
}

export interface Visualizer {
  /** Display name (cycle label), e.g. "Matrix". */
  name: string;
  /** Reset animation state; called on mode switch and grid resize. */
  init?(cols: number, rows: number): void;
  /** Advance internal animation by dt seconds. */
  tick(dt: number, data: VizData): void;
  /** Produce the next frame. Must not throw; must fill the full grid. */
  render(data: VizData): VizFrame;
}

/** Grid dimensions shared by all modes (terminal 80-col proportions). */
export const VIZ_COLS = 80;
export const VIZ_ROWS = 16;
