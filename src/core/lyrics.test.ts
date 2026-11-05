import { describe, expect, it } from "vitest";
import { activeLineIndex, parseLRC } from "./lyrics";

describe("LRC v2.4 fixes", () => {
  it("expands repeated cues, orders them, and parses hundredths and milliseconds", () => {
    const result = parseLRC("\uFEFF[ar:Artist]\n[00:45.123][00:12.34]Chorus\n[00:02]Verse\nNotes");
    expect(result).toEqual({ synced: true, lines: [
      { time: 2, text: "Verse" }, { time: 12.34, text: "Chorus" }, { time: 45.123, text: "Chorus" },
    ] });
    expect(activeLineIndex(result.lines, 45.12)).toBe(1);
    expect(activeLineIndex(result.lines, 45.124)).toBe(2);
  });
  it("accepts long recordings and single fractional digits", () => {
    expect(parseLRC("[123:45.6]Long").lines).toEqual([{ time: 7425.6, text: "Long" }]);
  });
  it("keeps plain lyrics unsynced", () => {
    expect(parseLRC("Verse\nChorus")).toEqual({ synced: false, lines: [{ time: -1, text: "Verse" }, { time: -1, text: "Chorus" }] });
  });
});
