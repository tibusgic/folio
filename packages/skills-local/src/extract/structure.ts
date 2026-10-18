/**
 * Layout analysis: positioned text runs -> semantic blocks.
 * Pure and deterministic so it can be unit-tested without pdf.js.
 *
 * Heuristics (in order): line grouping by baseline, cell splitting on wide
 * gaps, body-size detection by character-weighted mode, headings by relative
 * size, tables by column alignment across consecutive multi-cell lines,
 * lists by bullet/number prefixes, paragraphs by vertical rhythm.
 */
export interface TextRun {
  readonly str: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly fontSize: number;
}

export interface PageText {
  readonly number: number;
  readonly width: number;
  readonly height: number;
  readonly runs: readonly TextRun[];
}

export type Block =
  | { type: 'heading'; level: 1 | 2 | 3; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'list'; ordered: boolean; items: string[] }
  | { type: 'table'; rows: string[][] };

export interface PageBlocks {
  readonly number: number;
  readonly blocks: Block[];
}

interface Cell {
  x: number;
  text: string;
}
interface Line {
  y: number;
  size: number;
  cells: Cell[];
}

const BULLET = /^([•◦▪‣\-–—*])\s+/;
const ORDERED = /^(\d{1,3})[.)]\s+/;

function groupLines(runs: readonly TextRun[]): Line[] {
  const items = runs.filter((r) => r.str.trim() !== '').slice().sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: { y: number; size: number; runs: TextRun[] }[] = [];
  for (const r of items) {
    const line = lines.find((l) => Math.abs(l.y - r.y) <= Math.max(l.size, r.fontSize) * 0.45);
    if (line) {
      line.runs.push(r);
      line.size = Math.max(line.size, r.fontSize);
    } else lines.push({ y: r.y, size: r.fontSize, runs: [r] });
  }
  lines.sort((a, b) => b.y - a.y);
  return lines.map((l) => {
    const sorted = l.runs.sort((a, b) => a.x - b.x);
    const cells: Cell[] = [];
    let prevEnd = -Infinity;
    for (const r of sorted) {
      const gap = r.x - prevEnd;
      const current = cells.at(-1);
      if (!current || gap > r.fontSize * 1.5) cells.push({ x: r.x, text: r.str.trim() });
      else current.text += (gap > r.fontSize * 0.15 && !current.text.endsWith(' ') ? ' ' : '') + r.str.trim();
      prevEnd = r.x + r.width;
    }
    return { y: l.y, size: l.size, cells };
  });
}

/** Character-weighted mode of font sizes, rounded to 0.5pt. */
export function bodySize(pages: readonly PageText[]): number {
  const weight = new Map<number, number>();
  for (const p of pages)
    for (const r of p.runs) {
      const k = Math.round(r.fontSize * 2) / 2;
      weight.set(k, (weight.get(k) ?? 0) + r.str.length);
    }
  let best = 10;
  let max = -1;
  for (const [k, w] of weight) if (w > max || (w === max && k < best)) [best, max] = [k, w];
  return best;
}

function headingLevels(pages: readonly PageText[], body: number): Map<number, 1 | 2 | 3> {
  const sizes = new Set<number>();
  for (const p of pages) for (const r of p.runs) if (r.fontSize >= body * 1.15) sizes.add(Math.round(r.fontSize * 2) / 2);
  const ranked = [...sizes].sort((a, b) => b - a);
  return new Map(ranked.map((s, i) => [s, Math.min(3, i + 1) as 1 | 2 | 3]));
}

function alignedColumns(a: Line, b: Line, tol: number): boolean {
  return a.cells.length === b.cells.length && a.cells.every((c, i) => Math.abs(c.x - b.cells[i]!.x) <= tol);
}

function joinParagraph(lines: string[]): string {
  return lines.reduce((acc, line) => {
    if (!acc) return line;
    // Re-join words hyphenated at line end: "exam-" + "ple" -> "example".
    if (/[a-zà-ÿ]-$/i.test(acc) && /^[a-zà-ÿ]/.test(line)) return acc.slice(0, -1) + line;
    return `${acc} ${line}`;
  }, '');
}

export function analyzePages(pages: readonly PageText[], opts: { detectTables?: boolean } = {}): PageBlocks[] {
  const detectTables = opts.detectTables ?? true;
  const body = bodySize(pages);
  const levels = headingLevels(pages, body);

  return pages.map((page) => {
    const lines = groupLines(page.runs);
    const blocks: Block[] = [];
    let para: string[] = [];
    let lastY: number | null = null;
    let bulletX = Infinity;

    const flush = () => {
      if (para.length) blocks.push({ type: 'paragraph', text: joinParagraph(para) });
      para = [];
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const text = line.cells.map((c) => c.text).join(' ');
      const gap = lastY === null ? 0 : lastY - line.y;
      lastY = line.y;

      // Tables: >= 2 consecutive lines with >= 2 aligned cells.
      if (detectTables && line.cells.length >= 2) {
        let j = i;
        while (j + 1 < lines.length && alignedColumns(lines[j]!, lines[j + 1]!, body * 2)) j++;
        if (j > i) {
          flush();
          blocks.push({ type: 'table', rows: lines.slice(i, j + 1).map((l) => l.cells.map((c) => c.text)) });
          lastY = lines[j]!.y;
          i = j;
          continue;
        }
      }

      const level = levels.get(Math.round(line.size * 2) / 2);
      if (level && line.cells.length === 1 && text.length <= 160) {
        flush();
        blocks.push({ type: 'heading', level, text });
        continue;
      }

      const bullet = BULLET.exec(text);
      const ordered = ORDERED.exec(text);
      if (bullet || ordered) {
        flush();
        const item = text.slice((bullet ?? ordered)![0].length);
        const prev = blocks.at(-1);
        if (prev?.type === 'list' && prev.ordered === Boolean(ordered)) prev.items.push(item);
        else blocks.push({ type: 'list', ordered: Boolean(ordered), items: [item] });
        bulletX = line.cells[0]!.x;
        continue;
      }

      // A list item continuation is a line indented past the bullet, right after it.
      const prev = blocks.at(-1);
      if (!para.length && prev?.type === 'list' && gap < line.size * 1.6 && line.cells[0]!.x > bulletX + body * 0.5) {
        prev.items[prev.items.length - 1] += ` ${text}`;
        continue;
      }

      if (para.length && gap > line.size * 1.7) flush();
      para.push(text);
    }
    flush();
    return { number: page.number, blocks };
  });
}

const escapeCell = (s: string) => s.replace(/\|/g, '\\|');

export function toMarkdown(pages: readonly PageBlocks[], opts: { pageMarkers?: boolean } = {}): string {
  const out: string[] = [];
  for (const page of pages) {
    if (opts.pageMarkers) out.push(`<!-- page ${page.number} -->`);
    for (const b of page.blocks) {
      switch (b.type) {
        case 'heading':
          out.push(`${'#'.repeat(b.level)} ${b.text}`);
          break;
        case 'paragraph':
          out.push(b.text);
          break;
        case 'list':
          out.push(b.items.map((it, i) => (b.ordered ? `${i + 1}. ${it}` : `- ${it}`)).join('\n'));
          break;
        case 'table': {
          const width = Math.max(...b.rows.map((r) => r.length));
          const norm = b.rows.map((r) => [...r, ...Array(width - r.length).fill('')].map(escapeCell));
          const [head, ...rest] = norm;
          out.push(
            [`| ${head!.join(' | ')} |`, `| ${head!.map(() => '---').join(' | ')} |`, ...rest.map((r) => `| ${r.join(' | ')} |`)].join('\n'),
          );
          break;
        }
      }
    }
  }
  return out.join('\n\n') + '\n';
}
