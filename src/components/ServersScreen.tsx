import { useState } from "react";
import { useServers, type ServerConfig } from "../store/servers";
import { SERVER_CATALOG, verifyServerConfig, type AvailableServerId } from "../providers/serverCatalog";
import NavidromeBrowser from "./NavidromeBrowser";
import ServerBrowser from "./ServerBrowser";
import PlexSetup from "./PlexSetup";
import PlexBrowser from "./PlexBrowser";
import QobuzScreen from "./QobuzScreen";
import { hasQobuzCallback, qobuzTestEnabled } from "../providers/qobuzAuth";
import { useQobuz } from "../store/qobuz";
import "../providers/navidrome"; // registers the provider (side-effect)

/** Show only servers with implemented authentication; verify before saving. */
export default function ServersScreen() {
  const servers = useServers();
  const qobuzSession = useQobuz((s) => s.session);
  const [qobuzVisible, setQobuzVisible] = useState(hasQobuzCallback);
  const [editing, setEditing] = useState<AvailableServerId | null>(null);
  const [browse, setBrowse] = useState<AvailableServerId | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<ServerConfig>({ url: "", user: "", password: "" });

  if (qobuzVisible) return <QobuzScreen onBack={() => setQobuzVisible(false)} />;
  if (browse) return browse === "navidrome" ? <NavidromeBrowser /> : browse === "plex" ? <PlexBrowser onBack={() => setBrowse(null)} /> : <ServerBrowser id={browse} />;
  if (editing === "plex") return <PlexSetup initial={servers.getConfig("plex")} onCancel={() => setEditing(null)} onConnected={(config) => {
    servers.saveConfig("plex", config); setEditing(null); setBrowse("plex");
  }} />;

  const open = (id: AvailableServerId) => {
    setError(null);
    const c = servers.getConfig(id);
    if (c) setForm({ url: c.url, user: c.user ?? "", password: c.password ?? "", token: c.token, libraries: c.libraries });
    else setForm({ url: "", user: "", password: "" });
    setEditing(id);
  };
  const save = async (id: AvailableServerId) => {
    if (busy) return;
    setBusy(true); setError(null);
    const config = { ...form, url: form.url.trim().replace(/\/+$/, ""), user: form.user?.trim(), token: form.token?.trim() };
    try {
      await verifyServerConfig(id, config);
      servers.saveConfig(id, config);
      setEditing(null);
      setBrowse(id);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not connect to server"); }
    finally { setBusy(false); }
  };

  return (
    <div className="app">
      <div className="app-titlebar">
        <h1 className="app-title">S E R V E R S</h1>
        <span className="screen-label">Self-hosted</span>
      </div>

      {editing ? (
        <div className="panel panel-accent" style={{ flex: 1, minHeight: 0 }}>
          <form onSubmit={(e) => { e.preventDefault(); void save(editing); }} style={{ display: "flex", flexDirection: "column", gap: "var(--gap)", padding: "var(--pad)", overflowY: "auto", height: "100%" }}>
            <h2 style={{ margin: 0, color: "var(--text-accent)" }}>Connect to {SERVER_CATALOG.find((s) => s.id === editing)?.name}</h2>
            <p className="dim" style={{ fontSize: "var(--fs-xs)", margin: 0 }}>
              cliamp-web is an independent, open-source music player, not an official sign-in page.
              Your server URL and credentials are saved in this device's browser localStorage,
              not on GitHub Pages or a cliamp-web server. Authentication goes directly from your
              browser to the server you choose. Only enter credentials for a server you trust.{" "}
              <a href="https://github.com/keylimesoda/cliamp-web" target="_blank" rel="noreferrer">View source</a>.
            </p>
            <input
              type="url"
              aria-label="Server URL"
              required disabled={busy}
              placeholder="Base URL (http://192.168.1.10:4005)"
              value={form.url}
              onChange={(e) => setForm({ ...form, url: e.target.value })}
              style={inputStyle}
            />
            <input
              type="text"
              aria-label="Username" autoComplete="username" disabled={busy}
              placeholder="Username"
              value={form.user ?? ""}
              onChange={(e) => setForm({ ...form, user: e.target.value })}
              style={inputStyle}
            />
            <input
              type="password"
              aria-label="Password" autoComplete="current-password" disabled={busy}
              placeholder="Password"
              value={form.password ?? ""}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              style={inputStyle}
            />
            {editing === "audiobookshelf" && <input type="password" disabled={busy} placeholder="API token (optional with username/password)" aria-label="API token" value={form.token || ""} onChange={(e) => setForm({ ...form, token: e.target.value })} style={inputStyle} />}
            {error && <div role="alert">{error}</div>}
            <div style={{ display: "flex", gap: "var(--gap)" }}>
              <button type="submit" disabled={busy} className="btn-accent" style={{ flex: 1 }}>
                {busy ? "Connecting…" : "Connect"}
              </button>
              <button type="button" disabled={busy} style={{ flex: 1 }} onClick={() => setEditing(null)}>
                Cancel
              </button>
            </div>
            <p className="dim" style={{ fontSize: "var(--fs-xs)", margin: 0 }}>
              The server must allow the PWA origin via CORS. Navidrome does by default.
            </p>
          </form>
        </div>
      ) : (
        <div className="panel" style={{ padding: "0.4rem", flex: 1, minHeight: 0 }}>
          <div className="list" style={{ overflowY: "auto", flex: 1 }}>
            {SERVER_CATALOG.map((s) => {
              const configured = servers.isConfigured(s.id);
              return (
                <div className="row" key={s.id} onClick={() => (configured ? setBrowse(s.id) : open(s.id))} role="button" aria-label={s.name}>
                  <span className={"marker" + (configured ? "" : " is-fav")} aria-hidden>
                    {configured ? "✓" : "✎"}
                  </span>
                  <span className="title">{s.name}</span>
                  <span className="dur">{configured ? "configured" : "setup"}</span>
                  {configured && <button aria-label={`Edit ${s.name}`} onClick={(e) => { e.stopPropagation(); open(s.id); }}>Edit</button>}
                </div>
              );
            })}
            {(qobuzTestEnabled() || qobuzSession) && <button className="row" aria-label="Qobuz browser test" onClick={() => setQobuzVisible(true)}>Qobuz {qobuzSession ? "connected" : "— browser test"}</button>}
          </div>
        </div>
      )}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  minHeight: "var(--tap-min)",
  padding: "0.5rem 0.8rem",
  fontFamily: "inherit",
  fontSize: "var(--fs-md)",
  color: "var(--text)",
  background: "var(--bg-sunken)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius)",
};
