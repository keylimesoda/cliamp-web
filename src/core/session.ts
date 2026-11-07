import { isPlaylistState, type PlaylistState } from "./playlist";
import { isTrack, type Track } from "./types";

export interface PlaybackSession {
  version: 1;
  playlist: PlaylistState;
  track: Track | null;
  position: number;
  duration: number;
  at: number;
}

export function readPlaybackSession(value: unknown): PlaybackSession | null {
  if (!value || typeof value !== "object") return null;
  const s = value as PlaybackSession;
  if (s.version !== 1 || !isPlaylistState(s.playlist) || (s.track !== null && !isTrack(s.track))) return null;
  if (![s.position, s.duration, s.at].every((n) => typeof n === "number" && Number.isFinite(n) && n >= 0)) return null;
  return {
    ...s,
    position: !s.track || s.track.live || s.track.stream ? 0 : s.duration > 0 ? Math.min(s.position, s.duration) : s.position,
  };
}
