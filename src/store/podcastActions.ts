import { create } from "zustand";
import { latestEpisode, latestFromShows, type FeedShow } from "../core/podcastLatest";
import { podcastBrowse } from "../providers/podcast";
import { usePlayerStore } from "./player";
import { usePodcastPrefs } from "./podcastPrefs";

interface PodcastActions {
  busy: boolean;
  message: string;
  error: string;
  queueLatest: (show: FeedShow) => Promise<void>;
  appendLatestAll: () => Promise<void>;
}
const load = (show: FeedShow) => podcastBrowse.showEpisodes(show.feedUrl, show.name, 300);

// One shared operation across Podcasts/FAVS, just like native's loading guard.
export const usePodcastActions = create<PodcastActions>()((set, get) => ({
  busy: false, message: "", error: "",
  async queueLatest(show) {
    if (get().busy) return;
    set({ busy: true, message: `Loading the latest from ${show.name}…`, error: "" });
    try {
      const track = latestEpisode(await load(show));
      if (!track) throw new Error(`No playable episodes in ${show.name}.`);
      await usePlayerStore.getState().appendTracks([track], true);
      set({ message: `Queued ${track.title}.` });
    } catch (e) { set({ message: "", error: `${show.name}: ${e instanceof Error ? e.message : String(e)}` }); }
    finally { set({ busy: false }); }
  },
  async appendLatestAll() {
    const shows = [...usePodcastPrefs.getState().subs];
    if (get().busy || !shows.length) return;
    set({ busy: true, message: `Loading the newest episode of ${shows.length} show(s)…`, error: "" });
    try {
      const { tracks, failed } = await latestFromShows(shows, load);
      if (!tracks.length) throw new Error("No episodes found across your subscriptions.");
      await usePlayerStore.getState().appendTracks(tracks);
      set({ message: `Added the newest episode of ${tracks.length} show(s).`,
        error: failed.length ? `${failed.length} show(s) failed to load: ${failed[0]}.` : "" });
    } catch (e) { set({ message: "", error: e instanceof Error ? e.message : String(e) }); }
    finally { set({ busy: false }); }
  },
}));
