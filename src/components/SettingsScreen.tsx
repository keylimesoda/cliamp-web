import { usePluginStore } from "../store/plugins";
import { usePlayerStore } from "../store/player";
import { THEME_NAMES, THEMES } from "../themes/engine";

/**
 * Appearance settings and Lua plugins share the less frequently used controls.
 * Theme changes apply immediately and use the player's existing persistence.
 */
export default function SettingsScreen() {
  const theme = usePlayerStore((s) => s.theme);
  const setTheme = usePlayerStore((s) => s.setTheme);
  const colors = THEMES[theme] ?? THEMES.winamp;
  const plugins = usePluginStore((s) => s.plugins);
  const logs = usePluginStore((s) => s.logs);
  const status = usePluginStore((s) => s.status);
  const toggle = usePluginStore((s) => s.toggle);

  return (
    <div className="app">
      <div className="app-titlebar">
        <h1 className="app-title">S E T T I N G S</h1>
        <span className="screen-label">Appearance &amp; plugins</span>
      </div>

      <section className="panel appearance-settings" aria-labelledby="appearance-heading">
        <div className="theme-picker">
          <div>
            <h2 id="appearance-heading">Appearance</h2>
            <label htmlFor="theme-picker">Theme</label>
          </div>
          <select id="theme-picker" value={theme} onChange={(e) => setTheme(e.target.value)}>
            {THEME_NAMES.map((name) => (
              <option key={name} value={name}>
                {name.split("-").map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ")}
              </option>
            ))}
          </select>
        </div>
        <div className="theme-preview" aria-hidden="true" style={{ background: colors.bg, color: colors.brightFg }}>
          <span style={{ color: colors.accent }}>CLIAMP</span>
          <span className="theme-swatches">
            {[colors.accent, colors.brightFg, colors.fg, colors.green, colors.yellow, colors.red].map((color, i) => (
              <span key={i} style={{ background: color }} />
            ))}
          </span>
          <span style={{ color: colors.green }}>♫</span>
        </div>
      </section>

      <div className="panel" style={{ padding: "0.4rem", flex: 1, minHeight: 0, display: "flex", flexDirection: "column", gap: "var(--gap)" }}>
        <h2 className="settings-heading">Plugins</h2>
        {status ? (
          <div className="row" style={{ cursor: "default" }}>
            <span className="marker" aria-hidden>▸</span>
            <span className="title">{status}</span>
          </div>
        ) : null}

        <div className="list" style={{ overflowY: "auto", flex: 1, minHeight: 0 }}>
          {plugins.length === 0 ? (
            <div className="row" style={{ cursor: "default" }}>
              <span className="marker" aria-hidden>·</span>
              <span className="title dim">no plugins loaded</span>
            </div>
          ) : (
            plugins.map((p) => (
              <div className="row" key={p.name} style={{ cursor: "default" }}>
                <span className={`marker ${p.enabled ? "is-fav" : ""}`} aria-hidden>
                  {p.enabled ? "●" : "○"}
                </span>
                <span className="title">
                  {p.meta.name}
                  {p.meta.description ? <span className="dim"> — {p.meta.description}</span> : null}
                </span>
                <button
                  className="btn-accent"
                  style={{ minHeight: "var(--tap-min)" }}
                  onClick={() => toggle(p.name)}
                >
                  {p.enabled ? "Disable" : "Enable"}
                </button>
              </div>
            ))
          )}
        </div>

        <div className="panel" style={{ padding: "0.4rem", maxHeight: "38%", overflowY: "auto" }}>
          <div className="screen-label" style={{ marginBottom: "0.2rem" }}>Log</div>
          {logs.length === 0 ? (
            <div className="dim" style={{ fontFamily: "var(--mono)" }}>— no log output —</div>
          ) : (
            logs.map((line, i) => (
              <div key={i} className="dim" style={{ fontFamily: "var(--mono)", fontSize: "0.72rem", whiteSpace: "pre-wrap" }}>
                {line}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
