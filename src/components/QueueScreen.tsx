import { useState } from "react";
import { usePlayerStore } from "../store/player";
import { useSavedPlaylists } from "../store/playlists";
import ProgressLabel from "./ProgressLabel";

export default function QueueScreen({ onClose }: { onClose: () => void }) {
  const s = usePlayerStore(), saved = useSavedPlaylists();
  const [view, setView] = useState<"playlist" | "next" | "saved">("playlist");
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [notice, setNotice] = useState("");
  const entries = view === "next" ? s.queueEntries : s.tracks.map((track, displayPos) => ({ track, displayPos }));
  return <div className="app source-browser queue-screen">
    <div className="app-titlebar"><button onClick={onClose} aria-label="Back to playback">Back</button><h1 className="app-title">QUEUE</h1></div>
    <div className="queue-tabs" role="group" aria-label="Queue views">
      <button aria-pressed={view === "playlist"} onClick={() => setView("playlist")}>Playlist ({s.tracks.length})</button>
      <button aria-pressed={view === "next"} onClick={() => setView("next")}>Play next ({s.queueCount})</button>
      <button aria-pressed={view === "saved"} onClick={() => setView("saved")}>Saved playlists</button>
    </div>
    <div className="queue-toolbar">
      {view === "playlist" && <><button disabled={!s.tracks.length} onClick={() => { setName(""); setEditing(null); setSaving(true); }}>Save playlist</button><button disabled={s.tracks.length < 2} onClick={s.reversePlaylist}>Reverse list</button></>}
      {view === "next" && <><button disabled={!s.queueCount} onClick={() => void s.next()}>Play queue</button><button disabled={!s.queueCount} onClick={() => {
        if (s.queueCount > 1 && !confirmClear) { setConfirmClear(true); return; }
        s.queueClear(); setConfirmClear(false);
      }}>{confirmClear ? "Confirm clear queue" : "Clear queue"}</button>{confirmClear && <button onClick={() => setConfirmClear(false)}>Cancel</button>}</>}
      {view !== "saved" && <button onClick={s.undoPlaylist}>Undo</button>}
    </div>
    {saving && <form className="playlist-name-form" onSubmit={(e) => {
      e.preventDefault();
      if (editing) { saved.rename(editing, name); setSaving(false); }
      else if (saved.save(name, s.tracks)) { setSaving(false); setNotice("Playlist saved"); }
    }}><input aria-label="Playlist name" value={name} onChange={(e) => setName(e.target.value)} autoFocus maxLength={120} placeholder="Playlist name" required /><button type="submit">Save</button><button type="button" onClick={() => setSaving(false)}>Cancel</button></form>}
    {(saved.error || notice) && <div role="status" className="status-row">{saved.error || notice}</div>}
    {view === "playlist" && s.shuffle === "on" && <div className="status-row">Turn off shuffle to move tracks.</div>}
    <div className="panel scroll-panel queue-scroll">
      <div className="list">
      {view === "saved" ? saved.lists.length ? saved.lists.map((p) => <div className="queue-editor-row" key={p.id}>
        <button className="queue-track" onClick={() => { void s.loadPlaylist(p.tracks); onClose(); }} aria-label={`Play playlist: ${p.name}`}><span className="title">{p.name}</span><span className="dim">{p.tracks.length} tracks</span></button>
        <button onClick={() => { setName(p.name); setEditing(p.id); setSaving(true); }} aria-label={`Rename playlist: ${p.name}`}>Rename</button>
        <button onClick={() => { if (deleting === p.id) { saved.remove(p.id); setDeleting(null); } else setDeleting(p.id); }} aria-label={`Delete playlist: ${p.name}`}>{deleting === p.id ? "Confirm delete" : "Delete"}</button>
      </div>) : <div className="row dim">No saved playlists yet</div> : entries.length ? entries.map(({ track, displayPos }, i) => <div className={"queue-editor-row" + (displayPos === s.currentDisplay ? " is-active" : "")} key={`${track.path}:${i}`}>
        <button className="queue-track" aria-label={`Play: ${track.title}`} onClick={() => {
          if (view === "next") s.queueRemove(i);
          void s.playDisplay(displayPos);
        }}><span className="title">{track.title}</span><ProgressLabel track={track} /></button>
        {view === "playlist" && <button aria-label={`Play next: ${track.title}`} onClick={() => void s.enqueueTrack(track)}>+Next</button>}
        <button disabled={i === 0 || (view === "playlist" && s.shuffle === "on")} aria-label={`Move up: ${track.title}`} onClick={() => view === "next" ? s.queueMove(i, i - 1) : s.moveTrack(i, i - 1)}>↑</button>
        <button disabled={i === entries.length - 1 || (view === "playlist" && s.shuffle === "on")} aria-label={`Move down: ${track.title}`} onClick={() => view === "next" ? s.queueMove(i, i + 1) : s.moveTrack(i, i + 1)}>↓</button>
        <button aria-label={`Remove: ${track.title}`} onClick={() => view === "next" ? s.queueRemove(i) : s.removeTrack(displayPos)}>×</button>
      </div>) : <div className="row dim">{view === "next" ? "No tracks queued to play next" : "No tracks loaded"}</div>}
      </div>
    </div>
  </div>;
}
