import { z } from 'zod';
import {
  defineSkill,
  MIME,
  parseDataUriImage,
  resolveMarkdownImages,
  SkillError,
  stem,
  type DocumentFile,
} from '@folio/skills-core';
import { parseFrontMatter, asList, asText } from '@folio/skills-local';
import { callRemoteSkill, MB } from './transport.ts';

/**
 * Pure, deterministic Markdown -> LaTeX generator with full math ($...$, $$...$$),
 * citation support (@citekey, [@citekey, p. 12]), code blocks (verbatim/listings),
 * booktabs tables, front matter metadata (title, subtitle, author, date, abstract,
 * institution) and strict LaTeX macro sanitisation against command-injection
 * (\write18, \input, \include, \openout, \catcode).
 */

const FORBIDDEN_LATEX_MACROS = /\\(?:write18|immediate|openout|openin|read|input|include|catcode|csname|endcsname|makeatletter|def\\|edef\\|gdef\\|xdef\\)\b/i;

export type LatexLanguage = 'fr' | 'en';
export type SourceDisplayMode = 'clickable' | 'inline-url' | 'footnotes' | 'bibliography';

export interface LatexRenderOptions {
  documentClass: 'article' | 'report';
  paper: 'a4paper' | 'letterpaper';
  fontSize: '10pt' | '11pt' | '12pt';
  language?: LatexLanguage;
  sourceDisplay?: SourceDisplayMode;
  toc: boolean;
  numberSections: boolean;
  bibliographyStyle: 'plainnat' | 'IEEEtran' | 'apalike';
  titleOverride?: string;
  authorOverride?: string;
  dateOverride?: string;
  imageMappings?: Record<string, string>;
}

export interface LatexBundle {
  tex: string;
  bib?: string;
  meta: {
    title: string;
    authors: string[];
    date: string;
    abstract?: string;
    language: LatexLanguage;
    sourceDisplay: SourceDisplayMode;
  };
  citations: string[];
  sources: { num: number; label: string; url: string }[];
  equations: number;
  tables: number;
  figures: number;
  materializedImages: DocumentFile[];
}

/** Escape plain text characters that carry special meaning in LaTeX. */
export function escapeLatex(text: string): string {
  let out = '';
  for (const ch of text) {
    switch (ch) {
      case '\\':
        out += '\\textbackslash{}';
        break;
      case '{':
        out += '\\{';
        break;
      case '}':
        out += '\\}';
        break;
      case '$':
        out += '\\$';
        break;
      case '&':
        out += '\\&';
        break;
      case '#':
        out += '\\#';
        break;
      case '^':
        out += '\\textasciicircum{}';
        break;
      case '_':
        out += '\\_';
        break;
      case '~':
        out += '\\textasciitilde{}';
        break;
      case '%':
        out += '\\%';
        break;
      default:
        out += ch;
    }
  }
  return out;
}

/** Audit raw math/LaTeX fragments for shell-escape or file-inclusion primitives. */
export function assertSafeLatexFragment(fragment: string): void {
  const m = FORBIDDEN_LATEX_MACROS.exec(fragment);
  if (m) {
    throw new SkillError(
      'FORBIDDEN_CONTENT',
      `Macro LaTeX interdite par la politique de sécurité : « ${m[0]} ».`,
      { macro: m[0] },
    );
  }
}

interface InlineRenderContext {
  citations: Set<string>;
  onEquation: () => void;
  sourceDisplay: SourceDisplayMode;
  sources: { num: number; label: string; url: string }[];
  sourceUrlToNum: Map<string, number>;
  inTable?: boolean;
  tableFootnotes?: { num: number; url: string }[];
  isSourceSectionItem?: boolean;
}

function registerSource(ctx: InlineRenderContext, label: string, url: string): number {
  const existing = ctx.sourceUrlToNum.get(url);
  if (existing !== undefined) return existing;
  const num = ctx.sources.length + 1;
  ctx.sourceUrlToNum.set(url, num);
  ctx.sources.push({ num, label, url });
  return num;
}

/**
 * Convert inline Markdown (bold, italic, code, links, inline math $...$,
 * and Pandoc-style citations `[@key1; @key2, p. 42]` or `@key1`) into LaTeX.
 * Supports nested inline formatting such as `**bold with `code` or *italic***`.
 */
function renderInlineLatex(raw: string, ctx: InlineRenderContext): string {
  // Tokenise inline segments so math and code are not altered by text escaping.
  const tokens: { kind: 'text' | 'math' | 'code'; value: string }[] = [];
  let cursor = 0;

  while (cursor < raw.length) {
    const ch = raw[cursor];

    // Inline code `...`
    if (ch === '`') {
      const end = raw.indexOf('`', cursor + 1);
      if (end !== -1) {
        tokens.push({ kind: 'code', value: raw.slice(cursor + 1, end) });
        cursor = end + 1;
        continue;
      }
    }

    // Inline math $...$ (not $$)
    if (ch === '$' && raw[cursor + 1] !== '$') {
      let end = cursor + 1;
      while (end < raw.length) {
        end = raw.indexOf('$', end);
        if (end === -1) break;
        if (raw[end - 1] === '\\') {
          end++;
          continue;
        }
        break;
      }
      if (end !== -1 && end > cursor + 1) {
        const expr = raw.slice(cursor + 1, end).trim();
        assertSafeLatexFragment(expr);
        ctx.onEquation();
        tokens.push({ kind: 'math', value: expr });
        cursor = end + 1;
        continue;
      }
    }

    // Plain text up to next ` or $
    let next = cursor + 1;
    while (next < raw.length && raw[next] !== '`' && raw[next] !== '$') next++;
    tokens.push({ kind: 'text', value: raw.slice(cursor, next) });
    cursor = next;
  }

  const stash: string[] = [];
  const put = (latex: string) => {
    const idx = stash.push(latex) - 1;
    return `\u0000STASH${idx}\u0000`;
  };

  let combined = tokens
    .map((tok) => {
      if (tok.kind === 'math') return put(`$${tok.value}$`);
      if (tok.kind === 'code') return put(`\\texttt{${escapeLatex(tok.value)}}`);
      return tok.value;
    })
    .join('');

  // Replace bracketed citations [@smith2024; @doe2023, p. 14]
  combined = combined.replace(/\[(@[A-Za-z0-9_:-]+(?:[^[\]]*)?)\]/g, (_m, inner: string) => {
    const parts = inner.split(';').map((p) => p.trim());
    const keys: string[] = [];
    let locator = '';
    for (const p of parts) {
      const km = /^@([A-Za-z0-9_:-]+)(?:,\s*(.+))?$/.exec(p);
      if (km) {
        keys.push(km[1]!);
        ctx.citations.add(km[1]!);
        if (km[2]) locator = km[2];
      }
    }
    if (!keys.length) return _m;
    const opt = locator ? `[${escapeLatex(locator)}]` : '';
    return put(`\\cite${opt}{${keys.join(',')}}`);
  });

  // Standalone @citekey (not preceded by alphanumeric or email)
  combined = combined.replace(/(^|[\s(])@([A-Za-z0-9_:-]{2,})\b/g, (_m, pre: string, key: string) => {
    ctx.citations.add(key);
    return `${pre}${put(`\\cite{${key}}`)}`;
  });

  // Markdown links [label](https://...)
  combined = combined.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_m, label: string, url: string) => {
    const cleanLabel = label.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*([^*]+)\*/g, '$1').trim();
    const escUrl = escapeLatex(url);
    const escLabel = escapeLatex(cleanLabel);

    if (ctx.sourceDisplay === 'inline-url') {
      return put(`\\href{${escUrl}}{${escLabel}} ({\\small\\url{${url}}})`);
    }
    if (ctx.sourceDisplay === 'footnotes') {
      const num = registerSource(ctx, cleanLabel, url);
      if (ctx.isSourceSectionItem) {
        return put(`\\href{${escUrl}}{${escLabel}} — {\\small\\url{${url}}}`);
      }
      if (ctx.inTable && ctx.tableFootnotes) {
        if (!ctx.tableFootnotes.some((f) => f.num === num)) {
          ctx.tableFootnotes.push({ num, url });
        }
        return put(`\\href{${escUrl}}{${escLabel}}\\textsuperscript{[${num}]}`);
      }
      return put(`\\href{${escUrl}}{${escLabel}}\\footnote{\\url{${url}}}`);
    }
    if (ctx.sourceDisplay === 'bibliography') {
      const num = registerSource(ctx, cleanLabel, url);
      if (ctx.isSourceSectionItem) {
        return put(`[${num}] \\href{${escUrl}}{${escLabel}} — {\\small\\url{${url}}}`);
      }
      return put(`\\href{${escUrl}}{${escLabel}} [${num}]`);
    }
    // Default: 'clickable'
    return put(`\\href{${escUrl}}{${escLabel}}`);
  });

  // Bold **...** (supports stashed code/math/links and nested *italic* inside!)
  combined = combined.replace(/\*\*((?:(?!\*\*)[\s\S])+?)\*\*/g, (_m, inner: string) => {
    const withItalic = inner.replace(/\*([^*]+)\*/g, (_m2, it: string) => put(`\\emph{${escapeLatex(it)}}`));
    return put(`\\textbf{${escapeLatex(withItalic)}}`);
  });

  // Italic *...*
  combined = combined.replace(/\*([^*]+)\*/g, (_m, inner: string) => put(`\\emph{${escapeLatex(inner)}}`));

  const escaped = escapeLatex(combined);
  // Restore stashed fragments (may be nested up to 3 levels, e.g. code inside bold)
  let result = escaped;
  for (let pass = 0; pass < 3; pass++) {
    if (!result.includes('\u0000STASH')) break;
    result = result.replace(/\u0000STASH(\d+)\u0000/g, (_m, idxStr: string) => stash[Number(idxStr)] ?? '');
  }
  return result;
}

function parseMarkdownTableRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return trimmed.split('|').map((c) => c.trim());
}

function parseTableAlignments(line: string, cols: number): ('l' | 'c' | 'r')[] {
  const cells = parseMarkdownTableRow(line);
  return Array.from({ length: cols }, (_, idx) => {
    const raw = (cells[idx] ?? '').trim();
    const left = raw.startsWith(':');
    const right = raw.endsWith(':');
    if (left && right) return 'c';
    if (right) return 'r';
    return 'l';
  });
}

function stripOuterBold(cell: string): string {
  const t = cell.trim();
  if (t.startsWith('**') && t.endsWith('**') && t.length >= 4 && !t.slice(2, -2).includes('**')) {
    return t.slice(2, -2).trim();
  }
  return t;
}

const MONTHS_FR = [
  'janvier',
  'février',
  'mars',
  'avril',
  'mai',
  'juin',
  'juillet',
  'août',
  'septembre',
  'octobre',
  'novembre',
  'décembre',
];

const MONTHS_EN = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export function formatDefaultDate(language: LatexLanguage, now: Date = new Date()): string {
  const day = now.getDate();
  const monthIdx = now.getMonth();
  const year = now.getFullYear();
  if (language === 'en') {
    return `${MONTHS_EN[monthIdx] ?? 'January'} ${day}, ${year}`;
  }
  const dayStr = day === 1 ? '1er' : String(day);
  return `${dayStr} ${MONTHS_FR[monthIdx] ?? 'janvier'} ${year}`;
}

function visibleCellLength(cell: string, sourceDisplay: SourceDisplayMode = 'clickable'): number {
  const withLinks = cell.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_m, label: string, url: string) => {
    if (sourceDisplay === 'inline-url') {
      return `${label} (${url})`;
    }
    if (sourceDisplay === 'footnotes' || sourceDisplay === 'bibliography') {
      return `${label} [1]`;
    }
    return label;
  });
  return withLinks
    .replace(/\*\*((?:(?!\*\*)[\s\S])+?)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .trim().length;
}

function isTableSeparator(line: string): boolean {
  const trimmed = line.trim();
  return /^\|?[\s:]*-{3,}[\s:]*(\|[\s:]*-{3,}[\s:]*)+\|?$/.test(trimmed);
}

function parseMarkdownImageTarget(rawInner: string): { src: string; title?: string } {
  const trimmed = rawInner.trim();
  if (trimmed.startsWith('<')) {
    const closeIdx = trimmed.indexOf('>');
    if (closeIdx !== -1) {
      const src = trimmed.slice(1, closeIdx).trim();
      const rest = trimmed.slice(closeIdx + 1).trim();
      const titleMatch = /^["'](.*)["']$/.exec(rest);
      return { src, ...(titleMatch?.[1] ? { title: titleMatch[1] } : {}) };
    }
  }
  if (/^data:image\//i.test(trimmed)) {
    return { src: trimmed };
  }
  const titleMatch = /^(\S+)\s+["']([^"']*)["']$/.exec(trimmed);
  if (titleMatch) {
    return { src: titleMatch[1]!, title: titleMatch[2]! };
  }
  return { src: trimmed };
}

function sanitizeLatexGraphicsPath(rawPath: string): string {
  assertSafeLatexFragment(rawPath);
  return rawPath
    .trim()
    .replace(/\\/g, '/')
    .replace(/[\u0000-\u001f\u007f"{}$&#%^~]/g, '');
}

/**
 * Compile Markdown source (+ optional BibTeX content) into a self-contained,
 * publication-grade LaTeX document ready for Tectonic / XeLaTeX / pdflatex.
 */
export function markdownToLatex(
  markdownSource: string,
  opts: LatexRenderOptions,
  bibContent?: string,
  imagePathMap?: Record<string, string>,
): LatexBundle {
  const { meta, body } = parseFrontMatter(markdownSource);

  const language: LatexLanguage = opts.language ?? 'fr';
  const sourceDisplay: SourceDisplayMode = opts.sourceDisplay ?? 'clickable';
  const effectiveImageMap: Record<string, string> = {
    ...(opts.imageMappings ?? {}),
    ...(imagePathMap ?? {}),
  };

  const citations = new Set<string>();
  const sources: { num: number; label: string; url: string }[] = [];
  const sourceUrlToNum = new Map<string, number>();
  const materializedImages: DocumentFile[] = [];
  let equations = 0;
  let tables = 0;
  let figures = 0;
  const incEq = () => {
    equations++;
  };

  const buildFigureEnvironment = (altText: string, rawTarget: string): string => {
    const { src } = parseMarkdownImageTarget(rawTarget);
    figures++;

    let targetPath = effectiveImageMap[src];
    if (!targetPath) {
      const cleanRel = src.replace(/^(?:\.\/)+/, '');
      targetPath = effectiveImageMap[cleanRel];
    }

    if (!targetPath && /^data:image\//i.test(src)) {
      const parsed = parseDataUriImage(src, figures);
      if (parsed) {
        materializedImages.push(parsed.file);
        targetPath = parsed.file.name;
      } else {
        targetPath = `inline-image-${figures}.png`;
      }
    }

    const safeTarget = sanitizeLatexGraphicsPath(targetPath ?? src);
    const cleanAlt = altText.trim();
    const figLines = [
      '\\begin{figure}[H]',
      '  \\centering',
      `  \\includegraphics[width=0.85\\linewidth]{${safeTarget}}`,
      ...(cleanAlt ? [`  \\caption{${renderInlineLatex(cleanAlt, baseCtx)}}`] : []),
      '\\end{figure}',
    ];
    return figLines.join('\n');
  };

  const baseCtx: InlineRenderContext = {
    citations,
    onEquation: incEq,
    sourceDisplay,
    sources,
    sourceUrlToNum,
  };

  const lines = body.replace(/\r\n/g, '\n').split('\n');

  // If no YAML front-matter title and no titleOverride, promote a leading H1 (`# Title`) to the document title
  let extractedH1Title = '';
  let startIdx = 0;
  while (startIdx < lines.length && !lines[startIdx]!.trim()) startIdx++;
  if (!opts.titleOverride?.trim() && !asText(meta.title) && startIdx < lines.length) {
    const firstH1 = /^#\s+(.+)$/.exec(lines[startIdx]!.trim());
    if (firstH1) {
      extractedH1Title = firstH1[1]!.trim();
      startIdx++;
    }
  }

  // Detect if remaining headings start at ## (level 2) with no # (level 1)
  let minHeadingLevel = 4;
  for (let k = startIdx; k < lines.length; k++) {
    const hm = /^(#{1,4})\s+/.exec(lines[k]!.trim());
    if (hm) {
      minHeadingLevel = Math.min(minHeadingLevel, hm[1]!.length);
    }
  }
  const headingShift = minHeadingLevel === 2 ? 1 : 0;

  const defaultDocTitle = language === 'en' ? 'Technical Document' : 'Document technique';
  const title = opts.titleOverride?.trim() || asText(meta.title) || extractedH1Title || defaultDocTitle;
  const subtitle = asText(meta.subtitle);
  const authors = opts.authorOverride?.trim()
    ? opts.authorOverride.split(',').map((a) => a.trim()).filter(Boolean)
    : asList(meta.author).length
      ? asList(meta.author)
      : ['Folio Document Engine'];
  const rawDateOpt = opts.dateOverride?.trim() || asText(meta.date);
  const date = !rawDateOpt || rawDateOpt === '\\today' ? formatDefaultDate(language) : rawDateOpt;
  const abstractText = asText(meta.abstract);
  const institution = asText(meta.organization ?? meta.affiliation ?? meta.institution);

  const bodyBlocks: string[] = [];
  let i = startIdx;
  let inSourceSection = false;
  let hasExplicitSourceSection = false;

  while (i < lines.length) {
    const line = lines[i]!;
    const trimmed = line.trim();

    if (!trimmed) {
      i++;
      continue;
    }

    // Page break directive
    if (/^\\(?:newpage|pagebreak)$/.test(trimmed)) {
      bodyBlocks.push('\\newpage');
      i++;
      continue;
    }

    // Horizontal rule
    if (/^(?:---|\*\*\*|___)\s*$/.test(trimmed)) {
      bodyBlocks.push('\\bigskip\\noindent\\rule{\\textwidth}{0.4pt}\\bigskip');
      i++;
      continue;
    }

    // Fenced code block ```lang ... ```
    if (trimmed.startsWith('```')) {
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.trim().startsWith('```')) {
        codeLines.push(lines[i]!);
        i++;
      }
      if (i < lines.length) i++; // skip closing ```
      bodyBlocks.push(
        ['\\begin{verbatim}', ...codeLines, '\\end{verbatim}'].join('\n'),
      );
      continue;
    }

    // Display math block $$ ... $$
    if (trimmed.startsWith('$$')) {
      let expr = '';
      if (trimmed.endsWith('$$') && trimmed.length > 4) {
        expr = trimmed.slice(2, -2).trim();
        i++;
      } else {
        const mathLines: string[] = [trimmed.slice(2)];
        i++;
        while (i < lines.length) {
          const cur = lines[i]!;
          if (cur.trim().endsWith('$$')) {
            mathLines.push(cur.trim().slice(0, -2));
            i++;
            break;
          }
          mathLines.push(cur);
          i++;
        }
        expr = mathLines.join('\n').trim();
      }
      assertSafeLatexFragment(expr);
      equations++;
      bodyBlocks.push(`\\[\n${expr}\n\\]`);
      continue;
    }

    // Headings # .. ####
    const headingMatch = /^(#{1,4})\s+(.+)$/.exec(trimmed);
    if (headingMatch) {
      const rawLevel = headingMatch[1]!.length;
      const level = Math.max(1, rawLevel - headingShift);
      const rawHeadingText = headingMatch[2]!.trim();
      const plainHeading = rawHeadingText.replace(/[*_`]/g, '').trim().toLowerCase();
      if (/^(?:sources?|r[eé]f[eé]rences?|bibliographie|bibliography|references)$/.test(plainHeading)) {
        inSourceSection = true;
        hasExplicitSourceSection = true;
      } else if (level <= 2) {
        inSourceSection = false;
      }
      const text = renderInlineLatex(rawHeadingText, baseCtx);
      const star = opts.numberSections ? '' : '*';
      const isReport = opts.documentClass === 'report';
      const cmd = isReport
        ? level === 1
          ? `chapter${star}`
          : level === 2
            ? `section${star}`
            : level === 3
              ? `subsection${star}`
              : `subsubsection${star}`
        : level === 1
          ? `section${star}`
          : level === 2
            ? `subsection${star}`
            : level === 3
              ? `subsubsection${star}`
              : `paragraph`;
      bodyBlocks.push(`\\${cmd}{${text}}`);
      i++;
      continue;
    }

    // Markdown table
    if (line.includes('|') && i + 1 < lines.length && isTableSeparator(lines[i + 1]!)) {
      const header = parseMarkdownTableRow(line);
      const sepLine = lines[i + 1]!;
      i += 2; // skip header + separator
      const rows: string[][] = [];
      while (i < lines.length && lines[i]!.includes('|') && lines[i]!.trim() !== '') {
        rows.push(parseMarkdownTableRow(lines[i]!));
        i++;
      }
      const cols = Math.max(header.length, ...rows.map((r) => r.length));
      const aligns = parseTableAlignments(sepLine, cols);

      // Compute visible text length per column (taking into account sourceDisplay expansion)
      const colMaxLen = Array.from({ length: cols }, (_, c) => {
        const hLen = visibleCellLength(header[c] ?? '', sourceDisplay);
        const rLen = rows.reduce((m, r) => Math.max(m, visibleCellLength(r[c] ?? '', sourceDisplay)), 0);
        return Math.max(hLen, rLen);
      });
      const totalMaxLen = colMaxLen.reduce((a, b) => a + b, 0);
      const useTabularx = totalMaxLen > 68 || colMaxLen.some((len) => len > 32);

      let colSpec: string;
      if (useTabularx) {
        const alignToX = (a: 'l' | 'c' | 'r') =>
          a === 'c'
            ? '>{\\centering\\arraybackslash}X'
            : a === 'r'
              ? '>{\\raggedleft\\arraybackslash}X'
              : '>{\\raggedright\\arraybackslash}X';
        let hasX = false;
        const specs = colMaxLen.map((len, c) => {
          if (len > 28) {
            hasX = true;
            return alignToX(aligns[c] ?? 'l');
          }
          return aligns[c] ?? 'l';
        });
        if (!hasX) {
          let widestIdx = 0;
          for (let c = 1; c < cols; c++) {
            if ((colMaxLen[c] ?? 0) > (colMaxLen[widestIdx] ?? 0)) widestIdx = c;
          }
          specs[widestIdx] = alignToX(aligns[widestIdx] ?? 'l');
        }
        colSpec = specs.join(' ');
      } else {
        colSpec = aligns.join(' ');
      }

      const tableFootnotes: { num: number; url: string }[] = [];
      const tableCtx: InlineRenderContext = {
        ...baseCtx,
        inTable: true,
        tableFootnotes,
      };

      const fmtHeaderRow = (cells: string[]) =>
        Array.from({ length: cols }, (_, c) => {
          const cleaned = stripOuterBold(cells[c] ?? '');
          return cleaned ? `\\textbf{${renderInlineLatex(cleaned, tableCtx)}}` : '';
        }).join(' & ') + ' \\\\';

      const fmtRow = (cells: string[]) =>
        Array.from({ length: cols }, (_, c) => renderInlineLatex(cells[c] ?? '', tableCtx)).join(' & ') + ' \\\\';

      tables++;
      const envBegin = useTabularx
        ? `\\begin{tabularx}{\\textwidth}{@{}${colSpec}@{}}`
        : `\\begin{tabular}{@{}${colSpec}@{}}`;
      const envEnd = useTabularx ? '\\end{tabularx}' : '\\end{tabular}';

      const tableLines = [
        '\\par\\medskip\\noindent',
        '\\begin{minipage}{\\textwidth}',
        '\\centering',
        '\\small',
        '\\setlength{\\tabcolsep}{4pt}',
        '\\renewcommand{\\arraystretch}{1.2}',
        envBegin,
        '\\toprule',
        fmtHeaderRow(header),
        '\\midrule',
        ...rows.map(fmtRow),
        '\\bottomrule',
        envEnd,
        '\\end{minipage}',
        '\\par\\medskip',
      ];

      if (tableFootnotes.length > 0) {
        for (const fn of tableFootnotes) {
          tableLines.push(`\\footnotetext[${fn.num}]{\\url{${fn.url}}}`);
        }
      }

      bodyBlocks.push(tableLines.join('\n'));
      continue;
    }

    // Blockquote > ...
    if (trimmed.startsWith('>')) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i]!.trim().startsWith('>')) {
        quoteLines.push(lines[i]!.trim().replace(/^>\s?/, ''));
        i++;
      }
      bodyBlocks.push(
        `\\begin{quote}\n${renderInlineLatex(quoteLines.join(' '), baseCtx)}\n\\end{quote}`,
      );
      continue;
    }

    // Unordered list - / *
    if (/^[-*+]\s+/.test(trimmed)) {
      const items: string[] = [];
      const listCtx: InlineRenderContext = {
        ...baseCtx,
        isSourceSectionItem: inSourceSection,
      };
      while (i < lines.length && /^[-*+]\s+/.test(lines[i]!.trim())) {
        const itemText = lines[i]!.trim().replace(/^[-*+]\s+/, '');
        items.push(`  \\item ${renderInlineLatex(itemText, listCtx)}`);
        i++;
      }
      bodyBlocks.push(['\\begin{itemize}', ...items, '\\end{itemize}'].join('\n'));
      continue;
    }

    // Ordered list 1.
    if (/^\d+[.)]\s+/.test(trimmed)) {
      const items: string[] = [];
      const listCtx: InlineRenderContext = {
        ...baseCtx,
        isSourceSectionItem: inSourceSection,
      };
      while (i < lines.length && /^\d+[.)]\s+/.test(lines[i]!.trim())) {
        const itemText = lines[i]!.trim().replace(/^\d+[.)]\s+/, '');
        items.push(`  \\item ${renderInlineLatex(itemText, listCtx)}`);
        i++;
      }
      bodyBlocks.push(['\\begin{enumerate}', ...items, '\\end{enumerate}'].join('\n'));
      continue;
    }

    // Standalone Markdown image line `![Légende](image.png)`
    const standaloneImgMatch = /^!\[([^\]]*)\]\(([^)\n]+)\)\s*$/.exec(trimmed);
    if (standaloneImgMatch) {
      bodyBlocks.push(buildFigureEnvironment(standaloneImgMatch[1] ?? '', standaloneImgMatch[2] ?? ''));
      i++;
      continue;
    }

    // Standard paragraph
    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lines[i]!.trim() !== '' &&
      !lines[i]!.trim().startsWith('#') &&
      !lines[i]!.trim().startsWith('```') &&
      !lines[i]!.trim().startsWith('$$') &&
      !lines[i]!.trim().startsWith('>') &&
      !/^[-*+]\s+/.test(lines[i]!.trim()) &&
      !/^\d+[.)]\s+/.test(lines[i]!.trim()) &&
      !/^!\[([^\]]*)\]\(([^)\n]+)\)\s*$/.test(lines[i]!.trim()) &&
      !(lines[i]!.includes('|') && i + 1 < lines.length && isTableSeparator(lines[i + 1]!))
    ) {
      paraLines.push(lines[i]!.trim());
      i++;
    }
    if (paraLines.length) {
      const joinedPara = paraLines.join(' ');
      const inlineFigures: string[] = [];
      const textWithoutImages = joinedPara
        .replace(/!\[([^\]]*)\]\(([^)\n]+)\)/g, (_m, alt: string, target: string) => {
          inlineFigures.push(buildFigureEnvironment(alt, target));
          return '';
        })
        .trim();
      if (textWithoutImages) {
        bodyBlocks.push(renderInlineLatex(textWithoutImages, baseCtx));
      }
      for (const fig of inlineFigures) {
        bodyBlocks.push(fig);
      }
    }
  }

  // If bibliography mode is active and there is no explicit "## Source" section in the Markdown,
  // synthesize a numbered Sources/References section at the end for all collected URLs.
  if (sourceDisplay === 'bibliography' && sources.length > 0 && !hasExplicitSourceSection) {
    const star = opts.numberSections ? '' : '*';
    const topCmd = opts.documentClass === 'report' ? `chapter${star}` : `section${star}`;
    const secTitle = language === 'en' ? 'Sources & References' : 'Sources et références';
    const srcItems = sources.map((s) => {
      const escUrl = escapeLatex(s.url);
      const escLabel = escapeLatex(s.label);
      return `  \\item [${s.num}] \\href{${escUrl}}{${escLabel}} — {\\small\\url{${s.url}}}`;
    });
    bodyBlocks.push([`\\${topCmd}{${secTitle}}`, '\\begin{itemize}', ...srcItems, '\\end{itemize}'].join('\n'));
  }

  // Bibliography synthesis if BibTeX citations were used
  let bibSection = '';
  if (bibContent && bibContent.trim()) {
    bibSection = `\\bibliographystyle{${opts.bibliographyStyle}}\n\\bibliography{references}`;
  } else if (citations.size > 0) {
    const refWord = language === 'en' ? 'Reference' : 'Référence';
    const entries = [...citations].map(
      (key) => `  \\bibitem{${escapeLatex(key)}} ${refWord} \\texttt{${escapeLatex(key)}}.`,
    );
    bibSection = ['\\begin{thebibliography}{99}', ...entries, '\\end{thebibliography}'].join('\n');
  }

  const renderTitleInline = (str: string) => renderInlineLatex(str, baseCtx);
  const authorBlock = authors.map(escapeLatex).join(' \\and ');
  const fullTitle = subtitle
    ? `${renderTitleInline(title)}\\\\[0.4em]\\large ${renderTitleInline(subtitle)}`
    : renderTitleInline(title);
  const instLine = institution ? `\\\\[0.3em]\\small\\textit{${escapeLatex(institution)}}` : '';

  const tocLabel = language === 'en' ? 'Contents' : 'Sommaire';
  const abstractLabel = language === 'en' ? 'Abstract' : 'Résumé';
  const refLabel = language === 'en' ? 'References' : 'Références bibliographiques';
  const chapLabel = language === 'en' ? 'Chapter' : 'Chapitre';
  const isReportClass = opts.documentClass === 'report';

  const tex = [
    `\\documentclass[${opts.fontSize},${opts.paper}]{${opts.documentClass}}`,
    '\\usepackage[utf8]{inputenc}',
    '\\usepackage[T1]{fontenc}',
    '\\usepackage[margin=24mm]{geometry}',
    '\\usepackage{amsmath,amssymb,amsfonts}',
    '\\usepackage{graphicx}',
    '\\usepackage{float}',
    '\\usepackage{caption}',
    '\\usepackage{booktabs}',
    '\\usepackage{tabularx}',
    '\\usepackage{array}',
    '\\usepackage{url}',
    '\\usepackage{hyperref}',
    '\\hypersetup{colorlinks=true,linkcolor=black,citecolor=black,urlcolor=blue}',
    `\\renewcommand{\\contentsname}{${tocLabel}}`,
    `\\renewcommand{\\abstractname}{${abstractLabel}}`,
    ...(isReportClass
      ? [`\\renewcommand{\\bibname}{${refLabel}}`, `\\renewcommand{\\chaptername}{${chapLabel}}`]
      : [`\\renewcommand{\\refname}{${refLabel}}`]),
    ...(bibContent?.trim() ? ['\\usepackage[numbers,sort&compress]{natbib}'] : []),
    `\\title{${fullTitle}}`,
    `\\author{${authorBlock}${instLine}}`,
    `\\date{${escapeLatex(date)}}`,
    '\\begin{document}',
    '\\maketitle',
    ...(abstractText
      ? ['\\begin{abstract}', renderInlineLatex(abstractText, baseCtx), '\\end{abstract}']
      : []),
    ...(opts.toc ? ['\\tableofcontents', '\\newpage'] : []),
    '',
    bodyBlocks.join('\n\n'),
    ...(bibSection ? ['', bibSection] : []),
    '\\end{document}',
    '',
  ].join('\n');

  return {
    tex,
    ...(bibContent?.trim() ? { bib: bibContent } : {}),
    meta: {
      title,
      authors,
      date,
      ...(abstractText ? { abstract: abstractText } : {}),
      language,
      sourceDisplay,
    },
    citations: [...citations],
    sources,
    equations,
    tables,
    figures,
    materializedImages,
  };
}

export const markdownLatexSkill = defineSkill({
  id: 'md.latex-pdf',
  version: '2.1.0',
  title: 'Markdown → LaTeX → PDF',
  summary: 'Compilation académique complète : figures illustrées (PNG, JPG, WebP, SVG, ZIP, Base64, HTTPS), formules AMS, tables booktabs, citations BibTeX et export .tex.',
  category: 'convert',
  execution: 'remote-ephemeral',
  output: 'pdf',
  modes: ['quick', 'enterprise'],
  input: {
    mimes: [MIME.markdown, MIME.bibtex, MIME.png, MIME.jpeg, MIME.webp, MIME.svg, MIME.zip],
    minFiles: 1,
    maxFiles: 50,
    maxBytesPerFile: 25 * MB,
  },
  options: z.object({
    outputTarget: z.enum(['pdf', 'tex']).default('pdf'),
    language: z.enum(['fr', 'en']).default('fr'),
    sourceDisplay: z.enum(['clickable', 'footnotes', 'bibliography', 'inline-url']).default('clickable'),
    documentClass: z.enum(['article', 'report']).default('article'),
    paper: z.enum(['a4paper', 'letterpaper']).default('a4paper'),
    fontSize: z.enum(['10pt', '11pt', '12pt']).default('11pt'),
    toc: z.boolean().default(true),
    numberSections: z.boolean().default(true),
    bibliographyStyle: z.enum(['plainnat', 'IEEEtran', 'apalike']).default('plainnat'),
    titleOverride: z.string().trim().max(200).default(''),
    authorOverride: z.string().trim().max(200).default(''),
    dateOverride: z.string().trim().max(80).default(''),
    imageMappings: z.record(z.string(), z.string()).default({}),
  }),
  fields: [
    {
      kind: 'select',
      key: 'outputTarget',
      label: 'Cible de sortie',
      options: [
        { value: 'pdf', label: 'PDF compilé (Tectonic / LaTeX éphémère)' },
        { value: 'tex', label: 'Source LaTeX (.tex) — 100 % local' },
      ],
    },
    {
      kind: 'select',
      key: 'language',
      label: 'Langue du document',
      options: [
        { value: 'fr', label: 'Français (Sommaire / Sources)' },
        { value: 'en', label: 'English (Contents / References)' },
      ],
    },
    {
      kind: 'select',
      key: 'sourceDisplay',
      label: 'Affichage des sources / liens',
      options: [
        { value: 'clickable', label: 'Lien cliquable simple (sans URL visible)' },
        { value: 'footnotes', label: 'Notes de bas de page numérotées ([1], [2])' },
        { value: 'bibliography', label: 'Renvois numérotés [1] + Sources détaillées' },
        { value: 'inline-url', label: 'Texte + URL complète entre parenthèses' },
      ],
    },
    { kind: 'toggle', key: 'toc', label: 'Inclure le Sommaire / Contents' },
    { kind: 'toggle', key: 'numberSections', label: 'Numéroter les sections' },
    {
      kind: 'select',
      key: 'documentClass',
      label: 'Classe LaTeX',
      options: [
        { value: 'article', label: 'article (publication / note)' },
        { value: 'report', label: 'report (mémoire / rapport)' },
      ],
    },
    {
      kind: 'select',
      key: 'paper',
      label: 'Papier',
      options: [
        { value: 'a4paper', label: 'A4 (210 × 297 mm)' },
        { value: 'letterpaper', label: 'US Letter' },
      ],
    },
    {
      kind: 'select',
      key: 'fontSize',
      label: 'Corps de base',
      advanced: true,
      options: [
        { value: '10pt', label: '10 pt' },
        { value: '11pt', label: '11 pt' },
        { value: '12pt', label: '12 pt' },
      ],
    },
    { kind: 'text', key: 'titleOverride', label: 'Titre (surcharge)', placeholder: 'Auto via front-matter YAML ou # Titre', advanced: true },
    { kind: 'text', key: 'authorOverride', label: 'Auteur(s) (surcharge)', placeholder: 'Prénom Nom, Second Auteur', advanced: true },
    { kind: 'text', key: 'dateOverride', label: 'Date (surcharge)', placeholder: '2026-10-18', advanced: true },
  ],
  async run(files, o, ctx) {
    ctx.progress(0.1, 'résolution des images et ressources associées');
    const resolution = await resolveMarkdownImages(files, {
      imageMappings: o.imageMappings,
      signal: ctx.signal,
    });

    for (const warn of resolution.warnings) {
      ctx.log('warn', warn);
    }

    const mdFile = resolution.mdFile;
    const bibFile = resolution.bibFile;
    const mdSource = new TextDecoder().decode(mdFile.bytes);
    const bibSource = bibFile ? new TextDecoder().decode(bibFile.bytes) : undefined;

    const bundle = markdownToLatex(mdSource, o, bibSource, resolution.latexPathMap);
    const base = stem(mdFile.name);

    // If user requested the .tex source directly, return it immediately without network call.
    if (o.outputTarget === 'tex') {
      ctx.log('info', 'generated .tex source locally', {
        equations: bundle.equations,
        tables: bundle.tables,
        figures: bundle.figures,
        citations: bundle.citations.length,
        resolvedImages: resolution.stats.resolvedImages,
      });
      return {
        files: [
          {
            name: `${base}.tex`,
            mime: MIME.tex,
            bytes: new TextEncoder().encode(bundle.tex),
          },
        ],
        report: {
          mode: 'tex-source',
          title: bundle.meta.title,
          authors: bundle.meta.authors,
          equations: bundle.equations,
          tables: bundle.tables,
          figures: bundle.figures,
          citations: bundle.citations,
          resolvedImages: resolution.stats.resolvedImages,
          missingImages: resolution.stats.missingImages,
          imageSources: resolution.stats.bySource,
          ...(resolution.warnings.length ? { imageWarnings: resolution.warnings } : {}),
        },
      };
    }

    const payloadFiles: DocumentFile[] = [
      mdFile,
      ...(bibFile ? [bibFile] : []),
      ...resolution.latexAssetFiles,
      ...bundle.materializedImages,
    ];

    // Otherwise send the pre-validated bundle + resolved asset files to the ephemeral compiler endpoint
    const remoteResult = await callRemoteSkill({
      endpoint: '/latex-pdf',
      files: payloadFiles,
      options: {
        ...o,
        generatedTex: bundle.tex,
      },
      ctx,
      fallbackFilename: `${base}.pdf`,
      fallbackMime: MIME.pdf,
    });

    return {
      files: remoteResult.files,
      report: {
        title: bundle.meta.title,
        authors: bundle.meta.authors,
        equations: bundle.equations,
        tables: bundle.tables,
        figures: bundle.figures,
        citations: bundle.citations,
        resolvedImages: resolution.stats.resolvedImages,
        missingImages: resolution.stats.missingImages,
        imageSources: resolution.stats.bySource,
        ...(resolution.warnings.length ? { imageWarnings: resolution.warnings } : {}),
        ...(remoteResult.report ?? {}),
      },
    };
  },
});
