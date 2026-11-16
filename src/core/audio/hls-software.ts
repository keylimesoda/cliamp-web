import { Parser } from "m3u8-parser";
import { decodeAdts, type PcmOutput } from "./aac-stream";
import { UnsupportedStreamFormatError } from "./stream-error";

async function fetchResource(source: string, signal: AbortSignal): Promise<Response> {
  const url = new URL(source);
  if (url.username || url.password || !["http:", "https:"].includes(url.protocol)) {
    throw new Error("Invalid HLS URL");
  }
  const response = await fetch(url, { signal, credentials: "omit", cache: "no-store" });
  if (!response.ok) {
    void response.body?.cancel().catch(() => {});
    throw new Error("Stream unavailable");
  }
  return response;
}

async function playlist(source: string, signal: AbortSignal) {
  const response = await fetchResource(source, signal);
  const text = await response.text();
  if (!text.trimStart().startsWith("#EXTM3U")) throw new UnsupportedStreamFormatError();
  const parser = new Parser();
  parser.push(text);
  parser.end();
  return { url: response.url || source, manifest: parser.manifest };
}

function reloadAfter(ms: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const cancel = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", cancel);
      resolve();
    }, ms);
    signal.addEventListener("abort", cancel, { once: true });
  });
}

function packedAac(bytes: Uint8Array): Uint8Array {
  let offset = 0;
  // Packed audio normally begins with an ID3 timestamp. Each segment has
  // its own tag, which must stay out of the continuous ADTS decoder input.
  while (offset + 10 <= bytes.length && bytes[offset] === 73 &&
      bytes[offset + 1] === 68 && bytes[offset + 2] === 51) {
    const size = (bytes[offset + 6] << 21) | (bytes[offset + 7] << 14) |
      (bytes[offset + 8] << 7) | bytes[offset + 9];
    offset += 10 + size + (bytes[offset + 3] === 4 && (bytes[offset + 5] & 0x10) ? 10 : 0);
  }
  if (offset + 7 > bytes.length || bytes[offset] !== 0xff ||
      (bytes[offset + 1] & 0xf6) !== 0xf0) throw new UnsupportedStreamFormatError();
  return bytes.subarray(offset);
}

async function* segments(source: string, signal: AbortSignal): AsyncGenerator<Uint8Array> {
  let current = await playlist(source, signal);
  const variants = current.manifest.playlists;
  if (variants?.length) {
    const variant = variants.find(({ attributes }) => !attributes.RESOLUTION &&
      (attributes.CODECS?.split(",").every((codec) => /^mp4a\./i.test(codec.trim())) ?? true));
    if (!variant) throw new UnsupportedStreamFormatError();
    const group = current.manifest.mediaGroups?.AUDIO?.[variant.attributes.AUDIO ?? ""];
    const renditions = Object.values(group ?? {}).filter(({ uri }) => !!uri);
    const mediaUri = (renditions.find(({ default: preferred }) => preferred) ?? renditions[0])?.uri;
    current = await playlist(new URL(mediaUri ?? variant.uri, current.url).href, signal);
  }
  if (!current.manifest.segments.length) throw new UnsupportedStreamFormatError();
  const first = current.manifest.mediaSequence ?? 0;
  let next = first + (current.manifest.endList ? 0 : Math.max(0, current.manifest.segments.length - 3));
  while (true) {
    const { manifest, url } = current;
    const sequence = manifest.mediaSequence ?? 0;
    next = Math.max(next, sequence);
    for (let index = next - sequence; index < manifest.segments.length; index++) {
      const segment = manifest.segments[index];
      if (manifest.contentProtection || segment.key || segment.map || segment.byterange) {
        throw new UnsupportedStreamFormatError();
      }
      const response = await fetchResource(new URL(segment.uri, url).href, signal);
      yield packedAac(new Uint8Array(await response.arrayBuffer()));
      next = sequence + index + 1;
    }
    if (manifest.endList) return;
    await reloadAfter(Math.max(500, (manifest.targetDuration ?? 2) * 500), signal);
    current = await playlist(url, signal);
  }
}

export function decodeHlsAudio(source: string, signal: AbortSignal, output: PcmOutput): Promise<void> {
  return decodeAdts(segments(source, signal), signal, output);
}
