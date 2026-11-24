import { describe, expect, it } from 'vitest';
import { createSseParser, type SseEvent } from './api';

describe('SSE parser', () => {
  it('reassembles events split across chunks', () => {
    const events: SseEvent[] = [];
    const feed = createSseParser((e) => events.push(e));
    feed('event: suggestion\ndata: {"a"');
    feed(':1}\n\nevent: done\r\ndata: {"count":1}\r\n\r\n');
    expect(events).toEqual([
      { event: 'suggestion', data: { a: 1 } },
      { event: 'done', data: { count: 1 } },
    ]);
  });

  it('skips malformed events without dropping later ones', () => {
    const events: SseEvent[] = [];
    createSseParser((e) => events.push(e))('data: {oops\n\nevent: done\ndata: {}\n\n');
    expect(events).toEqual([{ event: 'done', data: {} }]);
  });
});
