import { SkillError } from './errors.ts';

/**
 * Parses a human page selection such as "1-3, 5, 8-" into groups of
 * zero-based page indices. Supported tokens: `n`, `a-b`, `a-` (to end),
 * `-b` (from start), `last`. Separators: comma, semicolon or whitespace.
 */
export function parsePageRanges(input: string, pageCount: number): number[][] {
  const tokens = input
    .split(/[,;\s]+/)
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);

  if (!tokens.length) return [Array.from({ length: pageCount }, (_, i) => i)];

  const resolve = (raw: string, fallback: number): number => {
    if (raw === '') return fallback;
    if (raw === 'last') return pageCount;
    if (!/^\d+$/.test(raw)) throw invalid(input);
    return Number(raw);
  };

  return tokens.map((token) => {
    const parts = token.split('-');
    if (parts.length > 2) throw invalid(input);
    const [a = '', b] = parts;
    const start = resolve(a, 1);
    const end = b === undefined ? start : resolve(b, pageCount);
    if (start < 1 || end > pageCount || start > end) {
      throw new SkillError('INVALID_OPTIONS', `Plage « ${token} » hors du document (1–${pageCount}).`, {
        token,
        pageCount,
      });
    }
    return Array.from({ length: end - start + 1 }, (_, i) => start - 1 + i);
  });
}

/** Flattened, de-duplicated selection preserving first-seen order. */
export function parsePageSelection(input: string, pageCount: number): number[] {
  return [...new Set(parsePageRanges(input, pageCount).flat())];
}

function invalid(input: string): SkillError {
  return new SkillError('INVALID_OPTIONS', `Sélection de pages illisible : « ${input.slice(0, 40)} ». Exemple : 1-3, 5, 8-`);
}
