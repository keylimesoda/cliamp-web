import { registerProvider } from "./registry";
import { qobuzClient } from "../store/qobuz";
import type { Provider } from "../core/types";
export const qobuzProvider: Provider = {
  id: "qobuz", name: "Qobuz", description: "Browser-only Qobuz test", capabilities: { browse: true, search: true, playlists: true },
  resolveSource: (track) => qobuzClient().resolve(track),
};
registerProvider(qobuzProvider);
