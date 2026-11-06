import { useEffect, useRef } from "react";
import { useVizStore } from "../store/viz";
import { VISUALIZERS } from "../viz/registry";

export default function VisualizerPicker({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null), current = useRef<HTMLButtonElement>(null);
  const index = useVizStore((s) => s.index);
  useEffect(() => {
    dialog.current?.showModal();
    current.current?.focus({ preventScroll: true });
    current.current?.scrollIntoView({ block: "nearest" });
  }, []);
  const close = () => { dialog.current?.close(); onClose(); };
  return <dialog ref={dialog} className="visualizer-picker" aria-labelledby="visualizer-picker-title"
    onCancel={(event) => { event.preventDefault(); close(); }}>
    <div className="visualizer-picker-header">
      <h2 id="visualizer-picker-title">Choose visualizer</h2>
      <button onClick={close} aria-label="Close visualizer picker">Close</button>
    </div>
    <div className="visualizer-picker-options">
      {VISUALIZERS.map((entry, i) => <button key={entry.name} ref={i === index ? current : undefined}
        aria-pressed={i === index} onClick={() => { useVizStore.getState().setIndex(i); close(); }}>
        {entry.name}
      </button>)}
    </div>
  </dialog>;
}
