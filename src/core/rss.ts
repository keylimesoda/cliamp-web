/**
 * Minimal RSS/Atom feed parser for podcast episodes. Parses the XML with
 * DOMParser and extracts each playable episode (enclosure URL, title,
 * GUID, duration, publication date). No external dependencies.
 */
import type { Track } from "./types";

export interface FeedInfo {
  title: string;
  description?: string;
  episodes: Track[];
}

const ITUNES_NS = "http://www.itunes.com/dtds/podcast-1.0.dtd";
const MEDIA_NS = "http://search.yahoo.com/mrss/";
const ATOM_NS = "http://www.w3.org/2005/Atom";

function text(el: Element | null | undefined, ...names: string[]): string | undefined {
  if (!el) return undefined;
  for (const n of names) {
    const v = el.getElementsByTagName(n).item(0)?.textContent?.trim();
    if (v) return v;
  }
  return undefined;
}

function textNS(el: Element, ns: string, local: string): string | undefined {
  return el.getElementsByTagNameNS(ns, local).item(0)?.textContent?.trim();
}

function parseDuration(raw?: string): number | undefined {
  if (!raw) return undefined;
  const s = raw.trim();
  if (/^\d+(\.\d+)?$/.test(s)) return Math.round(parseFloat(s));
  const m = s.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/);
  if (m) {
    const h = Number(m[1] ?? 0);
    const mm = Number(m[2] ?? 0);
    const sec = Number(m[3] ?? 0);
    return h * 3600 + mm * 60 + sec;
  }
  return undefined;
}

/**
 * Parse a podcast RSS feed. Returns the show title and up to `limit`
 * playable episodes in feed order (newest first for most feeds).
 * Episodes without an audio enclosure are skipped.
 */
export function parseFeed(xml: string, feedUrl: string, showTitle: string, limit = 300): FeedInfo {
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  if (doc.querySelector("parsererror")) {
    throw new Error("invalid feed XML");
  }
  const channel = doc.getElementsByTagName("channel").item(0);
  const title = channel ? text(channel, "title") ?? showTitle : showTitle;
  const description = channel ? text(channel, "description") : undefined;

  const items = Array.from(doc.getElementsByTagName("item"));
  const episodes: Track[] = [];
  for (const item of items) {
    const enclosure = item.getElementsByTagName("enclosure").item(0);
    const url = enclosure?.getAttribute("url")?.trim();
    if (!url) continue;
    const type = enclosure?.getAttribute("type") ?? "";
    // only audio enclosures
    if (type && !type.startsWith("audio/")) continue;
    const epTitle = text(item, "title") ?? "(untitled episode)";
    const guid =
      textNS(item, ITUNES_NS, "guid") ??
      text(item, "guid") ??
      textNS(item, ATOM_NS, "id") ??
      url;
    const pubDate = text(item, "pubDate");
    const duration = parseDuration(
      textNS(item, ITUNES_NS, "duration") ??
        textNS(item, MEDIA_NS, "content")?.match(/duration="(\d+)"/)?.[1],
    );
    episodes.push({
      path: url,
      title: epTitle,
      artist: title,
      feed: feedUrl,
      guid,
      durationSecs: duration,
      provider: "podcast",
      providerMeta: {
        feedUrl,
        pubDate,
        enclosureType: type,
      },
    });
    if (episodes.length >= limit) break;
  }
  return { title, description, episodes };
}
