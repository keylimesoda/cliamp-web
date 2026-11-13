/**
 * Decode Safe Browsing v5 SearchUrlsResponse (binary Protocol Buffers).
 * threats (field 1) -> ThreatUrl {url (1), threat_types (2)}
 * cache_duration (field 2) -> google.protobuf.Duration.
 * https://developers.google.com/safe-browsing/reference/rest/v5/urls/search
 * Malformed or unrecognized responses throw rather than yielding a clean verdict.
 */
const utf8 = new TextDecoder("utf-8", { fatal: true });
const threatNames = [
  "THREAT_TYPE_UNSPECIFIED", "MALWARE", "SOCIAL_ENGINEERING",
  "UNWANTED_SOFTWARE", "POTENTIALLY_HARMFUL_APPLICATION",
];

function readVarint(bytes, offset) {
  let value = 0;
  for (let i = 0; i < 5; i++) {
    if (offset >= bytes.length) throw new Error("Truncated protobuf varint");
    const byte = bytes[offset++];
    value += (byte & 0x7f) * (2 ** (i * 7));
    if (!(byte & 0x80)) return [value, offset];
  }
  throw new Error("Protobuf varint exceeds supported 32-bit size");
}

function* fields(bytes) {
  let offset = 0;
  while (offset < bytes.length) {
    const [tag, next] = readVarint(bytes, offset);
    offset = next;
    const field = Math.floor(tag / 8), wire = tag % 8;
    if (field === 0) throw new Error("Invalid protobuf field number zero");
    let value;
    if (wire === 0) {
      [value, offset] = readVarint(bytes, offset);
    } else if (wire === 2) {
      let length;
      [length, offset] = readVarint(bytes, offset);
      if (length > bytes.length - offset) throw new Error("Truncated protobuf length-delimited field");
      value = bytes.subarray(offset, offset + length);
      offset += length;
    } else if (wire === 1 || wire === 5) {
      const length = wire === 1 ? 8 : 4;
      if (length > bytes.length - offset) throw new Error("Truncated protobuf fixed-width field");
      value = bytes.subarray(offset, offset + length);
      offset += length;
    } else {
      throw new Error(`Unsupported protobuf wire type ${wire}`);
    }
    yield { field, wire, value };
  }
}

function parseThreat(bytes) {
  let url;
  const typeIds = [];
  for (const f of fields(bytes)) {
    if (f.field === 1) {
      if (f.wire !== 2) throw new Error("Unexpected threat URL wire type");
      url = utf8.decode(f.value);
    } else if (f.field === 2) {
      if (f.wire === 0) typeIds.push(f.value);
      else if (f.wire === 2) {
        let offset = 0;
        while (offset < f.value.length) {
          let value;
          [value, offset] = readVarint(f.value, offset);
          typeIds.push(value);
        }
      } else throw new Error("Unexpected threat types wire type");
    }
  }
  if (!url || !typeIds.length) throw new Error("Incomplete Safe Browsing threat entry");
  return { url, threatTypes: typeIds.map(id => threatNames[id] ?? `UNKNOWN(${id})`) };
}

/** @param {Uint8Array | ArrayBuffer} payload */
export function decodeSearchUrlsResponse(payload) {
  const bytes = payload instanceof Uint8Array ? payload : new Uint8Array(payload);
  if (!bytes.length) throw new Error("Empty Safe Browsing response");
  const threats = [];
  let hasCacheDuration = false;
  for (const f of fields(bytes)) {
    if (f.field === 1) {
      if (f.wire !== 2) throw new Error("Unexpected threats field wire type");
      threats.push(parseThreat(f.value));
    } else if (f.field === 2) {
      if (f.wire !== 2) throw new Error("Unexpected cacheDuration wire type");
      for (const durationField of fields(f.value)) {
        if ((durationField.field === 1 || durationField.field === 2) && durationField.wire !== 0)
          throw new Error("Malformed cacheDuration protobuf");
      }
      hasCacheDuration = true;
    }
  }
  if (!hasCacheDuration) throw new Error("Safe Browsing response missing cacheDuration");
  return { threats };
}
