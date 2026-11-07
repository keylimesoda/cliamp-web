import { create } from "zustand";
import { QobuzClient, type QobuzQuality, type QobuzSession } from "../providers/qobuzClient";
import { clearQobuzCallback, completeQobuzSignIn } from "../providers/qobuzAuth";
interface Saved { session: QobuzSession & { label: string }; quality: QobuzQuality; }
const KEY = "cliamp-web:qobuz-session";
function read(): Saved | null {
  try {
    const data = JSON.parse(localStorage.getItem(KEY) || "null");
    const s = data?.session;
    if (!s || ![s.appId, s.signingSecret, s.userToken, s.userId, s.label].every((v) => typeof v === "string" && v.length)) return null;
    return { session: s, quality: [5, 6, 7, 27].includes(data.quality) ? data.quality : 6 };
  } catch { return null; }
}
const saved = read();
export const useQobuz = create<{
  session: Saved["session"] | null; quality: QobuzQuality;
  connect: (session: Saved["session"]) => void; disconnect: () => void; setQuality: (quality: QobuzQuality) => void;
}>((set, get) => {
  const persist = () => {
    const s = get();
    if (s.session) localStorage.setItem(KEY, JSON.stringify({ session: s.session, quality: s.quality }));
    else localStorage.removeItem(KEY);
  };
  return {
    session: saved?.session || null, quality: saved?.quality || 6,
    connect(session) { set({ session }); persist(); },
    disconnect() { cancelQobuzSignIn(); set({ session: null }); persist(); },
    setQuality(quality) { if ([5, 6, 7, 27].includes(quality)) { set({ quality }); persist(); } },
  };
});

export function qobuzClient(): QobuzClient {
  const state = useQobuz.getState();
  if (!state.session) throw new Error("Sign in to Qobuz first");
  return new QobuzClient(state.session, state.quality);
}

let completion: Promise<void> | null = null;
let controller: AbortController | null = null;
export function cancelQobuzSignIn(): void {
  controller?.abort(); completion = null; controller = null;
  sessionStorage.removeItem("cliamp-web:qobuz-pending"); clearQobuzCallback();
}
export function finishQobuzSignIn(raw?: string, manual = false): Promise<void> {
  if (completion) return completion;
  const current = new AbortController(); controller = current;
  completion = completeQobuzSignIn(raw, manual, current.signal).then((session) => {
    current.signal.throwIfAborted(); useQobuz.getState().connect(session); clearQobuzCallback();
  }).catch((e) => { clearQobuzCallback(); throw e; })
    .finally(() => { if (controller === current) { completion = null; controller = null; } });
  return completion;
}
