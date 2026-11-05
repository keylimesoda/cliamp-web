/** Browser adaptation of cliamp v2.4.0 ui/vis_yinyang.go (MIT, Bjarne Øverli).
 * The canvas uses the port's Braille grid in place of terminal sextants.
 */
import type { Visualizer, VizData } from "../types";
import { Pixels } from "../pixels";

const TAU = Math.PI * 2;
const RADII = [2.5, 2.9, 2.9, 2.7, 2.4, 2.05, 1.75, 1.45, 1.2, 1, 0.85, 0.7, 0.6];
const PATTERNS = [[0, 4, 4, 0, 4, 4, 0, 0, 4, 4, 0, 4, 0], [0, 3, 3, 0, 0, 3, 3, 3, 0, 0, 0, 0, 0]];
interface Point { x: number; y: number; }
interface Koi { joints: Point[]; phase: number; flick: number; rest: number; power: number; direction: number; }
class Onset {
  mean = 0.03; dev = 0.02; since = 100;
  constructor(readonly from: number, readonly to: number, readonly k: number, readonly floor: number, readonly gap: number) {}
  step(bands: Float32Array, prev: number[]): number {
    let flux = 0;
    for (let i = Math.floor(this.from * bands.length); i < Math.floor(this.to * bands.length); i++) flux += Math.max(0, bands[i] - (prev[i] ?? 0));
    const threshold = Math.max(this.mean + this.k * this.dev, this.floor);
    const hit = flux > threshold && this.since >= this.gap;
    this.mean = this.mean * 0.92 + flux * 0.08;
    this.dev = this.dev * 0.92 + Math.abs(flux - this.mean) * 0.08;
    this.since = hit ? 0 : this.since + 1;
    return hit ? flux / threshold : 0;
  }
}

export function makeYinYang(): Visualizer {
  let cols = 0, rows = 0, width = 0, height = 0, strip = false;
  let size = 1, radius = 1, pad = 0, lap = 1, waves = 1;
  let angle = 0, pending = 0, loud = 0.3, mood = 0.3, bloom = 0.4, breath = 0;
  let prev: number[] = [], lo: number[] = [], hi: number[] = [], bassHistory: number[] = [];
  let kick = new Onset(0, 0.3, 2, 0.05, 6), snare = new Onset(0.3, 0.6, 2, 0.04, 5), hat = new Onset(0.6, 1, 1.8, 0.025, 4);
  let fish: Koi[] = [];
  let swirls: { x: number; y: number; angle: number; spin: number; life: number }[] = [];
  const toAngle = (distance: number) => distance * size * TAU / lap;
  const point = (a: number): Point => strip
    ? { x: a / TAU * lap + width * 0.6, y: height / 2 + Math.cos(a * waves) * radius }
    : { x: width / 2 + Math.cos(a) * radius, y: height / 2 + Math.sin(a) * radius };
  const offset = (i: number) => strip ? (i === 0 ? -toAngle(36) : 0) : i * Math.PI;

  const init = (c: number, r: number) => {
    cols = c; rows = r; width = c * 2; height = r * 4; strip = width > height * 3;
    angle = pending = breath = 0; loud = mood = 0.3; bloom = 0.4;
    prev = []; lo = []; hi = []; bassHistory = []; swirls = [];
    kick = new Onset(0, 0.3, 2, 0.05, 6); snare = new Onset(0.3, 0.6, 2, 0.04, 5); hat = new Onset(0.6, 1, 1.8, 0.025, 4);
    if (strip) {
      size = Math.max(0.01, Math.min(height * 0.84 / 12.6, width / 80));
      radius = Math.min(height * 0.3, size * 4.5);
      lap = Math.max(1, Math.round(width + 21.6 * size));
      waves = Math.max(1, Math.round(lap / (55 * size))); pad = 0;
    } else {
      const m = Math.min(width, height, 160);
      radius = m * 0.36; lap = Math.max(1, TAU * radius); pad = m * 0.17;
      size = Math.max(0.01, Math.min(m * 0.34 * 1.35 / 18, (width / 2 - radius) / 6.3, (height / 2 - radius) / 6.3));
    }
    fish = [0, 1].map((i) => ({ joints: RADII.map((_, j) => point(offset(i) - toAngle(j * 1.5))), phase: i * 1.5, flick: 0, rest: 0, power: 0, direction: 1 }));
  };

  const step = (data: VizData) => {
    const bands = data.bands;
    if (lo.length !== bands.length) { lo = Array(bands.length).fill(1); hi = Array(bands.length).fill(0); }
    let energy = 0, avg = 0;
    for (let i = 0; i < bands.length; i++) {
      energy += bands[i]; hi[i] = Math.max(bands[i], hi[i] - 0.004); lo[i] = Math.min(bands[i], lo[i] + 0.004);
      avg += Math.min(1, Math.max(0, (bands[i] - lo[i]) / Math.max(hi[i] - lo[i], 0.12)));
    }
    energy /= Math.max(1, bands.length); avg /= Math.max(1, bands.length);
    const quiet = !data.playing || energy < 0.02;
    if (data.playing) {
      loud += (avg - loud) * 0.05; mood += (avg - mood) * 0.01;
      bloom += ((quiet ? 0 : Math.min(1, Math.max(0, (mood - 0.1) / 0.5))) - bloom) * 0.02;
    }
    const hits = prev.length ? [strip ? kick.step(bands, prev) : snare.step(bands, prev), hat.step(bands, prev)] : [0, 0];
    prev = Array.from(bands);
    breath *= 0.8;
    if (data.playing && bands.length) {
      const low = Math.max(1, Math.floor(bands.length / 5));
      const level = bands.slice(0, low).reduce((sum, b) => sum + b, 0) / low;
      bassHistory.push(level); if (bassHistory.length > 40) bassHistory.shift();
      if (!quiet && !strip) breath = (level - Math.min(...bassHistory)) / Math.max(0.08, Math.max(...bassHistory) - Math.min(...bassHistory));
    }
    if (data.playing) {
      let pace = quiet ? 0.066 : strip ? 0.11 + 0.22 * loud : 0.09 + 0.13 * mood;
      if (strip) pace = Math.max(pace * 2.5, (quiet ? 0.7 : 1 + loud) / size);
      angle += toAngle(pace);
    }
    fish.forEach((k, i) => {
      if (!quiet && hits[i] >= 1.5 && k.rest === 0) {
        if (!k.flick) { k.power = Math.min(1.4, 0.6 + 0.3 * hits[i]); k.direction *= -1; }
        k.flick = Math.max(k.flick, 8 - k.flick); k.rest = 20;
      }
      k.rest = Math.max(0, k.rest - 1);
      if (data.playing) {
        k.phase += quiet ? 0.09 : 0.125 + 0.085 * mood;
        k.joints[0] = point(angle + offset(i));
        for (let j = 1; j < k.joints.length; j++) {
          const a = k.joints[j - 1], b = k.joints[j], distance = Math.hypot(b.x - a.x, b.y - a.y) || 1;
          k.joints[j] = { x: a.x + (b.x - a.x) / distance * size * 1.5, y: a.y + (b.y - a.y) / distance * size * 1.5 };
        }
      }
      if (k.flick === 8 && !strip) swirls.push({ ...k.joints[12], angle: k.phase, spin: k.direction, life: 12 });
      k.flick = Math.max(0, k.flick - 1);
    });
    swirls = swirls.filter((s) => --s.life > 0);
  };

  return {
    name: "YinYang", init,
    tick(dt, data) {
      if (cols !== data.cols || rows !== data.rows) init(data.cols, data.rows);
      pending += Math.min(dt, 0.2);
      while (pending >= 0.05) { step(data); pending -= 0.05; }
    },
    render(data) {
      if (cols !== data.cols || rows !== data.rows) init(data.cols, data.rows);
      const p = new Pixels(cols, rows);
      const fill = (x: number, y: number, r: number, tag: number) => {
        if (strip) {
          x = ((x % lap) + lap) % lap;
          // Drawing both copies keeps a fish whole when it wraps.
          p.fill(x - lap, y, r, tag); p.fill(x + lap, y, r, tag);
        }
        p.fill(x, y, r, tag);
      };
      for (const s of swirls) for (let i = 0; i < 14; i++) {
        const t = i / 14, open = (12 - s.life) / 12, r = (1 + 2.5 * open) * size * (0.4 + 0.6 * t);
        if (t < 1 - open * 0.6) p.set(s.x + Math.cos(s.angle + t * 4.5 * s.spin) * r, s.y + Math.sin(s.angle + t * 4.5 * s.spin) * r, 1);
      }
      fish.forEach((k, i) => {
        const body = i === 0 ? 3 : 4;
        const joints = k.joints.map((pt, j) => {
          const f = Math.max(0, (j - 3) / 9);
          const off = (Math.sin(k.phase - f * 2.5) * f * f * (0.3 + mood) * 1.8
            + Math.sin(Math.PI * k.flick / 8) ** 2 * k.power * k.direction * f * 0.9) * size;
          const a = k.joints[Math.max(0, j - 1)], angle = Math.atan2(pt.y - a.y, pt.x - a.x);
          return { x: pt.x - Math.sin(angle) * off, y: pt.y + Math.cos(angle) * off };
        });
        const head = Math.atan2(joints[0].y - joints[2].y, joints[0].x - joints[2].x);
        for (const side of [-1, 1]) for (let t = 0; t < 3; t++) {
          const a = head + Math.PI + side * (1.25 + Math.sin(k.phase * 0.5) * 0.25);
          const off = (RADII[2] + 0.6 + t) * size;
          fill(joints[2].x + Math.cos(a) * off, joints[2].y + Math.sin(a) * off, (1.5 - t * 0.35) * size, body);
        }
        const tail = Math.atan2(joints[12].y - joints[11].y, joints[12].x - joints[11].x) + Math.sin(k.phase - 2) * 0.5;
        fill(joints[12].x + Math.cos(tail) * 1.2 * size, joints[12].y + Math.sin(tail) * 1.2 * size, 0.75 * size, body);
        for (let j = 12; j >= 0; j--) {
          fill(joints[j].x, joints[j].y, RADII[j] * size, body);
          if (j > 0) fill((joints[j].x + joints[j - 1].x) / 2, (joints[j].y + joints[j - 1].y) / 2, (RADII[j] + RADII[j - 1]) / 2 * size, body);
        }
        for (let j = 12; j >= 0; j--) if (PATTERNS[i][j]) fill(joints[j].x, joints[j].y, RADII[j] * size * 0.62, PATTERNS[i][j]);
      });
      p.disc(width / 2, height / 2, pad, (dx, dy) => {
        const ahead = dx * Math.cos(0.9) + dy * Math.sin(0.9), aside = dx * Math.sin(0.9) - dy * Math.cos(0.9);
        return ahead > 0 && Math.abs(aside) < Math.tan(0.28) * ahead && dx * dx + dy * dy > 0.04 ? -1 : 2;
      });
      for (const [length, turn, tag] of [[pad * (0.5 + 0.12 * bloom + 0.2 * breath), 0, 4], [pad * (0.3 + 0.08 * bloom + 0.08 * breath), Math.PI / 6, 3]]) {
        p.disc(width / 2, height / 2, length, (dx, dy) => {
          let a = Math.atan2(dy, dx) - turn; a -= Math.round(a / (TAU / 6)) * TAU / 6;
          const r = Math.hypot(dx, dy), along = r * Math.cos(a), across = r * Math.sin(a);
          return along > 0 && along < 1 && Math.abs(across) <= 0.36 * Math.sin(Math.PI * along ** 0.8) ** 0.6 ? tag : -1;
        });
      }
      p.fill(width / 2, height / 2, pad * 0.12, 5);
      return p.frame(["", "dim", "low", "high", "text", "mid"]);
    },
  };
}
