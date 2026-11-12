export interface RecoveryStatus { attempt: number; phase: "waiting" | "reconnecting" | "offline"; reason: string; }
const DELAYS = [1000, 2000, 4000, 8000, 16000];

/** Bounded retries with cancellation, offline waiting, and a stable-play reset. */
export class PlaybackRecovery {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private epoch = 0;
  private enabled = false;
  private busy = false;
  private attempts = 0;
  private reason = "Connection interrupted";
  constructor(private callbacks: {
    reconnect: () => Promise<void>;
    online: () => boolean;
    status: (status: RecoveryStatus | null) => void;
    exhausted: (reason: string) => void;
  }) {}
  start(): void { this.stop(); this.enabled = true; this.attempts = 0; }
  stop(): void {
    this.epoch++; this.enabled = false; this.busy = false;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null; this.callbacks.status(null);
  }
  stable(): void { if (!this.busy && this.timer === null) this.attempts = 0; }
  request(reason: string): void {
    if (!this.enabled) return;
    this.reason = reason;
    if (!this.callbacks.online()) {
      if (this.timer !== null) clearTimeout(this.timer);
      this.timer = null;
      this.callbacks.status({ attempt: this.attempts, phase: "offline", reason });
      return;
    }
    if (this.timer !== null || this.busy) return;
    if (this.attempts >= DELAYS.length) {
      this.enabled = false; this.callbacks.status(null); this.callbacks.exhausted(reason); return;
    }
    const epoch = this.epoch;
    this.callbacks.status({ attempt: this.attempts + 1, phase: "waiting", reason });
    this.timer = setTimeout(async () => {
      this.timer = null;
      if (!this.enabled || epoch !== this.epoch) return;
      if (!this.callbacks.online()) { this.request(this.reason); return; }
      this.busy = true; this.attempts++;
      this.callbacks.status({ attempt: this.attempts, phase: "reconnecting", reason: this.reason });
      try {
        await this.callbacks.reconnect();
        if (epoch !== this.epoch || !this.enabled) return;
        this.busy = false; this.callbacks.status(null);
      } catch (e) {
        if (epoch !== this.epoch || !this.enabled) return;
        this.busy = false;
        this.request(e instanceof Error ? e.message : "Connection interrupted");
      }
    }, DELAYS[this.attempts]);
  }
}
