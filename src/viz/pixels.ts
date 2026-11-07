import type { VizFrame } from "./types";

const BITS = [1, 8, 2, 16, 4, 32, 64, 128];

/** Colored 2×4 subcell grid. Tag zero is transparent. */
export class Pixels {
  readonly width: number;
  readonly height: number;
  readonly tags: Uint8Array;
  constructor(readonly cols: number, readonly rows: number) {
    this.width = cols * 2;
    this.height = rows * 4;
    this.tags = new Uint8Array(this.width * this.height);
  }
  set(x: number, y: number, tag: number): void {
    x = Math.floor(x); y = Math.floor(y);
    if (x >= 0 && y >= 0 && x < this.width && y < this.height) this.tags[y * this.width + x] = tag;
  }
  disc(cx: number, cy: number, r: number, shade: (dx: number, dy: number) => number): void {
    if (r <= 0) return;
    for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(this.height - 1, Math.ceil(cy + r)); y++) {
      for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(this.width - 1, Math.ceil(cx + r)); x++) {
        const dx = (x + 0.5 - cx) / r, dy = (y + 0.5 - cy) / r;
        if (dx * dx + dy * dy <= 1) {
          const tag = shade(dx, dy);
          if (tag >= 0) this.set(x, y, tag);
        }
      }
    }
  }
  fill(x: number, y: number, r: number, tag: number): void { this.disc(x, y, r, () => tag); }
  frame(palette: readonly string[]): VizFrame {
    const rows: string[] = [], cells: string[][] = [];
    for (let row = 0; row < this.rows; row++) {
      let text = "";
      const colors: string[] = [];
      for (let col = 0; col < this.cols; col++) {
        let mask = 0, tag = 0;
        const counts = new Uint8Array(palette.length);
        for (let y = 0; y < 4; y++) for (let x = 0; x < 2; x++) {
          const t = this.tags[(row * 4 + y) * this.width + col * 2 + x];
          if (t) { mask |= BITS[y * 2 + x]; counts[t]++; }
        }
        for (let t = 1; t < counts.length; t++) if (counts[t] > (counts[tag] ?? 0)) tag = t;
        text += mask ? String.fromCharCode(0x2800 + mask) : " ";
        colors.push(palette[tag] ?? "text");
      }
      rows.push(text); cells.push(colors);
    }
    return { rows, cells };
  }
}
