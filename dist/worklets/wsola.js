/**
 * WSOLA time-stretch (pitch-preserving playback speed 0.25x-2.0x).
 * Plain JS on purpose: this exact file is loaded by the AudioWorklet
 * (public/worklets/ is served/copied verbatim) AND imported by vitest.
 *
 * Parity with cliamp player/speed.go (wsolaFrame):
 *   - a frame emits tsSeq=3584 samples: [crossfade 512][direct 3072]
 *   - the source window per frame is tsWin=4096; its trailing 512 (tail)
 *     is never emitted directly, only crossfaded into the next frame head
 *   - the cursor advances tsSeq * speed per frame, so output duration =
 *     input duration / speed while the verbatim direct copy preserves pitch
 *   - head offset is searched by normalized cross-correlation of the saved
 *     tail against candidate heads, +/-1024, coarse stride 8 keeping the
 *     top 8 candidates, refined at full resolution; falls back to expected
 *     when nothing correlates
 */
const SEQ = 3584;
const OVL = 512;
const WIN = SEQ + OVL; // 4096
const SEARCH = 1024;
const COARSE = 8;
const TOP = 8;

const ALPHA = new Float32Array(OVL);
for (let i = 0; i < OVL; i++) ALPHA[i] = i / OVL;

export class Wsola {
  constructor(speed = 1.0) {
    this.speed = Wsola.clamp(speed);
    this.buf = new Float32Array(0);
    this.cursor = 0; // fractional source position (like inPos)
    this.tail = null; // previous frame's trailing 512, or null before first
    this.out = []; // emitted frames (front = oldest)
    this.outLen = 0;
  }

  static clamp(s) {
    if (!Number.isFinite(s)) return 1.0;
    return Math.min(2.0, Math.max(0.25, s));
  }

  setSpeed(speed) {
    this.speed = Wsola.clamp(speed);
  }

  /** Append input samples. */
  push(samples) {
    if (samples.length === 0) return;
    const next = new Float32Array(this.buf.length + samples.length);
    next.set(this.buf);
    next.set(samples, this.buf.length);
    this.buf = next;
  }

  /** Produce up to `n` output samples (zeros while input is insufficient). */
  pull(n) {
    while (this.outLen < n && this.synthesizeOne()) {}
    const out = new Float32Array(n);
    let filled = 0;
    while (filled < n && this.out.length > 0) {
      const head = this.out[0];
      const take = Math.min(n - filled, head.length);
      out.set(head.subarray(0, take), filled);
      filled += take;
      if (take === head.length) this.out.shift();
      else this.out[0] = head.subarray(take);
    }
    this.outLen = Math.max(0, this.outLen - filled);
    return out;
  }

  /** True if another frame can be produced from buffered input. */
  canSynthesize() {
    return this.buf.length >= Math.round(this.cursor) + SEQ;
  }

  synthesizeOne() {
    const expected = Math.round(this.cursor);
    if (this.buf.length < expected + SEQ) return false;
    let srcOff = expected;
    const partial = this.buf.length < expected + WIN;
    if (this.tail !== null && !partial) {
      srcOff = this.searchBestOffset(expected);
    } else {
      const maxOff = this.buf.length - SEQ;
      if (srcOff > maxOff) srcOff = maxOff;
      if (srcOff < 0) srcOff = 0;
    }
    this.emitFrame(srcOff, partial);
    this.cursor += SEQ * this.speed;
    // Shrink once data is permanently consumed (keep SEARCH behind cursor).
    const keepFrom = Math.max(0, Math.round(this.cursor) - SEARCH);
    if (keepFrom > 0) {
      this.buf = this.buf.subarray(keepFrom);
      this.cursor -= keepFrom;
    }
    return true;
  }

  emitFrame(srcOff, partial) {
    const a = this.buf;
    let frame;
    if (this.tail === null) {
      frame = a.slice(srcOff, srcOff + SEQ);
    } else {
      frame = new Float32Array(SEQ);
      const ovl = Math.min(OVL, a.length - srcOff - (SEQ - OVL));
      for (let i = 0; i < ovl; i++) {
        const w = ALPHA[i];
        frame[i] = (1 - w) * this.tail[i] + w * a[srcOff + i];
      }
      frame.set(a.subarray(srcOff + ovl, srcOff + SEQ), ovl);
    }
    this.out.push(frame);
    this.outLen += SEQ;
    if (!partial && a.length >= srcOff + WIN) {
      this.tail = a.slice(srcOff + SEQ, srcOff + WIN);
    }
  }
  /**
   * Source offset near `expected` whose head best matches the saved tail
   * (searchBestOffset): coarse stride pass keeping top candidates, then
   * full-resolution refinement. Falls back to `expected` when nothing
   * correlates (silent or non-positive correlation).
   */
  searchBestOffset(expected) {
    const maxOff = Math.max(0, this.buf.length - WIN);
    const lo = Math.max(0, Math.min(expected - SEARCH, maxOff));
    const hi = Math.max(Math.min(maxOff, expected + SEARCH), lo);
    let bestOff = Math.min(Math.max(expected, lo), hi);
    let bestScore = this.offsetScore(bestOff, 1);

    const top = [];
    for (let off = lo; off <= hi; off++) {
      const score = this.offsetScore(off, COARSE);
      if (score <= 0) continue;
      let at = top.length;
      for (let i = 0; i < top.length; i++) {
        if (score > top[i].score || (score === top[i].score && off < top[i].off)) {
          at = i;
          break;
        }
      }
      if (at >= TOP) continue;
      if (top.length < TOP) top.push(null);
      for (let i = top.length - 1; i > at; i--) top[i] = top[i - 1];
      top[at] = { off, score };
    }

    const refine = (off) => {
      const score = this.offsetScore(off, 1);
      if (score > bestScore || (score === bestScore && score > 0 && off < bestOff)) {
        bestOff = off;
        bestScore = score;
      }
    };
    if (top.length > 0) {
      for (const c of top) {
        const rlo = Math.max(lo, c.off - COARSE + 1);
        const rhi = Math.min(hi, c.off + COARSE - 1);
        for (let off = rlo; off <= rhi; off++) refine(off);
      }
    } else {
      for (let off = lo; off <= hi; off++) refine(off);
    }
    return bestOff;
  }

  /** corr^2/norm ranking over the overlap region (offsetScore). */
  offsetScore(off, stride) {
    let corr = 0;
    let norm = 0;
    const a = this.buf;
    for (let i = 0; i < OVL; i += stride) {
      corr += this.tail[i] * a[off + i];
      norm += a[off + i] * a[off + i];
    }
    if (norm < 1e-9 || corr <= 0) return 0;
    return (corr * corr) / norm;
  }
}

if (typeof registerProcessor === "function") {
  registerProcessor("wsola", class extends AudioWorkletProcessor {
    constructor() {
      super();
      // One stretcher per channel: stereo is preserved end-to-end
      // (the EQ chain and output stay stereo, matching cliamp).
      this.stretchers = [new Wsola(1.0), new Wsola(1.0)];
      this.port.onmessage = (e) => {
        const d = e.data;
        if (!d) return;
        if (d.type === "speed") {
          for (const st of this.stretchers) st.setSpeed(d.value);
        } else if (d.type === "reset") {
          const s = this.stretchers[0].speed;
          this.stretchers = [new Wsola(s), new Wsola(s)];
        }
      };
    }
    process(inputs, outputs) {
      const input = inputs[0];
      const output = outputs[0];
      const quantum = output[0].length;
      for (let ch = 0; ch < output.length; ch++) {
        const src = input && input[ch] ? input[ch] : null;
        const st = this.stretchers[ch] ?? (this.stretchers[ch] = new Wsola(1.0));
        if (src && src.length > 0) st.push(src);
        const produced = st.pull(quantum);
        output[ch].set(produced);
      }
      return true;
    }
  });
}
