import { useState } from "react";
import type { Track } from "../core/types";
import { usePlayerStore } from "../store/player";
import { useFavoritesStore } from "../store/favorites";
import { useServers, type ServerId } from "../store/servers";
import { useAsync } from "./useAsync";
import { jellyfinBrowse, embyBrowseClient } from "../providers/jellyfin";
import type { EmbyItem } from "../providers/embyapi";
import { plexBrowse } from "../providers/plex";
import { absBrowse } from "../providers/audiobookshelf";
import { lyrionBrowse } from "../providers/lyrion";

interface Node { id: string; name: string; hint?: string; }

type View =
  | { level: 0 }
  | { level: 1; top: Node }
  | { level: 2; top: Node; sub: Node };

function Row({ label, hint, marker = "▸", onClick, onFav, faved }: {
  label: string; hint?: string; marker?: string; onClick?: () => void; onFav?: () => void; faved?: boolean;
}) {
  return (
    <div className="row" onClick={onClick} role={onClick ? "button" : undefined} aria-label={label}>
      <span className="marker" aria-hidden>{marker}</span>
      <span className="title">{label}</span>
      {hint ? <span className="dur">{hint}</span> : null}
      {onFav ? (
        <span className={"marker" + (faved ? " is-fav" : "")} role="button" aria-label="favorite"
          onClick={(e) => { e.stopPropagation(); onFav(); }}>★</span>
      ) : null}
    </div>
  );
}

function embyTrack(id: ServerId, t: EmbyItem): Track {
  return {
    path: `${id}://track/${t.Id}`, title: t.Name, artist: t.Artist || t.AlbumArtist,
    album: t.Album, durationSecs: t.RunTimeTicks ? Math.round(t.RunTimeTicks / 10_000_000) : undefined,
    provider: id, providerMeta: { itemId: t.Id },
  };
}

/**
 * Unified browser for Jellyfin / Emby / Plex / Audiobookshelf / Lyrion.
 * Two (or three) levels: top items → tracks (ABS and Lyrion add a middle
 * level for authors/artists). Tapping a track plays it; ★ favorites it.
 */
export default function ServerBrowser({ id }: { id: ServerId }) {
  const playTrack = usePlayerStore((s) => s.playTrack);
  const favorites = useFavoritesStore();
  const configured = useServers((s) => s.isConfigured(id, true));
  const [view, setView] = useState<View>({ level: 0 });
  const [query, setQuery] = useState("");

  const isEmby = id === "jellyfin" || id === "emby";
  const emby = id === "emby" ? embyBrowseClient : jellyfinBrowse;

  // Level 0: top items.
  const tops = useAsync<Node[]>(
    () => {
      if (!configured || view.level !== 0) return Promise.resolve([]);
      if (isEmby) return emby.listAlbums().then((a) => a.map((x) => ({ id: x.Id, name: x.Name, hint: x.Artist })));
      if (id === "plex") return plexBrowse.sections().then((s) => s.filter((x) => x.type === "artist" || x.type === "album").map((x) => ({ id: x.key, name: x.title })));
      if (id === "audiobookshelf") return absBrowse.libraries().then((l) => l.map((x) => ({ id: x.id, name: x.name })));
      return lyrionBrowse.artists().then((a) => a.map((x) => ({ id: String(x.id), name: x.name })));
    },
    configured && view.level === 0 && !query ? "tops" : "",
  );

  // Level 1: children of a top node (or tracks for emby/plex).
  const mids = useAsync<Node[]>(
    () => {
      if (view.level !== 1 || !configured) return Promise.resolve([]);
      if (id === "audiobookshelf") return absBrowse.items(view.top.id).then((items) => items.map((it) => ({ id: it.id, name: it.title, hint: it.author })));
      if (id === "lyrion") return lyrionBrowse.albums(Number(view.top.id)).then((als) => als.map((al) => ({ id: String(al.id), name: al.name, hint: al.artist })));
      return Promise.resolve([]);
    },
    view.level === 1 && !query ? "mid:" + view.top.id : "",
  );

  // Level 2: tracks (emby album / plex section / ABS item / lyrion album).
  const tracks = useAsync<Track[]>(
    () => {
      if (!configured || query) return Promise.resolve([]);
      if (view.level === 1) {
        if (isEmby) return emby.listTracks(view.top.id).then((ts) => ts.map((t) => embyTrack(id, t)));
        if (id === "plex") return plexBrowse.sectionTracks(view.top.id);
      }
      if (view.level === 2) {
        if (id === "audiobookshelf") return absBrowse.items(view.sub.id).then((items) => items.map(absBrowse.track));
        if (id === "lyrion") return lyrionBrowse.tracks(Number(view.sub.id));
      }
      return Promise.resolve([]);
    },
    !query && (view.level === 1 || view.level === 2) ? "trk:" + (view.level === 1 ? view.top.id : view.sub?.id) : "",
  );

  const results = useAsync<Track[]>(
    () => {
      if (!query.trim() || !configured) return Promise.resolve([]);
      if (isEmby) return emby.search(query).then((ts) => ts.map((t) => embyTrack(id, t)));
      if (id === "plex") return plexBrowse.search(query);
      if (id === "lyrion") return lyrionBrowse.search(query);
      if (id === "audiobookshelf") {
        // ABS search is per-library; search the first library.
        return absBrowse.libraries().then((libs) => (libs[0] ? absBrowse.search(libs[0].id, query) : [])).then((items) => items.map(absBrowse.track));
      }
      return Promise.resolve([]);
    },
    query.trim() && configured ? "srch:" + query : "",
  );

  const busy = query ? results.busy : view.level === 0 ? tops.busy : view.level === 1 ? (isEmby || id === "plex" ? tracks.busy : mids.busy) : tracks.busy;
  const list = query ? results.data ?? [] : view.level === 0 ? tops.data ?? [] : view.level === 1 && (isEmby || id === "plex") ? tracks.data ?? [] : view.level === 1 ? mids.data ?? [] : tracks.data ?? [];
  const crumb = query ? `“${query}”` : view.level === 0 ? "Library" : view.level === 1 ? view.top.name : view.sub.name;
  const canBack = view.level > 0;
  const goBack = () => (view.level === 2 ? setView({ level: 1, top: view.top }) : setView({ level: 0 }));
  const isTrack = query || (view.level === 1 && (isEmby || id === "plex")) || view.level === 2;

  if (!configured) {
    return (
      <div className="app">
        <div className="app-titlebar">
          <h1 className="app-title">{id.toUpperCase()}</h1>
          <span className="screen-label">not configured</span>
        </div>
        <div className="panel" style={{ padding: "var(--pad)" }}>
          <p className="dim">Configure this server first (URL + credentials), then browse.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <div className="app-titlebar">
        <button onClick={goBack} style={{ padding: 0 }} aria-label="Back" disabled={!canBack}>◀</button>
        <h1 className="app-title">{id.toUpperCase()}</h1>
        <span className="screen-label">{crumb}</span>
      </div>
      <input
        type="search"
        value={query}
        placeholder="Search…"
        onChange={(e) => setQuery(e.target.value)}
        style={{ width: "100%", minHeight: "var(--tap-min)", padding: "0.5rem 0.8rem", fontFamily: "inherit", fontSize: "var(--fs-md)", color: "var(--text)", background: "var(--bg-sunken)", border: "1px solid var(--border)", borderRadius: "var(--radius)" }}
      />
      <div className="panel" style={{ padding: "0.4rem", flex: 1, minHeight: 0 }}>
        <div className="list" style={{ overflowY: "auto", flex: 1 }}>
          {busy ? <Row label="loading…" /> : null}
          {!busy && list.length === 0 ? <Row label="empty" /> : null}
          {(list as (Node | Track)[]).map((item, i) =>
            isTrack ? (
              <Row key={(item as Track).path + i} marker="♫" label={(item as Track).title ?? ""} hint={(item as Track).artist}
                onClick={() => void playTrack(item as Track, 0)}
                onFav={() => favorites.toggle(item as Track)} faved={favorites.tracks.some((x) => x.path === (item as Track).path)} />
            ) : (
              <Row key={(item as Node).id + i} label={(item as Node).name} hint={(item as Node).hint}
                onClick={() => (view.level === 0 ? setView({ level: 1, top: item as Node }) : setView({ level: 2, top: view.top, sub: item as Node }))} />
            ),
          )}
        </div>
      </div>
    </div>
  );
}
