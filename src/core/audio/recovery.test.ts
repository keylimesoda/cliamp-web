import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlaybackRecovery } from "./recovery";
beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });
function fixture() {
  const callbacks = { reconnect: vi.fn<() => Promise<void>>().mockResolvedValue(undefined), online: vi.fn(() => true), status: vi.fn(), exhausted: vi.fn() };
  const r = new PlaybackRecovery(callbacks); r.start(); return { r, ...callbacks };
}
describe("playback recovery", () => {
  it("backs off and stops after five failed attempts", async () => {
    const { r, reconnect, exhausted } = fixture(); reconnect.mockRejectedValue(new Error("Unavailable"));
    r.request("Network error");
    for (const [i, delay] of [1000, 2000, 4000, 8000, 16000].entries()) {
      await vi.advanceTimersByTimeAsync(delay - 1); expect(reconnect).toHaveBeenCalledTimes(i);
      await vi.advanceTimersByTimeAsync(1); expect(reconnect).toHaveBeenCalledTimes(i + 1);
    }
    expect(exhausted).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(60000); expect(reconnect).toHaveBeenCalledTimes(5);
  });
  it("deduplicates failures and cancels pending recovery on pause/selection", async () => {
    const { r, reconnect } = fixture(); r.request("Stalled"); r.request("Still stalled");
    r.stop(); await vi.advanceTimersByTimeAsync(60000); expect(reconnect).not.toHaveBeenCalled();
  });
  it("waits while offline without spending its retry budget", async () => {
    const { r, reconnect, online, status } = fixture(); online.mockReturnValue(false);
    r.request("Offline"); await vi.advanceTimersByTimeAsync(60000); expect(reconnect).not.toHaveBeenCalled();
    expect(status).toHaveBeenLastCalledWith(expect.objectContaining({ phase: "offline", attempt: 0 }));
    online.mockReturnValue(true); r.request("Online"); await vi.advanceTimersByTimeAsync(1000);
    expect(reconnect).toHaveBeenCalledOnce();
  });
  it("ignores an old in-flight failure after a new playback request", async () => {
    const { r, reconnect, exhausted } = fixture(); let reject!: (e: Error) => void;
    reconnect.mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; }));
    r.request("Stalled"); await vi.advanceTimersByTimeAsync(1000); r.start();
    reject(new Error("Old failure")); await vi.advanceTimersByTimeAsync(60000);
    expect(reconnect).toHaveBeenCalledOnce(); expect(exhausted).not.toHaveBeenCalled();
  });
  it("resets the budget only after stable playback", async () => {
    const { r, reconnect, status } = fixture();
    r.request("Stalled"); await vi.advanceTimersByTimeAsync(1000); r.stable();
    r.request("Later stall"); expect(status).toHaveBeenLastCalledWith(expect.objectContaining({ attempt: 1 }));
    await vi.advanceTimersByTimeAsync(1000); expect(reconnect).toHaveBeenCalledTimes(2);
  });
});
