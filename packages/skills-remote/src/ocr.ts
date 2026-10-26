import { z } from 'zod';
import { defineSkill, MIME, stem } from '@folio/skills-core';
import { callRemoteSkill, MB } from './transport.ts';

/**
 * Optical Character Recognition (OCR) pipeline for scanned PDFs and PNG/JPEG images.
 * Can either produce a searchable PDF with an embedded selectable text layer or
 * extract the recognized text as structured Markdown (.md).
 */
export const ocrSkill = defineSkill({
  id: 'pdf.ocr',
  version: '2.0.0',
  title: 'OCR · Texte Scanné',
  summary: 'Transformer un PDF scanné ou une image (PNG/JPEG) en PDF consultable (couche texte sélectionnable) ou en extraire le texte.',
  category: 'extract',
  execution: 'remote-ephemeral',
  output: 'pdf',
  modes: ['quick', 'enterprise'],
  input: {
    mimes: [MIME.pdf, MIME.png, MIME.jpeg],
    minFiles: 1,
    maxFiles: 1,
    maxBytesPerFile: 100 * MB,
  },
  options: z.object({
    outputFormat: z.enum(['searchable-pdf', 'markdown']).default('searchable-pdf'),
    language: z.enum(['fra+eng', 'fra', 'eng']).default('fra+eng'),
    deskew: z.boolean().default(true),
    enhanceContrast: z.boolean().default(true),
  }),
  fields: [
    {
      kind: 'select',
      key: 'outputFormat',
      label: 'Format de sortie',
      options: [
        { value: 'searchable-pdf', label: 'PDF consultable (couche texte sélectionnable)' },
        { value: 'markdown', label: 'Texte extrait en Markdown (.md)' },
      ],
    },
    {
      kind: 'select',
      key: 'language',
      label: 'Langues de reconnaissance',
      options: [
        { value: 'fra+eng', label: 'Français + Anglais (bilingue)' },
        { value: 'fra', label: 'Français uniquement' },
        { value: 'eng', label: 'Anglais uniquement' },
      ],
    },
    {
      kind: 'toggle',
      key: 'deskew',
      label: 'Redresser l’inclinaison du scan',
    },
    {
      kind: 'toggle',
      key: 'enhanceContrast',
      label: 'Nettoyer le fond et renforcer le contraste',
      advanced: true,
    },
  ],
  async run(files, o, ctx) {
    const file = files[0]!;
    const isMd = o.outputFormat === 'markdown';
    return callRemoteSkill({
      endpoint: '/ocr',
      files,
      options: o,
      ctx,
      fallbackFilename: `${stem(file.name)}-ocr.${isMd ? 'md' : 'pdf'}`,
      fallbackMime: isMd ? MIME.markdown : MIME.pdf,
    });
  },
});
