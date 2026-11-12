import { useEffect, useMemo, useRef, useState } from "react";
import { QobuzClient, type QobuzQuality } from "../providers/qobuzClient";
import { useQobuz } from "../store/qobuz";
import type { Track } from "../core/types";
import { usePlayerStore } from "../store/player";
import { useFavoritesStore } from "../store/favorites";

type Kind = "home" | "tracks" | "albums" | "artists" | "artist" | "album" | "playlist" | "search";
type View = { kind: Kind; id?: string; title?: string; parent?: View };
type Row = { kind: Kind; id: string; title: string; hint?: string; track?: Track };
const trackRows = (tracks: Track[]): Row[] => tracks.map((track) => ({ kind: "tracks", id: track.path, title: track.title, hint: track.artist, track }));

export default function QobuzBrowser({ onBack }: { onBack: () => void }) {
  const state = useQobuz(), favorites = useFavoritesStore();
  const client = useMemo(() => new QobuzClient(state.session!, state.quality), [state.session, state.quality]);
  const [view, setView] = useState<View>({ kind: "home" });
  const [rows, setRows] = useState<Row[]>([]), [offset, setOffset] = useState(0), [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null), [query, setQuery] = useState("");
  const [revision, setRevision] = useState(0);
  const generation = useRef(0);
  const play = usePlayerStore((s) => s.loadPlaylist);
  const load = async (start: number, signal?: AbortSignal): Promise<{ rows: Row[]; more: boolean; next: number }> => {
    if (view.kind === "album" || view.kind === "playlist" || view.kind === "search") {
      const tracks = view.kind === "album" ? await client.albumTracks(view.id!, signal) : view.kind === "playlist" ? await client.playlistTracks(view.id!, signal) : await client.search(view.id!, signal);
      return { rows: trackRows(tracks), more: false, next: 0 };
    }
    if (view.kind === "home") {
      const page = await client.playlists(start, signal);
      return { rows: page.items.map((p) => ({ kind: "playlist", id: String(p.id), title: p.name, hint: `${p.tracks_count || 0} tracks` })), more: start + page.items.length < page.total, next: start + page.items.length };
    }
    if (view.kind === "tracks") {
      const page = await client.favorites("tracks", start, signal);
      // Advance by server-page size even when nonstreamable rows were removed.
      return { rows: trackRows(page.items), more: start + 100 < page.total, next: start + 100 };
    }
    if (view.kind === "artists") {
      const page = await client.favorites("artists", start, signal);
      return { rows: page.items.map((a) => ({ kind: "artist", id: String(a.id), title: a.name })), more: start + page.items.length < page.total, next: start + page.items.length };
    }
    const page = view.kind === "artist" ? await client.artistAlbums(view.id!, start, signal) : await client.favorites("albums", start, signal);
    return { rows: page.items.map((a) => ({ kind: "album", id: a.id, title: a.title, hint: a.artist?.name })), more: start + page.items.length < page.total, next: start + page.items.length };
  };
  useEffect(() => {
    const g = ++generation.current, controller = new AbortController();
    setRows([]); setMore(false); setOffset(0); setBusy(true); setError(null);
    void load(0, controller.signal).then((page) => { if (generation.current === g) { setRows(page.rows); setOffset(page.next); setMore(page.more); } })
      .catch((e) => { if (generation.current === g) setError(e instanceof Error ? e.message : "Could not load Qobuz"); })
      .finally(() => { if (generation.current === g) setBusy(false); });
    return () => { generation.current++; controller.abort(); };
  }, [view, client, revision]);
  const loadMore = async () => {
    const g = generation.current; setBusy(true); setError(null);
    try { const page = await load(offset); if (generation.current === g) { setRows((r) => [...r, ...page.rows]); setOffset(page.next); setMore(page.more); } }
    catch (e) { if (generation.current === g) setError(e instanceof Error ? e.message : "Could not load more"); }
    finally { if (generation.current === g) setBusy(false); }
  };
  const tracks = rows.flatMap((r) => r.track ? [r.track] : []);
  return <div className="app source-browser">
    <div className="app-titlebar"><button aria-label="Back in Qobuz" onClick={() => view.kind === "home" ? onBack() : setView(view.parent || { kind: "home" })}>Back</button><h1 className="app-title">{view.title || "Qobuz"}</h1></div>
    <div className="queue-toolbar"><select aria-label="Qobuz quality" value={state.quality} onChange={(e) => state.setQuality(Number(e.target.value) as QobuzQuality)}>
      <option value="5">MP3 320 kbps</option><option value="6">FLAC CD</option><option value="7">FLAC up to 96 kHz</option><option value="27">FLAC up to 192 kHz</option>
    </select><button onClick={state.disconnect}>Sign out of Qobuz</button></div>
    <form className="playlist-name-form" onSubmit={(e) => { e.preventDefault(); if (query.trim()) setView({ kind: "search", id: query.trim(), title: `Search: ${query.trim()}`, parent: view.kind === "search" ? view.parent : view }); }}>
      <input aria-label="Search Qobuz" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search Qobuz tracks" /><button disabled={!query.trim()} type="submit">Search</button>
    </form>
    {view.kind === "home" && <div className="queue-tabs">{(["tracks", "albums", "artists"] as const).map((kind) => <button key={kind} onClick={() => setView({ kind, title: `Favorite ${kind}`, parent: view })}>Favorite {kind}</button>)}</div>}
    {!!tracks.length && <button onClick={() => void play(tracks)}>Play all</button>}
    {busy && <div role="status">Loading Qobuz…</div>}
    {error && <div role="alert">{error} <button onClick={() => setRevision((v) => v + 1)}>Retry Qobuz</button></div>}
    <div className="panel scroll-panel" style={{ overflowY: "auto" }}><div className="list">
      {rows.map((row, i) => <div className="queue-editor-row" key={`${row.id}:${i}`}><button className="queue-track" aria-label={row.title} onClick={() => row.track ? void play(tracks, i) : setView({ kind: row.kind, id: row.id, title: row.title, parent: view })}><span className="title">{row.title}</span><span className="dim">{row.hint}</span></button>
        {row.track && <button aria-label={`Favorite: ${row.title}`} aria-pressed={favorites.tracks.some((t) => t.path === row.id)} onClick={() => favorites.toggle(row.track!)}>★</button>}
      </div>)}
      {!busy && !error && !rows.length && <div className="row dim">No streamable items found</div>}
      {more && <button disabled={busy} onClick={() => void loadMore()}>Load more</button>}
    </div></div>
  </div>;
}
