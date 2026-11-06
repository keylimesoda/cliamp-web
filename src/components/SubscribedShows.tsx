import { usePodcastPrefs, type SubscribedShow } from "../store/podcastPrefs";
import { usePodcastActions } from "../store/podcastActions";

export default function SubscribedShows({ onOpenShow }: { onOpenShow: (show: SubscribedShow) => void }) {
  const { subs, toggleSub } = usePodcastPrefs();
  const actions = usePodcastActions();
  return <>
    <div className="subscriptions-header">
      <span>Saved shows</span>
      <button disabled={actions.busy || !subs.length} onClick={() => void actions.appendLatestAll()}>Add latest from all</button>
    </div>
    <div role="status" aria-live="polite">
      {actions.message && <div className="status-row">{actions.message}</div>}
      {actions.error && <div className="status-row is-error">{actions.error}</div>}
    </div>
    <div className="list subscription-list">
      {subs.map((s) => <div className="row subscription-row" key={s.feedUrl}>
        <button className="subscription-open" onClick={() => onOpenShow(s)} aria-label={s.name}>
          <span className="marker" aria-hidden>▸</span><span className="title">{s.name}</span>
        </button>
        <button disabled={actions.busy} onClick={() => void actions.queueLatest(s)} aria-label={`Queue latest from ${s.name}`}>Queue latest</button>
        <button className="subscription-remove is-fav" onClick={() => toggleSub(s)} aria-label={`Unsubscribe from ${s.name}`}>♥</button>
      </div>)}
      {!subs.length && <div className="row dim">no saved podcast shows yet</div>}
    </div>
  </>;
}
