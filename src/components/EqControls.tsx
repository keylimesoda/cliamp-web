import { useEffect, useRef, useState } from "react";
import { EQ_BANDS_HZ, EQ_MAX_DB, EQ_MIN_DB, EQ_PRESET_CYCLE } from "../core/eq";
import { usePlayerStore } from "../store/player";

function PresetPicker({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const s = usePlayerStore();
  useEffect(() => { dialog.current?.showModal(); }, []);
  const close = () => { dialog.current?.close(); onClose(); };
  return (
    <dialog ref={dialog} className="eq-preset-dialog" aria-labelledby="eq-picker-title" onCancel={(event) => { event.preventDefault(); close(); }}>
      <div className="eq-picker-header">
        <h2 id="eq-picker-title">Choose EQ preset</h2>
        <button onClick={close} aria-label="Close EQ presets" autoFocus>Close</button>
      </div>
      <div className="eq-preset-list">
        {[...EQ_PRESET_CYCLE, "Custom"].map((name) => (
          <button key={name} disabled={name === "Custom" && !s.customEqGains}
            aria-pressed={s.eqPreset === name && (name !== "Custom" || s.customEqGains?.every((gain, i) => gain === s.eqGains[i]))}
            onClick={() => { s.applyPreset(name); close(); }}>
            {name === "Custom" ? "Saved custom EQ" : name}
          </button>
        ))}
      </div>
    </dialog>
  );
}

export default function EqControls() {
  const s = usePlayerStore();
  const [showPicker, setShowPicker] = useState(false);
  const presetButton = useRef<HTMLButtonElement>(null);
  const matchesSaved = s.customEqGains?.every((gain, i) => gain === s.eqGains[i]) ?? false;
  return (
    <section className="eq-controls" aria-label="Equalizer">
      <div className="eq-toolbar">
        <button ref={presetButton} onClick={() => setShowPicker(true)} aria-haspopup="dialog">EQ preset: {s.eqPreset}</button>
        <button onClick={s.saveCustomEq} disabled={matchesSaved}>Save custom EQ</button>
      </div>
      {s.track && !s.dspAvailable && <p className="eq-save-status">EQ is unavailable for this source. Your curve is kept for compatible audio.</p>}
      <div className="eq-bands">
        {EQ_BANDS_HZ.map((hz, i) => (
          <label className="eq-band" key={hz}>
            <span className="db">{s.eqGains[i] > 0 ? "+" : ""}{s.eqGains[i]} dB</span>
            <input type="range" min={EQ_MIN_DB} max={EQ_MAX_DB} step="1" value={s.eqGains[i]}
              aria-label={`EQ ${hz} Hz`} aria-valuetext={`${s.eqGains[i]} dB at ${hz} Hz`}
              onChange={(event) => {
                const gains = [...s.eqGains];
                gains[i] = Number(event.target.value);
                s.setEqGains(gains);
              }} />
            <span className="hz">{hz >= 1000 ? `${hz / 1000}k` : hz} Hz</span>
          </label>
        ))}
      </div>
      <p className="eq-save-status" role="status">
        {s.eqPreset === "Custom" ? (matchesSaved ? "Custom EQ saved on this browser." : "Custom EQ changed — tap Save custom EQ to keep this curve in the picker.")
          : "Adjust a frequency, then save your custom EQ on this browser."}
      </p>
      {showPicker && <PresetPicker onClose={() => { setShowPicker(false); presetButton.current?.focus(); }} />}
    </section>
  );
}
