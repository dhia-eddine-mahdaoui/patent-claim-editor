import { describe, expect, it } from 'vitest';
import { analyzeClaims } from './analysis';
import { diffWords } from './diff';
import {
  applySuggestionText,
  createLlmProvider,
  parseLlmSuggestions,
  suggestRuleBased,
} from './suggestions';
import { createClaim } from './parser';
import { sampleDocument } from './sample';
import type { Claim } from './types';

describe('rule-based suggestions', () => {
  it('proposes deterministic, offline fixes for the sample', () => {
    const claims = sampleDocument().claims;
    const suggestions = suggestRuleBased(claims, analyzeClaims(claims));
    const summary = suggestions.map((s) => [s.claimNumber, s.kind, s.from, s.to]);
    expect(summary).toEqual([
      [3, 'antecedent', 'the', 'a'],
      [4, 'wording', 'in order to', 'to'],
      [5, 'antecedent', 'the', 'a'],
      [5, 'style', '', '.'],
      [6, 'antecedent', 'the', 'a'],
    ]);
  });

  it('turns "said" into "the" when the term is already introduced', () => {
    const claims = [createClaim(1, 'A device comprising a housing and said housing.')];
    const said = suggestRuleBased(claims, analyzeClaims(claims)).filter((s) => s.from === 'said');
    expect(said).toHaveLength(1);
    expect(said[0].kind).toBe('wording');
  });

  it('offers an antecedent fix instead of a wording fix for an unsupported "said"', () => {
    const claims = [createClaim(1, 'A device comprising said housing.')];
    const said = suggestRuleBased(claims, analyzeClaims(claims)).filter((s) => s.from === 'said');
    expect(said).toHaveLength(1);
    expect(said[0].kind).toBe('antecedent');
    expect(said[0].to).toBe('a');
  });

  it('accepting an antecedent fix removes that issue after re-analysis', () => {
    const claims = sampleDocument().claims;
    const before = analyzeClaims(claims);
    const suggestion = suggestRuleBased(claims, before).find((s) => s.kind === 'antecedent' && s.claimNumber === 5);
    expect(suggestion).toBeDefined();
    if (!suggestion) return;

    const claim = claims.find((c) => c.id === suggestion.claimId) as Claim;
    const next = applySuggestionText(claim.text, suggestion);
    expect(next).toContain('reading a signal from a sensor');

    const updated = claims.map((c) => (c.id === claim.id ? { ...c, text: next ?? c.text } : c));
    const after = analyzeClaims(updated);
    expect(after.issues.filter((i) => i.claimId === claim.id && i.code === 'antecedent')).toEqual([]);
    expect(before.issues.length - after.issues.length).toBe(1);
  });

  it('reports a suggestion as stale when the text under it has changed', () => {
    expect(applySuggestionText('abc', { index: 0, from: 'x', to: 'y' })).toBeNull();
    expect(applySuggestionText('abc', { index: 1, from: 'b', to: 'B' })).toBe('aBc');
  });
});

describe('LLM suggestions', () => {
  const claims = [createClaim(1, 'A device comprising a sensor.'), createClaim(2, 'The device of claim 1, wherein the sensor is hot.')];

  it('accepts fenced JSON and drops invalid entries', () => {
    const content = [
      '```json',
      '[',
      '{"claimNumber": 2, "kind": "wording", "from": "is hot", "to": "is heated", "message": "Plainer verb"},',
      '{"claimNumber": 9, "kind": "wording", "from": "x", "to": "y", "message": "Unknown claim"},',
      '{"claimNumber": 2, "kind": "wording", "from": "not present", "to": "y", "message": "Bad anchor"}',
      ']',
      '```',
    ].join('\n');
    const result = parseLlmSuggestions(content, claims);
    expect(result).toHaveLength(1);
    expect(result[0].claimNumber).toBe(2);
    expect(result[0].message).toBe('Plainer verb (AI)');
  });

  it('returns nothing for malformed output', () => {
    expect(parseLlmSuggestions('not json at all', claims)).toEqual([]);
  });

  it('calls the configured endpoint and parses the chat response', async () => {
    const calls: Array<{ url: string; body: string }> = [];
    const fakeFetch = (async (url: string, init?: RequestInit) => {
      calls.push({ url, body: String(init?.body) });
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: '[{"claimNumber":2,"kind":"wording","from":"is hot","to":"is heated","message":"Plainer"}]' } }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof fetch;

    const provider = createLlmProvider({ endpoint: 'http://proxy.local/v1/chat', model: 'test-model', fetchImpl: fakeFetch });
    const result = await provider.suggest(claims, analyzeClaims(claims));

    expect(calls[0].url).toBe('http://proxy.local/v1/chat');
    expect(JSON.parse(calls[0].body).model).toBe('test-model');
    expect(result.map((s) => s.to)).toEqual(['is heated']);
  });

  it('surfaces HTTP failures as errors', async () => {
    const failing = (async () => new Response('nope', { status: 503 })) as typeof fetch;
    const provider = createLlmProvider({ endpoint: 'http://proxy.local', model: 'm', fetchImpl: failing });
    await expect(provider.suggest(claims, analyzeClaims(claims))).rejects.toThrow('503');
  });
});

describe('diffWords', () => {
  it('reconstructs both sides from the parts', () => {
    const before = 'The sensor is hot, and the sensor is cold.';
    const after = 'The sensor is warm, and a sensor is cold.';
    const parts = diffWords(before, after);
    const rebuilt = (keep: 'before' | 'after') =>
      parts
        .filter((p) => p.type === 'same' || (keep === 'before' ? p.type === 'removed' : p.type === 'added'))
        .map((p) => p.text)
        .join('');
    expect(rebuilt('before')).toBe(before);
    expect(rebuilt('after')).toBe(after);
  });

  it('marks only the changed words', () => {
    const parts = diffWords('a b c', 'a x c');
    expect(parts.filter((p) => p.type === 'removed').map((p) => p.text)).toEqual(['b']);
    expect(parts.filter((p) => p.type === 'added').map((p) => p.text)).toEqual(['x']);
  });
});
