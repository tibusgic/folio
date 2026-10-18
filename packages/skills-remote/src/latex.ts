import { z } from 'zod';
import { defineSkill, MIME, SkillError, stem } from '@folio/skills-core';
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

export interface LatexRenderOptions {
  documentClass: 'article' | 'report';
  paper: 'a4paper' | 'letterpaper';
  fontSize: '10pt' | '11pt' | '12pt';
  toc: boolean;
  numberSections: boolean;
  bibliographyStyle: 'plainnat' | 'IEEEtran' | 'apalike';
  titleOverride?: string;
  authorOverride?: string;
  dateOverride?: string;
}

export interface LatexBundle {
  tex: string;
  bib?: string;
  meta: {
    title: string;
    authors: string[];
    date: string;
    abstract?: string;
  };
  citations: string[];
  equations: number;
  tables: number;
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

/**
 * Convert inline Markdown (bold, italic, code, links, inline math $...$,
 * and Pandoc-style citations `[@key1; @key2, p. 42]` or `@key1`) into LaTeX.
 */
function renderInlineLatex(raw: string, citations: Set<string>, onEquation: () => void): string {
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
        onEquation();
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

  return tokens
    .map((tok) => {
      if (tok.kind === 'math') return `$${tok.value}$`;
      if (tok.kind === 'code') return `\\texttt{${escapeLatex(tok.value)}}`;

      // Process links, citations, bold, italics on text token
      let segment = tok.value;

      // Replace bracketed citations [@smith2024; @doe2023, p. 14]
      const stash: string[] = [];
      const put = (latex: string) => {
        const idx = stash.push(latex) - 1;
        return `\u0000STASH${idx}\u0000`;
      };

      segment = segment.replace(/\[(@[A-Za-z0-9_:-]+(?:[^[\]]*)?)\]/g, (_m, inner: string) => {
        const parts = inner.split(';').map((p) => p.trim());
        const keys: string[] = [];
        let locator = '';
        for (const p of parts) {
          const km = /^@([A-Za-z0-9_:-]+)(?:,\s*(.+))?$/.exec(p);
          if (km) {
            keys.push(km[1]!);
            citations.add(km[1]!);
            if (km[2]) locator = km[2];
          }
        }
        if (!keys.length) return _m;
        const opt = locator ? `[${escapeLatex(locator)}]` : '';
        return put(`\\cite${opt}{${keys.join(',')}}`);
      });

      // Standalone @citekey (not preceded by alphanumeric or email)
      segment = segment.replace(/(^|[\s(])@([A-Za-z0-9_:-]{2,})\b/g, (_m, pre: string, key: string) => {
        citations.add(key);
        return `${pre}${put(`\\cite{${key}}`)}`;
      });

      // Markdown links [label](https://...)
      segment = segment.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_m, label: string, url: string) => {
        return put(`\\href{${escapeLatex(url)}}{${escapeLatex(label)}}`);
      });

      // Bold **...**
      segment = segment.replace(/\*\*([^*]+)\*\*/g, (_m, inner: string) => put(`\\textbf{${escapeLatex(inner)}}`));
      // Italic *...*
      segment = segment.replace(/\*([^*]+)\*/g, (_m, inner: string) => put(`\\emph{${escapeLatex(inner)}}`));

      const escaped = escapeLatex(segment);
      return escaped.replace(/\u0000STASH(\d+)\u0000/g, (_m, idxStr: string) => stash[Number(idxStr)] ?? '');
    })
    .join('');
}

function parseMarkdownTableRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return trimmed.split('|').map((c) => c.trim());
}

function isTableSeparator(line: string): boolean {
  const trimmed = line.trim();
  return /^\|?[\s:]*-{3,}[\s:]*(\|[\s:]*-{3,}[\s:]*)+\|?$/.test(trimmed);
}

/**
 * Compile Markdown source (+ optional BibTeX content) into a self-contained,
 * publication-grade LaTeX document ready for Tectonic / XeLaTeX / pdflatex.
 */
export function markdownToLatex(
  markdownSource: string,
  opts: LatexRenderOptions,
  bibContent?: string,
): LatexBundle {
  const { meta, body } = parseFrontMatter(markdownSource);

  const title = opts.titleOverride?.trim() || asText(meta.title) || 'Document technique';
  const subtitle = asText(meta.subtitle);
  const authors = opts.authorOverride?.trim()
    ? opts.authorOverride.split(',').map((a) => a.trim()).filter(Boolean)
    : asList(meta.author).length
      ? asList(meta.author)
      : ['Folio Document Engine'];
  const date = opts.dateOverride?.trim() || asText(meta.date) || '\\today';
  const abstractText = asText(meta.abstract);
  const institution = asText(meta.organization ?? meta.affiliation ?? meta.institution);

  const citations = new Set<string>();
  let equations = 0;
  let tables = 0;
  const incEq = () => {
    equations++;
  };

  const lines = body.replace(/\r\n/g, '\n').split('\n');
  const bodyBlocks: string[] = [];
  let i = 0;

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
      const level = headingMatch[1]!.length;
      const text = renderInlineLatex(headingMatch[2]!.trim(), citations, incEq);
      const star = opts.numberSections ? '' : '*';
      const cmd =
        level === 1
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
      i += 2; // skip header + separator
      const rows: string[][] = [];
      while (i < lines.length && lines[i]!.includes('|') && lines[i]!.trim() !== '') {
        rows.push(parseMarkdownTableRow(lines[i]!));
        i++;
      }
      const cols = Math.max(header.length, ...rows.map((r) => r.length));
      const colSpec = Array.from({ length: cols }, () => 'l').join(' ');
      const fmtRow = (cells: string[]) =>
        Array.from({ length: cols }, (_, c) => renderInlineLatex(cells[c] ?? '', citations, incEq)).join(' & ') + ' \\\\';

      tables++;
      bodyBlocks.push(
        [
          '\\begin{table}[htbp]',
          '\\centering',
          `\\begin{tabular}{@{}${colSpec}@{}}`,
          '\\toprule',
          fmtRow(header.map((h) => `**${h}**`)),
          '\\midrule',
          ...rows.map(fmtRow),
          '\\bottomrule',
          '\\end{tabular}',
          '\\end{table}',
        ].join('\n'),
      );
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
        `\\begin{quote}\n${renderInlineLatex(quoteLines.join(' '), citations, incEq)}\n\\end{quote}`,
      );
      continue;
    }

    // Unordered list - / *
    if (/^[-*+]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*+]\s+/.test(lines[i]!.trim())) {
        const itemText = lines[i]!.trim().replace(/^[-*+]\s+/, '');
        items.push(`  \\item ${renderInlineLatex(itemText, citations, incEq)}`);
        i++;
      }
      bodyBlocks.push(['\\begin{itemize}', ...items, '\\end{itemize}'].join('\n'));
      continue;
    }

    // Ordered list 1.
    if (/^\d+[.)]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+[.)]\s+/.test(lines[i]!.trim())) {
        const itemText = lines[i]!.trim().replace(/^\d+[.)]\s+/, '');
        items.push(`  \\item ${renderInlineLatex(itemText, citations, incEq)}`);
        i++;
      }
      bodyBlocks.push(['\\begin{enumerate}', ...items, '\\end{enumerate}'].join('\n'));
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
      !(lines[i]!.includes('|') && i + 1 < lines.length && isTableSeparator(lines[i + 1]!))
    ) {
      paraLines.push(lines[i]!.trim());
      i++;
    }
    if (paraLines.length) {
      bodyBlocks.push(renderInlineLatex(paraLines.join(' '), citations, incEq));
    }
  }

  // Bibliography synthesis if citations were used
  let bibSection = '';
  if (bibContent && bibContent.trim()) {
    bibSection = `\\bibliographystyle{${opts.bibliographyStyle}}\n\\bibliography{references}`;
  } else if (citations.size > 0) {
    // Inline thebibliography fallback when no .bib file was attached
    const entries = [...citations].map(
      (key) => `  \\bibitem{${escapeLatex(key)}} Référence \\texttt{${escapeLatex(key)}}.`,
    );
    bibSection = ['\\begin{thebibliography}{99}', ...entries, '\\end{thebibliography}'].join('\n');
  }

  const authorBlock = authors.map(escapeLatex).join(' \\and ');
  const fullTitle = subtitle
    ? `${escapeLatex(title)}\\\\[0.4em]\\large ${escapeLatex(subtitle)}`
    : escapeLatex(title);
  const instLine = institution ? `\\\\[0.3em]\\small\\textit{${escapeLatex(institution)}}` : '';

  const tex = [
    `\\documentclass[${opts.fontSize},${opts.paper}]{${opts.documentClass}}`,
    '\\usepackage[utf8]{inputenc}',
    '\\usepackage[T1]{fontenc}',
    '\\usepackage[margin=24mm]{geometry}',
    '\\usepackage{amsmath,amssymb,amsfonts}',
    '\\usepackage{booktabs}',
    '\\usepackage{hyperref}',
    '\\hypersetup{colorlinks=true,linkcolor=black,citecolor=black,urlcolor=blue}',
    ...(bibContent?.trim() ? ['\\usepackage[numbers,sort&compress]{natbib}'] : []),
    `\\title{${fullTitle}}`,
    `\\author{${authorBlock}${instLine}}`,
    `\\date{${date === '\\today' ? '\\today' : escapeLatex(date)}}`,
    '\\begin{document}',
    '\\maketitle',
    ...(abstractText
      ? ['\\begin{abstract}', renderInlineLatex(abstractText, citations, incEq), '\\end{abstract}']
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
    },
    citations: [...citations],
    equations,
    tables,
  };
}

export const markdownLatexSkill = defineSkill({
  id: 'md.latex-pdf',
  version: '2.0.0',
  title: 'Markdown → LaTeX → PDF',
  summary: 'Compilation académique complète : formules AMS, tables booktabs, citations BibTeX et export du source .tex.',
  category: 'convert',
  execution: 'remote-ephemeral',
  output: 'pdf',
  modes: ['quick', 'enterprise'],
  input: {
    mimes: [MIME.markdown, MIME.bibtex],
    minFiles: 1,
    maxFiles: 2,
    maxBytesPerFile: 15 * MB,
  },
  options: z.object({
    outputTarget: z.enum(['pdf', 'tex']).default('pdf'),
    documentClass: z.enum(['article', 'report']).default('article'),
    paper: z.enum(['a4paper', 'letterpaper']).default('a4paper'),
    fontSize: z.enum(['10pt', '11pt', '12pt']).default('11pt'),
    toc: z.boolean().default(false),
    numberSections: z.boolean().default(true),
    bibliographyStyle: z.enum(['plainnat', 'IEEEtran', 'apalike']).default('plainnat'),
    titleOverride: z.string().trim().max(200).default(''),
    authorOverride: z.string().trim().max(200).default(''),
    dateOverride: z.string().trim().max(80).default(''),
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
    { kind: 'toggle', key: 'numberSections', label: 'Numéroter les sections' },
    { kind: 'toggle', key: 'toc', label: 'Table des matières', advanced: true },
    { kind: 'text', key: 'titleOverride', label: 'Titre (surcharge)', placeholder: 'Auto via front-matter YAML', advanced: true },
    { kind: 'text', key: 'authorOverride', label: 'Auteur(s) (surcharge)', placeholder: 'Prénom Nom, Second Auteur', advanced: true },
    { kind: 'text', key: 'dateOverride', label: 'Date (surcharge)', placeholder: '2026-10-18', advanced: true },
  ],
  async run(files, o, ctx) {
    const mdFile = files.find((f) => f.mime === MIME.markdown);
    if (!mdFile) {
      throw new SkillError('INPUT_TYPE', 'Déposez au moins un fichier Markdown (.md).');
    }
    const bibFile = files.find((f) => f.mime === MIME.bibtex);
    const mdSource = new TextDecoder().decode(mdFile.bytes);
    const bibSource = bibFile ? new TextDecoder().decode(bibFile.bytes) : undefined;

    const bundle = markdownToLatex(mdSource, o, bibSource);
    const base = stem(mdFile.name);

    // If user requested the .tex source directly, return it immediately without network call.
    if (o.outputTarget === 'tex') {
      ctx.log('info', 'generated .tex source locally', {
        equations: bundle.equations,
        tables: bundle.tables,
        citations: bundle.citations.length,
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
          citations: bundle.citations,
        },
      };
    }

    // Otherwise send the pre-validated bundle + raw files to the ephemeral compiler endpoint
    const remoteResult = await callRemoteSkill({
      endpoint: '/latex-pdf',
      files,
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
        citations: bundle.citations,
        ...(remoteResult.report ?? {}),
      },
    };
  },
});
