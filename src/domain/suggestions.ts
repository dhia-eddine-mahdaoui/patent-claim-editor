import type { Analysis, Claim } from './types';

export type SuggestionKind = 'antecedent' | 'wording' | 'style';

/**
 * A single text edit against one claim. `index` is the character offset where `from`
 * must appear in the claim text; `to` replaces it. Suggestions are recomputed from the
 * current text, so an edit that no longer matches is reported as out of date.
 */
export interface Suggestion {
  id: string;
  claimId: string;
  claimNumber: number;
  kind: SuggestionKind;
  message: string;
  index: number;
  from: string;
  to: string;
}

/** Provider interface: the rule-based engine and the optional LLM both implement it. */
export interface SuggestionProvider {
  readonly id: string;
  readonly label: string;
  suggest(claims: Claim[], analysis: Analysis): Promise<Suggestion[]>;
}

export function applySuggestionText(
  text: string,
  edit: Pick<Suggestion, 'index' | 'from' | 'to'>,
): string | null {
  if (text.slice(edit.index, edit.index + edit.from.length) !== edit.from) return null;
  return text.slice(0, edit.index) + edit.to + text.slice(edit.index + edit.from.length);
}

function makeSuggestion(
  claim: Claim,
  kind: SuggestionKind,
  message: string,
  index: number,
  from: string,
  to: string,
): Suggestion {
  return {
    id: `${claim.id}:${kind}:${index}:${from}>${to}`,
    claimId: claim.id,
    claimNumber: claim.number,
    kind,
    message,
    index,
    from,
    to,
  };
}

/** Deterministic, offline suggestions. Pure function of the claims and their analysis. */
export function suggestRuleBased(claims: Claim[], analysis: Analysis): Suggestion[] {
  const suggestions: Suggestion[] = [];
  for (const claim of claims) {
    const text = claim.text;
    if (!text.trim()) continue;
    const push = (kind: SuggestionKind, message: string, index: number, from: string, to: string) =>
      suggestions.push(makeSuggestion(claim, kind, message, index, from, to));

    const antecedentStarts = new Set<number>();
    for (const issue of analysis.issuesByClaim[claim.id] ?? []) {
      if (issue.code !== 'antecedent' || !issue.range) continue;
      const [start, end] = issue.range;
      const phrase = text.slice(start, end);
      const article = /^(the|said)\b/i.exec(phrase)?.[0];
      if (!article) continue;
      antecedentStarts.add(start);
      push('antecedent', `Use "a" to introduce "${phrase}" at its first mention.`, start, article, 'a');
    }

    for (const match of text.matchAll(/\bsaid\b/gi)) {
      const index = match.index ?? 0;
      if (antecedentStarts.has(index)) continue;
      push('wording', 'Replace "said" with "the" for plainer wording.', index, match[0], 'the');
    }

    for (const match of text.matchAll(/\bin order to\b/gi)) {
      push('wording', 'Shorten "in order to" to "to".', match.index ?? 0, match[0], 'to');
    }

    for (const match of text.matchAll(/ {2,}/g)) {
      push('style', 'Collapse repeated spaces.', match.index ?? 0, match[0], ' ');
    }

    const trimmedEnd = text.replace(/\s+$/, '');
    if (!trimmedEnd.endsWith('.')) {
      push('style', 'End the claim with a period.', trimmedEnd.length, '', '.');
    }
  }
  return suggestions;
}

/** Accepts the model's JSON array of edits (optionally inside a code fence) and keeps only valid ones. */
export function parseLlmSuggestions(content: string, claims: Claim[]): Suggestion[] {
  const cleaned = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  let raw: unknown;
  try {
    raw = JSON.parse(cleaned);
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];

  const suggestions: Suggestion[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const fields = item as Record<string, unknown>;
    const claim = claims.find((c) => c.number === Number(fields.claimNumber));
    const { from, to, message } = fields;
    if (!claim || typeof from !== 'string' || typeof to !== 'string' || typeof message !== 'string') continue;
    if (from.length === 0) continue;
    const index = claim.text.indexOf(from);
    if (index < 0) continue;
    suggestions.push(makeSuggestion(claim, 'wording', `${message} (AI)`, index, from, to));
  }
  return suggestions;
}

const LLM_SYSTEM_PROMPT =
  'You review patent claims. Reply with only a JSON array. Each item has: ' +
  'claimNumber (number), kind ("antecedent" or "wording"), from (an exact substring of that claim), ' +
  'to (the replacement), message (a short reason). Do not change the technical scope of any claim.';

export interface LlmProviderOptions {
  endpoint: string;
  model: string;
  fetchImpl?: typeof fetch;
}

/**
 * Optional provider for an OpenAI-compatible chat endpoint. The endpoint is expected to be
 * a local or company-controlled proxy so that no API key ships in the browser bundle.
 */
export function createLlmProvider(options: LlmProviderOptions): SuggestionProvider {
  const doFetch = options.fetchImpl ?? fetch;
  return {
    id: 'llm',
    label: `LLM (${options.model})`,
    async suggest(claims) {
      const listing = claims.map((claim) => `Claim ${claim.number}: ${claim.text}`).join('\n');
      const response = await doFetch(options.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: options.model,
          temperature: 0,
          messages: [
            { role: 'system', content: LLM_SYSTEM_PROMPT },
            { role: 'user', content: listing },
          ],
        }),
      });
      if (!response.ok) throw new Error(`LLM endpoint returned ${response.status}`);
      const payload = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
      return parseLlmSuggestions(payload.choices?.[0]?.message?.content ?? '[]', claims);
    },
  };
}
