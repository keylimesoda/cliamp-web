import { afterEach, expect, it, vi } from "vitest";
import { updateMediaSession } from "./mediasession";

afterEach(() => vi.unstubAllGlobals());
it("clears spoken seek handlers when a live station becomes active", () => {
  const setActionHandler = vi.fn();
  vi.stubGlobal("navigator", { mediaSession: { setActionHandler } });
  vi.stubGlobal("MediaMetadata", class {});
  const controls = { play: vi.fn(), pause: vi.fn(), next: vi.fn(), prev: vi.fn() };
  updateMediaSession({ path: "book", title: "Book" }, "playing", { ...controls, seekForward: vi.fn(), seekBackward: vi.fn(), seekTo: vi.fn() });
  setActionHandler.mockClear();
  updateMediaSession({ path: "radio", title: "Radio", live: true }, "playing", controls);
  for (const action of ["seekforward", "seekbackward", "seekto"]) expect(setActionHandler).toHaveBeenCalledWith(action, null);
});
