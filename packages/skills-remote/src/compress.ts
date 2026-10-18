import { z } from 'zod';
import { defineSkill, MIME, stem } from '@folio/skills-core';
import { callRemoteSkill, MB } from './transport.ts';

/**
 * Intelligent PDF compression via Ghostscript pdfwrite:
 * preserves vector text/line art while downsampling raster streams to target DPI.
 */
export const compressSkill = defineSkill({
  id: 'pdf.compress',
  version: '2.0.0',
  title: 'Compression vectorielle',
  summary: 'Rééchantillonnage bicubique des images avec préservation intégrale des tracés et polices vectorielles.',
  category: 'convert',
  execution: 'remote-ephemeral',
  output: 'pdf',
  modes: ['quick', 'enterprise'],
  input: {
    mimes: [MIME.pdf],
    minFiles: 1,
    maxFiles: 1,
    maxBytesPerFile: 200 * MB,
  },
  options: z.object({
    profile: z.enum(['archive', 'editorial', 'compact', 'screen']).default('editorial'),
    imageDpi: z.number().int().min(72).max(600).default(150),
    grayscale: z.boolean().default(false),
    linearize: z.boolean().default(true),
  }),
  fields: [
    {
      kind: 'select',
      key: 'profile',
      label: 'Profil de compression',
      options: [
        { value: 'editorial', label: 'Éditorial — 150 DPI, texte vectoriel intact' },
        { value: 'archive', label: 'Archive / Impression — 300 DPI sans perte visible' },
        { value: 'compact', label: 'Compact — 110 DPI (courriel / dépôt légal)' },
        { value: 'screen', label: 'Écran — 72 DPI maximal' },
      ],
    },
    {
      kind: 'range',
      key: 'imageDpi',
      label: 'Résolution cible des images',
      min: 72,
      max: 600,
      step: 10,
      unit: 'DPI',
      advanced: true,
    },
    {
      kind: 'toggle',
      key: 'grayscale',
      label: 'Convertir en niveaux de gris (DeviceGray)',
      advanced: true,
    },
    {
      kind: 'toggle',
      key: 'linearize',
      label: 'Linéariser (Fast Web View)',
      advanced: true,
    },
  ],
  async run(files, o, ctx) {
    const file = files[0]!;
    return callRemoteSkill({
      endpoint: '/compress',
      files,
      options: o,
      ctx,
      fallbackFilename: `${stem(file.name)}-compresse.pdf`,
    });
  },
});
