import { useHistoryStore, type HistoryEntry } from "../store/history";
import { useFavoritesStore } from "../store/favorites";
import { usePlayerStore } from "../store/player";

function ago(ts: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return d === 1 ? "yesterday" : `${d}d ago`;
  return `${Math.floor(d / 7)}w ago`;
}

function fmtDur(sec?: number): string {
  if (!sec) return "";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * Local screen — Recently Played (scrobbled history) and Favorites,
 * parity with cliamp's Local Playlists provider + station favorites.
 * Tapping a row plays the track.
 */
export default function LocalScreen() {
  const playTrack = usePlayerStore((s) => s.playTrack);
  const history = useHistoryStore((s) => s.entries);
  const clearHistory = useHistoryStore((s) => s.clear);
  const favs = useFavoritesStore((s) => s.tracks);

  const row = (
    key: string,
    title: string,
    artist: string,
    hint: string,
    onPlay: () => void,
  ) => (
    <div className="row" key={key} onClick={onPlay} role="button" aria-label={title}>
      <span className="marker" aria-hidden>
        ♫
      </span>
      <span className="title">
        {title}
        {artist ? <span className="dim"> — {artist}</span> : null}
      </span>
      <span className="dur">{hint}</span>
    </div>
  );

  return (
    <div className="app">
      <div className="app-titlebar">
        <h1 className="app-title">L O C A L</h1>
        <span className="screen-label">History &amp; favorites</span>
      </div>

      <div className="panel" style={{ padding: "0.4rem", flex: 1, minHeight: 0 }}>
        <div className="list" style={{ overflowY: "auto", flex: 1 }}>
          <div className="row" style={{ cursor: "default" }}>
            <span className="marker is-fav" aria-hidden>
              ◷
            </span>
            <span className="title">Recently Played</span>
            <button className="btn-accent" style={{ minHeight: "var(--tap-min)" }} onClick={() => clearHistory()}>
              Clear
            </button>
          </div>
          {history.length === 0 ? (
            <div className="row" style={{ cursor: "default" }}>
              <span className="marker" aria-hidden>
                ·
              </span>
              <span className="title dim">nothing yet — plays land here after 50% listened</span>
            </div>
          ) : (
            history.map((h: HistoryEntry) =>
              row(h.path + h.playedAt, h.title, h.artist, `${ago(h.playedAt)}${h.durationSecs ? " · " + fmtDur(h.durationSecs) : ""}`, () => void playTrack(h.track, 0)),
            )
          )}

          <div className="row" style={{ cursor: "default", marginTop: "var(--gap)" }}>
            <span className="marker is-fav" aria-hidden>
              ★
            </span>
            <span className="title">Favorites</span>
          </div>
          {favs.length === 0 ? (
            <div className="row" style={{ cursor: "default" }}>
              <span className="marker" aria-hidden>
                ·
              </span>
              <span className="title dim">no favorites yet — star a track to add it</span>
            </div>
          ) : (
            favs.map((t, i) => row("fav" + i, t.title ?? t.path, t.artist ?? "", t.album ?? "", () => void playTrack(t, 0)))
          )}
        </div>
      </div>
    </div>
  );
}
