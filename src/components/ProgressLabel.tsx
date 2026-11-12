import type { Track } from "../core/types";
import { findProgress } from "../core/listening";
import { useListening } from "../store/listening";
export default function ProgressLabel({ track }: { track: Track }) {
  const entries = useListening((s) => s.entries);
  const p = findProgress(entries, track);
  if (!p) return null;
  const minutes = Math.floor(p.position / 60), seconds = String(Math.floor(p.position % 60)).padStart(2, "0");
  return <span className="listening-progress">{p.completed ? "✓ Played" : p.position >= 15 ? `Resume ${minutes}:${seconds}` : "Started"}</span>;
}
