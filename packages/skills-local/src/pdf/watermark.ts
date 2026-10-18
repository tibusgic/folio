import { degrees, rgb, StandardFonts, type PDFFont, type PDFPage } from 'pdf-lib';
import { z } from 'zod';
import { defineSkill, MIME, parsePageSelection, sha256Hex, stem } from '@folio/skills-core';
import { encodableText, hexToRgb01, loadPdf, MB, mm, pdfOutput, visualFrame, type VisualFrame } from '../util/pdf.ts';

const FONTS = {
  'Helvetica-Bold': StandardFonts.HelveticaBold,
  Helvetica: StandardFonts.Helvetica,
  'Times-Roman': StandardFonts.TimesRoman,
  'Courier-Bold': StandardFonts.CourierBold,
} as const;

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Couleur hexadécimale attendue (#RRGGBB)');

const options = z.object({
  text: z.string().trim().min(1, 'Texte requis').max(200),
  layout: z.enum(['center', 'tile', 'stamp']).default('center'),
  font: z.enum(Object.keys(FONTS) as [keyof typeof FONTS, ...(keyof typeof FONTS)[]]).default('Helvetica-Bold'),
  fontSize: z.number().min(6).max(200).default(54),
  opacity: z.number().min(0.02).max(1).default(0.16),
  rotation: z.number().min(-90).max(90).default(35),
  color: hexColor.default('#B4532A'),
  pages: z.string().trim().max(500).default(''),
  auditStamp: z.boolean().default(false),
});

type Options = z.output<typeof options>;

interface DrawCtx {
  page: PDFPage;
  frame: VisualFrame;
  font: PDFFont;
  text: string;
  o: Options;
}

function rot(x: number, y: number, deg: number): { x: number; y: number } {
  const t = (deg * Math.PI) / 180;
  return { x: x * Math.cos(t) - y * Math.sin(t), y: x * Math.sin(t) + y * Math.cos(t) };
}

/** Draw text whose *visual* origin is (vx, vy) with a visual angle. */
function drawVisual({ page, frame, font, o }: DrawCtx, text: string, vx: number, vy: number, angle: number, size = o.fontSize) {
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

function drawCentered(c: DrawCtx) {
  const w = c.font.widthOfTextAtSize(c.text, c.o.fontSize);
  const h = c.font.heightAtSize(c.o.fontSize, { descender: false });
  const off = rot(w / 2, h / 2, c.o.rotation);
  drawVisual(c, c.text, c.frame.width / 2 - off.x, c.frame.height / 2 - off.y, c.o.rotation);
}

function drawTiled(c: DrawCtx) {
  const w = c.font.widthOfTextAtSize(c.text, c.o.fontSize);
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
      drawVisual(c, c.text, x, y, c.o.rotation);
    }
  }
}

/** Confidentiality stamp: uppercase label in a ruled box, top-right corner. */
function drawStamp(c: DrawCtx) {
  const size = Math.min(c.o.fontSize, 28);
  const label = c.text.toUpperCase();
  const tw = c.font.widthOfTextAtSize(label, size);
  const th = c.font.heightAtSize(size, { descender: false });
  const padX = size * 0.6;
  const padY = size * 0.45;
  const bw = tw + padX * 2;
  const bh = th + padY * 2;
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
  drawVisual({ ...c, o: { ...c.o, opacity } }, label, vx + padX, vy + padY, 0, size);
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
  version: '2.0.0',
  title: 'Filigrane & tampon',
  summary: 'Filigrane vectoriel, tampon de confidentialité et ligne d’audit horodatée.',
  category: 'secure',
  execution: 'local',
  output: 'pdf',
  modes: ['quick', 'enterprise'],
  input: { mimes: [MIME.pdf], minFiles: 1, maxFiles: 1, maxBytesPerFile: 500 * MB },
  options,
  fields: [
    { kind: 'text', key: 'text', label: 'Texte', placeholder: 'CONFIDENTIEL', maxLength: 200 },
    {
      kind: 'select',
      key: 'layout',
      label: 'Disposition',
      options: [
        { value: 'center', label: 'Centré' },
        { value: 'tile', label: 'Mosaïque' },
        { value: 'stamp', label: 'Tampon (coin supérieur)' },
      ],
    },
    { kind: 'color', key: 'color', label: 'Encre' },
    { kind: 'range', key: 'opacity', label: 'Opacité', min: 0.02, max: 1, step: 0.02 },
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
    const file = files[0]!;
    const doc = await loadPdf(file);
    const font = await doc.embedFont(FONTS[o.font]);
    const mono = o.auditStamp ? await doc.embedFont(StandardFonts.Courier) : null;
    const text = encodableText(o.text, font);
    const pages = doc.getPages();
    const targets = parsePageSelection(o.pages, pages.length);
    const sourceHash = o.auditStamp ? await sha256Hex(file.bytes) : '';
    const stampedAt = ctx.now().toISOString().replace(/\.\d+Z$/, 'Z');

    targets.forEach((idx, k) => {
      const page = pages[idx]!;
      const c: DrawCtx = { page, frame: visualFrame(page), font, text, o };
      if (o.layout === 'tile') drawTiled(c);
      else if (o.layout === 'stamp') drawStamp(c);
      else drawCentered(c);
      if (mono) {
        drawAuditLine(
          { ...c, font: mono },
          `FOLIO AUDIT  ${stampedAt}  SHA-256 ${sourceHash.slice(0, 16)}…  p. ${idx + 1}/${pages.length}`,
        );
      }
      ctx.progress((k + 1) / targets.length);
    });

    doc.setProducer('Folio');
    if (text !== o.text) ctx.log('warn', 'some characters are not encodable in standard fonts and were replaced');
    return {
      files: [await pdfOutput(doc, `${stem(file.name)}-filigrane`)],
      report: { pages: targets.length, layout: o.layout, ...(o.auditStamp ? { stampedAt, sourceSha256: sourceHash } : {}) },
    };
  },
});
