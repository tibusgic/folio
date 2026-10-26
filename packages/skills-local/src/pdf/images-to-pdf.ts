import { PDFDocument, type PDFImage } from 'pdf-lib';
import { z } from 'zod';
import { defineSkill, MIME, SkillError, stem } from '@folio/skills-core';
import { MB, mm, pdfOutput, throwIfAborted } from '../util/pdf.ts';

const PAPER_SIZES = {
  A4: [595.28, 841.89] as const,
  Letter: [612, 792] as const,
};

const options = z.object({
  paper: z.enum(['A4', 'Letter', 'auto']).default('A4'),
  orientation: z.enum(['auto', 'portrait', 'landscape']).default('auto'),
  marginMm: z.number().min(0).max(50).default(12),
  fit: z.enum(['contain', 'cover']).default('contain'),
  outputName: z.string().trim().max(120).default(''),
});

export const imagesToPdfSkill = defineSkill({
  id: 'img.to-pdf',
  version: '2.0.0',
  title: 'Images & Scans → PDF',
  summary: 'Assembler des photos ou scans PNG/JPEG en un PDF paginé propre avec gestion des marges et centrage automatique.',
  category: 'convert',
  execution: 'local',
  output: 'pdf',
  modes: ['quick', 'enterprise'],
  input: {
    mimes: [MIME.png, MIME.jpeg],
    minFiles: 1,
    maxFiles: 50,
    maxBytesPerFile: 100 * MB,
  },
  options,
  fields: [
    {
      kind: 'select',
      key: 'paper',
      label: 'Format de page',
      options: [
        { value: 'A4', label: 'A4 (210 × 297 mm)' },
        { value: 'Letter', label: 'US Letter (216 × 279 mm)' },
        { value: 'auto', label: 'Dimensions d’origine de chaque image (Auto)' },
      ],
    },
    {
      kind: 'select',
      key: 'orientation',
      label: 'Orientation',
      showIf: { key: 'paper', equals: ['A4', 'Letter'] },
      options: [
        { value: 'auto', label: 'Automatique (selon le ratio de l’image)' },
        { value: 'portrait', label: 'Portrait' },
        { value: 'landscape', label: 'Paysage' },
      ],
    },
    {
      kind: 'range',
      key: 'marginMm',
      label: 'Marges',
      min: 0,
      max: 50,
      step: 2,
      unit: 'mm',
      showIf: { key: 'paper', equals: ['A4', 'Letter'] },
    },
    {
      kind: 'select',
      key: 'fit',
      label: 'Ajustement',
      advanced: true,
      showIf: { key: 'paper', equals: ['A4', 'Letter'] },
      options: [
        { value: 'contain', label: 'Ajuster et centrer (intégralité visible)' },
        { value: 'cover', label: 'Remplir la zone utile (plein cadre)' },
      ],
    },
    {
      kind: 'text',
      key: 'outputName',
      label: 'Nom du fichier',
      placeholder: 'scans-assembles.pdf',
      advanced: true,
      maxLength: 120,
    },
  ],
  async run(files, o, ctx) {
    const out = await PDFDocument.create();

    for (let i = 0; i < files.length; i++) {
      throwIfAborted(ctx.signal);
      const file = files[i]!;
      let embedded: PDFImage;
      try {
        embedded =
          file.mime === MIME.png
            ? await out.embedPng(file.bytes)
            : await out.embedJpg(file.bytes);
      } catch (err) {
        throw new SkillError('CORRUPT_INPUT', `« ${file.name} » est une image illisible ou corrompue.`, {
          internal: String(err).slice(0, 200),
        });
      }

      const imgW = Math.max(1, embedded.width);
      const imgH = Math.max(1, embedded.height);

      if (o.paper === 'auto') {
        const marginPt = mm(o.marginMm);
        const pageW = imgW + marginPt * 2;
        const pageH = imgH + marginPt * 2;
        const page = out.addPage([pageW, pageH]);
        page.drawImage(embedded, {
          x: marginPt,
          y: marginPt,
          width: imgW,
          height: imgH,
        });
      } else {
        const [baseW, baseH] = PAPER_SIZES[o.paper];
        const useLandscape =
          o.orientation === 'landscape' || (o.orientation === 'auto' && imgW > imgH);
        const pageW = useLandscape ? baseH : baseW;
        const pageH = useLandscape ? baseW : baseH;

        const marginPt = mm(o.marginMm);
        const availW = Math.max(36, pageW - marginPt * 2);
        const availH = Math.max(36, pageH - marginPt * 2);

        const scaleX = availW / imgW;
        const scaleY = availH / imgH;
        const scale = o.fit === 'cover' ? Math.max(scaleX, scaleY) : Math.min(scaleX, scaleY);

        const drawW = imgW * scale;
        const drawH = imgH * scale;
        const x = (pageW - drawW) / 2;
        const y = (pageH - drawH) / 2;

        const page = out.addPage([pageW, pageH]);
        page.drawImage(embedded, {
          x,
          y,
          width: drawW,
          height: drawH,
        });
      }

      ctx.progress((i + 1) / files.length, `intégration ${file.name}`);
    }

    out.setProducer('Folio');
    out.setCreator('Folio · img.to-pdf');
    ctx.log('info', `converted ${files.length} image(s) to PDF`, { paper: o.paper });

    const name =
      o.outputName || (files.length === 1 ? `${stem(files[0]!.name)}-scan` : 'scans-assembles');
    return {
      files: [await pdfOutput(out, name)],
      report: {
        pages: files.length,
        paper: o.paper,
        orientation: o.orientation,
        marginMm: o.marginMm,
      },
    };
  },
});
