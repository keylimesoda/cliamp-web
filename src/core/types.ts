/**
 * Core domain types. Track identity is `path`: a playable URL for
 * stream providers or a synthetic id (provider://kind/id) for
 * provider-tracked sources that resolve at play time.
 */
export interface Track {
  /** Identity: playable URL or synthetic provider id. */
  path: string;
  title: string;
  artist?: string;
  album?: string;
  genre?: string;
  year?: number;
  trackNumber?: number;
  /** 0 or undefined when unknown (live streams). */
  durationSecs?: number;
  /** Live stream (no seeking, no end). */
  stream?: boolean;
  /** Live broadcast with no track boundary (radio). */
  live?: boolean;
  artUrl?: string;
  /** ICY/stream-title override for display. */
  streamTitle?: string;
  /** Radio station name. */
  station?: string;
  /** Podcast feed URL. */
  feed?: string;
  /** Podcast episode identity (feed GUID, fallback enclosure URL). */
  guid?: string;
  /** Provider id that owns this track. */
  provider?: string;
  providerMeta?: Record<string, unknown>;
  /** Local playlist bookmark (star). */
  bookmark?: boolean;
  /** Cross-playlist favorite (heart). */
  favorite?: boolean;
}

export type RepeatMode = "off" | "all" | "one";
export type ShuffleMode = "off" | "on";

export interface ProviderCapabilities {
  browse?: boolean;
  search?: boolean;
  playlists?: boolean;
}

export interface Provider {
  id: string;
  name: string;
  /** One-line description shown in the source picker. */
  description?: string;
  capabilities: ProviderCapabilities;
  /** Resolve the playable source for a track (may refresh signed URLs). */
  resolveSource(track: Track): Promise<ResolvedSource>;
  /** Optional browsing/search UI hooks; see providers/<id>. */
}

export interface ResolvedSource {
  /** URL the audio element should play. */
  url: string;
  /** True when the source is seekable (finite content). */
  seekable?: boolean;
  /** Extra request headers (same-origin only; cross-origin ignored). */
  headers?: Record<string, string>;
  /** Play on a standalone media element, bypassing Web Audio/CORS processing. */
  direct?: boolean;
}

export type PlaybackState = "stopped" | "playing" | "paused" | "buffering" | "seeking";

/** Events dispatched by the engine, consumed by plugins and UI. */
export interface PlayerEvents {
  onTrackChange: (t: (track: Track) => void) => void;
  onPlaybackState: (t: (state: PlaybackState) => void) => void;
  onPosition: (t: (position: number, duration: number) => void) => void;
  onStreamTitle: (t: (title: string) => void) => void;
}
