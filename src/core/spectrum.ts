/**
 * Spectrum analysis — parity with cliamp's visualizer tap:
 * FFT 2048, Hann window, 10 log bands with anchors
 * 20/100/200/400/800/1600/3200/6400/12800/16000/20000 Hz,
 * temporal smoothing (attack 0.6, decay 0.25), levels 0..1.
 * Source: /tmp/cliamp/ui/visualizer.go (see docs/recon/audio.md).
 * Pure functions; no DOM.
 */

export const FFT_SIZE = 2048;
export const BAND_COUNT = 10;
export const BAND_ANCHORS_HZ = [
  20, 100, 200, 400, 800, 1600, 3200, 6400, 12800, 16000, 20000,
] as const;
const SMOOTH_ATTACK = 0.6;
const SMOOTH_DECAY = 0.25;
/** Levels below this dBFS floor read as 0. */
const FLOOR_DB = -60;

/** In-place iterative radix-2 FFT. Length must be a power of two. */
export function fft(re: Float32Array, im: Float32Array): void {
  const n = re.length;
  // bit reversal
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i];
      re[i] = re[j];
      re[j] = t;
      t = im[i];
      im[i] = im[j];
      im[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ar = re[i + k];
        const ai = im[i + k];
        const br = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const bi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ar + br;
        im[i + k] = ai + bi;
        re[i + k + len / 2] = ar - br;
        im[i + k + len / 2] = ai - bi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

function hann(n: number): Float32Array {
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)));
  return w;
}
let hannTable: Float32Array | undefined;

/**
 * Compute 10-band levels (0..1) from a mono sample window.
 * `samples` length is truncated to FFT_SIZE; if shorter, zero-padded.
 */
export function bandLevels(samples: ArrayLike<number>, sampleRate: number): number[] {
  const n = FFT_SIZE;
  if (!hannTable) hannTable = hann(n);
  const re = new Float32Array(n);
  const im = new Float32Array(n);
  const len = Math.min(samples.length, n);
  for (let i = 0; i < len; i++) re[i] = samples[i] * hannTable[i];

  fft(re, im);

  const levels = new Array<number>(BAND_COUNT).fill(0);
  for (let b = 0; b < BAND_COUNT; b++) {
    const fLo = BAND_ANCHORS_HZ[b];
    const fHi = BAND_ANCHORS_HZ[b + 1];
    const binLo = Math.max(1, Math.floor((fLo * n) / sampleRate));
    let binHi = Math.ceil((fHi * n) / sampleRate);
    if (binHi <= binLo) binHi = binLo + 1;
    binHi = Math.min(binHi, n / 2);
    let power = 0;
    for (let bin = binLo; bin < binHi; bin++) {
      power += re[bin] * re[bin] + im[bin] * im[bin];
    }
    // Hann-windowed full-scale sine peaks at |X| = n/4, so this normalizes
    // a full-scale tone in-band to ~1.0 (scalloping loss included).
    const amp = (4 * Math.sqrt(power)) / n;
    const db = 20 * Math.log10(Math.max(amp, 1e-12));
    levels[b] = Math.min(1, Math.max(0, (db - FLOOR_DB) / -FLOOR_DB));
  }
  return levels;
}

/**
 * Temporal smoothing with separate attack/decay, matching the Go tap:
 * rising levels move 60% toward the new value, falling 25%.
 */
export class Spectrum {
  private smooth = new Float32Array(BAND_COUNT);
  /** Push a raw level vector; returns the smoothed bands. */
  push(levels: readonly number[]): Float32Array {
    for (let i = 0; i < BAND_COUNT; i++) {
      const v = Math.min(1, Math.max(0, levels[i]));
      const a = v >= this.smooth[i] ? SMOOTH_ATTACK : SMOOTH_DECAY;
      this.smooth[i] = a * v + (1 - a) * this.smooth[i];
    }
    return this.smooth;
  }
  reset(): void {
    this.smooth.fill(0);
  }
}
