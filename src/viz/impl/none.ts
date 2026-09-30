/**
 * None — no visualizer (original VisNone).
 */
import type { Visualizer, VizData, VizFrame } from "../types";

export function makeNone(): Visualizer {
  return {
    name: "None",
    tick() {},
    render(data: VizData): VizFrame {
      return { rows: Array.from({ length: data.rows }, () => " ".repeat(data.cols)) };
    },
  };
}
