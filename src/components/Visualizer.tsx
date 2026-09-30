import { useEffect, useRef, useState } from "react";
import { getEngine, usePlayerStore } from "../store/player";
import { useVizStore } from "../store/viz";
import { VISUALIZERS } from "../viz/registry";
import { drawFrame } from "../viz/draw";
import { VIZ_COLS, VIZ_ROWS } from "../viz/types";
import type { VizColors, VizData, Visualizer as Viz } from "../viz/types";

// Original cadence (ui/tick.go): ~60 FPS while playing, 5 FPS when idle.
const TICK_PLAYING_MS = 16;
const TICK_PAUSED_MS = 200;
const WAVE_ZERO = new Float32Array(1024);
const CELL_ASPECT = 0.62;

function cssVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function readColors(): VizColors {
  return {
    text: cssVar("--text", "#d8e8d8"),
    dim: cssVar("--text-dim", "#6a7a6a"),
    spectrumLow: cssVar("--spectrum-low", "#7ec97e"),
    spectrumMid: cssVar("--spectrum-mid", "#d8c97e"),
    spectrumHigh: cssVar("--spectrum-high", "#d87e7e"),
    red: cssVar("--error", "#d87e7e"),
    white: cssVar("--fg-bright", "#f0f0e8"),
    bg: cssVar("--bg-sunken", "#0a0e0a"),
  };
}

export function immersiveRowsForRect(width: number, height: number): number {
  if (width <= 0 || height <= 0) return VIZ_ROWS;
  return Math.max(8, Math.min(64, Math.round((height * VIZ_COLS * CELL_ASPECT) / width)));
}

function vizData(cols: number, rows: number): VizData {
  const st = usePlayerStore.getState();
  const eng = getEngine();
  return {
    bands: eng ? eng.getBands() : new Float32Array(10),
    waveform: eng?.getWaveform() ?? WAVE_ZERO,
    t: performance.now() / 1000,
    dt: 0,
    playing: st.state === "playing",
    cols,
    rows,
    colors: readColors(),
  };
}

interface VisualizerProps {
  immersive?: boolean;
  onEnterImmersive?: () => void;
}

/**
 * Visualizer — all cliamp visualizer modes, rendered as a character grid.
 *
 * Normal mode preserves the original 80x16 grid. Immersive mode keeps 80
 * columns but derives the row count from the actual display rectangle, then
 * sizes the canvas backing store to the real CSS dimensions. That prevents the
 * old 900x200 bitmap from being stretched into the 804x638 Tesla layout.
 */
export default function Visualizer({ immersive = false, onEnterImmersive }: VisualizerProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [grid, setGrid] = useState({ cols: VIZ_COLS, rows: VIZ_ROWS });
  const index = useVizStore((s) => s.index);
  const theme = usePlayerStore((s) => s.theme);
  const name = VISUALIZERS[index]?.name ?? "";

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;

    if (!immersive) {
      canvas.width = 900;
      canvas.height = 200;
      setGrid((g) => (g.cols === VIZ_COLS && g.rows === VIZ_ROWS ? g : { cols: VIZ_COLS, rows: VIZ_ROWS }));
      return;
    }

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const dpr = Math.max(1, window.devicePixelRatio || 1);
      const width = Math.max(1, Math.round(rect.width * dpr));
      const height = Math.max(1, Math.round(rect.height * dpr));
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;

      const rows = immersiveRowsForRect(rect.width, rect.height);
      setGrid((g) => (g.cols === VIZ_COLS && g.rows === rows ? g : { cols: VIZ_COLS, rows }));
    };

    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();
    return () => observer.disconnect();
  }, [immersive]);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const entry = VISUALIZERS[index];
    if (!entry) return;
    const viz: Viz = entry.make();
    viz.init?.(grid.cols, grid.rows);
    let raf = 0;
    let last = performance.now();

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const interval = usePlayerStore.getState().state === "playing" ? TICK_PLAYING_MS : TICK_PAUSED_MS;
      const dt = now - last;
      if (dt < interval) return;
      last = now - (dt % interval);
      const d = vizData(grid.cols, grid.rows);
      d.dt = dt / 1000;
      if (entry.name !== "None") {
        try {
          viz.tick(dt / 1000, d);
          drawFrame(canvas, viz.render(d), d, d.colors.text);
        } catch {
          // A broken frame must never take down the player.
        }
      }
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [grid.cols, grid.rows, index, theme]);

  return (
    <div
      className="viz-wrap"
      onPointerDown={() => useVizStore.getState().cycle()}
      role="button"
      aria-label={`Visualizer: ${name}. Tap to switch.`}
    >
      <canvas
        ref={ref}
        className={"visualizer" + (immersive ? " is-immersive" : "")}
        width={immersive ? undefined : 900}
        height={immersive ? undefined : 200}
        aria-hidden
      />
      <span className="viz-name">{name}</span>
      {!immersive && onEnterImmersive ? (
        <button
          className="viz-full-toggle"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onEnterImmersive();
          }}
          aria-label="Open full visualizer"
        >
          V FULL
        </button>
      ) : null}
    </div>
  );
}
