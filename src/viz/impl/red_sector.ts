/**
 * RedSector — tumbling wireframe equalizer over a starfield (port of
 * /tmp/cliamp/ui/vis_red_sector.go), after the vector part of the Red
 * Sector Inc. RSI Megademo (Amiga, 1989).
 *
 * Five hollow bars stand on a common ground line, each driven by two
 * spectrum bands, and the whole group tumbles as a rigid body while a
 * starfield drifts behind it. Hidden edges are removed with per-face
 * backface culling. A dot keeps the highest tag drawn into it, so every
 * bar sits in front of every star.
 *
 * Stateful: rotation angles, the zoom phase, the star positions, and the
 * per-bar envelope (ceiling/floor/height easing) live in the closure and
 * advance in tick. The original ticks at 20 FPS while playing and 5 FPS
 * when idle (ui/tick.go); per-frame steps scale with dt.
 *
 * Multi-color: stars wear the quiet keys (dim, brightest tier white), the
 * bars the spectrum (low/mid, tallest bars red).
 */
import type { Visualizer, VizData, VizFrame } from "../types";

const RED_SECTOR_BARS = 5;
const RED_SECTOR_HALF_WIDTH = 0.26;
const RED_SECTOR_HALF_DEPTH = 0.26;
// Centre-to-centre distance between neighbouring bars.
const RED_SECTOR_PITCH = 0.78;
// The common base line all bars stand on.
const RED_SECTOR_GROUND_Y = -1.05;
const RED_SECTOR_MIN_HEIGHT = 0.4;
const RED_SECTOR_MAX_HEIGHT = 2.3;
const RED_SECTOR_FOCAL = 3.2;
const RED_SECTOR_CAMERA_Z = 6.0;
// How far the object drifts towards the viewer and back.
const RED_SECTOR_ZOOM_AMPLITUDE = 1.5;
// How far the picture may be widened past its own height.
const RED_SECTOR_MAX_STRETCH = 2.0;
// Dot rows at which no widening is needed any more.
const RED_SECTOR_COMFORT_DOT_ROWS = 40;

// Rotation in radians per frame. The demo tumbles the object around two
// axes at unrelated rates, so it never repeats a pose for long.
const RED_SECTOR_SPIN_Y = 0.105;
const RED_SECTOR_SPIN_X = 0.073;
const RED_SECTOR_ZOOM_RATE = 0.011;

// Per frame, how fast a band's ceiling and floor close in on each other.
const RED_SECTOR_ENVELOPE_RELAX = 0.001;
// The narrowest span that still counts as movement.
const RED_SECTOR_MIN_ENVELOPE = 0.06;

// How many dot cells one star covers, and the bounds the count is held in.
const RED_SECTOR_DOTS_PER_STAR = 130;
const RED_SECTOR_MIN_STARS = 6;
const RED_SECTOR_MAX_STARS = 90;

// A single edge must not become an unbounded loop under a degenerate
// projection.
const RED_SECTOR_MAX_LINE_STEPS = 512;

// The eight corners of a bar, as signs on its base centre. Height is filled
// in per frame, so only the signs live here.
const CORNER_X = [-1, 1, 1, -1, -1, 1, 1, -1] as const;
const CORNER_Z = [-1, -1, -1, -1, 1, 1, 1, 1] as const;
const CORNER_TOP = [false, false, true, true, false, false, true, true] as const;

// Faces wound so the cross product of the first two edges points inwards.
// A face is visible when that normal points away from the viewer.
const FACES = [
  [0, 1, 2, 3], // front
  [5, 4, 7, 6], // back
  [0, 3, 7, 4], // left
  [1, 5, 6, 2], // right
  [3, 2, 6, 7], // top
  [0, 4, 5, 1], // bottom
] as const;

// Cell tags, low to high. The four star tags sit below the three bar tags,
// so a bar always wins the cell it shares with a star.
const TAG_KEYS = ["dim", "dim", "dim", "white", "low", "mid", "red"] as const;

const BRAILLE_BITS = [0x01, 0x08, 0x02, 0x10, 0x04, 0x20, 0x40, 0x80] as const; // [dr*2+dc]

// Deterministic pseudo-random value in [0, 1) for star index i, one slot
// per coordinate. The index is mixed (avalanche finaliser) rather than
// scaled, which would put every star on a diagonal.
function starHash(i: number, slot: number): number {
  let x = (Math.imul(i, 0x9e3779b1) + Math.imul(slot + 1, 0x85ebca77) + 0x9e3779b9) | 0;
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b3) | 0;
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b3) | 0;
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

// Rotate a model point around Y then X and project it; returns the rotated
// point plus its projected position in world units, before panel scaling.
function place(
  x: number, y: number, z: number,
  cosX: number, sinX: number, cosY: number, sinY: number, camZ: number,
): [number, number, number, number, number] {
  const x1 = x * cosY + z * sinY;
  const z1 = -x * sinY + z * cosY;
  const y1 = y * cosX - z1 * sinX;
  const z2 = y * sinX + z1 * cosX;
  const depth = Math.max(0.35, z2 + camZ);
  const f = RED_SECTOR_FOCAL / depth;
  return [x1, y1, z2, x1 * f, y1 * f];
}

// Whether a face is turned towards the viewer. The faces are wound so the
// cross product of the first two edges points into the bar, which makes a
// face visible exactly when that normal points away from the camera.
function faceVisible(
  p1: [number, number, number],
  p2: [number, number, number],
  p3: [number, number, number],
  camZ: number,
): boolean {
  const ux = p2[0] - p1[0];
  const uy = p2[1] - p1[1];
  const uz = p2[2] - p1[2];
  const vx = p3[0] - p2[0];
  const vy = p3[1] - p2[1];
  const vz = p3[2] - p2[2];
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  // The view vector runs from the camera to the first corner of the face.
  return nx * p1[0] + ny * p1[1] + nz * (p1[2] + camZ) > 0;
}

// Read a bar's colour off its height, using cliamp's own spectrum thresholds.
function barTag(height: number): number {
  const shown = (height - RED_SECTOR_MIN_HEIGHT) / (RED_SECTOR_MAX_HEIGHT - RED_SECTOR_MIN_HEIGHT);
  if (shown >= 0.6) return 7;
  if (shown >= 0.3) return 6;
  return 5;
}

export function makeRedSector(): Visualizer {
  let angY = 0;
  let angX = 0;
  let zoomPhase = 0;

  let dotRows = 0;
  let dotCols = 0;
  let starCount = 0;
  let starX: Float32Array = new Float32Array(0);
  let starY: Int32Array = new Int32Array(0);
  let starHue: Uint8Array = new Uint8Array(0);

  const ceiling = new Float64Array(RED_SECTOR_BARS);
  const floor = new Float64Array(RED_SECTOR_BARS);
  const heights = new Float64Array(RED_SECTOR_BARS);

  let grid: Uint8Array = new Uint8Array(0);

  const resetEnvelope = () => {
    for (let i = 0; i < RED_SECTOR_BARS; i++) {
      // Start wide open, so the first frames pull both ends onto the real range.
      ceiling[i] = 0;
      floor[i] = 1;
      heights[i] = RED_SECTOR_MIN_HEIGHT;
    }
  };

  const allocate = (rows: number, cols: number) => {
    dotRows = rows * 4;
    dotCols = cols * 2;
    starCount = Math.min(RED_SECTOR_MAX_STARS, Math.max(RED_SECTOR_MIN_STARS, Math.floor((dotRows * dotCols) / RED_SECTOR_DOTS_PER_STAR)));
    starX = new Float32Array(starCount);
    starY = new Int32Array(starCount);
    starHue = new Uint8Array(starCount);
    for (let i = 0; i < starCount; i++) {
      starX[i] = starHash(i, 0) * dotCols;
      starY[i] = Math.floor(starHash(i, 1) * dotRows);
      // Colour is drawn once per star index, so a star keeps its hue while it
      // drifts instead of flickering from frame to frame.
      starHue[i] = Math.min(4, 1 + Math.floor(starHash(i, 2) * 4));
    }
    grid = new Uint8Array(dotRows * dotCols);
    resetEnvelope();
  };

  return {
    name: "RedSector",
    init(cols: number, rows: number) {
      angY = 0;
      angX = 0;
      zoomPhase = 0;
      allocate(rows, cols);
    },
    tick(dt: number, data: VizData) {
      // Per-frame step at the original cadence (20 FPS playing, 5 FPS idle),
      // clamped the way the original bounds catch-up.
      const steps = Math.min(Math.min(dt, 0.4) * (data.playing ? 20 : 5), 8);
      angY += RED_SECTOR_SPIN_Y * steps;
      angX += RED_SECTOR_SPIN_X * steps;
      zoomPhase += RED_SECTOR_ZOOM_RATE * steps;

      for (let i = 0; i < starCount; i++) {
        // Three speed lanes give the field a shallow sense of depth.
        const speed = 0.1 + (i % 3) * 0.09;
        starX[i] -= speed * steps;
        starX[i] = ((starX[i] % dotCols) + dotCols) % dotCols;
      }

      const bands = data.bands;
      const relax = RED_SECTOR_ENVELOPE_RELAX * steps;
      for (let i = 0; i < RED_SECTOR_BARS; i++) {
        // Two bands per bar, taking the louder of the pair.
        const a = i * 2 < bands.length ? Math.min(1, Math.max(0, bands[i * 2])) : 0;
        const b = i * 2 + 1 < bands.length ? Math.min(1, Math.max(0, bands[i * 2 + 1])) : 0;
        const level = Math.max(a, b);

        if (level > ceiling[i]) {
          ceiling[i] = level;
        } else {
          ceiling[i] -= relax;
        }
        if (level < floor[i]) {
          floor[i] = level;
        } else {
          floor[i] += relax;
        }
        if (ceiling[i] < floor[i] + RED_SECTOR_MIN_ENVELOPE) {
          ceiling[i] = floor[i] + RED_SECTOR_MIN_ENVELOPE;
        }

        const norm = Math.min(1, Math.max(0, (level - floor[i]) / (ceiling[i] - floor[i])));
        const target = RED_SECTOR_MIN_HEIGHT + norm * (RED_SECTOR_MAX_HEIGHT - RED_SECTOR_MIN_HEIGHT);
        // Rising fast and falling slow keeps a transient visible long enough
        // to read as a hit rather than a flicker.
        const rate = target > heights[i] ? 0.75 : 0.28;
        heights[i] += (target - heights[i]) * (1 - Math.pow(1 - rate, steps));
      }
    },
    render(data: VizData): VizFrame {
      const rows = data.rows;
      const cols = data.cols;
      const out: string[] = [];
      const cells: string[][] = [];
      for (let r = 0; r < rows; r++) {
        out.push(" ".repeat(cols));
        cells.push(new Array<string>(cols).fill(""));
      }
      if (rows <= 0 || cols <= 0) return { rows: out, cells };
      if (dotRows < 4 || dotCols < 16) return { rows: out, cells };

      grid.fill(0);

      const setDot = (x: number, y: number, tag: number) => {
        if (x < 0 || x >= dotCols || y < 0 || y >= dotRows) return;
        const idx = y * dotCols + x;
        if (tag > grid[idx]) grid[idx] = tag;
      };

      // ── STARFIELD ──
      for (let i = 0; i < starCount; i++) {
        setDot(Math.floor(starX[i]), starY[i], starHue[i]);
      }

      // ── WIREFRAME BARS ──
      const cosY = Math.cos(angY);
      const sinY = Math.sin(angY);
      const cosX = Math.cos(angX);
      const sinX = Math.sin(angX);
      const camZ = RED_SECTOR_CAMERA_Z + Math.sin(zoomPhase) * RED_SECTOR_ZOOM_AMPLITUDE;

      // Scale the picture against a hull the object can never exceed, not
      // against the bars as they stand this frame. Fitting the live shape
      // would blow a quiet picture up to full height.
      const hullX = ((RED_SECTOR_BARS - 1) / 2) * RED_SECTOR_PITCH + RED_SECTOR_HALF_WIDTH;
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      for (const sx of [-1, 1]) {
        for (const hy of [RED_SECTOR_GROUND_Y, RED_SECTOR_GROUND_Y + RED_SECTOR_MAX_HEIGHT]) {
          for (const sz of [-1, 1]) {
            const p = place(sx * hullX, hy, sz * RED_SECTOR_HALF_DEPTH, cosX, sinX, cosY, sinY, camZ);
            if (p[3] < minX) minX = p[3];
            if (p[3] > maxX) maxX = p[3];
            if (p[4] < minY) minY = p[4];
            if (p[4] > maxY) maxY = p[4];
          }
        }
      }
      const spanX = Math.max(maxX - minX, 0.001);
      const spanY = Math.max(maxY - minY, 0.001);

      // Breathe in and out, the way the demo pulls the object towards the
      // viewer and back. The upper bound leaves a margin at full size.
      const zoom = 0.55 + 0.3 * (0.5 + 0.5 * Math.sin(zoomPhase));
      const fitY = ((dotRows - 1) / spanY) * zoom;

      // A short panel starves the object of height, so the bars are widened
      // to stay apart. Once the panel is tall enough it keeps its own shape.
      const stretch = Math.min(RED_SECTOR_MAX_STRETCH, Math.max(1, RED_SECTOR_COMFORT_DOT_ROWS / dotRows));
      const fitX = Math.min(fitY * stretch, (dotCols - 1) / spanX);

      const centreX = dotCols / 2 - ((minX + maxX) / 2) * fitX;
      const centreY = dotRows / 2 + ((minY + maxY) / 2) * fitY;

      const drawLine = (x0: number, y0: number, x1: number, y1: number, tag: number) => {
        const dx = x1 - x0;
        const dy = y1 - y0;
        const span = Math.max(Math.abs(dx), Math.abs(dy));
        if (!Number.isFinite(span)) return;
        const steps = Math.min(RED_SECTOR_MAX_LINE_STEPS, Math.floor(span) + 1);
        for (let s = 0; s <= steps; s++) {
          const tt = steps === 0 ? 0 : s / steps;
          const x = Math.floor(x0 + dx * tt + 0.5);
          const y = Math.floor(y0 + dy * tt + 0.5);
          if (x < 0 || x >= dotCols || y < 0 || y >= dotRows) continue;
          const idx = y * dotCols + x;
          if (tag > grid[idx]) grid[idx] = tag;
        }
      };

      const rx = new Float64Array(8);
      const ry = new Float64Array(8);
      const rz = new Float64Array(8);
      const px = new Float64Array(8);
      const py = new Float64Array(8);

      for (let bar = 0; bar < RED_SECTOR_BARS; bar++) {
        const baseX = (bar - (RED_SECTOR_BARS - 1) / 2) * RED_SECTOR_PITCH;
        const topY = RED_SECTOR_GROUND_Y + heights[bar];
        const tag = barTag(heights[bar]);

        for (let c = 0; c < 8; c++) {
          const y = CORNER_TOP[c] ? topY : RED_SECTOR_GROUND_Y;
          const p = place(
            baseX + CORNER_X[c] * RED_SECTOR_HALF_WIDTH, y,
            CORNER_Z[c] * RED_SECTOR_HALF_DEPTH,
            cosX, sinX, cosY, sinY, camZ,
          );
          rx[c] = p[0];
          ry[c] = p[1];
          rz[c] = p[2];
          px[c] = centreX + p[3] * fitX;
          py[c] = centreY - p[4] * fitY;
        }

        for (const face of FACES) {
          const i1 = face[0];
          const i2 = face[1];
          const i3 = face[2];
          if (!faceVisible([rx[i1], ry[i1], rz[i1]], [rx[i2], ry[i2], rz[i2]], [rx[i3], ry[i3], rz[i3]], camZ)) {
            continue;
          }
          for (let e = 0; e < 4; e++) {
            const from = face[e];
            const to = face[(e + 1) % 4];
            drawLine(px[from], py[from], px[to], py[to], tag);
          }
        }
      }

      // ── PACK BRAILLE ──
      for (let row = 0; row < rows; row++) {
        let line = "";
        const cellRow: string[] = [];
        for (let ch = 0; ch < cols; ch++) {
          let code = 0;
          let cellTag = 0;
          for (let dr = 0; dr < 4; dr++) {
            const dy = row * 4 + dr;
            if (dy >= dotRows) break;
            for (let dc = 0; dc < 2; dc++) {
              const t = grid[dy * dotCols + ch * 2 + dc];
              if (t === 0) continue;
              code |= BRAILLE_BITS[dr * 2 + dc];
              if (t > cellTag) cellTag = t;
            }
          }
          line += code !== 0 ? String.fromCharCode(0x2800 | code) : " ";
          cellRow.push(code !== 0 ? TAG_KEYS[cellTag - 1] : "");
        }
        out[row] = line.slice(0, cols).padEnd(cols, " ");
        cells[row] = cellRow.slice(0, cols);
      }
      return { rows: out, cells };
    },
  };
}
