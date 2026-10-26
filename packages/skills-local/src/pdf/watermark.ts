import { degrees, PDFArray, PDFName, rgb, StandardFonts, type PDFFont, type PDFImage, type PDFPage } from 'pdf-lib';
import { z } from 'zod';
import { defineSkill, MIME, parsePageSelection, sha256Hex, SkillError, stem } from '@folio/skills-core';
import { encodableText, hexToRgb01, loadPdf, MB, mm, pdfOutput, visualFrame, type VisualFrame } from '../util/pdf.ts';

const FONTS = {
  'Helvetica-Bold': StandardFonts.HelveticaBold,
  Helvetica: StandardFonts.Helvetica,
  'Times-Roman': StandardFonts.TimesRoman,
  'Courier-Bold': StandardFonts.CourierBold,
} as const;

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Couleur hexadécimale attendue (#RRGGBB)');

const options = z.object({
  text: z.string().trim().max(200).default('CONFIDENTIEL'),
  layout: z.enum(['center', 'tile', 'stamp']).default('center'),
  layer: z.enum(['under', 'over']).default('under'),
  font: z.enum(Object.keys(FONTS) as [keyof typeof FONTS, ...(keyof typeof FONTS)[]]).default('Helvetica-Bold'),
  fontSize: z.number().min(6).max(200).default(54),
  opacity: z.number().min(0.02).max(1).default(0.16),
  rotation: z.number().min(-90).max(90).default(35),
  color: hexColor.default('#B4532A'),
  logoScale: z.number().min(0.1).max(1.5).default(0.45),
  pages: z.string().trim().max(500).default(''),
  auditStamp: z.boolean().default(false),
});

type Options = z.output<typeof options>;

interface DrawCtx {
  page: PDFPage;
  frame: VisualFrame;
  font: PDFFont;
  text: string;
  logo: PDFImage | null;
  o: Options;
}

function rot(x: number, y: number, deg: number): { x: number; y: number } {
  const t = (deg * Math.PI) / 180;
  return { x: x * Math.cos(t) - y * Math.sin(t), y: x * Math.sin(t) + y * Math.cos(t) };
}

/** Draw text whose *visual* origin is (vx, vy) with a visual angle. */
function drawVisual({ page, frame, font, o }: DrawCtx, text: string, vx: number, vy: number, angle: number, size = o.fontSize) {
  if (!text) return;
  const { r, g, b } = hexToRgb01(o.color);
  const p = frame.toUser(vx, vy);
  page.drawText(text, {
    x: p.x,
    y: p.y,
    size,
    font,
    color: rgb(r, g, b),
    opacity: o.opacity,
    rotate: degrees(angle + frame.rotation),
  });
}

function drawLogoVisual({ page, frame, logo, o }: DrawCtx, vx: number, vy: number, w: number, h: number, angle: number) {
  if (!logo) return;
  const p = frame.toUser(vx, vy);
  page.drawImage(logo, {
    x: p.x,
    y: p.y,
    width: w,
    height: h,
    opacity: o.opacity,
    rotate: degrees(angle + frame.rotation),
  });
}

function drawCentered(c: DrawCtx) {
  if (c.logo) {
    const maxDim = Math.min(c.frame.width, c.frame.height) * c.o.logoScale;
    const scale = maxDim / Math.max(1, Math.max(c.logo.width, c.logo.height));
    const lw = c.logo.width * scale;
    const lh = c.logo.height * scale;
    const offLogo = rot(lw / 2, lh / 2, c.o.rotation);
    const shiftY = c.text ? lh * 0.35 : 0;
    drawLogoVisual(c, c.frame.width / 2 - offLogo.x, c.frame.height / 2 - offLogo.y + shiftY, lw, lh, c.o.rotation);
  }
  if (c.text) {
    const w = c.font.widthOfTextAtSize(c.text, c.o.fontSize);
    const h = c.font.heightAtSize(c.o.fontSize, { descender: false });
    const off = rot(w / 2, h / 2, c.o.rotation);
    const shiftY = c.logo ? -c.o.fontSize * 0.9 : 0;
    drawVisual(c, c.text, c.frame.width / 2 - off.x, c.frame.height / 2 - off.y + shiftY, c.o.rotation);
  }
}

function drawTiled(c: DrawCtx) {
  const label = c.text || 'FOLIO';
  const w = c.text ? c.font.widthOfTextAtSize(label, c.o.fontSize) : 120;
  const stepX = w + c.o.fontSize * 2;
  const stepY = c.o.fontSize * 3.2;
  const { width: vw, height: vh } = c.frame;
  const reach = Math.hypot(vw, vh);
  for (let gy = -reach; gy <= reach; gy += stepY) {
    // Stagger every other row for an even, typographic texture.
    const shift = Math.round(gy / stepY) % 2 ? stepX / 2 : 0;
    for (let gx = -reach; gx <= reach; gx += stepX) {
      const p = rot(gx + shift, gy, c.o.rotation);
      const x = vw / 2 + p.x;
      const y = vh / 2 + p.y;
      if (x < -w || x > vw + w || y < -w || y > vh + w) continue;
      if (c.logo) {
        const lw = Math.min(80, c.o.fontSize * 1.4);
        const lh = (c.logo.height / Math.max(1, c.logo.width)) * lw;
        drawLogoVisual(c, x, y + (c.text ? c.o.fontSize * 0.8 : 0), lw, lh, c.o.rotation);
      }
      if (c.text) {
        drawVisual(c, c.text, x, y, c.o.rotation);
      }
    }
  }
}

/** Confidentiality stamp: uppercase label (+ optional PNG logo) in a ruled box, top-right corner. */
function drawStamp(c: DrawCtx) {
  const size = Math.min(c.o.fontSize, 28);
  const label = (c.text || 'CONFIDENTIEL').toUpperCase();
  const tw = c.font.widthOfTextAtSize(label, size);
  const th = c.font.heightAtSize(size, { descender: false });
  const logoH = c.logo ? th * 1.2 : 0;
  const logoW = c.logo ? (c.logo.width / Math.max(1, c.logo.height)) * logoH : 0;
  const logoGap = c.logo ? 6 : 0;
  const padX = size * 0.6;
  const padY = size * 0.45;
  const bw = logoW + logoGap + tw + padX * 2;
  const bh = Math.max(th, logoH) + padY * 2;
  const vx = c.frame.width - mm(14) - bw;
  const vy = c.frame.height - mm(14) - bh;
  const { r, g, b } = hexToRgb01(c.o.color);
  const corner = c.frame.toUser(vx, vy);
  const opacity = Math.max(c.o.opacity, 0.6);
  c.page.drawRectangle({
    x: corner.x,
    y: corner.y,
    width: bw,
    height: bh,
    borderColor: rgb(r, g, b),
    borderWidth: 1.4,
    borderOpacity: opacity,
    rotate: degrees(c.frame.rotation),
  });
  if (c.logo) {
    drawLogoVisual({ ...c, o: { ...c.o, opacity } }, vx + padX, vy + (bh - logoH) / 2, logoW, logoH, 0);
  }
  drawVisual({ ...c, o: { ...c.o, opacity } }, label, vx + padX + logoW + logoGap, vy + padY, 0, size);
}

function drawAuditLine(c: DrawCtx, line: string) {
  const size = 6.5;
  const p = c.frame.toUser(mm(12), mm(7));
  c.page.drawText(line, {
    x: p.x,
    y: p.y,
    size,
    font: c.font,
    color: rgb(0.35, 0.35, 0.37),
    opacity: 0.9,
    rotate: degrees(c.frame.rotation),
  });
}

export const watermarkSkill = defineSkill({
  id: 'pdf.watermark',
  version: '2.1.0',
  title: 'Filigrane & tampon',
  summary: 'Filigrane vectoriel ou logo PNG transparent (en arrière-plan sous le texte ou en superposition), tampon et ligne d’audit.',
  category: 'secure',
  execution: 'local',
  output: 'pdf',
  modes: ['quick', 'enterprise'],
  input: { mimes: [MIME.pdf, MIME.png], minFiles: 1, maxFiles: 2, maxBytesPerFile: 500 * MB },
  options,
  fields: [
    { kind: 'text', key: 'text', label: 'Texte (ou laissez vide si logo PNG seul)', placeholder: 'CONFIDENTIEL', maxLength: 200 },
    {
      kind: 'select',
      key: 'layer',
      label: 'Position du calque',
      options: [
        { value: 'under', label: 'En arrière-plan (Sous le texte du PDF)' },
        { value: 'over', label: 'En superposition (Au-dessus du contenu)' },
      ],
    },
    {
      kind: 'select',
      key: 'layout',
      label: 'Disposition',
      options: [
        { value: 'center', label: 'Centré (Texte et/ou Logo PNG)' },
        { value: 'tile', label: 'Mosaïque répétée' },
        { value: 'stamp', label: 'Tampon encadré (coin supérieur)' },
      ],
    },
    { kind: 'color', key: 'color', label: 'Encre' },
    { kind: 'range', key: 'opacity', label: 'Opacité', min: 0.02, max: 1, step: 0.02 },
    { kind: 'range', key: 'logoScale', label: 'Échelle du logo PNG (si joint)', min: 0.1, max: 1.5, step: 0.05, advanced: true },
    { kind: 'range', key: 'fontSize', label: 'Corps', min: 6, max: 200, step: 1, unit: 'pt', advanced: true },
    { kind: 'range', key: 'rotation', label: 'Angle', min: -90, max: 90, step: 1, unit: '°', advanced: true, showIf: { key: 'layout', equals: ['center', 'tile'] } },
    {
      kind: 'select',
      key: 'font',
      label: 'Police',
      advanced: true,
      options: [
        { value: 'Helvetica-Bold', label: 'Helvetica Bold' },
        { value: 'Helvetica', label: 'Helvetica' },
        { value: 'Times-Roman', label: 'Times' },
        { value: 'Courier-Bold', label: 'Courier Bold' },
      ],
    },
    { kind: 'pages', key: 'pages', label: 'Pages', placeholder: 'toutes', advanced: true },
    { kind: 'toggle', key: 'auditStamp', label: 'Ligne d’audit', help: 'Horodatage UTC, empreinte SHA-256 du document source et pagination en pied de page.', advanced: true },
  ],
  async run(files, o, ctx) {
    const pdfFile = files.find((f) => f.mime === MIME.pdf);
    if (!pdfFile) {
      throw new SkillError('INPUT_TYPE', 'Déposez au moins un document PDF principal (et optionnellement un logo PNG transparent).');
    }
    const pngFile = files.find((f) => f.mime === MIME.png);
    if (!o.text.trim() && !pngFile) {
      throw new SkillError('INVALID_OPTIONS', 'Indiquez un texte de filigrane ou joignez un logo PNG transparent.');
    }

    const doc = await loadPdf(pdfFile);
    const font = await doc.embedFont(FONTS[o.font]);
    const mono = o.auditStamp ? await doc.embedFont(StandardFonts.Courier) : null;
    let logo: PDFImage | null = null;
    if (pngFile) {
      try {
        logo = await doc.embedPng(pngFile.bytes);
      } catch (err) {
        throw new SkillError('CORRUPT_INPUT', `Le logo PNG « ${pngFile.name} » est invalide ou corrompu.`, {
          internal: String(err).slice(0, 200),
        });
      }
    }

    const text = o.text.trim() ? encodableText(o.text.trim(), font) : '';
    const pages = doc.getPages();
    const targets = parsePageSelection(o.pages, pages.length);
    const sourceHash = o.auditStamp ? await sha256Hex(pdfFile.bytes) : '';
    const stampedAt = ctx.now().toISOString().replace(/\.\d+Z$/, 'Z');

    targets.forEach((idx, k) => {
      const page = pages[idx]!;
      page.node.normalize();
      const contentsArr = page.node.get(PDFName.of('Contents'));
      const beforeLen = contentsArr instanceof PDFArray ? contentsArr.size() : 0;

      const c: DrawCtx = { page, frame: visualFrame(page), font, text, logo, o };
      if (o.layout === 'tile') drawTiled(c);
      else if (o.layout === 'stamp') drawStamp(c);
      else drawCentered(c);

      // Move watermark operators behind existing page content when layer === 'under'
      if (o.layer === 'under' && contentsArr instanceof PDFArray) {
        const afterLen = contentsArr.size();
        if (afterLen > beforeLen) {
          const addedRefs = [];
          for (let i = beforeLen; i < afterLen; i++) addedRefs.push(contentsArr.get(i));
          for (let i = afterLen - 1; i >= beforeLen; i--) contentsArr.remove(i);
          for (let i = addedRefs.length - 1; i >= 0; i--) contentsArr.insert(0, addedRefs[i]!);
        }
      }

      if (mono) {
        drawAuditLine(
          { ...c, font: mono },
          `FOLIO AUDIT  ${stampedAt}  SHA-256 ${sourceHash.slice(0, 16)}…  p. ${idx + 1}/${pages.length}`,
        );
      }
      ctx.progress((k + 1) / targets.length);
    });

    doc.setProducer('Folio');
    if (text && text !== o.text.trim()) {
      ctx.log('warn', 'some characters are not encodable in standard fonts and were replaced');
    }
    return {
      files: [await pdfOutput(doc, `${stem(pdfFile.name)}-filigrane`)],
      report: {
        pages: targets.length,
        layout: o.layout,
        layer: o.layer,
        hasLogo: Boolean(logo),
        ...(o.auditStamp ? { stampedAt, sourceSha256: sourceHash } : {}),
      },
    };
  },
});
