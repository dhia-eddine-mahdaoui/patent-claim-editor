import type { Claim, ClaimDocument } from './types';

export function toPlainText(claims: Claim[]): string {
  return `${claims.map((claim) => `${claim.number}. ${claim.text}`).join('\n\n')}\n`;
}

export function toJsonExport(doc: ClaimDocument): string {
  return JSON.stringify(
    {
      title: doc.title,
      claims: doc.claims.map(({ number, text }) => ({ number, text })),
    },
    null,
    2,
  );
}

export function downloadText(filename: string, content: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: `${mime};charset=utf-8` }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
