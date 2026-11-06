import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { qobuzCallbackParams, qobuzSignInUrl } from "./qobuzAuth";
const values = new Map<string, string>();
beforeEach(() => {
  values.clear();
  vi.stubGlobal("sessionStorage", { getItem: (k: string) => values.get(k) || null, setItem: (k: string, v: string) => values.set(k, v), removeItem: (k: string) => values.delete(k) });
  vi.stubGlobal("location", { origin: "https://app.test", search: "", href: "https://app.test/cliamp-web/" });
  vi.stubGlobal("document", { baseURI: "https://app.test/cliamp-web/" });
});
afterEach(() => vi.unstubAllGlobals());
const pending = (state = "nonce", at = Date.now()) => values.set("cliamp-web:qobuz-pending", JSON.stringify({ state, at }));
it("rejects automatic callbacks without matching state, origin, or a fresh pending login", () => {
  pending();
  expect(() => qobuzCallbackParams("https://app.test/cliamp-web/?code=anything")).toThrow("expected sign-in state");
  expect(() => qobuzCallbackParams("https://other.test/?qobuz_state=nonce&code=anything")).toThrow("expected sign-in state");
  pending("nonce", Date.now() - 11 * 60 * 1000);
  expect(() => qobuzCallbackParams("https://app.test/?qobuz_state=nonce&code=anything")).toThrow("expired");
});
it("accepts an explicit localhost handoff only for a pending login", () => {
  expect(() => qobuzCallbackParams("http://localhost:19873/?code=fixture", true)).toThrow("expired");
  pending();
  expect(qobuzCallbackParams("http://localhost:19873/?code_autorisation=fixture", true).get("code_autorisation")).toBe("fixture");
  expect(() => qobuzCallbackParams("https://attacker.test/?code=fixture", true)).toThrow("localhost return URL");
});
it("constructs a hosted OAuth URL with per-attempt state without collecting a password", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ appId: "fixture-app", secrets: ["fixture-secret"], oauthKey: "fixture-key" }))));
  const url = new URL(await qobuzSignInUrl());
  expect(url.origin).toBe("https://www.qobuz.com");
  const redirect = new URL(url.searchParams.get("redirect_url")!);
  expect(redirect.origin).toBe("https://app.test");
  expect(redirect.pathname).toBe("/cliamp-web/");
  expect(redirect.searchParams.get("qobuz_state")).toBe(JSON.parse(values.get("cliamp-web:qobuz-pending")!).state);
  expect(url.searchParams.has("password")).toBe(false);
});
