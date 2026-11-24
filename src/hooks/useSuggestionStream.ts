import { useCallback, useEffect, useRef, useState } from 'react';
import { streamSuggestions } from '../api';
import { analyzeClaims } from '../domain/analysis';
import { suggestRuleBased, type Suggestion } from '../domain/suggestions';
import type { Claim } from '../domain/types';
import type { StreamState } from '../components/SuggestionPanel';

const DEBOUNCE_MS = 450;

/**
 * Keeps the suggestion list in step with the claims. Each run streams from the server and merges
 * results as they arrive; when the server is unreachable the same rule engine runs locally.
 * Earlier suggestions stay on screen until the new run finishes, so typing does not flicker the list.
 */
export function useSuggestionStream(claims: Claim[], serverAvailable: boolean) {
  const [items, setItems] = useState<Suggestion[]>([]);
  const [stream, setStream] = useState<StreamState>({ status: 'idle', done: 0, total: 0, engine: 'server', ms: null });
  const [runId, setRunId] = useState(0);
  const first = useRef(true);
  const claimsRef = useRef(claims);
  claimsRef.current = claims;

  const rerun = useCallback(() => setRunId((n) => n + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    const snapshot = claims;
    const wait = first.current ? 0 : DEBOUNCE_MS;
    first.current = false;

    const runLocal = () => {
      const result = suggestRuleBased(snapshot, analyzeClaims(snapshot));
      setItems(result);
      setStream({ status: 'done', done: snapshot.length, total: snapshot.length, engine: 'local', ms: null });
    };

    const timer = setTimeout(async () => {
      if (!serverAvailable) {
        runLocal();
        return;
      }
      const seen = new Set<string>();
      setStream((s) => ({ ...s, status: 'streaming', done: 0, total: snapshot.length, engine: 'server' }));
      try {
        await streamSuggestions(
          snapshot,
          '',
          {
            onProgress: (done, total) => setStream((s) => ({ ...s, done, total })),
            onSuggestion: (suggestion) => {
              seen.add(suggestion.id);
              setItems((previous) => {
                const index = previous.findIndex((p) => p.id === suggestion.id);
                if (index >= 0) return previous.map((p, i) => (i === index ? suggestion : p));
                return [...previous, suggestion];
              });
            },
            onDone: ({ ms }) => {
              setItems((previous) => previous.filter((p) => seen.has(p.id)));
              setStream((s) => ({ ...s, status: 'done', ms }));
            },
          },
          controller.signal,
        );
      } catch (error) {
        if ((error as Error).name === 'AbortError') return;
        runLocal();
      }
    }, wait);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [claims, serverAvailable, runId]);

  return { items, stream, rerun, setItems };
}
