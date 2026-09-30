import { describe, expect, it } from "vitest";
import { VISUALIZERS } from "./registry";
import { VIZ_COLS, VIZ_ROWS } from "./types";
import type { VizColors, VizData } from "./types";

const COLORS: VizColors = {
  text: "#fff",
  dim: "#888",
  spectrumLow: "#0f0",
  spectrumMid: "#ff0",
  spectrumHigh: "#f00",
  red: "#f00",
  white: "#fff",
  bg: "#000",
};

/** Deterministic synthetic frame: bands sweep a sine, waveform is a sine. */
function frame(t: number): VizData {
  const bands = new Float32Array(10);
  for (let i = 0; i < 10; i++) {
    bands[i] = Math.max(0, Math.min(1, 0.5 + 0.5 * Math.sin(t * 2 + i * 0.9)));
  }
  const waveform = new Float32Array(512);
  for (let i = 0; i < waveform.length; i++) {
    waveform[i] = 0.6 * Math.sin(t * 8 + (i / waveform.length) * 12);
  }
  return {
    bands,
    waveform,
    t,
    dt: 1 / 30,
    playing: true,
    cols: VIZ_COLS,
    rows: VIZ_ROWS,
    colors: COLORS,
  };
}

describe("visualizer registry", () => {
  it("lists all 33 modes in cycle order (32 + None)", () => {
    expect(VISUALIZERS).toHaveLength(33);
    expect(VISUALIZERS[0].name).toBe("Bars");
    expect(VISUALIZERS[VISUALIZERS.length - 1].name).toBe("None");
    const names = VISUALIZERS.map((v) => v.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("every mode renders valid full-grid frames without throwing", () => {
    for (const entry of VISUALIZERS) {
      const viz = entry.make();
      expect(viz.name).toBe(entry.name);
      viz.init?.(VIZ_COLS, VIZ_ROWS);
      for (let f = 0; f < 10; f++) {
        const d = frame(f / 30);
        expect(() => viz.tick(1 / 30, d)).not.toThrow();
        const out = viz.render(d);
        expect(out.rows, `${entry.name}: row count`).toHaveLength(d.rows);
        for (let r = 0; r < d.rows; r++) {
          expect(out.rows[r]?.length, `${entry.name}: row ${r} width`).toBe(d.cols);
        }
      }
    }
  });

  it("every non-None mode draws something", () => {
    for (const entry of VISUALIZERS) {
      if (entry.name === "None") continue;
      const viz = entry.make();
      viz.init?.(VIZ_COLS, VIZ_ROWS);
      let ink = 0;
      for (let f = 0; f < 30; f++) {
        const d = frame(f / 30);
        viz.tick(1 / 30, d);
        const out = viz.render(d);
        ink = Math.max(ink, out.rows.join("").replace(/ /g, "").length);
      }
      expect(ink, `${entry.name}: drew no cells across 30 frames`).toBeGreaterThan(0);
    }
  });
});
