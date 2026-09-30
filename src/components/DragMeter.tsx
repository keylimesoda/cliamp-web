import { useCallback, useRef } from "react";

interface DragMeterProps {
  /** 0..1 fill ratio. */
  value: number;
  /** Called with a 0..1 ratio while dragging/tapping. */
  onRatio: (ratio: number) => void;
  /** Live drag callback (optional, for scrub preview). */
  onScrub?: (ratio: number) => void;
  className?: string;
  label?: string;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/**
 * Touch-draggable meter (seek bar / volume). A wide invisible hit area
 * (via .meter::after) makes the thin bar easy to grab; pointer events
 * drive the ratio. No hover dependence.
 */
export default function DragMeter({ value, onRatio, onScrub, className, label }: DragMeterProps) {
  const ref = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const ratioFromEvent = useCallback((clientX: number): number => {
    const el = ref.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    return clamp01((clientX - rect.left) / rect.width);
  }, []);

  const onPointerDown = (e: React.PointerEvent) => {
    dragging.current = true;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const r = ratioFromEvent(e.clientX);
    onScrub?.(r);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging.current) return;
    onScrub?.(ratioFromEvent(e.clientX));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (!dragging.current) return;
    dragging.current = false;
    onRatio(ratioFromEvent(e.clientX));
  };

  const pct = `${(clamp01(value) * 100).toFixed(2)}%`;
  return (
    <div
      ref={ref}
      className={"meter" + (className ? " " + className : "")}
      role="slider"
      aria-label={label ?? "meter"}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamp01(value) * 100)}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <div className="fill" style={{ width: pct }} />
      <div className="head" style={{ left: pct }} />
    </div>
  );
}
