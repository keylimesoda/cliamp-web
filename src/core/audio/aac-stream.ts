import type { LibAV, LibAVWrapper, Packet } from "@libav.js/variant-fat";
import wrapperUrl from "@libav.js/variant-fat/dist/libav-4.10.6.1.1-fat.js?url";
import workerUrl from "@libav.js/variant-fat/dist/libav-4.10.6.1.1-fat.wasm.js?url";
import wasmUrl from "@libav.js/variant-fat/dist/libav-4.10.6.1.1-fat.wasm.wasm?url";
import { HlsPlaylistError, UnsupportedStreamFormatError } from "./stream-error";

type Wrapper = LibAVWrapper & { toImport: string };
let wrapper: Promise<Wrapper> | undefined;

function loadWrapper(): Promise<Wrapper> {
  return wrapper ??= new Promise<Wrapper>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = wrapperUrl;
    script.onload = () => {
      script.remove();
      const libav = (globalThis as typeof globalThis & { LibAV?: Wrapper }).LibAV;
      if (!libav?.LibAV) reject(new Error("FFmpeg WASM loader failed"));
      else resolve(libav);
    };
    script.onerror = () => { script.remove(); reject(new Error("FFmpeg WASM loader unavailable")); };
    document.head.append(script);
  }).catch((error) => { wrapper = undefined; throw error; });
}

function stripIcyMetadata(interval: number): TransformStream<Uint8Array, Uint8Array> {
  let audioBytes = interval;
  let metadataBytes = 0;
  return new TransformStream({
    transform(chunk, controller) {
      let offset = 0;
      while (offset < chunk.length) {
        if (metadataBytes > 0) {
          const count = Math.min(metadataBytes, chunk.length - offset);
          offset += count;
          metadataBytes -= count;
        } else if (audioBytes === 0) {
          metadataBytes = chunk[offset++] * 16;
          audioBytes = interval;
        } else {
          const count = Math.min(audioBytes, chunk.length - offset);
          controller.enqueue(chunk.subarray(offset, offset + count));
          offset += count;
          audioBytes -= count;
        }
      }
    },
  });
}

/** Decode raw ADTS AAC from a live HTTP response. Callbacks apply output backpressure. */
export async function decodeAacStream(
  url: string,
  signal: AbortSignal,
  output: (planes: Float32Array[], rate: number) => Promise<void>,
  httpFallback?: string,
): Promise<void> {
  const options = { signal, credentials: "omit" } as const;
  let response: Response;
  try {
    response = await fetch(url, options);
    if (!response.ok && httpFallback) {
      void response.body?.cancel().catch(() => {});
      throw new Error("HTTPS stream returned an error");
    }
  } catch (error) {
    signal.throwIfAborted();
    if (!httpFallback) throw error;
    // Chromium permits this only when the listener has allowed insecure
    // content for the page. Fetch still enforces cross-origin read permissions.
    try { response = await fetch(httpFallback, options); }
    catch { signal.throwIfAborted(); throw error; }
  }
  if (!response.ok || !response.body) throw new Error("Could not read the radio stream");
  const intervalHeader = response.headers.get("icy-metaint");
  const interval = Number(intervalHeader);
  const body = Number.isSafeInteger(interval) && interval > 0
    ? response.body.pipeThrough(stripIcyMetadata(interval)) : response.body;
  const reader = body.getReader();
  try {
    const type = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
    if (type === "application/vnd.apple.mpegurl" || type === "application/x-mpegurl" ||
        type === "audio/mpegurl" || type === "audio/x-mpegurl") {
      throw new HlsPlaylistError(response.url || url);
    }
    if (type !== "audio/aac" && type !== "audio/aacp" && type !== "audio/x-aac") {
      throw new UnsupportedStreamFormatError();
    }
    if (intervalHeader !== null && (!Number.isSafeInteger(interval) || interval <= 0)) {
      throw new UnsupportedStreamFormatError();
    }
    async function* chunks() {
      while (true) {
        signal.throwIfAborted();
        const { done, value } = await reader.read();
        if (done) return;
        yield value;
      }
    }
    await decodeAdts(chunks(), signal, output);
  } finally {
    void reader.cancel().catch(() => {});
  }
}

export type PcmOutput = (planes: Float32Array[], rate: number) => Promise<void>;

export async function decodeAdts(
  chunks: AsyncIterable<Uint8Array>, signal: AbortSignal, output: PcmOutput,
): Promise<void> {
  let av: LibAV | undefined;
  const terminate = () => av?.terminate();
  signal.addEventListener("abort", terminate, { once: true });
  try {
    const libav = await loadWrapper();
    signal.throwIfAborted();
    libav.toImport = new URL(workerUrl, document.baseURI).href;
    av = await libav.LibAV({
      nosimd: true,
      nothreads: true,
      wasmurl: new URL(wasmUrl, document.baseURI).href,
    });
    signal.throwIfAborted();
    const [, codec, packet, frame] = await av.ff_init_decoder("aac");
    let tail = new Uint8Array(0);
    let synchronized = false;
    for await (const value of chunks) {
      signal.throwIfAborted();
      const bytes = new Uint8Array(tail.length + value.length);
      bytes.set(tail);
      bytes.set(value, tail.length);
      let offset = 0;
      while (offset + 7 <= bytes.length) {
        // ADTS sync, layer and sampling-frequency fields.
        if (bytes[offset] !== 0xff || (bytes[offset + 1] & 0xf6) !== 0xf0 ||
            (bytes[offset + 2] & 0x3c) > 0x30) {
          if (synchronized) throw new Error("Lost AAC frame alignment");
          offset++;
          continue;
        }
        const size = ((bytes[offset + 3] & 3) << 11) | (bytes[offset + 4] << 3) | (bytes[offset + 5] >> 5);
        if (size < ((bytes[offset + 1] & 1) ? 7 : 9)) throw new Error("Invalid AAC frame size");
        if (offset + size > bytes.length) break;
        const data = bytes.slice(offset, offset + size);
        offset += size;
        const frames = await av.ff_decode_multi(codec, packet, frame, [{ data } as Packet]);
        for (const decoded of frames) {
          const planes: unknown = decoded.data;
          if (!Array.isArray(planes) || !planes.length || !planes.every((p) => p instanceof Float32Array)
              || !decoded.sample_rate) throw new Error("Unsupported AAC sample format");
          await output(planes, decoded.sample_rate);
        }
        synchronized = true;
      }
      tail = bytes.slice(offset);
    }
    throw new Error("Live stream ended");
  } finally {
    signal.removeEventListener("abort", terminate);
    terminate();
  }
}
