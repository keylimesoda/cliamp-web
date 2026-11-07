/**
 * Visualizer mode selection — parity with cliamp's persisted visualizer
 * choice (saveVisualizerChoice). Tapping the visualizer cycles to the next
 * mode in registry order (original "v" key behavior), wrapping around.
 */
import { create } from "zustand";
import { VISUALIZERS } from "../viz/registry";

const KEY = "cliamp-web:viz";

function readIndex(): number {
  try {
    const raw = localStorage.getItem(KEY);
    const named = VISUALIZERS.findIndex((v) => v.name === raw);
    if (named >= 0) return named;
    const n = raw === null ? NaN : Number(raw);
    if (n === 32) return VISUALIZERS.findIndex((v) => v.name === "None"); // v0.1's last index
    if (Number.isInteger(n) && n >= 0 && n < VISUALIZERS.length) return n;
  } catch {
    /* ignore */
  }
  return 0;
}
function writeIndex(i: number): void {
  try {
    localStorage.setItem(KEY, VISUALIZERS[i].name);
  } catch {
    /* ignore quota */
  }
}

interface VizState {
  index: number;
  cycle: () => void;
  setIndex: (i: number) => void;
}

export const useVizStore = create<VizState>((set, get) => ({
  index: readIndex(),
  cycle: () => {
    const next = (get().index + 1) % VISUALIZERS.length;
    writeIndex(next);
    set({ index: next });
  },
  setIndex: (i) => {
    if (i < 0 || i >= VISUALIZERS.length) return;
    writeIndex(i);
    set({ index: i });
  },
}));
