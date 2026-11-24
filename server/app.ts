import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import { analyzeClaims } from '../src/domain/analysis';
import { sampleDocument } from '../src/domain/sample';
import {
  createLlmProvider,
  suggestRuleBased,
  type Suggestion,
  type SuggestionProvider,
} from '../src/domain/suggestions';
import type { Claim, ClaimDocument } from '../src/domain/types';
import { DraftStore } from './store';

export interface AppOptions {
  /** JSON file for drafts, or null to keep them in memory. */
  dataFile: string | null;
  /** Built front end to serve, if it exists. */
  staticDir?: string;
  /** Pause between streamed suggestions so progressive delivery is visible. 0 disables it. */
  suggestDelayMs?: number;
  /** Optional OpenAI-compatible endpoint used when a request asks for `llm: true`. */
  llm?: { endpoint: string; model: string; fetchImpl?: typeof fetch };
}

const MAX_CLAIMS = 500;
const MAX_TEXT = 20_000;
const MAX_SPEC = 200_000;

function parseClaims(value: unknown): Claim[] | null {
  if (!Array.isArray(value) || value.length > MAX_CLAIMS) return null;
  const claims: Claim[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') return null;
    const { id, number, text } = item as Record<string, unknown>;
    if (typeof id !== 'string' || typeof number !== 'number' || typeof text !== 'string') return null;
    if (!Number.isFinite(number) || text.length > MAX_TEXT || id.length > 100) return null;
    claims.push({ id, number, text });
  }
  return claims;
}

function parseDocument(value: unknown): ClaimDocument | null {
  if (!value || typeof value !== 'object') return null;
  const { title, claims, spec } = value as Record<string, unknown>;
  const parsed = parseClaims(claims);
  if (typeof title !== 'string' || title.length > 300 || !parsed) return null;
  if (spec !== undefined && (typeof spec !== 'string' || spec.length > MAX_SPEC)) return null;
  return { title, claims: parsed, spec: typeof spec === 'string' ? spec : '' };
}

const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

export function buildApp(options: AppOptions): FastifyInstance {
  const app = Fastify({ logger: false, bodyLimit: 2_000_000 });
  const store = new DraftStore(options.dataFile);
  const delay = options.suggestDelayMs ?? 0;

  app.get('/api/health', async () => ({ ok: true, engine: 'rules', llm: Boolean(options.llm) }));

  app.get('/api/drafts', async () => ({ drafts: store.listDrafts() }));

  app.post('/api/drafts', async (request, reply) => {
    const body = request.body as Record<string, unknown> | null;
    const doc = body && Object.keys(body).length > 0 ? parseDocument(body) : sampleDocument();
    if (!doc) return reply.code(400).send({ error: 'Invalid document.' });
    return reply.code(201).send(store.createDraft(doc));
  });

  app.get<{ Params: { id: string } }>('/api/drafts/:id', async (request, reply) => {
    const draft = store.getDraft(request.params.id);
    return draft ?? reply.code(404).send({ error: 'Draft not found.' });
  });

  app.put<{ Params: { id: string } }>('/api/drafts/:id', async (request, reply) => {
    const doc = parseDocument(request.body);
    if (!doc) return reply.code(400).send({ error: 'Invalid document.' });
    const draft = store.updateDraft(request.params.id, doc);
    return draft ?? reply.code(404).send({ error: 'Draft not found.' });
  });

  app.delete<{ Params: { id: string } }>('/api/drafts/:id', async (request, reply) => {
    return store.deleteDraft(request.params.id) ? reply.code(204).send() : reply.code(404).send({ error: 'Draft not found.' });
  });

  app.get<{ Params: { id: string } }>('/api/drafts/:id/versions', async (request, reply) => {
    const versions = store.listVersions(request.params.id);
    return versions ? { versions } : reply.code(404).send({ error: 'Draft not found.' });
  });

  /** Saves the posted document as the current draft and snapshots it as a version in one step. */
  app.post<{ Params: { id: string } }>('/api/drafts/:id/versions', async (request, reply) => {
    if (!store.getDraft(request.params.id)) return reply.code(404).send({ error: 'Draft not found.' });
    const body = (request.body ?? {}) as { label?: unknown; auto?: unknown; doc?: unknown };
    const doc = body.doc === undefined ? null : parseDocument(body.doc);
    if (body.doc !== undefined && !doc) return reply.code(400).send({ error: 'Invalid document.' });
    const current = doc ? store.updateDraft(request.params.id, doc) : store.getDraft(request.params.id);
    if (!current) return reply.code(404).send({ error: 'Draft not found.' });
    const label =
      typeof body.label === 'string' && body.label.trim() ? body.label.trim().slice(0, 120) : 'Saved version';
    const { title, claims, spec } = current;
    const version = store.addVersion(current.id, label, body.auto === true, { title, claims, spec });
    return reply.code(201).send({ version });
  });

  app.get<{ Params: { id: string; versionId: string } }>(
    '/api/drafts/:id/versions/:versionId',
    async (request, reply) => {
      const version = store.getVersion(request.params.id, request.params.versionId);
      return version ?? reply.code(404).send({ error: 'Version not found.' });
    },
  );

  /** Restoring never loses work: the current state is snapshotted first. */
  app.post<{ Params: { id: string; versionId: string } }>(
    '/api/drafts/:id/versions/:versionId/restore',
    async (request, reply) => {
      const draft = store.getDraft(request.params.id);
      const version = store.getVersion(request.params.id, request.params.versionId);
      if (!draft || !version) return reply.code(404).send({ error: 'Not found.' });
      const { title, claims, spec } = draft;
      store.addVersion(draft.id, 'Before restore', true, { title, claims, spec });
      const restored = store.updateDraft(draft.id, version.snapshot);
      return restored;
    },
  );

  /**
   * Streams suggestions as server-sent events: `progress` per claim, one `suggestion` event per
   * edit, then `done`. The deterministic rule engine is the default; the optional LLM provider
   * only runs when the server has an endpoint configured and the request asks for it.
   */
  app.post('/api/suggest', async (request, reply) => {
    const body = (request.body ?? {}) as { claims?: unknown; spec?: unknown; llm?: unknown };
    const claims = parseClaims(body.claims);
    if (!claims) return reply.code(400).send({ error: 'Invalid claims.' });
    const spec = typeof body.spec === 'string' ? body.spec : '';

    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    let closed = false;
    res.on('close', () => {
      closed = true;
    });
    const send = (event: string, data: unknown) => {
      if (!closed) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    const started = performance.now();
    let count = 0;
    try {
      const analysis = analyzeClaims(claims, spec);
      const rule = suggestRuleBased(claims, analysis);
      const byClaim = new Map<string, Suggestion[]>();
      for (const s of rule) byClaim.set(s.claimId, [...(byClaim.get(s.claimId) ?? []), s]);

      let done = 0;
      for (const claim of claims) {
        if (closed) break;
        done += 1;
        send('progress', { done, total: claims.length });
        for (const suggestion of byClaim.get(claim.id) ?? []) {
          if (delay > 0) await sleep(delay);
          send('suggestion', { engine: 'rules', suggestion });
          count += 1;
        }
      }

      if (body.llm === true && options.llm && !closed) {
        const provider: SuggestionProvider = createLlmProvider(options.llm);
        for (const suggestion of await provider.suggest(claims, analysis)) {
          send('suggestion', { engine: 'llm', suggestion });
          count += 1;
        }
      }
      send('done', { count, ms: Math.round(performance.now() - started), engine: body.llm === true && options.llm ? 'rules+llm' : 'rules' });
    } catch (error) {
      send('error', { message: error instanceof Error ? error.message : 'Suggestion engine failed.' });
    } finally {
      res.end();
    }
  });

  const staticDir = options.staticDir ? resolve(options.staticDir) : null;
  if (staticDir && existsSync(staticDir)) {
    void app.register(fastifyStatic, { root: staticDir });
    app.setNotFoundHandler((request, reply) => {
      if (request.raw.url?.startsWith('/api/')) return reply.code(404).send({ error: 'Not found.' });
      return reply.sendFile('index.html');
    });
  }

  return app;
}
