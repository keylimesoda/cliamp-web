import { useEffect, useRef, useState } from "react";
import { activeLineIndex, fetchLyrics, type LyricsResult } from "../core/lyrics";
import { usePlayerStore } from "../store/player";

/**
 * Lyrics overlay — toggled from Now Playing. Synced tracks auto-scroll and
 * highlight the active line; plain lyrics / live streams show scroll mode.
 */
export default function LyricsOverlay({ onClose }: { onClose: () => void }) {
  const track = usePlayerStore((s) => s.track);
  const position = usePlayerStore((s) => s.position);
  const [lyrics, setLyrics] = useState<LyricsResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const live = track?.stream === true || track?.live === true;
  const synced = !live && lyrics?.synced === true;

  // Fetch when the track changes (or on open).
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setLyrics(null);
    fetchLyrics(track?.artist, track?.title)
      .then((r) => {
        if (!cancelled) setLyrics(r);
      })
      .catch(() => {
        if (!cancelled) setError("lookup failed");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [track?.path]);

  // Auto-scroll the active line into view in synced mode.
  useEffect(() => {
    if (!synced || !lyrics || !listRef.current) return;
    const idx = activeLineIndex(lyrics.lines, position);
    if (idx === -1) return;
    const el = listRef.current.querySelector<HTMLElement>(`[data-line="${idx}"]`);
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [synced, lyrics, Math.floor(position * 2)]); // re-run ~2x/sec

  const activeIdx = synced && lyrics ? activeLineIndex(lyrics.lines, position) : -1;

  return (
    <div className="lyrics-overlay" role="dialog" aria-label="Lyrics">
      <div className="lyrics-header">
        <span className="screen-label">
          {synced ? "Synced" : live ? "Live" : "Lyrics"}
          {lyrics?.source === "lrclib" ? " · LRCLIB" : ""}
        </span>
        <button className="btn-accent" onClick={onClose} aria-label="Close lyrics">
          ✕
        </button>
      </div>
      <div className="lyrics-body" ref={listRef}>
        {loading ? <p className="dim">looking up…</p> : null}
        {error ? <p className="dim">ERR: {error}</p> : null}
        {!loading && !error && lyrics && lyrics.lines.length === 0 ? (
          <p className="dim">no lyrics found</p>
        ) : null}
        {!loading && !error && lyrics && lyrics.lines.length > 0 ? (
          lyrics.lines.map((l, i) => (
            <div
              key={i}
              data-line={i}
              className={"lyrics-line" + (i === activeIdx ? " is-active" : "")}
            >
              {l.text}
            </div>
          ))
        ) : null}
      </div>
    </div>
  );
}
