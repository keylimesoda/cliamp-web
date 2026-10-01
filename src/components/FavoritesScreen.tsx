import { useFavoritesStore } from "../store/favorites";
import { usePodcastPrefs, type SubscribedShow } from "../store/podcastPrefs";
import { usePlayerStore } from "../store/player";
import type { PodcastShow } from "../providers/podcast";
import type { Track } from "../core/types";

interface FavoritesScreenProps {
  onOpenPodcast: (show: PodcastShow) => void;
}

function kindFor(t: Track): string {
  if (t.provider === "radio" || t.stream || t.live) return "RADIO";
  if (t.provider === "podcast" || t.feed) return "POD";
  return "TRACK";
}

function detailFor(t: Track): string {
  if (t.station) return t.station;
  if (t.artist) return t.artist;
  if (t.album) return t.album;
  return "";
}

export default function FavoritesScreen({ onOpenPodcast }: FavoritesScreenProps) {
  const playTrack = usePlayerStore((s) => s.playTrack);
  const favorites = useFavoritesStore();
  const podcasts = usePodcastPrefs();

  const openSubscribedShow = (s: SubscribedShow) => {
    onOpenPodcast({
      collectionId: s.collectionId ?? 0,
      name: s.name,
      feedUrl: s.feedUrl,
      artworkUrl: s.artworkUrl,
    });
  };

  return (
    <div className="app source-browser">
      <div className="app-titlebar">
        <h1 className="app-title">F A V O R I T E S</h1>
        <span className="screen-label">Saved audio &amp; shows</span>
      </div>

      <div className="panel scroll-panel" style={{ padding: "0.4rem" }}>
        <div className="list">
          <div className="favorites-section-label">
            <span className="nf-icon" aria-hidden>{"\uf130"}</span>
            <span>Podcast shows</span>
          </div>

          {podcasts.subs.length === 0 ? (
            <div className="row" style={{ cursor: "default" }}>
              <span className="marker" aria-hidden>·</span>
              <span className="title dim">no saved podcast shows yet</span>
            </div>
          ) : (
            podcasts.subs.map((s) => (
              <div
                className="row"
                key={s.feedUrl}
                onClick={() => openSubscribedShow(s)}
                role="button"
                aria-label={s.name}
              >
                <span className="marker" aria-hidden>▸</span>
                <span className="title">{s.name}</span>
                <span className="favorite-kind">POD</span>
                <span
                  className="save-toggle is-fav"
                  role="button"
                  aria-label="Remove podcast"
                  onClick={(e) => {
                    e.stopPropagation();
                    podcasts.toggleSub(s);
                  }}
                >
                  ♥
                </span>
              </div>
            ))
          )}

          <div className="favorites-section-label" style={{ marginTop: "var(--gap)" }}>
            <span className="nf-icon" aria-hidden>{"\uf005"}</span>
            <span>Stations &amp; episodes</span>
          </div>

          {favorites.tracks.length === 0 ? (
            <div className="row" style={{ cursor: "default" }}>
              <span className="marker" aria-hidden>·</span>
              <span className="title dim">no saved stations or episodes yet</span>
            </div>
          ) : (
            favorites.tracks.map((t) => (
              <div
                className="row"
                key={t.path}
                onClick={() => void playTrack(t, 0)}
                role="button"
                aria-label={t.title}
              >
                <span className="marker" aria-hidden>{t.stream || t.live ? "♫" : "▸"}</span>
                <span className="title">
                  {t.title}
                  {detailFor(t) ? <span className="dim"> — {detailFor(t)}</span> : null}
                </span>
                <span className="favorite-kind">{kindFor(t)}</span>
                <span
                  className="save-toggle is-fav"
                  role="button"
                  aria-label="Remove favorite"
                  onClick={(e) => {
                    e.stopPropagation();
                    favorites.toggle(t);
                  }}
                >
                  ★
                </span>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="footer">
        <div className="help-row">
          <span><span className="key-pill">tip</span> tap saved audio to play · tap a podcast to open</span>
        </div>
      </div>
    </div>
  );
}
