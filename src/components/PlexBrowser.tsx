import { useEffect, useRef, useState } from "react";
import { plexBrowse } from "../providers/plex";
import type { Track } from "../core/types";
import { usePlayerStore } from "../store/player";
import { useServers } from "../store/servers";
import { useFavoritesStore } from "../store/favorites";

type View = { kind: "home" | "library" | "album" | "playlist" | "search"; id?: string; title?: string; parent?: View };
type Row = { kind: "library" | "album" | "playlist" | "track"; id: string; title: string; hint?: string; track?: Track };
const trackRows = (tracks: Track[]): Row[] => tracks.map((track) => ({ kind: "track", id: track.path, title: track.title, hint: track.artist, track }));

export default function PlexBrowser({ onBack }: { onBack: () => void }) {
  const [view, setView] = useState<View>({ kind: "home" });
  const [rows, setRows] = useState<Row[]>([]), [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [revision, setRevision] = useState(0);
  const generation = useRef(0);
  const play = usePlayerStore((s) => s.loadPlaylist);
  const favorites = useFavoritesStore();
  const server = useServers((s) => s.getConfig("plex"));
  const albums = async (id: string, start: number) => {
    const result = await plexBrowse.sectionAlbums(id, start);
    return { rows: result.albums.map((a): Row => ({ kind: "album", id: a.ratingKey, title: a.title, hint: [a.parentTitle, a.year].filter(Boolean).join(" · ") })), more: result.more };
  };
  useEffect(() => {
    const g = ++generation.current;
    setBusy(true); setError(null); setRows([]); setMore(false);
    const load = async (): Promise<{ rows: Row[]; more?: boolean }> => {
      if (view.kind === "library") return albums(view.id!, 0);
      if (view.kind === "album") return { rows: trackRows(await plexBrowse.albumTracks(view.id!)) };
      if (view.kind === "playlist") return { rows: trackRows(await plexBrowse.playlistItems(view.id!)) };
      if (view.kind === "search") return { rows: trackRows(await plexBrowse.search(view.id!)) };
      const [libraries, playlists] = await Promise.all([plexBrowse.sections(), plexBrowse.playlists()]);
      return { rows: [
        ...libraries.filter((l) => l.type === "artist" || l.type === "album").map((l): Row => ({ kind: "library", id: l.key, title: l.title, hint: "Music library" })),
        ...playlists.map((p): Row => ({ kind: "playlist", id: p.ratingKey, title: p.title, hint: "Audio playlist" })),
      ] };
    };
    void load().then((result) => { if (generation.current === g) { setRows(result.rows); setMore(Boolean(result.more)); } })
      .catch((e) => { if (generation.current === g) setError(e instanceof Error ? e.message : "Could not load Plex"); })
      .finally(() => { if (generation.current === g) setBusy(false); });
    return () => { generation.current++; };
  }, [view, revision]);
  const loadMore = async () => {
    if (busy || view.kind !== "library") return;
    const g = generation.current; setBusy(true); setError(null);
    try {
      const result = await albums(view.id!, rows.length);
      if (generation.current === g) { setRows((current) => [...current, ...result.rows]); setMore(result.more); }
    } catch (e) { if (generation.current === g) setError(e instanceof Error ? e.message : "Could not load more albums"); }
    finally { if (generation.current === g) setBusy(false); }
  };
  const tracks = rows.flatMap((r) => r.track ? [r.track] : []);
  return <div className="app source-browser">
    <div className="app-titlebar">
      <button aria-label="Back in Plex" onClick={() => view.kind === "home" ? onBack() : setView(view.parent || { kind: "home" })}>Back</button>
      <h1 className="app-title">{view.title || server?.serverName || "Plex"}</h1>
    </div>
    <form onSubmit={(e) => { e.preventDefault(); if (query.trim()) setView({ kind: "search", id: query.trim(), title: `Search: ${query.trim()}`, parent: view.kind === "search" ? view.parent : view }); }} className="playlist-name-form">
      <input type="search" aria-label="Search Plex music" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search your Plex music" />
      <button type="submit" disabled={!query.trim()}>Search</button>
    </form>
    {!!tracks.length && <button onClick={() => void play(tracks)}>Play all</button>}
    {busy && <div role="status">Loading Plex…</div>}
    {error && <div role="alert">{error} <button onClick={() => setRevision((v) => v + 1)}>Retry Plex</button></div>}
    <div className="panel scroll-panel" style={{ overflowY: "auto" }}><div className="list">
      {rows.map((row, i) => <div className="queue-editor-row" key={`${row.kind}:${row.id}:${i}`}>
        <button className="queue-track" aria-label={row.title} onClick={() => {
          if (row.track) void play(tracks, i);
          else setView({ kind: row.kind as View["kind"], id: row.id, title: row.title, parent: view });
        }}><span className="title">{row.title}</span><span className="dim">{row.hint}</span></button>
        {row.track && <button aria-label={`Favorite: ${row.title}`} aria-pressed={favorites.tracks.some((t) => t.path === row.track!.path)} onClick={() => favorites.toggle(row.track!)}>★</button>}
      </div>)}
      {!busy && !error && !rows.length && <div className="row dim">No music found</div>}
      {more && <button disabled={busy} onClick={() => void loadMore()}>Load more albums</button>}
    </div></div>
  </div>;
}
