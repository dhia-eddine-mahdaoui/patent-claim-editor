/**
 * Immutable undo/redo history. Commits that share a coalescing key with the previous
 * commit (for example consecutive keystrokes in one claim) form a single undo step.
 */
export interface History<T> {
  past: T[];
  present: T;
  future: T[];
  lastKey: string | null;
}

const LIMIT = 200;

export function createHistory<T>(present: T): History<T> {
  return { past: [], present, future: [], lastKey: null };
}

export function commit<T>(history: History<T>, next: T, key: string | null = null): History<T> {
  if (next === history.present) return history;
  const coalesced = key !== null && key === history.lastKey;
  const past = coalesced ? history.past : [...history.past, history.present].slice(-LIMIT);
  return { past, present: next, future: [], lastKey: key };
}

export function undo<T>(history: History<T>): History<T> {
  if (history.past.length === 0) return history;
  const previous = history.past[history.past.length - 1];
  return {
    past: history.past.slice(0, -1),
    present: previous,
    future: [history.present, ...history.future],
    lastKey: null,
  };
}

export function redo<T>(history: History<T>): History<T> {
  if (history.future.length === 0) return history;
  const [next, ...rest] = history.future;
  return {
    past: [...history.past, history.present],
    present: next,
    future: rest,
    lastKey: null,
  };
}
