import { PDFDocument } from 'pdf-lib';
import { z } from 'zod';
import { defineSkill, MIME, parsePageSelection, SkillError, stem } from '@folio/skills-core';
import { loadPdf, MB, mm, pdfOutput, throwIfAborted } from '../util/pdf.ts';

const PAPER_SIZES = {
  A4: [595.28, 841.89] as const,
  Letter: [612, 792] as const,
};

const options = z.object({
  mode: z.enum(['both', 'normalize-a4', 'crop-margins']).default('both'),
  targetPaper: z.enum(['A4', 'Letter']).default('A4'),
  cropTopMm: z.number().min(0).max(80).default(10),
  cropBottomMm: z.number().min(0).max(80).default(10),
  cropLeftMm: z.number().min(0).max(80).default(10),
  cropRightMm: z.number().min(0).max(80).default(10),
  pages: z.string().trim().max(500).default(''),
});

export const cropMarginsSkill = defineSkill({
  id: 'pdf.crop-margins',
  version: '2.0.0',
  title: 'Recadrage & Format A4',
  summary: 'Rogner les marges blanches excessives et normaliser des pages hétérogènes au format A4 ou US Letter standard.',
  category: 'convert',
  execution: 'local',
  output: 'pdf',
  modes: ['quick', 'enterprise'],
  input: {
    mimes: [MIME.pdf],
    minFiles: 1,
    maxFiles: 1,
    maxBytesPerFile: 500 * MB,
  },
  options,
  fields: [
    {
      kind: 'select',
      key: 'mode',
      label: 'Opération',
      options: [
        { value: 'both', label: 'Rogner les marges + Normaliser au format standard' },
        { value: 'normalize-a4', label: 'Normaliser uniquement au format A4 / Letter' },
        { value: 'crop-margins', label: 'Rogner uniquement les marges (CropBox)' },
      ],
    },
    {
      kind: 'select',
      key: 'targetPaper',
      label: 'Format cible',
      showIf: { key: 'mode', equals: ['both', 'normalize-a4'] },
      options: [
        { value: 'A4', label: 'A4 (210 × 297 mm)' },
        { value: 'Letter', label: 'US Letter (216 × 279 mm)' },
      ],
    },
    {
      kind: 'range',
      key: 'cropTopMm',
      label: 'Rognage haut',
      min: 0,
      max: 80,
      step: 1,
      unit: 'mm',
      showIf: { key: 'mode', equals: ['both', 'crop-margins'] },
    },
    {
      kind: 'range',
      key: 'cropBottomMm',
      label: 'Rognage bas',
      min: 0,
      max: 80,
      step: 1,
      unit: 'mm',
      showIf: { key: 'mode', equals: ['both', 'crop-margins'] },
    },
    {
      kind: 'range',
      key: 'cropLeftMm',
      label: 'Rognage gauche',
      min: 0,
      max: 80,
      step: 1,
      unit: 'mm',
      showIf: { key: 'mode', equals: ['both', 'crop-margins'] },
    },
    {
      kind: 'range',
      key: 'cropRightMm',
      label: 'Rognage droite',
      min: 0,
      max: 80,
      step: 1,
      unit: 'mm',
      showIf: { key: 'mode', equals: ['both', 'crop-margins'] },
    },
    {
      kind: 'pages',
      key: 'pages',
      label: 'Pages à traiter',
      placeholder: 'toutes',
      advanced: true,
    },
  ],
  async run(files, o, ctx) {
    const file = files[0]!;
    const src = await loadPdf(file);
    const srcPages = src.getPages();
    const selectedSet = new Set(parsePageSelection(o.pages, srcPages.length));

    const topPt = mm(o.cropTopMm);
    const bottomPt = mm(o.cropBottomMm);
    const leftPt = mm(o.cropLeftMm);
    const rightPt = mm(o.cropRightMm);

    if (o.mode === 'crop-margins') {
      srcPages.forEach((page, idx) => {
        throwIfAborted(ctx.signal);
        if (!selectedSet.has(idx)) return;
        const box = page.getMediaBox();
        const newW = box.width - leftPt - rightPt;
        const newH = box.height - topPt - bottomPt;
        if (newW < 36 || newH < 36) {
          throw new SkillError(
            'INVALID_OPTIONS',
            `Les marges de rognage dépassent les dimensions de la page ${idx + 1}.`,
          );
        }
        const nx = box.x + leftPt;
        const ny = box.y + bottomPt;
        page.setCropBox(nx, ny, newW, newH);
        page.setMediaBox(nx, ny, newW, newH);
        ctx.progress((idx + 1) / srcPages.length);
      });

      src.setProducer('Folio');
      ctx.log('info', `cropped ${selectedSet.size} page(s)`);
      return {
        files: [await pdfOutput(src, `${stem(file.name)}-recadre`)],
        report: {
          mode: o.mode,
          pages: selectedSet.size,
          cropMm: { top: o.cropTopMm, bottom: o.cropBottomMm, left: o.cropLeftMm, right: o.cropRightMm },
        },
      };
    }

    // mode === 'normalize-a4' or 'both'
    const out = await PDFDocument.create();
    const [baseW, baseH] = PAPER_SIZES[o.targetPaper];
    const applyCrop = o.mode === 'both';

    for (let idx = 0; idx < srcPages.length; idx++) {
      throwIfAborted(ctx.signal);
      const srcPage = srcPages[idx]!;
      const box = srcPage.getMediaBox();
      const shouldCropThisPage = applyCrop && selectedSet.has(idx);

      const left = box.x + (shouldCropThisPage ? leftPt : 0);
      const bottom = box.y + (shouldCropThisPage ? bottomPt : 0);
      const right = box.x + box.width - (shouldCropThisPage ? rightPt : 0);
      const top = box.y + box.height - (shouldCropThisPage ? topPt : 0);

      const boxW = right - left;
      const boxH = top - bottom;
      if (boxW < 36 || boxH < 36) {
        throw new SkillError(
          'INVALID_OPTIONS',
          `Les marges de rognage dépassent les dimensions de la page ${idx + 1}.`,
        );
      }

      const embedded = await out.embedPage(srcPage, { left, bottom, right, top });
      const isLandscape = boxW > boxH;
      const pageW = isLandscape ? baseH : baseW;
      const pageH = isLandscape ? baseW : baseH;

      const scale = Math.min(pageW / boxW, pageH / boxH);
      const drawW = boxW * scale;
      const drawH = boxH * scale;
      const x = (pageW - drawW) / 2;
      const y = (pageH - drawH) / 2;

      const outPage = out.addPage([pageW, pageH]);
      outPage.drawPage(embedded, { x, y, width: drawW, height: drawH });
      ctx.progress((idx + 1) / srcPages.length);
    }

    out.setProducer('Folio');
    out.setCreator('Folio · pdf.crop-margins');
    ctx.log('info', `normalized ${srcPages.length} page(s) to ${o.targetPaper}`, { mode: o.mode });

    return {
      files: [await pdfOutput(out, `${stem(file.name)}-${o.targetPaper.toLowerCase()}`)],
      report: {
        mode: o.mode,
        targetPaper: o.targetPaper,
        pages: srcPages.length,
      },
    };
  },
});
