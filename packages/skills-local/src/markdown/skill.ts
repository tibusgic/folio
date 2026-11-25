import { z } from 'zod';
import { defineSkill, MIME, resolveMarkdownImages, stem } from '@folio/skills-core';
import { MB } from '../util/pdf.ts';
import { renderMarkdownDocument } from './render.ts';

/**
 * Markdown -> print-ready document, 100 % in the browser.
 * The output is a self-contained HTML document with CSS Paged Media; the host
 * exports it through the browser's native PDF engine (vector text, embedded
 * fonts, preloaded Data URI images, real page breaks) without any upload.
 */
export const markdownPrintSkill = defineSkill({
  id: 'md.pdf',
  version: '2.1.0',
  title: 'Markdown → PDF',
  summary: 'Typographie papier, figures illustrées (PNG, JPG, WebP, SVG, ZIP, Base64, HTTPS), tableaux, code et formules — 100 % local.',
  category: 'convert',
  execution: 'local',
  output: 'print-html',
  modes: ['quick', 'enterprise'],
  input: {
    mimes: [MIME.markdown, MIME.png, MIME.jpeg, MIME.webp, MIME.svg, MIME.zip],
    minFiles: 1,
    maxFiles: 50,
    maxBytesPerFile: 25 * MB,
  },
  options: z.object({
    paper: z.enum(['A4', 'Letter']).default('A4'),
    theme: z.enum(['editorial', 'technical']).default('editorial'),
    toc: z.boolean().default(false),
    numberSections: z.boolean().default(false),
    pageNumbers: z.boolean().default(true),
    imageMappings: z.record(z.string(), z.string()).default({}),
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
    ctx.progress(0.15, 'résolution et préchargement des images');
    const resolution = await resolveMarkdownImages(files, {
      imageMappings: o.imageMappings,
      signal: ctx.signal,
    });

    for (const warn of resolution.warnings) {
      ctx.log('warn', warn);
    }

    ctx.progress(0.65, 'composition typographique et pagination CSS');
    const source = new TextDecoder().decode(resolution.mdFile.bytes);
    const doc = renderMarkdownDocument(source, {
      ...o,
      resolvedImages: resolution.resolutions,
    });
    ctx.log('info', 'markdown rendered', { ...doc.stats, imageStats: resolution.stats });
    ctx.progress(1, 'terminé');

    return {
      files: [
        {
          name: `${stem(resolution.mdFile.name)}.print.html`,
          mime: MIME.html,
          bytes: new TextEncoder().encode(doc.html),
        },
      ],
      report: {
        title: doc.meta.title ?? null,
        headings: doc.headings.length,
        ...doc.stats,
        resolvedImages: resolution.stats.resolvedImages,
        missingImages: resolution.stats.missingImages,
        imageSources: resolution.stats.bySource,
        ...(resolution.warnings.length ? { imageWarnings: resolution.warnings } : {}),
      },
    };
  },
});
