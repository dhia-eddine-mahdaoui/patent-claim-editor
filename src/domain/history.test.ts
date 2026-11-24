import { describe, expect, it } from 'vitest';
import { commit, createHistory, redo, undo } from './history';

describe('undo / redo history', () => {
  it('steps back and forward through commits', () => {
    let h = createHistory('a');
    h = commit(h, 'b');
    h = commit(h, 'c');
    h = undo(h);
    expect(h.present).toBe('b');
    h = redo(h);
    expect(h.present).toBe('c');
  });

  it('merges consecutive commits that share a key into one step', () => {
    let h = createHistory('');
    h = commit(h, 'h', 'text:1');
    h = commit(h, 'he', 'text:1');
    h = commit(h, 'hel', 'text:1');
    h = undo(h);
    expect(h.present).toBe('');
    expect(h.past).toHaveLength(0);
  });

  it('clears the redo branch after a new commit', () => {
    let h = createHistory(1);
    h = commit(h, 2);
    h = undo(h);
    h = commit(h, 3);
    expect(redo(h)).toBe(h);
  });

  it('is a no-op when there is nothing to undo', () => {
    const h = createHistory('x');
    expect(undo(h)).toBe(h);
  });
});
