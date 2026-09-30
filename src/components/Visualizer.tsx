import { useEffect, useRef } from "react";
import { getEngine } from "../store/player";

const BARS = 48;

/**
 * Spectrum visualizer — reads the engine's 10 smoothed bands and renders
 * them as an interpolated bar field. Colors map low→high bands across the
 * theme's spectrum-low/mid/high. Redrawn each animation frame; the engine
 * updates bands independently at 33 ms.
 */
export default function Visualizer() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;

    const css = getComputedStyle(document.documentElement);
    const colors = [
      css.getPropertyValue("--spectrum-low").trim(),
      css.getPropertyValue("--spectrum-mid").trim(),
      css.getPropertyValue("--spectrum-high").trim(),
    ];
    const bg = css.getPropertyValue("--bg-sunken").trim();

    const draw = () => {
      const eng = getEngine();
      const bands = eng ? eng.getBands() : null;
      const w = canvas.width;
      const h = canvas.height;
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);
      const gap = 2;
      const bw = (w - gap * (BARS + 1)) / BARS;
      for (let i = 0; i < BARS; i++) {
        // interpolate the 10 bands across 48 bars
        const t = i / (BARS - 1);
        const bi = t * 9;
        const lo = Math.floor(bi);
        const hi = Math.min(9, lo + 1);
        const frac = bi - lo;
        const level = bands ? bands[lo] * (1 - frac) + bands[hi] * frac : 0;
        const bh = Math.max(2, level * (h - 6));
        const color = t < 0.45 ? colors[0] : t < 0.8 ? colors[1] : colors[2];
        ctx.fillStyle = color;
        ctx.fillRect(gap + i * (bw + gap), h - 3 - bh, bw, bh);
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return <canvas ref={ref} className="visualizer" width={900} height={200} aria-hidden />;
}
