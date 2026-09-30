/**
 * 10-band parametric EQ — exact parity with cliamp's audio pipeline:
 * peaking biquads, Q = 1.4, gain clamped [-12, +12] dB.
 * Source: /tmp/cliamp/player/eq.go (see docs/recon/audio.md).
 */
export const EQ_BANDS_HZ = [70, 180, 320, 600, 1000, 3000, 6000, 12000, 14000, 16000] as const;
export const EQ_Q = 1.4;
export const EQ_MIN_DB = -12;
export const EQ_MAX_DB = 12;
/** Gains strictly inside (-0.1, 0.1) dB bypass the band filter. */
export const EQ_BYPASS_EPS = 0.1;

export type EqPresetName =
  | "Flat"
  | "Rock"
  | "Pop"
  | "Jazz"
  | "Classical"
  | "Bass Boost"
  | "Treble Boost"
  | "Vocal"
  | "Electronic"
  | "Acoustic"
  | "Hip-Hop"
  | "R&B"
  | "Loudness"
  | "Late Night"
  | "Podcast"
  | "Small Speakers"
  | "Custom";

/** Cycle order used by the preset cycler (Custom follows the last preset). */
export const EQ_PRESET_CYCLE: readonly EqPresetName[] = [
  "Flat",
  "Rock",
  "Pop",
  "Jazz",
  "Classical",
  "Bass Boost",
  "Treble Boost",
  "Vocal",
  "Electronic",
  "Acoustic",
  "Hip-Hop",
  "R&B",
  "Loudness",
  "Late Night",
  "Podcast",
  "Small Speakers",
];

/** Preset gains in band order (70 → 16k). Exact values from eq_presets.go. */
export const EQ_PRESETS: Record<string, readonly number[]> = {
  Flat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  Rock: [5, 4, 2, -1, -2, 2, 4, 5, 5, 5],
  Pop: [-1, 2, 4, 5, 4, 1, -1, -1, 1, 2],
  Jazz: [3, 4, 2, 1, -1, -1, 1, 2, 3, 4],
  Classical: [3, 2, 1, 0, -1, -1, 0, 2, 3, 4],
  "Bass Boost": [8, 6, 4, 2, 0, 0, 0, 0, 0, 0],
  "Treble Boost": [0, 0, 0, 0, 0, 1, 3, 5, 6, 7],
  Vocal: [-2, -1, 1, 4, 5, 4, 2, 0, -1, -2],
  Electronic: [6, 4, 1, -1, -2, 1, 3, 4, 5, 6],
  Acoustic: [3, 3, 2, 0, 1, 2, 3, 3, 2, 1],
  "Hip-Hop": [7, 5, 3, 1, -1, -1, 1, 3, 3, 3],
  "R&B": [4, 6, 3, 1, -1, 1, 2, 2, 1, 0],
  Loudness: [6, 4, 1, 0, -2, -1, 1, 4, 5, 5],
  "Late Night": [5, 3, 1, 0, -2, -1, 0, 2, 3, 3],
  Podcast: [-3, -1, 2, 4, 4, 3, 1, -1, -2, -3],
  "Small Speakers": [7, 5, 4, 2, 1, 0, -1, 0, 1, 2],
};

export function clampDb(db: number): number {
  if (!Number.isFinite(db)) return 0;
  return Math.min(EQ_MAX_DB, Math.max(EQ_MIN_DB, db));
}

/** Case-insensitive preset lookup; undefined when not a preset. */
export function presetGains(name: string): readonly number[] | undefined {
  const key = Object.keys(EQ_PRESETS).find((k) => k.toLowerCase() === name.toLowerCase());
  return key ? EQ_PRESETS[key] : undefined;
}

/** Next preset in cycle order; from a preset returns the following one,
 * from Custom/unknown returns Flat. */
export function nextPreset(current: string): EqPresetName {
  const i = EQ_PRESET_CYCLE.findIndex((p) => p.toLowerCase() === current.toLowerCase());
  if (i === -1) return "Flat"; // Custom or unknown wraps to first
  return EQ_PRESET_CYCLE[(i + 1) % EQ_PRESET_CYCLE.length];
}
