import { useEffect, useState } from "react";
import { hasQobuzCallback, qobuzSignInUrl } from "../providers/qobuzAuth";
import { cancelQobuzSignIn, finishQobuzSignIn, useQobuz } from "../store/qobuz";
import QobuzBrowser from "./QobuzBrowser";

export default function QobuzScreen({ onBack }: { onBack: () => void }) {
  const session = useQobuz((s) => s.session);
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState(false), [returnedUrl, setReturnedUrl] = useState("");
  useEffect(() => {
    if (!hasQobuzCallback()) return;
    let live = true; setBusy(true);
    void finishQobuzSignIn().catch((e) => { if (live) setError(e instanceof Error ? e.message : "Qobuz sign-in failed"); })
      .finally(() => { if (live) setBusy(false); });
    return () => { live = false; };
  }, []);
  const signIn = async (manualReturn: boolean) => {
    setBusy(true); setError(null);
    try { location.assign(await qobuzSignInUrl(manualReturn)); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not open Qobuz sign-in"); setBusy(false); }
  };
  if (session && !busy) return <QobuzBrowser onBack={onBack} />;
  return <div className="app source-browser">
    <div className="app-titlebar"><button onClick={() => { cancelQobuzSignIn(); onBack(); }}>Back</button><h1 className="app-title">Qobuz browser test</h1></div>
    <div className="panel scroll-panel" style={{ overflowY: "auto", padding: "var(--pad)", display: "flex", flexDirection: "column", gap: "var(--gap)" }}>
      <p>Experimental browser-only connection. Sign in on Qobuz's own page with your streaming account. Automatic return to this app still needs real-account verification.</p>
      {busy && <div role="status">Checking Qobuz authorization and streaming access…</div>}
      {error && <div role="alert">{error}</div>}
      <button disabled={busy} onClick={() => void signIn(false)}>Sign in to Qobuz</button>
      <button disabled={busy} onClick={() => setManual((v) => !v)}>Manual return option</button>
      {manual && <>
        <p>If automatic return is rejected, use the localhost handoff supported by native cliamp. After signing in, press Qobuz's Back button. Copy the localhost address from the browser's error page, return here, and paste it below.</p>
        <button disabled={busy} onClick={() => void signIn(true)}>Sign in using manual return</button>
        <form className="playlist-name-form" onSubmit={(e) => {
          e.preventDefault(); setBusy(true); setError(null);
          void finishQobuzSignIn(returnedUrl, true).catch((e) => setError(e instanceof Error ? e.message : "Qobuz sign-in failed")).finally(() => setBusy(false));
        }}><input aria-label="Qobuz return URL" type="url" value={returnedUrl} onChange={(e) => setReturnedUrl(e.target.value)} required disabled={busy} autoComplete="off" placeholder="http://localhost:19873/?code_autorisation=…" /><button disabled={busy} type="submit">Complete sign-in</button></form>
      </>}
    </div>
  </div>;
}
