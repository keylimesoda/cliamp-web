/**
 * Lua 5.1 lexer (tokenizer). Produces tokens for the tree-walk interpreter in
 * vm.ts. Supports the full 5.1 grammar: numbers (int/float/hex), strings
 * (single/double/long [[...]] and escapes), all operators, and keywords.
 */

export type Tok =
  | { kind: "num"; value: number }
  | { kind: "str"; value: string }
  | { kind: "name"; value: string }
  | { kind: "op"; value: string }
  | { kind: "eof" };

export const KEYWORDS = new Set([
  "and", "break", "do", "else", "elseif", "end", "false", "for", "function",
  "goto", "if", "in", "local", "nil", "not", "or", "repeat", "return",
  "then", "true", "while",
]);

const OPS = ["...", "..", "<=", ">=", "~=", "==", "+", "-", "*", "/", "%", "^", "#", "<", ">", "=", "(", ")", "{", "}", "[", "]", ";", ",", ":", "."];

export class LexError extends Error {
  constructor(msg: string, public line: number) { super(msg); }
}

function matchLongBracket(src: string, i: number): { close: string; contentStart: number } | null {
  if (src[i] !== "[") return null;
  let j = i + 1;
  let eqs = 0;
  while (src[j] === "=") { eqs++; j++; }
  if (src[j] !== "[") return null;
  const bar = "=".repeat(eqs);
  return { close: "]" + bar + "]", contentStart: j + 1 };
}

function findClose(src: string, from: number, close: string): number {
  let j = from;
  while (j < src.length && !src.startsWith(close, j)) j++;
  return j;
}

function readNumber(src: string, i: number): { value: number; next: number } {
  let j = i;
  if (src[i] === "0" && (src[i + 1] === "x" || src[i + 1] === "X")) {
    j = i + 2;
    while (j < src.length && /[0-9a-fA-F]/.test(src[j])) j++;
    let fracStart = -1;
    let fracEnd = -1;
    if (src[j] === ".") {
      fracStart = j + 1;
      j++;
      while (j < src.length && /[0-9a-fA-F]/.test(src[j])) j++;
      fracEnd = j;
    }
    let exp = 0;
    if (src[j] === "p" || src[j] === "P") {
      let k = j + 1;
      if (src[k] === "+" || src[k] === "-") k++;
      const expStart = k;
      while (k < src.length && /[0-9]/.test(src[k])) k++;
      exp = parseInt(src.slice(expStart, k), 10) || 0;
      j = k;
    }
    let intHex = src.slice(i + 2, fracStart === -1 ? j : src.indexOf(".", i + 2));
    let fracHex = fracStart === -1 ? "" : src.slice(fracStart, fracEnd);
    const v = parseInt(intHex + fracHex, 16) / Math.pow(16, fracHex.length) * Math.pow(2, exp);
    return { value: v, next: j };
  }
  while (j < src.length && /[0-9]/.test(src[j])) j++;
  if (src[j] === ".") { j++; while (j < src.length && /[0-9]/.test(src[j])) j++; }
  if (src[j] === "e" || src[j] === "E") { j++; if (src[j] === "+" || src[j] === "-") j++; while (j < src.length && /[0-9]/.test(src[j])) j++; }
  return { value: parseFloat(src.slice(i, j)), next: j };
}

function readString(src: string, i: number, quote: string): { value: string; next: number } {
  let j = i + 1;
  let out = "";
  while (j < src.length && src[j] !== quote) {
    if (src[j] === "\\") {
      const e = src[j + 1];
      switch (e) {
        case "n": out += "\n"; break;
        case "t": out += "\t"; break;
        case "r": out += "\r"; break;
        case "a": out += "\x07"; break;
        case "b": out += "\b"; break;
        case "f": out += "\f"; break;
        case "v": out += "\v"; break;
        case "\\": out += "\\"; break;
        case "'": out += "'"; break;
        case '"': out += '"'; break;
        case "\n": out += "\n"; break;
        case "x":
          out += String.fromCharCode(parseInt(src.slice(j + 2, j + 4), 16));
          j += 2;
          break;
        case "d": {
          let d = 0, k = j + 1;
          while (k < src.length && /[0-9]/.test(src[k]) && d < 3) { d++; k++; }
          out += String.fromCharCode(parseInt(src.slice(j + 1, j + 1 + d), 10));
          j += d;
          break;
        }
        default: out += e;
      }
      j += 2;
      continue;
    }
    out += src[j];
    j++;
  }
  return { value: out, next: j + 1 };
}

export function lex(src: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  let line = 1;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === "\n") { line++; i++; continue; }
    if (c === " " || c === "\t" || c === "\r") { i++; continue; }
    if (src.startsWith("--", i)) {
      if (src.startsWith("--[", i)) {
        const m = matchLongBracket(src, i + 2);
        if (m) {
          const end = findClose(src, m.contentStart, m.close);
          line += (src.slice(i, end).match(/\n/g) || []).length;
          i = end + m.close.length;
          continue;
        }
      }
      let j = i + 2;
      while (j < n && src[j] !== "\n") j++;
      i = j;
      continue;
    }
    if (c === "[") {
      const m = matchLongBracket(src, i);
      if (m) {
        const end = findClose(src, m.contentStart, m.close);
        const value = src.slice(m.contentStart, end);
        toks.push({ kind: "str", value });
        line += (value.match(/\n/g) || []).length;
        i = end + m.close.length;
        continue;
      }
    }
    if (c === '"' || c === "'") {
      const r = readString(src, i, c);
      toks.push({ kind: "str", value: r.value });
      line += (r.value.match(/\n/g) || []).length;
      i = r.next;
      continue;
    }
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(src[i + 1] ?? ""))) {
      const r = readNumber(src, i);
      toks.push({ kind: "num", value: r.value });
      i = r.next;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < n && /[A-Za-z0-9_]/.test(src[j])) j++;
      toks.push({ kind: "name", value: src.slice(i, j) });
      i = j;
      continue;
    }
    let matched = false;
    for (const op of OPS) {
      if (src.startsWith(op, i)) {
        toks.push({ kind: "op", value: op });
        i += op.length;
        matched = true;
        break;
      }
    }
    if (matched) continue;
    throw new LexError(`unexpected character '${c}'`, line);
  }
  toks.push({ kind: "eof" });
  return toks;
}
