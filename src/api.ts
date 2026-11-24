import type { Suggestion } from './domain/suggestions';
import type { Claim, ClaimDocument } from './domain/types';
import type { Draft, DraftSummary, Version, VersionSummary } from './domain/versions';

/** Thrown for any failed API call so callers can fall back to offline mode. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers: init?.body ? { 'Content-Type': 'application/json', ...init.headers } : init?.headers,
    });
  } catch {
    throw new ApiError('API unreachable', 0);
  }
  if (!response.ok) throw new ApiError(`API returned ${response.status}`, response.status);
  return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
}

const json = (value: unknown) => JSON.stringify(value);
const docOf = ({ title, claims, spec }: ClaimDocument): ClaimDocument => ({ title, claims, spec });

export const api = {
  listDrafts: () => request<{ drafts: DraftSummary[] }>('/api/drafts').then((r) => r.drafts),
  createDraft: (doc?: ClaimDocument) =>
    request<Draft>('/api/drafts', { method: 'POST', body: json(doc ? docOf(doc) : {}) }),
  getDraft: (id: string) => request<Draft>(`/api/drafts/${id}`),
  saveDraft: (id: string, doc: ClaimDocument, signal?: AbortSignal) =>
    request<Draft>(`/api/drafts/${id}`, { method: 'PUT', body: json(docOf(doc)), signal }),
  listVersions: (id: string) => request<{ versions: VersionSummary[] }>(`/api/drafts/${id}/versions`).then((r) => r.versions),
  getVersion: (id: string, versionId: string) => request<Version>(`/api/drafts/${id}/versions/${versionId}`),
  saveVersion: (id: string, doc: ClaimDocument, label: string, auto = false) =>
    request<{ version: VersionSummary }>(`/api/drafts/${id}/versions`, {
      method: 'POST',
      body: json({ label, auto, doc: docOf(doc) }),
    }).then((r) => r.version),
  restoreVersion: (id: string, versionId: string) =>
    request<Draft>(`/api/drafts/${id}/versions/${versionId}/restore`, { method: 'POST' }),
};

export interface SseEvent {
  event: string;
  data: unknown;
}

/** Incremental parser for a server-sent-event byte stream. Feed it text chunks as they arrive. */
export function createSseParser(onEvent: (event: SseEvent) => void): (chunk: string) => void {
  let buffer = '';
  return (chunk) => {
    buffer += chunk.replace(/\r\n/g, '\n');
    let boundary = buffer.indexOf('\n\n');
    while (boundary >= 0) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      let event = 'message';
      const data: string[] = [];
      for (const line of block.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
      }
      if (data.length > 0) {
        try {
          onEvent({ event, data: JSON.parse(data.join('\n')) });
        } catch {
          // Ignore a malformed event rather than dropping the whole stream.
        }
      }
      boundary = buffer.indexOf('\n\n');
    }
  };
}

export interface SuggestStreamHandlers {
  onProgress?: (done: number, total: number) => void;
  onSuggestion: (suggestion: Suggestion, engine: string) => void;
  onDone?: (info: { count: number; ms: number; engine: string }) => void;
}

/** Streams suggestions from the server. Resolves when the stream ends; rejects if it cannot be read. */
export async function streamSuggestions(
  claims: Claim[],
  spec: string,
  handlers: SuggestStreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  let response: Response;
  try {
    response = await fetch('/api/suggest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: json({ claims, spec }),
      signal,
    });
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw error;
    throw new ApiError('API unreachable', 0);
  }
  if (!response.ok || !response.body) throw new ApiError(`API returned ${response.status}`, response.status);

  let failed: string | null = null;
  const feed = createSseParser(({ event, data }) => {
    const payload = data as Record<string, unknown>;
    if (event === 'progress') handlers.onProgress?.(Number(payload.done), Number(payload.total));
    else if (event === 'suggestion') handlers.onSuggestion(payload.suggestion as Suggestion, String(payload.engine));
    else if (event === 'done') handlers.onDone?.(payload as { count: number; ms: number; engine: string });
    else if (event === 'error') failed = String(payload.message);
  });

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    feed(decoder.decode(value, { stream: true }));
  }
  if (failed) throw new ApiError(failed, 500);
}
