/**
 * Podcast preferences — subscribed shows, persisted to localStorage
 * (web equivalent of podcast_subscriptions.json). A subscription is the
 * show's feed URL + display name.
 */
import { create } from "zustand";

const SUBS_KEY = "cliamp-web:podcast-subs";

export interface SubscribedShow {
  feedUrl: string;
  name: string;
  collectionId?: number;
  artworkUrl?: string;
}

function readSubs(): SubscribedShow[] {
  try {
    const s = localStorage.getItem(SUBS_KEY);
    return s ? (JSON.parse(s) as SubscribedShow[]) : [];
  } catch {
    return [];
  }
}
function writeSubs(v: SubscribedShow[]): void {
  try {
    localStorage.setItem(SUBS_KEY, JSON.stringify(v));
  } catch {
    // non-fatal
  }
}

interface PodcastPrefs {
  subs: SubscribedShow[];
  isSubscribed: (feedUrl: string) => boolean;
  toggleSub: (show: SubscribedShow) => void;
}

export const usePodcastPrefs = create<PodcastPrefs>()((set, get) => ({
  subs: readSubs(),
  isSubscribed: (feedUrl) => get().subs.some((s) => s.feedUrl === feedUrl),
  toggleSub(show) {
    const cur = get().subs;
    const next = cur.some((s) => s.feedUrl === show.feedUrl)
      ? cur.filter((s) => s.feedUrl !== show.feedUrl)
      : [...cur, show];
    writeSubs(next);
    set({ subs: next });
  },
}));
