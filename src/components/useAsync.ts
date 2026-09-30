import { useEffect, useState } from "react";

export interface AsyncState<T> {
  data: T | null;
  busy: boolean;
  error: string | null;
}

/**
 * Fetch-on-key-change hook. Re-runs `fn` whenever `key` changes; an empty
 * key skips the fetch (returns no data). Cancels stale responses on
 * key change / unmount.
 */
export function useAsync<T>(fn: () => Promise<T>, key: string): AsyncState<T> {
  const [state, setState] = useState<AsyncState<T>>({ data: null, busy: false, error: null });

  useEffect(() => {
    if (!key) {
      setState({ data: null, busy: false, error: null });
      return;
    }
    let live = true;
    setState({ data: null, busy: true, error: null });
    fn()
      .then((data) => {
        if (live) setState({ data, busy: false, error: null });
      })
      .catch((e) => {
        if (live) setState({ data: null, busy: false, error: e instanceof Error ? e.message : String(e) });
      });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return state;
}
