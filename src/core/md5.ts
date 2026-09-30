/**
 * Compact MD5 (hex) — used only for Subsonic query-token auth
 * (t = hex(MD5(password + salt))). Not for any security purpose.
 * Self-contained; no dependencies.
 */
const P: number[] = [];
for (let i = 0; i < 64; i++) {
  P[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296);
}

// Per-round left-rotation amounts (round, k%4) -> shift
const SHIFT: number[][] = [
  [7, 12, 17, 22],
  [5, 9, 14, 20],
  [4, 11, 16, 23],
  [6, 10, 15, 21],
];
// Per-round index order g(k)
const G = (k: number): number => {
  if (k < 16) return k;
  if (k < 32) return (5 * k + 1) % 16;
  if (k < 48) return (3 * k + 5) % 16;
  return (7 * k) % 16;
};

function rotl(x: number, c: number): number {
  return (x << c) | (x >>> (32 - c));
}

function md5words(input: Uint8Array): number[] {
  const len = input.length;
  const bitLen = len * 8;
  const paddedLen = (((len + 8) >> 6) + 1) << 6;
  const msg = new Uint8Array(paddedLen);
  msg.set(input);
  msg[len] = 0x80;
  const dv = new DataView(msg.buffer);
  dv.setUint32(paddedLen - 8, bitLen % 0x100000000, true);
  dv.setUint32(paddedLen - 4, Math.floor(bitLen / 0x100000000), true);

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;

  const M = new Int32Array(16);
  for (let i = 0; i < paddedLen; i += 64) {
    for (let j = 0; j < 16; j++) M[j] = dv.getInt32(i + j * 4, true);
    let A = a0, B = b0, C = c0, D = d0;
    for (let k = 0; k < 64; k++) {
      const round = Math.floor(k / 16);
      let F: number;
      if (round === 0) F = (B & C) | (~B & D);
      else if (round === 1) F = (D & B) | (~D & C);
      else if (round === 2) F = B ^ C ^ D;
      else F = C ^ (B | ~D);
      F = (F + A + P[k] + M[G(k)]) | 0;
      A = D;
      D = C;
      C = B;
      B = (B + rotl(F, SHIFT[round][k % 4])) | 0;
    }
    a0 = (a0 + A) | 0;
    b0 = (b0 + B) | 0;
    c0 = (c0 + C) | 0;
    d0 = (d0 + D) | 0;
  }
  return [a0, b0, c0, d0];
}

export function md5Hex(str: string): string {
  const bytes = new TextEncoder().encode(str);
  return md5words(bytes)
    .map((w) => {
      const u = w >>> 0;
      return [
        (u & 0xff).toString(16).padStart(2, "0"),
        ((u >> 8) & 0xff).toString(16).padStart(2, "0"),
        ((u >> 16) & 0xff).toString(16).padStart(2, "0"),
        ((u >> 24) & 0xff).toString(16).padStart(2, "0"),
      ].join("");
    })
    .join("");
}
