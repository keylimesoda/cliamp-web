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
  { id: "now" as const, label: "Now Playing", compactLabel: "NOW", icon: "\uf001" },
  { id: "radio" as const, label: "Radio", compactLabel: "RADIO", icon: "\uf1eb" },
  { id: "podcast" as const, label: "Podcasts", compactLabel: "PODS", icon: "\uf130" },
  { id: "servers" as const, label: "Servers", compactLabel: "SERVERS", icon: "\uf1c0" },
  { id: "local" as const, label: "Local", compactLabel: "LOCAL", icon: "\uf07c" },
  { id: "plugins" as const, label: "Plugins", compactLabel: "PLUGINS", icon: "\uf1e6" },
];

function renderScreen(screen: Screen, immersive: boolean, setImmersive: (enabled: boolean) => void) {
  switch (screen) {
    case "now":
      return <NowPlaying immersive={immersive} onImmersiveChange={setImmersive} />;
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
  const [immersive, setImmersive] = useState(false);

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
      {renderScreen(screen, immersive, setImmersive)}
      {!immersive || screen !== "now" ? <nav className="app-nav" aria-label="Primary">
        {NAV.map((n) => (
          <button
            key={n.id}
            className={screen === n.id ? "btn-accent" : ""}
            onClick={() => {
              setImmersive(false);
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
