// @vitest-environment node
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { sampleDocument } from '../src/domain/sample';
import { buildApp } from './app';

const apps: Array<ReturnType<typeof buildApp>> = [];
const dirs: string[] = [];

function make(options: Partial<Parameters<typeof buildApp>[0]> = {}) {
  const app = buildApp({ dataFile: null, suggestDelayMs: 0, ...options });
  apps.push(app);
  return app;
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function parseSse(body: string) {
  return body
    .split('\n\n')
    .filter(Boolean)
    .map((block) => {
      const event = /^event: (.*)$/m.exec(block)?.[1] ?? '';
      const data = JSON.parse(/^data: (.*)$/m.exec(block)?.[1] ?? 'null');
      return { event, data };
    });
}

describe('drafts API', () => {
  it('creates, reads, updates and lists drafts', async () => {
    const app = make();
    const created = await app.inject({ method: 'POST', url: '/api/drafts', payload: {} });
    expect(created.statusCode).toBe(201);
    const draft = created.json();
    expect(draft.claims).toHaveLength(8);

    const doc = { title: 'Renamed', claims: draft.claims.slice(0, 2), spec: 'Text.' };
    const put = await app.inject({ method: 'PUT', url: `/api/drafts/${draft.id}`, payload: doc });
    expect(put.statusCode).toBe(200);
    expect(put.json().claims).toHaveLength(2);

    const list = await app.inject({ method: 'GET', url: '/api/drafts' });
    expect(list.json().drafts).toEqual([expect.objectContaining({ id: draft.id, title: 'Renamed', claimCount: 2 })]);
  });

  it('rejects malformed documents and unknown drafts', async () => {
    const app = make();
    const bad = await app.inject({ method: 'POST', url: '/api/drafts', payload: { title: 1, claims: [] } });
    expect(bad.statusCode).toBe(400);
    const missing = await app.inject({ method: 'GET', url: '/api/drafts/nope' });
    expect(missing.statusCode).toBe(404);
  });

  it('keeps version history and restores without losing the current state', async () => {
    const app = make();
    const draft = (await app.inject({ method: 'POST', url: '/api/drafts', payload: {} })).json();
    const edited = { title: draft.title, spec: draft.spec, claims: draft.claims.slice(0, 3) };

    const saved = await app.inject({
      method: 'POST',
      url: `/api/drafts/${draft.id}/versions`,
      payload: { label: 'Cut to three claims', doc: edited },
    });
    expect(saved.statusCode).toBe(201);
    expect(saved.json().version.change.removed).toBe(5);

    const list = (await app.inject({ method: 'GET', url: `/api/drafts/${draft.id}/versions` })).json().versions;
    expect(list.map((v: { label: string }) => v.label)).toEqual(['Cut to three claims', 'Initial draft']);

    const initial = list[1];
    const restored = await app.inject({ method: 'POST', url: `/api/drafts/${draft.id}/versions/${initial.id}/restore` });
    expect(restored.json().claims).toHaveLength(8);

    const after = (await app.inject({ method: 'GET', url: `/api/drafts/${draft.id}/versions` })).json().versions;
    expect(after[0].label).toBe('Before restore');
    const backup = (await app.inject({ method: 'GET', url: `/api/drafts/${draft.id}/versions/${after[0].id}` })).json();
    expect(backup.snapshot.claims).toHaveLength(3);
  });

  it('persists drafts to disk across restarts', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'claims-'));
    dirs.push(dir);
    const file = join(dir, 'drafts.json');
    const first = make({ dataFile: file });
    const draft = (await first.inject({ method: 'POST', url: '/api/drafts', payload: sampleDocument() })).json();
    await first.close();
    apps.length = 0;

    const second = make({ dataFile: file });
    const read = await second.inject({ method: 'GET', url: `/api/drafts/${draft.id}` });
    expect(read.statusCode).toBe(200);
    expect(read.json().title).toBe(draft.title);
  });
});

describe('suggestion stream', () => {
  it('streams one event per suggestion, then done', async () => {
    const app = make();
    const { claims, spec } = sampleDocument();
    const res = await app.inject({ method: 'POST', url: '/api/suggest', payload: { claims, spec } });
    expect(res.headers['content-type']).toContain('text/event-stream');
    const events = parseSse(res.body);
    const suggestions = events.filter((e) => e.event === 'suggestion');
    expect(suggestions.map((e) => e.data.suggestion.claimNumber)).toEqual([3, 4, 5, 5, 6]);
    expect(events.filter((e) => e.event === 'progress')).toHaveLength(claims.length);
    expect(events[events.length - 1]).toEqual({ event: 'done', data: expect.objectContaining({ count: 5, engine: 'rules' }) });
  });

  it('is deterministic', async () => {
    const app = make();
    const { claims } = sampleDocument();
    const run = async () => (await app.inject({ method: 'POST', url: '/api/suggest', payload: { claims } })).body.replace(/"ms":\d+/, '');
    expect(await run()).toBe(await run());
  });

  it('rejects invalid input', async () => {
    const app = make();
    const res = await app.inject({ method: 'POST', url: '/api/suggest', payload: { claims: [{ id: 1 }] } });
    expect(res.statusCode).toBe(400);
  });

  it('adds LLM suggestions only when asked and configured', async () => {
    const fetchImpl = (async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: '[{"claimNumber":2,"from":"comprises","to":"includes","message":"Plainer verb"}]' } }],
        }),
      )) as unknown as typeof fetch;
    const app = make({ llm: { endpoint: 'http://llm.test/v1', model: 'm', fetchImpl } });
    const { claims } = sampleDocument();
    const withLlm = parseSse((await app.inject({ method: 'POST', url: '/api/suggest', payload: { claims, llm: true } })).body);
    expect(withLlm.filter((e) => e.event === 'suggestion' && e.data.engine === 'llm')).toHaveLength(1);
    const without = parseSse((await app.inject({ method: 'POST', url: '/api/suggest', payload: { claims } })).body);
    expect(without.some((e) => e.data?.engine === 'llm')).toBe(false);
  });
});
