import type { Track } from "./types";

export interface ListeningProgress {
  key: string;
  kind: "podcast" | "audiobook";
  position: number;
  duration: number;
  completed: boolean;
  updatedAt: number;
  title: string;
  show: string;
  feed?: string;
  published?: string;
}

export function listeningKey(t: Track): string | null {
  if (t.live) return null;
  if (t.provider === "podcast" && t.feed) return JSON.stringify(["podcast", t.feed, t.guid || t.path]);
  if (t.provider === "audiobookshelf") return JSON.stringify([
    t.kind || "audiobook", t.providerMeta?.serverUrl || "", t.providerMeta?.itemId || t.path,
    t.providerMeta?.episodeId || t.providerMeta?.ino || t.path,
  ]);
  return null;
}

export function findProgress(entries: Record<string, ListeningProgress>, t: Track): ListeningProgress | undefined {
  const key = listeningKey(t);
  if (!key) return;
  if (entries[key]) return entries[key];
  // A publisher may rewrite both its GUID and enclosure URL. Only migrate an
  // unambiguous match for the same show/title and compatible publication date.
  if (t.provider !== "podcast") return;
  const candidates = Object.values(entries).filter((p) => p.kind === "podcast" && p.feed === t.feed
    && p.title === t.title && p.show === (t.artist || "")
    && (!p.published || !t.providerMeta?.pubDate || p.published === t.providerMeta.pubDate));
  return candidates.length === 1 ? candidates[0] : undefined;
}

export function resumePosition(p?: ListeningProgress): number {
  if (!p || p.completed || p.position < 15) return 0;
  return Math.max(0, p.position - 5);
}

export function makeProgress(t: Track, position: number, duration: number, ended = false): ListeningProgress | null {
  const key = listeningKey(t);
  if (!key || !Number.isFinite(position) || position < 0 || !Number.isFinite(duration) || duration < 0) return null;
  const pos = duration > 0 ? Math.min(position, duration) : position;
  const completed = ended || (duration > 0 && (duration < 120 ? pos >= duration / 2 : pos >= duration - 60));
  return {
    key, kind: t.kind === "podcast" || t.provider === "podcast" ? "podcast" : "audiobook",
    position: pos, duration, completed, updatedAt: Date.now(), title: t.title,
    show: t.artist || "", feed: t.feed, published: typeof t.providerMeta?.pubDate === "string" ? t.providerMeta.pubDate : undefined,
  };
}
