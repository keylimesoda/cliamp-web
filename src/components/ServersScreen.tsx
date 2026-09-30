import { useState } from "react";
import { useServers, type ServerConfig, type ServerId } from "../store/servers";
import NavidromeBrowser from "./NavidromeBrowser";
import ServerBrowser from "./ServerBrowser";
import "../providers/navidrome"; // registers the provider (side-effect)

const SERVERS: { id: ServerId; name: string; needsCreds: boolean }[] = [
  { id: "navidrome", name: "Navidrome", needsCreds: true },
  { id: "jellyfin", name: "Jellyfin", needsCreds: true },
  { id: "emby", name: "Emby", needsCreds: true },
  { id: "plex", name: "Plex", needsCreds: true },
  { id: "audiobookshelf", name: "Audiobookshelf", needsCreds: true },
  { id: "lyrion", name: "Lyrion (LMS)", needsCreds: false },
];

/**
 * Self-hosted servers screen — configure a music server (base URL +
 * credentials) and open its browser. Navidrome is fully implemented
 * (Subsonic, works out-of-the-box); the others require the server to
 * permit the PWA origin via CORS.
 */
export default function ServersScreen() {
  const servers = useServers();
  const [editing, setEditing] = useState<ServerId | null>(null);
  const [browse, setBrowse] = useState<ServerId | null>(null);
  const [form, setForm] = useState<ServerConfig>({ url: "", user: "", password: "" });

  if (browse) return browse === "navidrome" ? <NavidromeBrowser /> : <ServerBrowser id={browse} />;

  const open = (id: ServerId) => {
    const c = servers.getConfig(id);
    if (c) setForm({ url: c.url, user: c.user ?? "", password: c.password ?? "", token: c.token, libraries: c.libraries });
    else setForm({ url: "", user: "", password: "" });
    setEditing(id);
  };
  const save = (id: ServerId) => {
    servers.saveConfig(id, form);
    setEditing(null);
    setBrowse(id);
  };

  return (
    <div className="app">
      <div className="app-titlebar">
        <h1 className="app-title">S E R V E R S</h1>
        <span className="screen-label">Self-hosted</span>
      </div>

      {editing ? (
        <div className="panel panel-accent" style={{ flex: 1, minHeight: 0 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--gap)", padding: "var(--pad)" }}>
            <h2 style={{ margin: 0, color: "var(--text-accent)" }}>Configure {SERVERS.find((s) => s.id === editing)?.name}</h2>
            <input
              type="url"
              placeholder="Base URL (http://192.168.1.10:4005)"
              value={form.url}
              onChange={(e) => setForm({ ...form, url: e.target.value })}
              style={inputStyle}
            />
            <input
              type="text"
              placeholder="Username"
              value={form.user ?? ""}
              onChange={(e) => setForm({ ...form, user: e.target.value })}
              style={inputStyle}
            />
            <input
              type="password"
              placeholder="Password"
              value={form.password ?? ""}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              style={inputStyle}
            />
            <div style={{ display: "flex", gap: "var(--gap)" }}>
              <button className="btn-accent" style={{ flex: 1 }} onClick={() => save(editing)}>
                Save
              </button>
              <button style={{ flex: 1 }} onClick={() => setEditing(null)}>
                Cancel
              </button>
            </div>
            <p className="dim" style={{ fontSize: "var(--fs-xs)", margin: 0 }}>
              The server must allow the PWA origin via CORS. Navidrome does by default.
            </p>
          </div>
        </div>
      ) : (
        <div className="panel" style={{ padding: "0.4rem", flex: 1, minHeight: 0 }}>
          <div className="list" style={{ overflowY: "auto", flex: 1 }}>
            {SERVERS.map((s) => {
              const configured = servers.isConfigured(s.id, s.needsCreds);
              return (
                <div className="row" key={s.id} onClick={() => (configured ? setBrowse(s.id) : open(s.id))} role="button" aria-label={s.name}>
                  <span className={"marker" + (configured ? "" : " is-fav")} aria-hidden>
                    {configured ? "✓" : "✎"}
                  </span>
                  <span className="title">{s.name}</span>
                  <span className="dur">{configured ? "configured" : "setup"}</span>
                </div>
              );
            })}
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
