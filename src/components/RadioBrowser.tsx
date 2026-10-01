import { useState } from "react";
import { radioBrowse, type RadioCountry, type RadioTag } from "../providers/radio";
import { usePlayerStore } from "../store/player";
import { useRadioPrefs } from "../store/radioPrefs";
import type { Track } from "../core/types";
import { useAsync } from "./useAsync";

type View =
  | { kind: "home" }
  | { kind: "countries" }
  | { kind: "country"; code: string }
  | { kind: "tags" }
  | { kind: "tag"; name: string }
  | { kind: "search"; query: string };

const titleFor = (v: View): string => {
  switch (v.kind) {
    case "home":
      return "R A D I O";
    case "countries":
      return "C O U N T R I E S";
    case "country":
      return "S T A T I O N S";
    case "tags":
      return "G E N R E S";
    case "tag":
      return "S T A T I O N S";
    case "search":
      return "R E S U L T S";
  }
};
const crumbFor = (v: View, countryName?: string): string => {
  switch (v.kind) {
    case "country":
      return countryName ?? v.code;
    case "tag":
      return v.name;
    case "search":
      return `“${v.query}”`;
    default:
      return "Source";
  }
};

function Row({ label, hint, onClick }: { label: string; hint?: string; onClick?: () => void }) {
  return (
    <div className="row" onClick={onClick} role={onClick ? "button" : undefined} aria-label={label}>
      <span className="marker" aria-hidden>▸</span>
      <span className="title">{label}</span>
      {hint ? <span className="dur">{hint}</span> : null}
    </div>
  );
}

/**
 * Radio source picker — built-in channels, station search, and the
 * Radio Browser directory (country + genre/tag browse). Tapping a station
 * loads it into the playback playlist and plays. Countries can be pinned
 * (persisted) for quick access; stations can be favorited.
 */
export default function RadioBrowser() {
  const playTrack = usePlayerStore((s) => s.playTrack);
  const prefs = useRadioPrefs();
  const [view, setView] = useState<View>({ kind: "home" });
  const [query, setQuery] = useState("");
  const [countryName, setCountryName] = useState("");

  const play = (t: Track) => {
    void playTrack(t, 0);
  };

  const builtinsKey = view.kind === "home" ? "builtins" : "";
  const builtins = useAsync<Track[]>(
    () => (builtinsKey ? radioBrowse.listBuiltins() : Promise.resolve([])),
    builtinsKey,
  );
  const countries = useAsync<RadioCountry[]>(
    () => (view.kind === "countries" ? radioBrowse.listCountries() : Promise.resolve([])),
    view.kind === "countries" ? "countries" : "",
  );
  const countryStations = useAsync<Track[]>(
    () =>
      view.kind === "country" ? radioBrowse.stationsForCountry(view.code) : Promise.resolve([]),
    view.kind === "country" ? "country:" + view.code : "",
  );
  const tags = useAsync<RadioTag[]>(
    () => (view.kind === "tags" ? radioBrowse.listTags() : Promise.resolve([])),
    view.kind === "tags" ? "tags" : "",
  );
  const tagStations = useAsync<Track[]>(
    () =>
      view.kind === "tag" ? radioBrowse.stationsForTag(view.name) : Promise.resolve([]),
    view.kind === "tag" ? "tag:" + view.name : "",
  );
  const searchResults = useAsync<Track[]>(
    () =>
      view.kind === "search" && view.query.trim()
        ? radioBrowse.searchStations(view.query.trim(), 50)
        : Promise.resolve([]),
    view.kind === "search" ? "search:" + view.query : "",
  );

  const back = () => setView({ kind: "home" });

  const search = (q: string) => {
    setQuery(q);
    if (q.trim()) setView({ kind: "search", query: q });
    else setView({ kind: "home" });
  };

  const stationList: Track[] =
    view.kind === "country"
      ? countryStations.data ?? []
      : view.kind === "tag"
        ? tagStations.data ?? []
        : view.kind === "search"
          ? searchResults.data ?? []
          : [];
  const stationBusy =
    view.kind === "country"
      ? countryStations.busy
      : view.kind === "tag"
        ? tagStations.busy
        : view.kind === "search"
          ? searchResults.busy
          : false;
  const stationError =
    view.kind === "country"
      ? countryStations.error
      : view.kind === "tag"
        ? tagStations.error
        : view.kind === "search"
          ? searchResults.error
          : null;

  const orderedCountries =
    view.kind === "countries" && countries.data
      ? [...countries.data].sort(
          (a, b) =>
            Number(prefs.pinned.includes(b.code)) - Number(prefs.pinned.includes(a.code)),
        )
      : [];

  return (
    <div className="app source-browser">
      <div className="app-titlebar">
        <button onClick={back} style={{ padding: 0 }} aria-label="Back" disabled={view.kind === "home"}>
          ◀
        </button>
        <h1 className="app-title">{titleFor(view)}</h1>
        <span className="screen-label">
          {crumbFor(view, view.kind === "country" ? countryName : undefined)}
        </span>
      </div>

      <input
        type="search"
        value={query}
        placeholder="Search stations…"
        onChange={(e) => search(e.target.value)}
        style={{
          width: "100%",
          minHeight: "var(--tap-min)",
          padding: "0.5rem 0.8rem",
          fontFamily: "inherit",
          fontSize: "var(--fs-md)",
          color: "var(--text)",
          background: "var(--bg-sunken)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius)",
        }}
      />

      {stationError ? <div className="status-row is-error">ERR: {stationError}</div> : null}

      {view.kind === "home" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--gap)", flex: 1, minHeight: 0 }}>
          <div className="panel" style={{ padding: "0.4rem" }}>
            <div className="list">
              <Row
                label="Browse countries"
                hint={countries.data ? `${countries.data.length}` : undefined}
                onClick={() => setView({ kind: "countries" })}
              />
              <Row
                label="Browse genres & tags"
                hint={tags.data ? `${tags.data.length}` : undefined}
                onClick={() => setView({ kind: "tags" })}
              />
            </div>
          </div>
          <div className="panel scroll-panel" style={{ padding: "0.4rem" }}>
            <div className="list">
              {(builtins.data ?? []).map((t) => (
                <div className="row" key={t.path} onClick={() => play(t)} role="button" aria-label={t.title}>
                  <span className="marker" aria-hidden>♫</span>
                  <span className="title">{t.title}</span>
                  <span className="dur">{t.genre ?? "LIVE"}</span>
                  <span
                    className={"radio-star" + (prefs.isFavorite(t.path) ? " is-fav" : "")}
                    onClick={(e) => {
                      e.stopPropagation();
                      prefs.toggleFavorite(t.path);
                    }}
                    role="button"
                    aria-label={prefs.isFavorite(t.path) ? "Remove favorite" : "Favorite station"}
                  >
                    {prefs.isFavorite(t.path) ? "★" : "☆"}
                  </span>
                </div>
              ))}
              {builtins.busy ? <Row label="loading built-in channels…" /> : null}
              {builtins.error ? <div className="status-row is-error">ERR: {builtins.error}</div> : null}
            </div>
          </div>
        </div>
      )}

      {view.kind === "countries" && (
        <div className="panel scroll-panel" style={{ padding: "0.4rem" }}>
          <div className="list">
            {countries.busy ? <Row label="loading countries…" /> : null}
            {orderedCountries.map((c) => (
              <div
                className="row"
                key={c.code}
                onClick={() => {
                  setCountryName(c.name);
                  setView({ kind: "country", code: c.code });
                }}
                role="button"
                aria-label={c.name}
              >
                <span className="marker" aria-hidden>▸</span>
                <span className="title">{c.name}</span>
                <span className="dur">{c.stationcount}</span>
                <span
                  className={"radio-star" + (prefs.isPinned(c.code) ? " is-fav" : "")}
                  onClick={(e) => {
                    e.stopPropagation();
                    prefs.togglePin(c.code);
                  }}
                  role="button"
                  aria-label={prefs.isPinned(c.code) ? "Unpin country" : "Pin country"}
                >
                  {prefs.isPinned(c.code) ? "★" : "☆"}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {view.kind === "tags" && (
        <div className="panel scroll-panel" style={{ padding: "0.4rem" }}>
          <div className="list">
            {tags.busy ? <Row label="loading tags…" /> : null}
            {(tags.data ?? []).slice(0, 300).map((t) => (
              <div className="row" key={t.name} onClick={() => setView({ kind: "tag", name: t.name })} role="button" aria-label={t.name}>
                <span className="marker" aria-hidden>#</span>
                <span className="title">{t.name}</span>
                <span className="dur">{t.stationcount}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {(view.kind === "country" || view.kind === "tag" || view.kind === "search") && (
        <div className="panel scroll-panel" style={{ padding: "0.4rem" }}>
          <div className="list">
            {stationBusy ? <Row label="loading stations…" /> : null}
            {stationList.map((t) => (
              <div className="row" key={t.path} onClick={() => play(t)} role="button" aria-label={t.title}>
                <span className="marker" aria-hidden>♫</span>
                <span className="title">{t.title}</span>
                <span className="dur">{(t.providerMeta?.countrycode as string) ?? t.genre ?? "LIVE"}</span>
                <span
                  className={"radio-star" + (prefs.isFavorite(t.path) ? " is-fav" : "")}
                  onClick={(e) => {
                    e.stopPropagation();
                    prefs.toggleFavorite(t.path);
                  }}
                  role="button"
                  aria-label={prefs.isFavorite(t.path) ? "Remove favorite" : "Favorite station"}
                >
                  {prefs.isFavorite(t.path) ? "★" : "☆"}
                </span>
              </div>
            ))}
            {!stationBusy && stationList.length === 0 ? (
              <Row label={view.kind === "search" ? "no results" : "no stations"} />
            ) : null}
          </div>
        </div>
      )}

      <div className="footer">
        <div className="help-row">
          <span>
            <span className="key-pill">tip</span> tap a station to play · ☆ / ★ pins / favorites
          </span>
        </div>
      </div>
    </div>
  );
}
