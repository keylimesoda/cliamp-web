import { useState } from "react";
import { navidromeBrowse } from "../providers/navidrome";
import { usePlayerStore } from "../store/player";
import { useFavoritesStore } from "../store/favorites";
import type { Track } from "../core/types";
import { useAsync } from "./useAsync";

type View =
  | { kind: "home" }
  | { kind: "albums" }
  | { kind: "artist"; id: string; name: string }
  | { kind: "album"; id: string; name: string }
  | { kind: "search"; query: string };

interface Album { id: string; name: string; artist: string; year?: number; }

function Row({ label, hint, onClick }: { label: string; hint?: string; onClick?: () => void }) {
  return (
    <div className="row" onClick={onClick} role={onClick ? "button" : undefined} aria-label={label}>
      <span className="marker" aria-hidden>▸</span>
      <span className="title">{label}</span>
      {hint ? <span className="dur">{hint}</span> : null}
    </div>
  );
}

/**
 * Navidrome browser — artists → albums → tracks, global albums, and search.
 * Tapping a track plays it via the Subsonic stream URL.
 */
export default function NavidromeBrowser() {
  const playTrack = usePlayerStore((s) => s.playTrack);
  const favorites = useFavoritesStore();
  const [view, setView] = useState<View>({ kind: "home" });
  const [query, setQuery] = useState("");

  const artists = useAsync(
    () => (view.kind === "home" ? navidromeBrowse.listArtists() : Promise.resolve([])),
    view.kind === "home" ? "artists" : "",
  );
  const albums = useAsync<Album[]>(
    () => (view.kind === "albums" ? navidromeBrowse.listAlbums() : Promise.resolve([])),
    view.kind === "albums" ? "albums" : "",
  );
  const artistAlbums = useAsync<Album[]>(
    () => (view.kind === "artist" ? navidromeBrowse.albumsForArtist(view.id) : Promise.resolve([])),
    view.kind === "artist" ? "art:" + view.id : "",
  );
  const albumTracks = useAsync<Track[]>(
    () => (view.kind === "album" ? navidromeBrowse.tracksForAlbum(view.id) : Promise.resolve([])),
    view.kind === "album" ? "alb:" + view.id : "",
  );
  const search = useAsync<Track[]>(
    () => (view.kind === "search" && view.query.trim() ? navidromeBrowse.search(view.query) : Promise.resolve([])),
    view.kind === "search" ? "srch:" + view.query : "",
  );

  const back = () => setView({ kind: "home" });
  const title =
    view.kind === "home" ? "N A V I D R O M E"
    : view.kind === "albums" ? "A L B U M S"
    : view.kind === "artist" ? view.name
    : view.kind === "album" ? view.name
    : "S E A R C H";
  const crumb =
    view.kind === "home" ? "Library"
    : view.kind === "search" ? `“${view.query}”`
    : view.kind === "albums" ? "All"
    : view.name;

  const tracks = view.kind === "album" ? albumTracks.data ?? [] : view.kind === "search" ? search.data ?? [] : [];
  const busy = view.kind === "album" ? albumTracks.busy : view.kind === "search" ? search.busy : false;
  const err = view.kind === "album" ? albumTracks.error : view.kind === "search" ? search.error : null;

  return (
    <div className="app">
      <div className="app-titlebar">
        <button onClick={back} style={{ padding: 0 }} aria-label="Back" disabled={view.kind === "home"}>◀</button>
        <h1 className="app-title">{title}</h1>
        <span className="screen-label">{crumb}</span>
      </div>

      {view.kind !== "album" && (
        <input
          type="search"
          value={query}
          placeholder="Search…"
          onChange={(e) => {
            const q = e.target.value;
            setQuery(q);
            setView(q.trim() ? { kind: "search", query: q } : { kind: "home" });
          }}
          style={{ width: "100%", minHeight: "var(--tap-min)", padding: "0.5rem 0.8rem", fontFamily: "inherit", fontSize: "var(--fs-md)", color: "var(--text)", background: "var(--bg-sunken)", border: "1px solid var(--border)", borderRadius: "var(--radius)" }}
        />
      )}

      {err ? <div className="status-row is-error">ERR: {err}</div> : null}

      {view.kind === "home" && (
        <div className="panel" style={{ padding: "0.4rem", flex: 1, minHeight: 0 }}>
          <div className="list" style={{ overflowY: "auto", flex: 1 }}>
            <Row label="All albums" onClick={() => setView({ kind: "albums" })} />
            {(artists.data ?? []).map((a) => (
              <Row key={a.id} label={a.name} hint={`${a.albumCount} albums`} onClick={() => setView({ kind: "artist", id: a.id, name: a.name })} />
            ))}
            {artists.error ? <div className="status-row is-error">ERR: {artists.error}</div> : null}
          </div>
        </div>
      )}

      {view.kind === "albums" && (
        <div className="panel" style={{ padding: "0.4rem", flex: 1, minHeight: 0 }}>
          <div className="list" style={{ overflowY: "auto", flex: 1 }}>
            {albums.busy ? <Row label="loading albums…" /> : null}
            {(albums.data ?? []).map((al) => (
              <Row key={al.id} label={al.name} hint={al.artist} onClick={() => setView({ kind: "album", id: al.id, name: al.name })} />
            ))}
          </div>
        </div>
      )}

      {view.kind === "artist" && (
        <div className="panel" style={{ padding: "0.4rem", flex: 1, minHeight: 0 }}>
          <div className="list" style={{ overflowY: "auto", flex: 1 }}>
            {artistAlbums.busy ? <Row label="loading albums…" /> : null}
            {(artistAlbums.data ?? []).map((al) => (
              <Row key={al.id} label={al.name} hint={al.year ? String(al.year) : undefined} onClick={() => setView({ kind: "album", id: al.id, name: al.name })} />
            ))}
          </div>
        </div>
      )}

      {(view.kind === "album" || view.kind === "search") && (
        <div className="panel" style={{ padding: "0.4rem", flex: 1, minHeight: 0 }}>
          <div className="list" style={{ overflowY: "auto", flex: 1 }}>
            {busy ? <Row label="loading tracks…" /> : null}
            {tracks.map((t, i) => (
              <div className="row" key={t.path + i} onClick={() => void playTrack(t, 0)} role="button" aria-label={t.title}>
                <span className="marker" aria-hidden>♫</span>
                <span className="title">{t.title}</span>
                <span className="dur">{t.durationSecs ? `${Math.floor(t.durationSecs / 60)}:${String(t.durationSecs % 60).padStart(2, "0")}` : ""}</span>
                <span
                  className={"marker" + (favorites.tracks.some((x) => x.path === t.path) ? " is-fav" : "")}
                  role="button"
                  aria-label="favorite"
                  onClick={(e) => { e.stopPropagation(); favorites.toggle(t); }}
                >
                  ★
                </span>
              </div>
            ))}
            {!busy && tracks.length === 0 && !err ? <Row label="no tracks" /> : null}
          </div>
        </div>
      )}
    </div>
  );
}
