import QueueScreen from "./QueueScreen";
import ProgressLabel from "./ProgressLabel";
import { useState } from "react";
import { usePlayerStore } from "../store/player";
import EqControls from "./EqControls";
import { VOLUME_MAX_DB, VOLUME_MIN_DB } from "../core/audio/engine";
import { useFavoritesStore } from "../store/favorites";
import { usePluginStore } from "../store/plugins";
import DragMeter from "./DragMeter";
import Visualizer from "./Visualizer";
import LyricsOverlay from "./LyricsOverlay";
import type { Track } from "../core/types";
import { isSpokenTrack } from "../core/listening";
import { PlaybackSpeedPicker, SpokenSkipButton } from "./SpokenControls";

function fmtTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "--:--";
  const s = Math.floor(sec % 60);
  const m = Math.floor(sec / 60) % 60;
  const h = Math.floor(sec / 3600);
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return `${mm}:${String(s).padStart(2, "0")}`;
}

function stateLabel(state: string): { text: string; cls: string } {
  switch (state) {
    case "playing":
      return { text: "Playing", cls: "" };
    case "paused":
      return { text: "Paused", cls: "is-paused" };
    case "buffering":
      return { text: "Buffering", cls: "is-paused" };
    case "seeking":
      return { text: "Seeking", cls: "is-paused" };
    default:
      return { text: "Stopped", cls: "is-paused" };
  }
}

function trackName(t: Track | null): string {
  if (!t) return "Nothing playing";
  if (t.streamTitle) return t.streamTitle;
  if (t.artist) return `${t.title} — ${t.artist}`;
  return t.title;
}

function sourceName(t: Track | null): string {
  if (!t) return "Playing";
  if (t.station) return t.station;
  switch (t.provider) {
    case "podcast":
      return "Podcasts";
    case "radio":
      return "Radio";
    case "local":
      return "Local";
    default:
      return t.provider || "Playing";
  }
}

interface NowPlayingProps {
  onOpenAppearance: () => void;
  immersive?: boolean;
  onImmersiveChange?: (enabled: boolean) => void;
}

export default function NowPlaying({ immersive = false, onImmersiveChange, onOpenAppearance }: NowPlayingProps) {
  const s = usePlayerStore();
  const favorites = useFavoritesStore();
  const [scrubPos, setScrubPos] = useState<number | null>(null);
  const [showLyrics, setShowLyrics] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showQueue, setShowQueue] = useState(false);
  const [hideImmersiveTitle, setHideImmersiveTitle] = useState(false);
  const pluginStatus = usePluginStore((s) => s.status);
  const playing =
    s.state === "playing" || s.state === "buffering" || s.state === "seeking";
  const st = stateLabel(s.state);
  const live = s.track?.stream === true || s.track?.live === true;
  const shownPos = scrubPos ?? s.position;
  const seekRatio = s.duration > 0 ? shownPos / s.duration : 0;
  const spoken = isSpokenTrack(s.track);

  if (showQueue) return <QueueScreen onClose={() => setShowQueue(false)} />;

  if (immersive) {
    return (
      <div className={"immersive-app" + (spoken ? " is-spoken" : "")}>
        <div className="immersive-track-line">
          {hideImmersiveTitle ? (
            <span className="name dim">[{sourceName(s.track)}]</span>
          ) : (
            <>
              <span className="glyph nf-icon" aria-hidden>{"\\uf001"}</span>
              <span className="name">{trackName(s.track)}</span>
            </>
          )}
        </div>

        <div className="immersive-time-status">
          <span>
            {fmtTime(shownPos)}
            {live ? " / LIVE" : ` / ${fmtTime(s.duration)}`}
          </span>
          <span className={"state " + st.cls}>{st.text}</span>
        </div>

        <div aria-hidden />

        <Visualizer immersive />

        <div aria-hidden />

        <div className="immersive-seek-row">
          {s.seekable ? (
            <DragMeter
              value={seekRatio}
              onRatio={(r) => {
                s.seek(r * s.duration);
                setScrubPos(null);
              }}
              onScrub={(r) => setScrubPos(r * s.duration)}
              label="Seek"
            />
          ) : (
            <div className="meter" aria-label="Live stream">
              <div className="fill" style={{ width: "100%" }} />
            </div>
          )}
        </div>

        <div className="immersive-controls">
          <button onClick={() => onImmersiveChange?.(false)} aria-label="Exit immersive visualizer">
            EXIT
          </button>
          <button onClick={() => void s.prev()} aria-label="Previous track">
            <span className="nf-icon transport-icon" aria-hidden>{"\uf048"}</span>
          </button>
          {spoken && <SpokenSkipButton seconds={-15} />}
          <button className="immersive-play" onClick={() => void s.toggle()} aria-label="Play or pause">
            <span className="nf-icon transport-icon" aria-hidden>
              {playing ? "\uf04c" : "\uf04b"}
            </span>
          </button>
          {spoken && <SpokenSkipButton seconds={30} />}
          <button onClick={() => void s.next()} aria-label="Next track">
            <span className="nf-icon transport-icon" aria-hidden>{"\uf051"}</span>
          </button>
          {spoken && <PlaybackSpeedPicker />}
          <button onClick={() => setHideImmersiveTitle((v) => !v)} aria-label="Toggle track title or source">
            {hideImmersiveTitle ? "TITLE" : "SOURCE"}
          </button>
        </div>

        <div aria-hidden />
      </div>
    );
  }

  return (
    <div className="app">
      <div className="app-titlebar">
        <h1 className="app-title">C L I A M P</h1>
        <span className="screen-label">Now Playing</span>
      </div>

      <section className="nowplaying panel panel-accent">
        <div className="track-line">
          <span className="glyph nf-icon" aria-hidden>
            {"\uf001"}
          </span>
          <span className="name">{trackName(s.track)}</span>
        </div>
        <div className="time-status">
          <span>
            {fmtTime(shownPos)}
            {live ? " / LIVE" : ` / ${fmtTime(s.duration)}`}
          </span>
          <span className={"state " + st.cls}>{st.text}</span>
        </div>
        {pluginStatus ? (
          <div className="plugin-status dim">{pluginStatus}</div>
        ) : null}

        <Visualizer onOpenFull={() => onImmersiveChange?.(true)} />

        {s.seekable ? (
          <DragMeter
            value={seekRatio}
            onRatio={(r) => {
              s.seek(r * s.duration);
              setScrubPos(null);
            }}
            onScrub={(r) => setScrubPos(r * s.duration)}
            label="Seek"
          />
        ) : (
          <div className="meter" aria-hidden>
            <div className="fill" style={{ width: "100%" }} />
          </div>
        )}

        <div className={"transport-row" + (spoken ? " is-spoken" : "")}>
          <button className="compact-more-toggle" onClick={() => setShowAdvanced(true)} aria-expanded={showAdvanced} aria-controls="advanced-controls">MORE</button>
          <div className="transport">
            <button onClick={() => void s.prev()} aria-label="Previous">
              <span className="nf-icon transport-icon" aria-hidden>{"\uf048"}</span>
            </button>
            {spoken && <SpokenSkipButton seconds={-15} />}
            <button className="btn-primary" onClick={() => void s.toggle()} aria-label="Play/Pause">
              <span className="nf-icon transport-icon" aria-hidden>
                {playing ? "\uf04c" : "\uf04b"}
              </span>
            </button>
            {spoken && <SpokenSkipButton seconds={30} />}
            <button onClick={() => void s.next()} aria-label="Next">
              <span className="nf-icon transport-icon" aria-hidden>{"\uf051"}</span>
            </button>
          </div>
          {spoken && <PlaybackSpeedPicker />}
        </div>

        <div className="mix">
          <div
            id="advanced-controls"
            className={"advanced-controls" + (showAdvanced ? " is-open" : "")}
          >
            <div className="advanced-header">
              <span>Playback options</span>
              <button
                className="advanced-close"
                onClick={() => setShowAdvanced(false)}
                aria-label="Close playback options"
              >
                Close
              </button>
            </div>
            <EqControls />
            <div className="help-row">
              <button className="key-pill" onClick={() => { setShowAdvanced(false); setShowQueue(true); }} aria-label="Open queue">
                Queue{s.queueCount ? ` (${s.queueCount})` : ""}
              </button>
              <span className="key-pill" onClick={() => s.setMono(!s.mono)} role="button">
                {s.mono ? "Mono" : "Stereo"}
              </span>
              <span className="key-pill" onClick={() => s.toggleShuffle()} role="button">
                Shuffle {s.shuffle === "on" ? "On" : "Off"}
              </span>
              <span className="key-pill" onClick={() => s.cycleRepeat()} role="button">
                Repeat {s.repeat === "off" ? "Off" : s.repeat === "all" ? "All" : "One"}
              </span>
              <button className="key-pill" onClick={onOpenAppearance} aria-label={`Choose theme: ${s.theme}`}>
                Theme {s.theme}
              </button>
              <span className="key-pill" onClick={() => setShowLyrics((v) => !v)} role="button">
                Lyrics {showLyrics ? "On" : "Off"}
              </span>
              {s.tracks.length > 1 ? <button className="key-pill" onClick={s.reversePlaylist}>Reverse list</button> : null}
              {s.track?.provider === "navidrome" ? (
                <label className="rating-control">Rating
                  <select aria-label="Track rating" value={s.track.rating ?? 0} disabled={s.ratingBusy}
                    onChange={(e) => void s.setTrackRating(Number(e.target.value))}>
                    {[0, 1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n ? `★ ${n}` : "Unrated"}</option>)}
                  </select>
                </label>
              ) : null}
            </div>
            <div className="volume-control">
              <label className="volume-label" htmlFor="player-volume">Player volume ({Math.round(s.volumeDb)} dB)</label>
              <input id="player-volume" type="range" aria-label="Player volume" min={VOLUME_MIN_DB} max={VOLUME_MAX_DB} step="1" value={s.volumeDb}
                onChange={(e) => s.setVolume(Number(e.target.value))} />
              <button onClick={() => s.setVolume(0)} aria-label="Reset player volume">Reset 0 dB</button>
            </div>
          </div>

        </div>
      </section>

      <div className="list" style={{ overflowY: "auto", flex: "1 1 auto" }}>
        {s.tracks.length === 0 ? (
          <div className="row dim">
            <span className="title">No tracks — open a source below</span>
          </div>
        ) : (
          s.tracks.map((t, i) => (
            <div
              className={"row queue-row" + (i === s.currentDisplay ? " is-active" : "")}
              key={t.path + i}
              onClick={() => void s.playDisplay(i)}
              role="button"
              aria-label={t.title}
            >
              <span className="queue-index">
                <span className="marker" aria-hidden>
                  {i === s.currentDisplay ? (playing ? <span className="nf-icon">{"\uf04b"}</span> : ">") : ""}
                </span>
                <span className="num">{i + 1}</span>
              </span>
              <span className="title">{t.title}<ProgressLabel track={t} /></span>
              <span className="queue-meta">
                {t.favorite ? (
                  <span className="marker is-fav" aria-hidden>
                    <span className="nf-icon">{"\uf004"}</span>
                  </span>
                ) : null}
                <span className="dur">
                  {t.stream ? "LIVE" : t.durationSecs ? fmtTime(t.durationSecs) : "--:--"}
                </span>
                <span
                  className={"queue-favorite-toggle marker" + (favorites.tracks.some((x) => x.path === t.path) ? " is-fav" : "")}
                  role="button"
                  aria-label="favorite"
                  onClick={(e) => {
                    e.stopPropagation();
                    favorites.toggle(t);
                  }}
                >
                  <span className="nf-icon">{"\uf005"}</span>
                </span>
              </span>
            </div>
          ))
        )}
      </div>

      <div className="footer">
        {s.recovery ? (
          <div className="recovery-controls" role="status"><span>{s.recovery.phase === "offline" ? "Waiting for connection…" : `Reconnecting ${s.recovery.attempt}/5…`}</span><button onClick={s.pause}>Pause</button></div>
        ) : s.error ? (
          <div className="recovery-controls"><span className="status-row is-error">{s.error}</span><button onClick={() => void s.retry()}>Retry</button></div>
        ) : (
          <div className="status-row">
            {s.track?.station ? `${s.track.station} · ` : ""}
            {playing ? "streaming" : s.track ? "ready" : "idle"}
          </div>
        )}
      </div>
      {showLyrics ? <LyricsOverlay onClose={() => setShowLyrics(false)} /> : null}
    </div>
  );
}

export { fmtTime };
