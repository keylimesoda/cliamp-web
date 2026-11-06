import type { ServerConfig } from "../store/servers";
import { verifyNavidromeConfig } from "./navidrome";
import { verifyAudiobookshelfConfig } from "./audiobookshelf";
import { verifyPlexConfig } from "./plexConnection";

// Only expose providers with an implemented, fixture-covered sign-in flow.
export const SERVER_CATALOG = [
  { id: "navidrome", name: "Navidrome" },
  { id: "audiobookshelf", name: "Audiobookshelf" },
  { id: "plex", name: "Plex" },
] as const;
export type AvailableServerId = typeof SERVER_CATALOG[number]["id"];

export async function verifyServerConfig(id: AvailableServerId, config: ServerConfig): Promise<void> {
  const url = new URL(config.url);
  if (!/^https?:$/.test(url.protocol) || url.username || url.password) throw new Error("Enter an HTTP or HTTPS server URL");
  if (id === "navidrome") await verifyNavidromeConfig(config);
  else if (id === "audiobookshelf") await verifyAudiobookshelfConfig(config);
  else if (id === "plex") await verifyPlexConfig(config);
  else throw new Error("Server sign-in is not available");
}
