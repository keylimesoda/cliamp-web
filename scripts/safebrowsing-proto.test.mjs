import test from "node:test";
import assert from "node:assert/strict";
import { decodeSearchUrlsResponse } from "./safebrowsing-proto.mjs";

const vi = n => {
  const bytes = [];
  do { let x = n % 128; n = Math.floor(n / 128); if (n) x |= 128; bytes.push(x); } while (n);
  return bytes;
};
const wire = (field, kind, content) => kind === 2
  ? [ ...vi(field * 8 + kind), ...vi(content.length), ...content ]
  : [ ...vi(field * 8 + kind), ...vi(content) ];
const str = s => [...new TextEncoder().encode(s)];
const asBytes = bytes => Uint8Array.from(bytes);
const cache = wire(2, 2, wire(1, 0, 300));

test("negative lookup: only cache duration, no threats", () => {
  assert.deepEqual(decodeSearchUrlsResponse(asBytes(cache)), { threats: [] });
});
test("malware and social engineering found (packed enums)", () => {
  const url = "https://keylimesoda.github.io/cliamp-web/";
  const threat = [ ...wire(1, 2, str(url)), ...wire(2, 2, [1, 2]) ];
  const msg = [...wire(1, 2, threat), ...cache];
  assert.deepEqual(decodeSearchUrlsResponse(asBytes(msg)), { threats: [{
    url, threatTypes: ["MALWARE", "SOCIAL_ENGINEERING"]
  }] });
});
test("unpacked enum, unknown type and nonessential unknown field", () => {
  const threat = [ ...wire(1, 2, str("https://example.com/")), ...wire(2, 0, 99) ];
  const msg = [...wire(1, 2, threat), ...wire(9, 0, 7), ...cache];
  assert.deepEqual(decodeSearchUrlsResponse(asBytes(msg)).threats[0].threatTypes, ["UNKNOWN(99)"]);
});
test("malformed or unrecognized payloads are not reported as clean", () => {
  for (const msg of [[], [0x0a, 0x07, 0x0a], [0x12, 0x09, 0x08, 0x05], [0x08, 0x01], wire(9, 0, 123)]) {
    assert.throws(() => decodeSearchUrlsResponse(asBytes(msg)));
  }
});
test("malformed threat entries cannot be mistaken for a clean lookup", () => {
  assert.throws(() => decodeSearchUrlsResponse(asBytes([
    ...wire(1, 2, wire(1, 2, str("abc"))), ...cache
  ])));
});
