import { useEffect, useRef, useState } from "react";
import type { ServerConfig } from "../store/servers";
import { checkPlexPin, createPlexPin, discoverPlexServers, plexServerConfig, type PlexPin, type PlexServer } from "../providers/plexAuth";
import { connectPlexServer } from "../providers/plexConnection";

function delay(signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, 2000);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
}

export default function PlexSetup({ initial, onConnected, onCancel }: {
  initial?: ServerConfig; onConnected: (config: ServerConfig) => void; onCancel: () => void;
}) {
  const controller = useRef<AbortController | null>(null);
  const [pin, setPin] = useState<PlexPin | null>(null);
  const [servers, setServers] = useState<PlexServer[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState(false);
  const [url, setUrl] = useState(initial?.url || "");
  const [token, setToken] = useState(initial?.token || "");
  useEffect(() => () => controller.current?.abort(), []);
  const begin = () => {
    controller.current?.abort();
    const next = new AbortController(); controller.current = next;
    setError(null); setBusy(true); return next.signal;
  };
  const fail = (e: unknown, signal: AbortSignal) => {
    if (!signal.aborted) { setError(e instanceof Error ? e.message : "Could not connect to Plex"); setBusy(false); }
  };
  const link = async () => {
    const signal = begin(); setPin(null); setServers(null);
    try {
      const p = await createPlexPin(signal); signal.throwIfAborted(); setPin(p); setBusy(false);
      let accountToken: string | null = null;
      while (!accountToken) { await delay(signal); accountToken = await checkPlexPin(p, signal); }
      signal.throwIfAborted(); setBusy(true); setPin(null);
      const discovered = await discoverPlexServers(accountToken, signal);
      signal.throwIfAborted(); setServers(discovered); setBusy(false);
      if (!discovered.length) setError("No Plex servers with secure connections were found. Check your home server's Remote Access settings.");
    } catch (e) { if (!signal.aborted) setPin(null); fail(e, signal); }
  };
  const connect = async (config: ServerConfig) => {
    const signal = begin();
    try { const verified = await connectPlexServer(config, signal); signal.throwIfAborted(); onConnected(verified); }
    catch (e) { fail(e, signal); }
  };
  return <div className="app source-browser">
    <div className="app-titlebar"><button onClick={onCancel}>Back</button><h1 className="app-title">Connect to Plex</h1></div>
    <div className="panel scroll-panel" style={{ overflowY: "auto", padding: "var(--pad)", display: "flex", flexDirection: "column", gap: "var(--gap)" }}>
      <p>Listen to music from your home Plex server. Remote Access and a secure connection must be available from the car.</p>
      <p className="dim" style={{ fontSize: "var(--fs-xs)", margin: 0 }}>
        cliamp-web is an independent, open-source music player, not affiliated with Plex.
        Account linking takes place on plex.tv. Connected server tokens are stored in this
        device's browser localStorage, not on a cliamp-web server.
      </p>
      <button disabled={busy} onClick={() => { setManual(false); void link(); }}>{pin ? "Create a new code" : "Link Plex account"}</button>
      {pin && !manual && <div role="status">
        On your phone, open <a href={`https://plex.tv/link/?pin=${encodeURIComponent(pin.code)}`} target="_blank" rel="noreferrer">plex.tv/link</a> and enter:
        <p style={{ fontSize: "2rem", letterSpacing: ".25em", color: "var(--text-accent)" }} aria-label="Plex linking code">{pin.code}</p>
        Waiting for approval. This code expires in a few minutes.
      </div>}
      {busy && <div role="status">Connecting to Plex…</div>}
      {error && <div role="alert">{error}</div>}
      {!manual && servers && <div className="list">
        {servers.map((server) => <button key={server.id} disabled={busy} onClick={() => void connect(plexServerConfig(server))}>Connect to {server.name}</button>)}
      </div>}
      <button disabled={busy} onClick={() => { controller.current?.abort(); setPin(null); setError(null); setManual((v) => !v); }}> {manual ? "Hide manual setup" : "Use server URL and token"}</button>
      {manual && <form onSubmit={(e) => { e.preventDefault(); void connect({ ...(url.trim() === initial?.url ? initial : {}), url: url.trim(), token: token.trim() }); }} style={{ display: "flex", flexDirection: "column", gap: "var(--gap)" }}>
        <input aria-label="Plex server URL" type="url" required disabled={busy} placeholder="https://your-server.plex.direct:32400" value={url} onChange={(e) => setUrl(e.target.value)} />
        <input aria-label="Plex token" type="password" required disabled={busy} value={token} onChange={(e) => setToken(e.target.value)} />
        <button type="submit" disabled={busy}>Connect to Plex server</button>
      </form>}
    </div>
  </div>;
}
