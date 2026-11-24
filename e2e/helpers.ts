import type { APIRequestContext, Page } from '@playwright/test';

export interface SeedDoc {
  title: string;
  spec: string;
  claims: Array<{ id: string; number: number; text: string }>;
}

/** Creates a draft through the API and opens it. Without a document the server seeds the sample patent. */
export async function openDraft(page: Page, request: APIRequestContext, doc?: SeedDoc): Promise<string> {
  const response = await request.post('/api/drafts', { data: doc ?? {} });
  const draft = (await response.json()) as { id: string };
  await page.goto(`/?draft=${draft.id}`);
  await page.locator('p.claim').first().waitFor();
  return draft.id;
}

export const claim = (page: Page, n: number) => page.locator('p.claim').nth(n - 1);

export async function clickEndOfClaim(page: Page, n: number) {
  await claim(page, n).click();
  await page.keyboard.press('End');
}

export const tab = (page: Page, name: string) => page.getByRole('tab', { name: new RegExp(`^${name}`) });
