/**
 * Theme engine — parses the vendored theme TOMLs (each supplies the 7 base
 * colors) and applies them as CSS custom properties on :root. theme.css
 * derives every other token from these 7 via color-mix(), so a theme only
 * ever supplies raw colors.
 */

export interface ThemeColors {
  bg: string;
  accent: string;
  brightFg: string;
  fg: string;
  green: string;
  yellow: string;
  red: string;
}


// Minimal TOML parser for the flat `key = "value"` files we vendor.
function parseToml(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    // strip surrounding quotes
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

function toTheme(parsed: Record<string, string>): ThemeColors {
  const get = (k: string) => parsed[k] ?? "#000000";
  return {
    bg: get("bg"),
    accent: get("accent"),
    brightFg: get("bright_fg"),
    fg: get("fg"),
    green: get("green"),
    yellow: get("yellow"),
    red: get("red"),
  };
}

// Eagerly import every vendored .toml as raw text.
const modules = import.meta.glob("./*.toml", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

export const THEMES: Record<string, ThemeColors> = {};
export const THEME_NAMES: string[] = [];
for (const [path, raw] of Object.entries(modules)) {
  const name = path.split("/").pop()!.replace(/\.toml$/, "");
  THEMES[name] = toTheme(parseToml(raw));
  THEME_NAMES.push(name);
}
THEME_NAMES.sort();

/** Apply a theme by name; returns false if the theme is unknown. */
export function applyTheme(name: string): boolean {
  const t = THEMES[name];
  if (!t) return false;
  const root = document.documentElement.style;
  root.setProperty("--bg", t.bg);
  root.setProperty("--accent", t.accent);
  root.setProperty("--fg-bright", t.brightFg);
  root.setProperty("--fg", t.fg);
  root.setProperty("--green", t.green);
  root.setProperty("--yellow", t.yellow);
  root.setProperty("--red", t.red);
  return true;
}

export function hasTheme(name: string): boolean {
  return name in THEMES;
}
