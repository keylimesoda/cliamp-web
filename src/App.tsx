import { useEffect, useState } from "react";
import { usePlayerStore } from "./store/player";
import { usePluginStore } from "./store/plugins";
import NowPlaying from "./components/NowPlaying";
import RadioBrowser from "./components/RadioBrowser";
import PodcastBrowser from "./components/PodcastBrowser";
import ServersScreen from "./components/ServersScreen";
import LocalScreen from "./components/LocalScreen";
import PluginsScreen from "./components/PluginsScreen";
import "./providers/radio"; // side-effect: registers the radio provider
import "./providers/podcast"; // side-effect: registers the podcast provider
import "./providers/navidrome"; // side-effect: registers the navidrome provider
import "./providers/jellyfin"; // side-effect: registers jellyfin + emby
import "./providers/plex"; // side-effect: registers plex
import "./providers/audiobookshelf"; // side-effect: registers audiobookshelf
import "./providers/lyrion"; // side-effect: registers lyrion (LMS)
import { applyTheme } from "./themes/engine";

type Screen = "now" | "radio" | "podcast" | "servers" | "local" | "plugins";

const NAV = [
  { id: "now" as const, label: "Now Playing", compactLabel: "NOW" },
  { id: "radio" as const, label: "Radio", compactLabel: "RADIO" },
  { id: "podcast" as const, label: "Podcasts", compactLabel: "PODS" },
  { id: "servers" as const, label: "Servers", compactLabel: "SERVERS" },
  { id: "local" as const, label: "Local", compactLabel: "LOCAL" },
  { id: "plugins" as const, label: "Plugins", compactLabel: "PLUGINS" },
];

function renderScreen(screen: Screen) {
  switch (screen) {
    case "now":
      return <NowPlaying />;
    case "radio":
      return <RadioBrowser />;
    case "podcast":
      return <PodcastBrowser />;
    case "servers":
      return <ServersScreen />;
    case "local":
      return <LocalScreen />;
    case "plugins":
      return <PluginsScreen />;
  }
}

export default function App() {
  const boot = usePlayerStore((s) => s.boot);
  const booted = usePlayerStore((s) => s.booted);
  const theme = usePlayerStore((s) => s.theme);
  const [screen, setScreen] = useState<Screen>("now");

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
      {renderScreen(screen)}
      <nav className="app-nav" aria-label="Primary">
        {NAV.map((n) => (
          <button
            key={n.id}
            className={screen === n.id ? "btn-accent" : ""}
            onClick={() => setScreen(n.id)}
            aria-current={screen === n.id ? "page" : undefined}
          >
            <span className="nav-label nav-label-full">{n.label}</span>
            <span className="nav-label nav-label-compact">{n.compactLabel}</span>
          </button>
        ))}
      </nav>
    </>
  );
}
