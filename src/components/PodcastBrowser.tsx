import { useState } from "react";
import { APPLE_CATEGORIES, podcastBrowse, type PodcastShow } from "../providers/podcast";
import { usePlayerStore } from "../store/player";
import { useFavoritesStore } from "../store/favorites";
import { usePodcastPrefs } from "../store/podcastPrefs";
import type { Track } from "../core/types";
import { useAsync } from "./useAsync";

type View =
  | { kind: "home" }
  | { kind: "categories" }
  | { kind: "category"; name: string }
  | { kind: "search"; query: string }
  | { kind: "show"; show: PodcastShow };

function Row({ label, hint, onClick, marker }: { label: string; hint?: string; onClick?: () => void; marker?: string }) {
  return (
    <div className="row" onClick={onClick} role={onClick ? "button" : undefined} aria-label={label}>
      <span className="marker" aria-hidden>{marker ?? "▸"}</span>
      <span className="title">{label}</span>
      {hint ? <span className="dur">{hint}</span> : null}
    </div>
  );
}

/**
 * Podcast browser — Apple top chart, categories, search, and show →
 * episodes (RSS). Tapping an episode loads the show's episodes into the
 * playback playlist and plays it. Shows can be subscribed (persisted).
 */
interface PodcastBrowserProps {
  initialShow?: PodcastShow | null;
}

export default function PodcastBrowser({ initialShow = null }: PodcastBrowserProps) {
  const playTrack = usePlayerStore((s) => s.playTrack);
  const loadPlaylist = usePlayerStore((s) => s.loadPlaylist);
  const favorites = useFavoritesStore();
  const prefs = usePodcastPrefs();
  const [view, setView] = useState<View>(() => initialShow ? { kind: "show", show: initialShow } : { kind: "home" });
  const [query, setQuery] = useState("");

  const chart = useAsync(
    () => (view.kind === "home" ? podcastBrowse.listTopChart("us", 100) : Promise.resolve([])),
    view.kind === "home" ? "chart" : "",
  );
  const category = useAsync<PodcastShow[]>(
    () => (view.kind === "category" ? podcastBrowse.showsForCategory(view.name, "us", 100) : Promise.resolve([])),
    view.kind === "category" ? "cat:" + view.name : "",
  );
  const search = useAsync<PodcastShow[]>(
    () => (view.kind === "search" && view.query.trim() ? podcastBrowse.searchShows(view.query, "us", 100) : Promise.resolve([])),
    view.kind === "search" ? "srch:" + view.query : "",
  );
  const episodes = useAsync<Track[]>(
    () =>
      view.kind === "show"
        ? view.show.feedUrl
          ? podcastBrowse.showEpisodes(view.show.feedUrl, view.show.name, 300)
          : podcastBrowse
              .lookupShow(view.show.collectionId)
              .then((s) => podcastBrowse.showEpisodes(s.feedUrl!, s.name, 300))
        : Promise.resolve([]),
    view.kind === "show" ? "show:" + view.show.collectionId : "",
  );

  const back = () => setView({ kind: "home" });
  const openShow = (s: PodcastShow) => setView({ kind: "show", show: s });
  const playEpisode = (t: Track) => {
    void playTrack(t, 0);
  };
  const playAll = (t: Track[]) => {
    void loadPlaylist(t, 0, true);
  };

  const showList: PodcastShow[] =
    view.kind === "home"
      ? chart.data ?? []
      : view.kind === "category"
        ? category.data ?? []
        : view.kind === "search"
          ? search.data ?? []
          : [];
  const listBusy =
    view.kind === "home" ? chart.busy : view.kind === "category" ? category.busy : view.kind === "search" ? search.busy : false;
  const listError =
    view.kind === "home" ? chart.error : view.kind === "category" ? category.error : view.kind === "search" ? search.error : null;

  const title =
    view.kind === "home" ? "P O D C A S T S"
    : view.kind === "categories" ? "C A T E G O R I E S"
    : view.kind === "show" ? "E P I S O D E S"
    : "S H O W S";
  const crumb =
    view.kind === "category" ? view.name
    : view.kind === "search" ? `“${view.query}”`
    : view.kind === "show" ? view.show.name
    : "Source";

  return (
    <div className="app source-browser">
      <div className="app-titlebar">
        <button onClick={back} style={{ padding: 0 }} aria-label="Back" disabled={view.kind === "home"}>
          ◀
        </button>
        <h1 className="app-title">{title}</h1>
        <span className="screen-label">{crumb}</span>
      </div>

      {view.kind !== "show" && (
        <input
          type="search"
          value={query}
          placeholder="Search shows…"
          onChange={(e) => {
            const q = e.target.value;
            setQuery(q);
            setView(q.trim() ? { kind: "search", query: q } : { kind: "home" });
          }}
          style={{
            width: "100%",
            minHeight: "var(--tap-min)",
            padding: "0.5rem 0.8rem",
            fontFamily: "inherit",
            fontSize: "var(--fs-md)",
            color: "var(--text)",
            background: "var(--bg-sunken)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius)",
          }}
        />
      )}

      {listError ? <div className="status-row is-error">ERR: {listError}</div> : null}
      {view.kind === "show" && episodes.error ? (
        <div className="status-row is-error">
          ERR: {episodes.error} — this feed may not allow cross-origin reads
        </div>
      ) : null}

      {view.kind === "home" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--gap)", flex: 1, minHeight: 0 }}>
          {prefs.subs.length > 0 && (
            <div className="panel" style={{ padding: "0.4rem" }}>
              <div className="list">
                {prefs.subs.map((s) => (
                  <div className="row" key={s.feedUrl} onClick={() => openShow({ collectionId: s.collectionId ?? 0, name: s.name, feedUrl: s.feedUrl, artworkUrl: s.artworkUrl })} role="button" aria-label={s.name}>
                    <span className="marker" aria-hidden>▸</span>
                    <span className="title">{s.name}</span>
                    <span className="dur">sub</span>
                    <span
                      className="save-toggle is-fav"
                      onClick={(e) => {
                        e.stopPropagation();
                        prefs.toggleSub(s);
                      }}
                      role="button"
                      aria-label="Unsubscribe"
                    >
                      ♥
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="panel" style={{ padding: "0.4rem" }}>
            <div className="list">
              <Row label="Browse categories" onClick={() => setView({ kind: "categories" })} />
            </div>
          </div>
          <div className="panel scroll-panel" style={{ padding: "0.4rem" }}>
            <div className="list">
              <Row label="Top Shows (US)" hint="chart" />
              {showList.map((s) => (
                <div className="row" key={s.collectionId} onClick={() => openShow(s)} role="button" aria-label={s.name}>
                  <span className="marker" aria-hidden>▸</span>
                  <span className="title">{s.name}</span>
                  <span className="dur">{s.genre ?? ""}</span>
                  <span
                    className={"save-toggle" + (prefs.isSubscribed(s.feedUrl ?? "") ? " is-fav" : "")}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (s.feedUrl) prefs.toggleSub({ feedUrl: s.feedUrl, name: s.name, collectionId: s.collectionId, artworkUrl: s.artworkUrl });
                    }}
                    role="button"
                    aria-label={prefs.isSubscribed(s.feedUrl ?? "") ? "Unsubscribe" : "Subscribe"}
                  >
                    {prefs.isSubscribed(s.feedUrl ?? "") ? "♥" : "♡"}
                  </span>
                </div>
              ))}
              {chart.busy ? <Row label="loading top shows…" /> : null}
            </div>
          </div>
        </div>
      )}

      {view.kind === "categories" && (
        <div className="panel scroll-panel" style={{ padding: "0.4rem" }}>
          <div className="list">
            {APPLE_CATEGORIES.map((c) => (
              <Row key={c.genreId} label={c.name} onClick={() => setView({ kind: "category", name: c.name })} />
            ))}
          </div>
        </div>
      )}

      {(view.kind === "category" || view.kind === "search") && (
        <div className="panel scroll-panel" style={{ padding: "0.4rem" }}>
          <div className="list">
            {listBusy ? <Row label="loading shows…" /> : null}
            {showList.map((s) => (
              <div className="row" key={s.collectionId} onClick={() => openShow(s)} role="button" aria-label={s.name}>
                <span className="marker" aria-hidden>▸</span>
                <span className="title">{s.name}</span>
                <span className="dur">{s.genre ?? ""}</span>
                <span
                  className={"save-toggle" + (prefs.isSubscribed(s.feedUrl ?? "") ? " is-fav" : "")}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (s.feedUrl) prefs.toggleSub({ feedUrl: s.feedUrl, name: s.name, collectionId: s.collectionId, artworkUrl: s.artworkUrl });
                  }}
                  role="button"
                  aria-label={prefs.isSubscribed(s.feedUrl ?? "") ? "Unsubscribe" : "Subscribe"}
                >
                  {prefs.isSubscribed(s.feedUrl ?? "") ? "♥" : "♡"}
                </span>
              </div>
            ))}
            {!listBusy && showList.length === 0 ? <Row label="no shows" /> : null}
          </div>
        </div>
      )}

      {view.kind === "show" && (
        <div className="panel scroll-panel" style={{ padding: "0.4rem" }}>
          <div className="list">
            {episodes.busy ? <Row label="loading episodes…" /> : null}
            {!episodes.busy && episodes.data && episodes.data.length > 0 ? (
              <Row label={`▶ Play all (${episodes.data.length})`} hint="queue" onClick={() => playAll(episodes.data!)} />
            ) : null}
            {(episodes.data ?? []).map((t, i) => (
              <div className="row" key={t.guid ?? t.path + i} onClick={() => playEpisode(t)} role="button" aria-label={t.title}>
                <span className="marker" aria-hidden>♫</span>
                <span className="title">{t.title}</span>
                <span className="dur">{t.durationSecs ? fmtDur(t.durationSecs) : ""}</span>
                <span
                  className={"save-toggle" + (favorites.tracks.some((x) => x.path === t.path) ? " is-fav" : "")}
                  role="button"
                  aria-label={favorites.tracks.some((x) => x.path === t.path) ? "Remove favorite" : "Favorite episode"}
                  onClick={(e) => { e.stopPropagation(); favorites.toggle(t); }}
                >
                  {favorites.tracks.some((x) => x.path === t.path) ? "★" : "☆"}
                </span>
              </div>
            ))}
            {!episodes.busy && (episodes.data ?? []).length === 0 && !episodes.error ? <Row label="no episodes" /> : null}
          </div>
        </div>
      )}

      <div className="footer">
        <div className="help-row">
          <span>
            <span className="key-pill">tip</span> tap to open / play · ♡ / ♥ subscribes · ☆ / ★ favorites
          </span>
        </div>
      </div>
    </div>
  );
}

function fmtDur(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
