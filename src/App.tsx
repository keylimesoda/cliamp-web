import { useEffect, useState } from "react";
import { usePlayerStore } from "./store/player";
import { usePluginStore } from "./store/plugins";
import NowPlaying from "./components/NowPlaying";
import RadioBrowser from "./components/RadioBrowser";
import PodcastBrowser from "./components/PodcastBrowser";
import ServersScreen from "./components/ServersScreen";
import FavoritesScreen from "./components/FavoritesScreen";
import PluginsScreen from "./components/PluginsScreen";
import type { PodcastShow } from "./providers/podcast";
import "./providers/radio"; // side-effect: registers the radio provider
import "./providers/podcast"; // side-effect: registers the podcast provider
import "./providers/navidrome"; // side-effect: registers the navidrome provider
import "./providers/jellyfin"; // side-effect: registers jellyfin + emby
import "./providers/plex"; // side-effect: registers plex
import "./providers/audiobookshelf"; // side-effect: registers audiobookshelf
import "./providers/lyrion"; // side-effect: registers lyrion (LMS)
import { applyTheme } from "./themes/engine";

type Screen = "now" | "radio" | "podcast" | "servers" | "favorites" | "plugins";

const NAV = [
  { id: "now" as const, label: "Now Playing", compactLabel: "NOW", icon: "\uf001" },
  { id: "radio" as const, label: "Radio", compactLabel: "RADIO", icon: "\uf1eb" },
  { id: "podcast" as const, label: "Podcasts", compactLabel: "PODS", icon: "\uf130" },
  { id: "servers" as const, label: "Servers", compactLabel: "SERVERS", icon: "\uf1c0" },
  { id: "favorites" as const, label: "Favorites", compactLabel: "FAVS", icon: "\uf005" },
  { id: "plugins" as const, label: "Plugins", compactLabel: "PLUGINS", icon: "\uf1e6" },
];

function renderScreen(
  screen: Screen,
  immersive: boolean,
  setImmersive: (enabled: boolean) => void,
  podcastTarget: PodcastShow | null,
  openPodcast: (show: PodcastShow) => void,
) {
  switch (screen) {
    case "now":
      return <NowPlaying immersive={immersive} onImmersiveChange={setImmersive} />;
    case "radio":
      return <RadioBrowser />;
    case "podcast":
      return <PodcastBrowser initialShow={podcastTarget} />;
    case "servers":
      return <ServersScreen />;
    case "favorites":
      return <FavoritesScreen onOpenPodcast={openPodcast} />;
    case "plugins":
      return <PluginsScreen />;
  }
}

export default function App() {
  const boot = usePlayerStore((s) => s.boot);
  const booted = usePlayerStore((s) => s.booted);
  const theme = usePlayerStore((s) => s.theme);
  const [screen, setScreen] = useState<Screen>("now");
  const [immersive, setImmersive] = useState(false);
  const [podcastTarget, setPodcastTarget] = useState<PodcastShow | null>(null);

  useEffect(() => {
    void boot();
  }, [boot]);

  useEffect(() => {
    if (booted) usePluginStore.getState().init();
  }, [booted]);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  if (!booted) {
    return (
      <main className="boot">
        <p className="boot-line dim">starting…</p>
      </main>
    );
  }

  return (
    <>
      {renderScreen(
        screen,
        immersive,
        setImmersive,
        podcastTarget,
        (show) => {
          setPodcastTarget(show);
          setImmersive(false);
          setScreen("podcast");
        },
      )}
      {!immersive || screen !== "now" ? <nav className="app-nav" aria-label="Primary">
        {NAV.map((n) => (
          <button
            key={n.id}
            className={screen === n.id ? "btn-accent" : ""}
            onClick={() => {
              setImmersive(false);
              if (n.id === "podcast") setPodcastTarget(null);
              setScreen(n.id);
            }}
            aria-current={screen === n.id ? "page" : undefined}
          >
            <span className="nf-icon nav-icon" aria-hidden>{n.icon}</span>
            <span className="nav-label nav-label-full">{n.label}</span>
            <span className="nav-label nav-label-compact">{n.compactLabel}</span>
          </button>
        ))}
      </nav> : null}
    </>
  );
}
