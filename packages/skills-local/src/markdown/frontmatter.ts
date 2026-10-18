/**
 * Minimal, safe YAML front matter reader for document metadata.
 * Supports scalars, quoted strings, inline lists `[a, b]` and block lists.
 * Deliberately not a full YAML parser: no anchors, no tags, no code paths.
 */
export type FrontMatter = Record<string, string | string[]>;

const unquote = (v: string) => v.trim().replace(/^(['"])(.*)\1$/, '$2');

export function parseFrontMatter(source: string): { meta: FrontMatter; body: string } {
  const text = source.replace(/^\uFEFF/, '');
  const m = /^---[ \t]*\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/.exec(text);
  if (!m) return { meta: {}, body: text };

  const meta: FrontMatter = {};
  let listKey: string | null = null;
  for (const raw of m[1]!.split(/\r?\n/)) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    const item = /^\s+-\s+(.*)$/.exec(raw);
    if (item && listKey) {
      const current = meta[listKey];
      meta[listKey] = [...(Array.isArray(current) ? current : []), unquote(item[1]!)];
      continue;
    }
    const kv = /^([A-Za-z][\w-]*)\s*:\s*(.*)$/.exec(raw);
    if (!kv) continue;
    const key = kv[1]!.toLowerCase();
    const value = kv[2]!.trim();
    if (value === '') {
      listKey = key;
      meta[key] = [];
    } else if (/^\[.*\]$/.test(value)) {
      listKey = null;
      meta[key] = value.slice(1, -1).split(',').map(unquote).filter(Boolean);
    } else {
      listKey = null;
      meta[key] = unquote(value);
    }
  }
  return { meta, body: text.slice(m[0].length) };
}

export const asList = (v: string | string[] | undefined): string[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
export const asText = (v: string | string[] | undefined): string => asList(v).join(', ');
