import { useState } from "react";
import { usePlayerStore } from "../store/player";
import { EQ_BANDS_HZ } from "../core/eq";
import { VOLUME_MAX_DB, VOLUME_MIN_DB } from "../core/audio/engine";
import { THEME_NAMES } from "../themes/engine";
import { useFavoritesStore } from "../store/favorites";
import { usePluginStore } from "../store/plugins";
import DragMeter from "./DragMeter";
import Visualizer from "./Visualizer";
import LyricsOverlay from "./LyricsOverlay";
import type { Track } from "../core/types";

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
  immersive?: boolean;
  onImmersiveChange?: (enabled: boolean) => void;
}

export default function NowPlaying({ immersive = false, onImmersiveChange }: NowPlayingProps) {
  const s = usePlayerStore();
  const favorites = useFavoritesStore();
  const [scrubPos, setScrubPos] = useState<number | null>(null);
  const [showLyrics, setShowLyrics] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [hideImmersiveTitle, setHideImmersiveTitle] = useState(false);
  const pluginStatus = usePluginStore((s) => s.status);
  const playing =
    s.state === "playing" || s.state === "buffering" || s.state === "seeking";
  const st = stateLabel(s.state);
  const live = s.track?.stream === true || s.track?.live === true;
  const shownPos = scrubPos ?? s.position;
  const seekRatio = s.duration > 0 ? shownPos / s.duration : 0;
  const volRatio = (s.volumeDb - VOLUME_MIN_DB) / (VOLUME_MAX_DB - VOLUME_MIN_DB);

  if (immersive) {
    return (
      <div className="immersive-app">
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
          <button className="immersive-play" onClick={() => void s.toggle()} aria-label="Play or pause">
            <span className="nf-icon transport-icon" aria-hidden>
              {playing ? "\uf04c" : "\uf04b"}
            </span>
          </button>
          <button onClick={() => void s.next()} aria-label="Next track">
            <span className="nf-icon transport-icon" aria-hidden>{"\uf051"}</span>
          </button>
          <button onClick={() => s.setVolume(s.volumeDb - 1)} aria-label="Volume down">
            VOL -
          </button>
          <button onClick={() => s.setVolume(s.volumeDb + 1)} aria-label="Volume up">
            VOL +
          </button>
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

        <Visualizer />

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

        <div className="transport-row">
          <span aria-hidden />
          <div className="transport">
            <button onClick={() => void s.prev()} aria-label="Previous">
              <span className="nf-icon transport-icon" aria-hidden>{"\uf048"}</span>
            </button>
            <button className="btn-primary" onClick={() => void s.toggle()} aria-label="Play/Pause">
              <span className="nf-icon transport-icon" aria-hidden>
                {playing ? "\uf04c" : "\uf04b"}
              </span>
            </button>
            <button onClick={() => void s.next()} aria-label="Next">
              <span className="nf-icon transport-icon" aria-hidden>{"\uf051"}</span>
            </button>
          </div>
          <button
            className="viz-full-toggle"
            onClick={() => onImmersiveChange?.(true)}
            aria-label="Open full visualizer"
          >
            <span className="viz-full-glyph" aria-hidden>V</span>
          </button>
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
            <div className="eq-bands">
              {EQ_BANDS_HZ.map((hz, i) => (
                <div className="eq-band" key={hz} title={`${hz} Hz`}>
                  <span className="hz">{hz >= 1000 ? `${hz / 1000}k` : hz}</span>
                  <span className="db">
                    {s.eqGains[i] > 0 ? "+" + s.eqGains[i] : s.eqGains[i]}
                  </span>
                </div>
              ))}
            </div>
            <div className="help-row">
              <span className="key-pill" onClick={() => s.cyclePreset()} role="button">
                EQ {s.eqPreset}
              </span>
              <span className="key-pill" onClick={() => s.setMono(!s.mono)} role="button">
                {s.mono ? "Mono" : "Stereo"}
              </span>
              <span className="key-pill" onClick={() => s.toggleShuffle()} role="button">
                Shuffle {s.shuffle === "on" ? "On" : "Off"}
              </span>
              <span className="key-pill" onClick={() => s.cycleRepeat()} role="button">
                Repeat {s.repeat === "off" ? "Off" : s.repeat === "all" ? "All" : "One"}
              </span>
              <span
                className="key-pill"
                role="button"
                onClick={() => {
                  const i = THEME_NAMES.indexOf(s.theme);
                  s.setTheme(THEME_NAMES[(i + 1) % THEME_NAMES.length]);
                }}
              >
                Theme {s.theme}
              </span>
              <span className="key-pill" onClick={() => setShowLyrics((v) => !v)} role="button">
                Lyrics {showLyrics ? "On" : "Off"}
              </span>
            </div>
          </div>

          <div className="mix-primary">
            <div className="volume-control">
              <span className="volume-label">VOL</span>
              <DragMeter
                className="meter-green"
                value={volRatio}
                onRatio={(r) =>
                  s.setVolume(VOLUME_MIN_DB + r * (VOLUME_MAX_DB - VOLUME_MIN_DB))
                }
                label="Volume"
              />
            </div>
            <button
              className="compact-more-toggle"
              onClick={() => setShowAdvanced(true)}
              aria-expanded={showAdvanced}
              aria-controls="advanced-controls"
            >
              MORE
            </button>
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
              <span className="title">{t.title}</span>
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
        {s.error ? (
          <div className="status-row is-error">ERR: {s.error}</div>
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
