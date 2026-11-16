export class UnsupportedStreamFormatError extends Error {
  constructor() {
    super("Unsupported audio format");
  }
}

export class HlsPlaylistError extends Error {
  constructor(readonly url: string) {
    super("HLS playlist");
  }
}
