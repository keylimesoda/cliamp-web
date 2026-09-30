/**
 * Radio preferences — pinned countries/regions and station favorites,
 * persisted to localStorage (web equivalent of radio_countries.toml and
 * radio_favorites.toml). Pins order the country browse; favorites mark
 * stations the driver returns to.
 */
import { create } from "zustand";

const PINS_KEY = "cliamp-web:radio-pins";
const FAVS_KEY = "cliamp-web:radio-favs";

function readList(key: string): string[] {
  try {
    const s = localStorage.getItem(key);
    return s ? (JSON.parse(s) as string[]) : [];
  } catch {
    return [];
  }
}
function writeList(key: string, v: string[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    // non-fatal
  }
}

interface RadioPrefs {
  pinned: string[]; // country codes (ISO alpha-2) or "CC/State" region ids
  favorites: string[]; // station URLs
  isPinned: (id: string) => boolean;
  isFavorite: (url: string) => boolean;
  togglePin: (id: string) => void;
  toggleFavorite: (url: string) => void;
}

export const useRadioPrefs = create<RadioPrefs>()((set, get) => ({
  pinned: readList(PINS_KEY),
  favorites: readList(FAVS_KEY),

  isPinned: (id) => get().pinned.includes(id),
  isFavorite: (url) => get().favorites.includes(url),

  togglePin(id) {
    const cur = get().pinned;
    const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
    writeList(PINS_KEY, next);
    set({ pinned: next });
  },
  toggleFavorite(url) {
    const cur = get().favorites;
    const next = cur.includes(url) ? cur.filter((x) => x !== url) : [...cur, url];
    writeList(FAVS_KEY, next);
    set({ favorites: next });
  },
}));
