import { describe, expect, it } from "vitest";
// The worklet file is plain JS shared with the AudioWorklet runtime.
import { Wsola } from "../../../public/worklets/wsola.js";

const SR = 44100;

function sine(freq: number, samples: number): Float32Array {
  const s = new Float32Array(samples);
  for (let i = 0; i < samples; i++) s[i] = Math.sin((2 * Math.PI * freq * i) / SR);
  return s;
}

/**
 * Burst all input, then drain every producible output sample.
 * No leading silence (everything is buffered before the first pull),
 * so the output length IS the stretched duration.
 */
function run(speed: number, input: Float32Array): Float32Array {
  const w = new Wsola(speed);
  w.push(input);
  const chunks: Float32Array[] = [];
  for (;;) {
    const out = w.pull(128);
    chunks.push(out);
    if (w.outLen === 0 && !w.canSynthesize()) break;
  }
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const all = new Float32Array(total);
  let off = 0;
  for (const c of chunks) {
    all.set(c, off);
    off += c.length;
  }
  return all;
}

/** Zero-crossing rate (Hz) of a segment. */
function zeroCrossingsPerSec(s: Float32Array): number {
  let zc = 0;
  for (let i = 1; i < s.length; i++) {
    if ((s[i - 1] < 0 && s[i] >= 0) || (s[i - 1] > 0 && s[i] <= 0)) zc++;
  }
  return (zc * SR) / s.length;
}

function expectDuration(out: Float32Array, expected: number) {
  // Windowed output = 4096 + K*3584, which trails N/speed by up to one
  // window's worth at low speeds; the pitch check is the real assertion.
  expect(out.length).toBeGreaterThan(expected - 10000);
  expect(out.length).toBeLessThan(expected + 5000);
}

describe("Wsola", () => {
  it("clamps speed to [0.25, 2]", () => {
    expect(new Wsola(0.1).speed).toBe(0.25);
    expect(new Wsola(3).speed).toBe(2);
    expect(new Wsola(Number.NaN).speed).toBe(1);
  });

  it("speed 1 passes audio through", () => {
    const input = sine(220, 88200); // 2s
    const out = run(1.0, input);
    expectDuration(out, 88200);
    // First window is emitted verbatim (no overlap blend) — correlate it.
    let num = 0;
    let da = 0;
    let db = 0;
    for (let i = 512; i < 3584; i++) {
      num += out[i] * input[i];
      da += out[i] * out[i];
      db += input[i] * input[i];
    }
    expect(num / Math.sqrt(da * db)).toBeGreaterThan(0.999);
  });

  it("speed 2 halves duration and preserves pitch", () => {
    const input = sine(220, 176400); // 4s
    const out = run(2.0, input);
    expectDuration(out, 88200);
    const mid = out.subarray(Math.floor(out.length / 2), Math.floor(out.length / 2) + Math.min(SR, out.length));
    const f = zeroCrossingsPerSec(mid);
    expect(f).toBeGreaterThan(380);
    expect(f).toBeLessThan(500);
  });

  it("speed 0.5 doubles duration and preserves pitch", () => {
    const input = sine(440, 88200); // 2s
    const out = run(0.5, input);
    expectDuration(out, 176400);
    const mid = out.subarray(Math.floor(out.length / 2), Math.floor(out.length / 2) + Math.min(SR, out.length));
    const f = zeroCrossingsPerSec(mid);
    expect(f).toBeGreaterThan(760);
    expect(f).toBeLessThan(1010);
  });

  it("outputs silence instead of failing on underrun", () => {
    const w = new Wsola(1.0);
    const out = w.pull(128);
    expect(out.length).toBe(128);
    for (const v of out) expect(v).toBe(0);
  });
});
