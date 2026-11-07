import { usePlayerStore } from "../store/player";

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

export function SpokenSkipButton({ seconds }: { seconds: number }) {
  const s = usePlayerStore();
  return <button className="spoken-skip" disabled={!s.seekable || s.state === "stopped" || s.state === "buffering"}
    aria-label={seconds < 0 ? `Rewind ${-seconds} seconds` : `Forward ${seconds} seconds`}
    onClick={() => s.seekRelative(seconds)}>
    {seconds < 0 ? "−" : "+"}{Math.abs(seconds)}s
  </button>;
}

export function PlaybackSpeedPicker() {
  const speed = usePlayerStore((s) => s.spokenSpeed), setSpeed = usePlayerStore((s) => s.setSpeed);
  const choices = SPEEDS.includes(speed) ? SPEEDS : [...SPEEDS, speed].sort((a, b) => a - b);
  return <select className="spoken-speed" aria-label="Playback speed" value={speed}
    onChange={(event) => setSpeed(Number(event.target.value))}>
    {choices.map((value) => <option key={value} value={value}>{Number(value.toFixed(2))}×</option>)}
  </select>;
}
