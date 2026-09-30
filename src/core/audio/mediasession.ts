/**
 * MediaSession integration — the web equivalent of cliamp's MPRIS
 * (IPC recon: docs/recon/ipc.md). Surfaces title/artist/artwork to the
 * car head-unit lock screen and maps hardware/browser media controls
 * (play, pause, next, previous, seek ±10s) onto the store.
 */
import type { PlaybackState, Track } from "../types";

export interface MediaSessionHandlers {
  play: () => void;
  pause: () => void;
  next: () => void;
  prev: () => void;
  /** Optional for finite sources; omit for live streams. */
  seekForward?: () => void;
  seekBackward?: () => void;
  seekTo?: (time: number) => void;
}

/**
 * Update metadata + action handlers. Cheap enough to call on every
 * track/state change. No-op when the API is unavailable.
 */
export function updateMediaSession(track: Track | null, state: PlaybackState, h: MediaSessionHandlers): void {
  if (!("mediaSession" in navigator)) return;
  const ms = navigator.mediaSession;
  try {
    if (track) {
      ms.metadata = new MediaMetadata({
        title: track.streamTitle ?? track.title,
        artist: track.artist ?? track.station ?? "",
        album: track.album ?? "",
        artwork: track.artUrl ? [{ src: track.artUrl, sizes: "512x512", type: "image/png" }] : [],
      });
    }
    ms.playbackState = state === "playing" ? "playing" : state === "paused" ? "paused" : "none";
    ms.setActionHandler("play", h.play);
    ms.setActionHandler("pause", h.pause);
    ms.setActionHandler("nexttrack", h.next);
    ms.setActionHandler("previoustrack", h.prev);
    if (h.seekForward) ms.setActionHandler("seekforward", h.seekForward);
    if (h.seekBackward) ms.setActionHandler("seekbackward", h.seekBackward);
    if (h.seekTo) {
      ms.setActionHandler("seekto", (d) => {
        if (d.seekTime !== undefined) h.seekTo!(d.seekTime);
      });
    }
  } catch {
    // MediaSession can throw on malformed metadata in some engines.
  }
}

export function clearMediaSession(): void {
  if (!("mediaSession" in navigator)) return;
  try {
    navigator.mediaSession.metadata = null;
    navigator.mediaSession.playbackState = "none";
  } catch {
    // ignore
  }
}
