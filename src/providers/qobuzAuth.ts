import { QobuzClient, type QobuzSession } from "./qobuzClient";
const PENDING = "cliamp-web:qobuz-pending";
const API = "https://www.qobuz.com/api.json/0.2/";
interface Bootstrap { appId: string; secrets: string[]; oauthKey: string; generatedAt: string; }
interface Pending { state: string; at: number; }

export function qobuzTestEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (new URLSearchParams(location.search).get("qobuz-test") === "1") sessionStorage.setItem("cliamp-web:qobuz-test", "1");
    return sessionStorage.getItem("cliamp-web:qobuz-test") === "1";
  } catch { return false; }
}
export function hasQobuzCallback(): boolean {
  const q = new URLSearchParams(location.search);
  return q.has("qobuz_state") || q.has("code_autorisation") || q.has("user_auth_token");
}

async function bootstrap(signal?: AbortSignal): Promise<Bootstrap> {
  const response = await fetch(new URL("qobuz-bootstrap.json", document.baseURI), { cache: "no-store", signal });
  if (!response.ok) throw new Error("This build does not include the Qobuz browser test. The public bootstrap must be generated when building.");
  const data = await response.json() as Bootstrap;
  if (!data.appId || !data.oauthKey || !Array.isArray(data.secrets) || !data.secrets.length) throw new Error("Qobuz public bootstrap is incomplete");
  return data;
}

export async function qobuzSignInUrl(manual = false, signal?: AbortSignal): Promise<string> {
  const data = await bootstrap(signal);
  const state = crypto.randomUUID();
  sessionStorage.setItem(PENDING, JSON.stringify({ state, at: Date.now() }));
  const redirect = manual ? new URL("http://localhost:19873/") : new URL("./", document.baseURI);
  if (!manual) redirect.searchParams.set("qobuz-test", "1");
  if (!manual) redirect.searchParams.set("qobuz_state", state);
  const url = new URL("https://www.qobuz.com/signin/oauth");
  url.search = new URLSearchParams({ ext_app_id: data.appId, redirect_url: redirect.href, state }).toString();
  return url.href;
}

export function qobuzCallbackParams(raw: string, manual = false): URLSearchParams {
  const url = new URL(raw);
  let pending: Pending;
  try { pending = JSON.parse(sessionStorage.getItem(PENDING) || "null"); } catch { throw new Error("No pending Qobuz sign-in"); }
  if (typeof pending?.state !== "string" || !pending.state || !Number.isFinite(pending.at)
    || Date.now() - pending.at < 0 || Date.now() - pending.at > 10 * 60 * 1000) throw new Error("Qobuz sign-in expired. Start again.");
  if (manual) {
    if (url.hostname !== "localhost" || url.protocol !== "http:") throw new Error("Paste the localhost return URL from your Qobuz sign-in");
  } else if (url.origin !== location.origin || (url.searchParams.get("qobuz_state") || url.searchParams.get("state")) !== pending.state) {
    throw new Error("Qobuz did not return the expected sign-in state. Start again or use the manual return option.");
  }
  if (url.searchParams.has("error")) throw new Error("Qobuz declined authorization");
  return url.searchParams;
}

export function clearQobuzCallback(): void {
  const url = new URL(location.href);
  for (const k of ["code", "code_autorisation", "user_auth_token", "token", "user_id", "qobuz_state", "state", "error"]) url.searchParams.delete(k);
  history.replaceState(null, "", url);
}

export async function completeQobuzSignIn(raw = location.href, manual = false, signal?: AbortSignal): Promise<QobuzSession & { label: string }> {
  const q = qobuzCallbackParams(raw, manual), data = await bootstrap(signal);
  const api = async (endpoint: string, token?: string, params?: URLSearchParams, method = "POST") => {
    const url = new URL(endpoint, API);
    if (method === "GET" && params) url.search = params.toString();
    const response = await fetch(url, { method, headers: { "X-App-Id": data.appId, ...(token ? { "X-User-Auth-Token": token } : {}), ...(method === "POST" ? { "Content-Type": "application/x-www-form-urlencoded" } : {}) },
      ...(method === "POST" ? { body: params || new URLSearchParams({ extra: "partner" }) } : {}), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`Qobuz authorization failed (${response.status})`);
    return await response.json();
  };
  let token = q.get("user_auth_token") || q.get("token");
  const code = q.get("code_autorisation") || q.get("code");
  if (!token && code) {
    let lastError: unknown;
    for (const [method, key] of [["GET", "code"], ["POST", "code"], ["GET", "code_autorisation"], ["POST", "code_autorisation"]]) {
      try {
        const result = await api("oauth/callback", undefined, new URLSearchParams({ [key]: code, app_id: data.appId, private_key: data.oauthKey }), method);
        token = result.token || result.user_auth_token;
        if (token) break;
      } catch (e) { signal?.throwIfAborted(); lastError = e; }
    }
    if (!token && lastError) throw new Error(lastError instanceof TypeError ? "Qobuz token exchange was blocked by the browser or network. The hosted browser flow is not yet verified." : lastError instanceof Error ? lastError.message : "Qobuz code exchange failed");
  }
  if (!token) throw new Error("Qobuz returned no authorization token");
  const info = await api("user/login", token);
  if (!info.user?.credential?.parameters || info.user.id == null) throw new Error("This Qobuz account is not eligible for streaming");
  const userId = String(info.user.id);
  for (const signingSecret of data.secrets) {
    signal?.throwIfAborted();
    const session = { appId: data.appId, signingSecret, userToken: token, userId };
    try {
      await new QobuzClient(session, 5).resolve({ path: "qobuz://track/5966783", title: "Connection check", provider: "qobuz", providerMeta: { trackId: "5966783", userId } }, signal);
      sessionStorage.removeItem(PENDING);
      return { ...session, label: info.user.credential.parameters.short_label || "Qobuz" };
    } catch { signal?.throwIfAborted(); }
  }
  throw new Error("Qobuz did not accept the public stream-signing material. The test build may need a fresh bootstrap, or this API path may no longer be supported.");
}
