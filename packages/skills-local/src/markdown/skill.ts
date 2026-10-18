import { z } from 'zod';
import { defineSkill, MIME, stem } from '@folio/skills-core';
import { MB } from '../util/pdf.ts';
import { renderMarkdownDocument } from './render.ts';

/**
 * Markdown -> print-ready document, 100 % in the browser.
 * The output is a self-contained HTML document with CSS Paged Media; the host
 * exports it through the browser's native PDF engine (vector text, embedded
 * fonts, real page breaks) without any upload.
 */
export const markdownPrintSkill = defineSkill({
  id: 'md.pdf',
  version: '2.0.0',
  title: 'Markdown → PDF',
  summary: 'Typographie papier, sauts de page intelligents, tableaux, code et formules — sans quitter votre machine.',
  category: 'convert',
  execution: 'local',
  output: 'print-html',
  modes: ['quick', 'enterprise'],
  input: { mimes: [MIME.markdown], minFiles: 1, maxFiles: 1, maxBytesPerFile: 10 * MB },
  options: z.object({
    paper: z.enum(['A4', 'Letter']).default('A4'),
    theme: z.enum(['editorial', 'technical']).default('editorial'),
    toc: z.boolean().default(false),
    numberSections: z.boolean().default(false),
    pageNumbers: z.boolean().default(true),
  }),
  fields: [
    {
      kind: 'select',
      key: 'theme',
      label: 'Composition',
      options: [
        { value: 'editorial', label: 'Éditoriale — serif, justifiée' },
        { value: 'technical', label: 'Technique — sans-serif, numérotée' },
      ],
    },
    { kind: 'select', key: 'paper', label: 'Format', options: [{ value: 'A4', label: 'A4' }, { value: 'Letter', label: 'US Letter' }] },
    { kind: 'toggle', key: 'toc', label: 'Sommaire', advanced: true },
    { kind: 'toggle', key: 'numberSections', label: 'Numéroter les sections', advanced: true },
    { kind: 'toggle', key: 'pageNumbers', label: 'Folios (n° de page)', advanced: true },
  ],
  async run(files, o, ctx) {
    const file = files[0]!;
    const source = new TextDecoder().decode(file.bytes);
    const doc = renderMarkdownDocument(source, o);
    ctx.log('info', 'markdown rendered', doc.stats);
    return {
      files: [{ name: `${stem(file.name)}.print.html`, mime: MIME.html, bytes: new TextEncoder().encode(doc.html) }],
      report: { title: doc.meta.title ?? null, headings: doc.headings.length, ...doc.stats },
    };
  },
});
