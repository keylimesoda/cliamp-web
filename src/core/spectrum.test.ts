import { describe, expect, it } from "vitest";
import { BAND_COUNT, bandLevels, fft, Spectrum } from "./spectrum";

const SR = 44100;

function sine(freq: number, n: number): Float32Array {
  const s = new Float32Array(n);
  for (let i = 0; i < n; i++) s[i] = Math.sin((2 * Math.PI * freq * i) / SR);
  return s;
}

function peakBand(levels: number[]): number {
  let best = 0;
  for (let i = 1; i < levels.length; i++) if (levels[i] > levels[best]) best = i;
  return best;
}

describe("bandLevels", () => {
  it("returns 10 levels in 0..1", () => {
    const levels = bandLevels(sine(440, 2048), SR);
    expect(levels).toHaveLength(BAND_COUNT);
    for (const v of levels) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it("places a 1kHz sine in the 1k band", () => {
    const levels = bandLevels(sine(1000, 2048), SR);
    expect(peakBand(levels)).toBe(4); // anchors: 20,100,200,400,800,1600 → 1k is band 4
    expect(levels[4]).toBeGreaterThan(0.5);
  });

  it("places a 150Hz sine in the 100-200 band", () => {
    const levels = bandLevels(sine(150, 2048), SR);
    expect(peakBand(levels)).toBe(1);
  });

  it("places an 8kHz sine in the 6.4k-12.8k band", () => {
    const levels = bandLevels(sine(8000, 2048), SR);
    expect(peakBand(levels)).toBe(7);
  });

  it("reads silence as all zeros", () => {
    const levels = bandLevels(new Float32Array(2048), SR);
    for (const v of levels) expect(v).toBe(0);
  });
});

describe("fft", () => {
  it("resolves a single bin", () => {
    const n = 64;
    const re = new Float32Array(n);
    const im = new Float32Array(n);
    const k = 8;
    // Pure cosine splits into bins k and n-k, magnitude n/2 each.
    for (let i = 0; i < n; i++) re[i] = Math.cos((2 * Math.PI * k * i) / n);
    fft(re, im);
    let best = 0;
    let bestMag = 0;
    for (let i = 0; i < n; i++) {
      const m = Math.hypot(re[i], im[i]);
      if (m > bestMag) {
        bestMag = m;
        best = i;
      }
    }
    expect(best).toBe(k);
    expect(bestMag).toBeCloseTo(n / 2, 0);
    // Conjugate bin carries the same energy.
    expect(Math.hypot(re[n - k], im[n - k])).toBeCloseTo(n / 2, 0);
  });
});

describe("Spectrum smoothing", () => {
  it("attacks faster than it decays", () => {
    const s = new Spectrum();
    const levels = new Array(BAND_COUNT).fill(1);
    const up = s.push(levels)[0];
    expect(up).toBeCloseTo(0.6, 5);
    const down = s.push(new Array(BAND_COUNT).fill(0))[0];
    expect(down).toBeCloseTo(0.6 * 0.75, 5);
  });

  it("reset zeroes state", () => {
    const s = new Spectrum();
    s.push(new Array(BAND_COUNT).fill(1));
    s.reset();
    expect(s.push(new Array(BAND_COUNT).fill(0))[0]).toBe(0);
  });
});
