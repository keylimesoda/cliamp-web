import { test } from "vitest";
import assert from "node:assert/strict";
import { parseQobuzBundle } from "../scripts/qobuz-bootstrap.mjs";

test("extracts the native seed/info/extras layout without account credentials", () => {
  const seed = Buffer.from("fixture-signing-secret").toString("base64") + "A".repeat(44);
  const source = `production:{api:{appId:"123456789",appSecret:"${"x".repeat(32)}" a.initialSeed("${seed.slice(0, 8)}",window.utimezone.paris) name:"Europe/Paris",info:"${seed.slice(8, 16)}",extras:"${seed.slice(16)}" oauthKey:"fixture-oauth-key"`;
  assert.deepEqual(parseQobuzBundle(source), { appId: "123456789", secrets: ["fixture-signing-secret"], oauthKey: "fixture-oauth-key" });
});
test("fails closed when Qobuz changes its bundle shape", () => {
  assert.throws(() => parseQobuzBundle("unrecognized bundle"), /identity/);
});
