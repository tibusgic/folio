import { degrees, rgb, StandardFonts } from 'pdf-lib';
import { z } from 'zod';
import { defineSkill, MIME, SkillError, stem } from '@folio/skills-core';
import { encodableText, hexToRgb01, loadPdf, MB, mm, pdfOutput, throwIfAborted, visualFrame } from '../util/pdf.ts';

const options = z.object({
  format: z.enum(['page-x-of-y', 'x-slash-y', 'bates', 'page-x']).default('page-x-of-y'),
  batesPrefix: z.string().trim().max(40).default('PIECE-'),
  batesDigits: z.number().int().min(3).max(8).default(4),
  position: z
    .enum(['bottom-right', 'bottom-center', 'bottom-left', 'top-right', 'top-center', 'top-left'])
    .default('bottom-right'),
  headerText: z.string().trim().max(120).default(''),
  includeDate: z.boolean().default(false),
  startPage: z.number().int().min(1).max(10000).default(1),
  startNumber: z.number().int().min(1).max(999999).default(1),
  marginMm: z.number().min(6).max(40).default(12),
  fontSize: z.number().min(6).max(18).default(9),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#2A2C32'),
});

export const pageNumbersSkill = defineSkill({
  id: 'pdf.page-numbers',
  version: '2.0.0',
  title: 'Foliotage & En-têtes',
  summary: 'Numérotation professionnelle (Page X sur Y, Bates stamping juridique, titre et date) avec contrôle des marges et de la première page.',
  category: 'assemble',
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
      key: 'format',
      label: 'Style de numérotation',
      options: [
        { value: 'page-x-of-y', label: 'Page X sur Y' },
        { value: 'x-slash-y', label: 'X / Y' },
        { value: 'bates', label: 'Bates Stamping juridique (ex. PIECE-0001)' },
        { value: 'page-x', label: 'Page X uniquement' },
      ],
    },
    {
      kind: 'text',
      key: 'batesPrefix',
      label: 'Préfixe Bates',
      placeholder: 'PIECE-',
      maxLength: 40,
      showIf: { key: 'format', equals: 'bates' },
    },
    {
      kind: 'select',
      key: 'position',
      label: 'Emplacement du folio',
      options: [
        { value: 'bottom-right', label: 'Pied de page — Droite' },
        { value: 'bottom-center', label: 'Pied de page — Centré' },
        { value: 'bottom-left', label: 'Pied de page — Gauche' },
        { value: 'top-right', label: 'En-tête — Droite' },
        { value: 'top-center', label: 'En-tête — Centré' },
        { value: 'top-left', label: 'En-tête — Gauche' },
      ],
    },
    {
      kind: 'text',
      key: 'headerText',
      label: 'Titre ou mention de dossier',
      placeholder: 'Dossier Confidentiel — Annexe Technique',
      maxLength: 120,
    },
    {
      kind: 'toggle',
      key: 'includeDate',
      label: 'Inclure la date (AAAA-MM-JJ)',
    },
    {
      kind: 'range',
      key: 'marginMm',
      label: 'Marge depuis le bord',
      min: 6,
      max: 40,
      step: 1,
      unit: 'mm',
    },
    {
      kind: 'number',
      key: 'startPage',
      label: 'Commencer à la page n°',
      min: 1,
      max: 10000,
      help: 'Ex. : mettez 2 pour ne pas numéroter la page de garde.',
      advanced: true,
    },
    {
      kind: 'number',
      key: 'startNumber',
      label: 'Premier numéro affiché',
      min: 1,
      max: 999999,
      advanced: true,
    },
    {
      kind: 'range',
      key: 'fontSize',
      label: 'Corps de police',
      min: 6,
      max: 18,
      step: 0.5,
      unit: 'pt',
      advanced: true,
    },
    {
      kind: 'color',
      key: 'color',
      label: 'Couleur de l’encre',
      advanced: true,
    },
  ],
  async run(files, o, ctx) {
    const file = files[0]!;
    const doc = await loadPdf(file);
    const pages = doc.getPages();
    const totalPages = pages.length;

    if (o.startPage > totalPages) {
      throw new SkillError(
        'INVALID_OPTIONS',
        `La page de départ (${o.startPage}) dépasse le nombre total de pages du document (${totalPages}).`,
      );
    }

    const font = await doc.embedFont(
      o.format === 'bates' ? StandardFonts.CourierBold : StandardFonts.Helvetica,
    );
    const metaFont = await doc.embedFont(StandardFonts.Helvetica);

    const ink = hexToRgb01(o.color);
    const textColor = rgb(ink.r, ink.g, ink.b);
    const dateStr = o.includeDate ? ctx.now().toISOString().slice(0, 10) : '';
    const companionLabel = encodableText(
      [o.headerText.trim(), dateStr].filter(Boolean).join('  ·  '),
      metaFont,
    );

    const numberedTotal = totalPages - (o.startPage - 1);
    let stampedPages = 0;

    for (let idx = o.startPage - 1; idx < totalPages; idx++) {
      throwIfAborted(ctx.signal);
      const page = pages[idx]!;
      const frame = visualFrame(page);
      const currentNum = o.startNumber + (idx - (o.startPage - 1));
      const maxNum = o.startNumber + numberedTotal - 1;

      let folioRaw: string;
      switch (o.format) {
        case 'page-x-of-y':
          folioRaw = `Page ${currentNum} sur ${maxNum}`;
          break;
        case 'x-slash-y':
          folioRaw = `${currentNum} / ${maxNum}`;
          break;
        case 'bates':
          folioRaw = `${o.batesPrefix || 'PIECE-'}${String(currentNum).padStart(o.batesDigits, '0')}`;
          break;
        case 'page-x':
          folioRaw = `Page ${currentNum}`;
          break;
      }

      const folioText = encodableText(folioRaw, font);
      const folioW = font.widthOfTextAtSize(folioText, o.fontSize);
      const marginPt = mm(o.marginMm);

      const isTop = o.position.startsWith('top');
      const vy = isTop ? frame.height - marginPt - o.fontSize : marginPt;

      let vx: number;
      if (o.position.endsWith('right')) {
        vx = frame.width - marginPt - folioW;
      } else if (o.position.endsWith('center')) {
        vx = (frame.width - folioW) / 2;
      } else {
        vx = marginPt;
      }

      const p = frame.toUser(vx, vy);
      page.drawText(folioText, {
        x: p.x,
        y: p.y,
        size: o.fontSize,
        font,
        color: textColor,
        rotate: degrees(frame.rotation),
      });

      if (companionLabel) {
        const compSize = Math.max(6, o.fontSize - 0.5);
        const compW = metaFont.widthOfTextAtSize(companionLabel, compSize);
        let compVx: number;
        if (o.position.endsWith('left')) {
          compVx = frame.width - marginPt - compW;
        } else {
          compVx = marginPt;
        }
        // If folio is centered, put companion label in the opposite vertical band (header vs footer)
        const compVy = o.position.endsWith('center')
          ? isTop
            ? marginPt
            : frame.height - marginPt - compSize
          : vy;

        const cp = frame.toUser(compVx, compVy);
        page.drawText(companionLabel, {
          x: cp.x,
          y: cp.y,
          size: compSize,
          font: metaFont,
          color: rgb(0.38, 0.38, 0.41),
          rotate: degrees(frame.rotation),
        });
      }

      stampedPages++;
      ctx.progress(stampedPages / numberedTotal);
    }

    doc.setProducer('Folio');
    ctx.log('info', `numbered ${stampedPages} page(s)`, { format: o.format, position: o.position });

    return {
      files: [await pdfOutput(doc, `${stem(file.name)}-foliote`)],
      report: {
        numberedPages: stampedPages,
        totalPages,
        format: o.format,
        position: o.position,
      },
    };
  },
});
