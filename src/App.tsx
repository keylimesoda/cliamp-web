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
  { id: "now" as const, label: "♫ Now Playing" },
  { id: "radio" as const, label: "📡 Radio" },
  { id: "podcast" as const, label: "🎙 Podcasts" },
  { id: "servers" as const, label: "🗄 Servers" },
  { id: "local" as const, label: "◷ Local" },
  { id: "plugins" as const, label: "⚙ Plugins" },
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
      <nav
        style={{
          position: "fixed",
          bottom: 0,
          left: 0,
          right: 0,
          display: "flex",
          gap: "var(--gap)",
          padding: "var(--gap)",
          background: "var(--bg-sunken)",
          borderTop: "1px solid var(--border)",
          zIndex: 10,
        }}
      >
        {NAV.map((n) => (
          <button
            key={n.id}
            className={screen === n.id ? "btn-accent" : ""}
            onClick={() => setScreen(n.id)}
            style={{ flex: 1 }}
          >
            {n.label}
          </button>
        ))}
      </nav>
    </>
  );
}
