import { useEffect, useRef } from "react";
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

function vizData(): VizData {
  const st = usePlayerStore.getState();
  const eng = getEngine();
  return {
    bands: eng ? eng.getBands() : new Float32Array(10),
    waveform: eng?.getWaveform() ?? WAVE_ZERO,
    t: performance.now() / 1000,
    dt: 0,
    playing: st.state === "playing",
    cols: VIZ_COLS,
    rows: VIZ_ROWS,
    colors: readColors(),
  };
}

/**
 * Visualizer — all 32 cliamp visualizer modes (plus None), rendered as
 * character grids on a canvas. Tap/click the area to cycle modes
 * (original "v" key); the choice persists.
 */
export default function Visualizer() {
  const ref = useRef<HTMLCanvasElement>(null);
  const index = useVizStore((s) => s.index);
  const theme = usePlayerStore((s) => s.theme);
  const name = VISUALIZERS[index]?.name ?? "";

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const entry = VISUALIZERS[index];
    if (!entry) return;
    const viz: Viz = entry.make();
    viz.init?.(VIZ_COLS, VIZ_ROWS);
    let raf = 0;
    let last = performance.now();

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const interval = usePlayerStore.getState().state === "playing" ? TICK_PLAYING_MS : TICK_PAUSED_MS;
      const dt = now - last;
      if (dt < interval) return;
      last = now - (dt % interval);
      const d = vizData();
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
  }, [index, theme]);

  return (
    <div
      className="viz-wrap"
      onPointerDown={() => useVizStore.getState().cycle()}
      role="button"
      aria-label={`Visualizer: ${name}. Tap to switch.`}
    >
      <canvas ref={ref} className="visualizer" width={900} height={200} aria-hidden />
      <span className="viz-name">{name}</span>
    </div>
  );
}
