/**
 * Visualizer registry — cycle order matches the original cliamp
 * (ui/visualizer.go visModes). "None" (original VisNone) last.
 */
import type { Visualizer } from "./types";
import { makeBars } from "./impl/bars";
import { makeBarsDot } from "./impl/bars_dot";
import { makeRain } from "./impl/rain";
import { makeBarsOutline } from "./impl/bars_outline";
import { makeBricks } from "./impl/bricks";
import { makeColumns } from "./impl/columns";
import { makeClassicPeak } from "./impl/classic_peak";
import { makeWave } from "./impl/wave";
import { makeScatter } from "./impl/scatter";
import { makeFlame } from "./impl/flame";
import { makeRetro } from "./impl/retro";
import { makePulse } from "./impl/pulse";
import { makeMatrix } from "./impl/matrix";
import { makeBinary } from "./impl/binary";
import { makeSakura } from "./impl/sakura";
import { makeFirework } from "./impl/firework";
import { makeBubbles } from "./impl/bubbles";
import { makeLogo } from "./impl/logo";
import { makeTerrain } from "./impl/terrain";
import { makeScope } from "./impl/scope";
import { makeHeartbeat } from "./impl/heartbeat";
import { makeButterfly } from "./impl/butterfly";
import { makeAscii } from "./impl/ascii";
import { makeFirefly } from "./impl/firefly";
import { makeMosaic } from "./impl/mosaic";
import { makeSand } from "./impl/sand";
import { makeGeyser } from "./impl/geyser";
import { makeClassicLed } from "./impl/classic_led";
import { makeStereo } from "./impl/stereo";
import { makeMirror } from "./impl/mirror";
import { makeOmarchy } from "./impl/omarchy";
import { makeRedSector } from "./impl/red_sector";
import { makeNone } from "./impl/none";

export interface VizEntry {
  name: string;
  make: () => Visualizer;
}

export const VISUALIZERS: VizEntry[] = [
  { name: "Bars", make: makeBars },
  { name: "BarsDot", make: makeBarsDot },
  { name: "Rain", make: makeRain },
  { name: "BarsOutline", make: makeBarsOutline },
  { name: "Bricks", make: makeBricks },
  { name: "Columns", make: makeColumns },
  { name: "ClassicPeak", make: makeClassicPeak },
  { name: "Wave", make: makeWave },
  { name: "Scatter", make: makeScatter },
  { name: "Flame", make: makeFlame },
  { name: "Retro", make: makeRetro },
  { name: "Pulse", make: makePulse },
  { name: "Matrix", make: makeMatrix },
  { name: "Binary", make: makeBinary },
  { name: "Sakura", make: makeSakura },
  { name: "Firework", make: makeFirework },
  { name: "Bubbles", make: makeBubbles },
  { name: "Logo", make: makeLogo },
  { name: "Terrain", make: makeTerrain },
  { name: "Scope", make: makeScope },
  { name: "Heartbeat", make: makeHeartbeat },
  { name: "Butterfly", make: makeButterfly },
  { name: "Ascii", make: makeAscii },
  { name: "Firefly", make: makeFirefly },
  { name: "Mosaic", make: makeMosaic },
  { name: "Sand", make: makeSand },
  { name: "Geyser", make: makeGeyser },
  { name: "ClassicLED", make: makeClassicLed },
  { name: "Stereo", make: makeStereo },
  { name: "Mirror", make: makeMirror },
  { name: "Omarchy", make: makeOmarchy },
  { name: "RedSector", make: makeRedSector },
  { name: "None", make: makeNone },
];
