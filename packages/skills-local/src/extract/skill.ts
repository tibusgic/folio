import { z } from 'zod';
import { defineSkill, MIME, parsePageSelection, stem } from '@folio/skills-core';
import { MB } from '../util/pdf.ts';
import { readPageTexts } from './pdfjs.ts';
import { analyzePages, toMarkdown } from './structure.ts';

export const extractSkill = defineSkill({
  id: 'pdf.extract',
  version: '2.0.0',
  title: 'Extraction structurée',
  summary: 'Convertir un PDF texte en Markdown ou JSON : titres, paragraphes, listes et tableaux.',
  category: 'extract',
  execution: 'local',
  output: 'data',
  modes: ['quick', 'enterprise'],
  input: { mimes: [MIME.pdf], minFiles: 1, maxFiles: 1, maxBytesPerFile: 300 * MB },
  options: z.object({
    format: z.enum(['markdown', 'json']).default('markdown'),
    pages: z.string().trim().max(500).default(''),
    detectTables: z.boolean().default(true),
    pageMarkers: z.boolean().default(false),
  }),
  fields: [
    {
      kind: 'select',
      key: 'format',
      label: 'Format',
      options: [
        { value: 'markdown', label: 'Markdown (.md)' },
        { value: 'json', label: 'JSON structuré' },
      ],
    },
    { kind: 'pages', key: 'pages', label: 'Pages', placeholder: 'toutes', advanced: true },
    { kind: 'toggle', key: 'detectTables', label: 'Détecter les tableaux', advanced: true },
    { kind: 'toggle', key: 'pageMarkers', label: 'Repères de page', help: 'Insère <!-- page N --> dans le Markdown.', advanced: true, showIf: { key: 'format', equals: 'markdown' } },
  ],
  async run(files, o, ctx) {
    const file = files[0]!;
    const probe = o.pages ? await readPageTexts(file.bytes, [], ctx.signal) : null;
    const indices = probe ? parsePageSelection(o.pages, probe.pageCount) : null;
    const { pageCount, pages } = await readPageTexts(file.bytes, indices, ctx.signal);
    ctx.progress(0.6, 'analyse de mise en page');

    const blocks = analyzePages(pages, { detectTables: o.detectTables });
    const counts = blocks.flatMap((p) => p.blocks).reduce<Record<string, number>>((acc, b) => ((acc[b.type] = (acc[b.type] ?? 0) + 1), acc), {});
    const runs = pages.reduce((n, p) => n + p.runs.length, 0);
    if (runs === 0) ctx.log('warn', 'no text layer found: the PDF is probably a scan (OCR required)');

    const base = stem(file.name);
    const out =
      o.format === 'json'
        ? { name: `${base}.json`, mime: MIME.json, bytes: new TextEncoder().encode(JSON.stringify({ source: file.name, pageCount, pages: blocks }, null, 2)) }
        : { name: `${base}.md`, mime: MIME.markdown, bytes: new TextEncoder().encode(toMarkdown(blocks, { pageMarkers: o.pageMarkers })) };

    return { files: [out], report: { pageCount, extractedPages: pages.length, blocks: counts, scanned: runs === 0 } };
  },
});
