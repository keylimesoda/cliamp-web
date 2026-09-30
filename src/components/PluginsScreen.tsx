import { usePluginStore } from "../store/plugins";

/**
 * Plugins screen — lists the Lua plugins (bundled + any loaded), toggles them
 * on/off, and shows their live log output (cliamp.log / load errors) plus the
 * latest transient status message (cliamp.message / cliamp.notify).
 */
export default function PluginsScreen() {
  const plugins = usePluginStore((s) => s.plugins);
  const logs = usePluginStore((s) => s.logs);
  const status = usePluginStore((s) => s.status);
  const toggle = usePluginStore((s) => s.toggle);

  return (
    <div className="app">
      <div className="app-titlebar">
        <h1 className="app-title">P L U G I N S</h1>
        <span className="screen-label">Lua hooks</span>
      </div>

      <div className="panel" style={{ padding: "0.4rem", flex: 1, minHeight: 0, display: "flex", flexDirection: "column", gap: "var(--gap)" }}>
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
              <button
                type="button"
                className={`plugin-row ${p.enabled ? "is-enabled" : ""}`}
                key={p.name}
                aria-pressed={p.enabled}
                onClick={() => toggle(p.name)}
              >
                <span className="plugin-marker" aria-hidden>
                  {p.enabled ? "●" : "○"}
                </span>
                <span className="plugin-title">
                  {p.meta.name}
                  {p.meta.description ? <span className="dim"> — {p.meta.description}</span> : null}
                </span>
                <span className="plugin-state">
                  {p.enabled ? "ENABLED" : "DISABLED"}
                </span>
              </button>
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
