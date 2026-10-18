import { degrees, rgb, StandardFonts, type PDFPage } from 'pdf-lib';
import { z } from 'zod';
import { defineSkill, MIME, sha256Hex, stem } from '@folio/skills-core';
import { encodableText, hexToRgb01, loadPdf, MB, mm, pdfOutput, visualFrame } from '../util/pdf.ts';

const point = z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)]);

const options = z.object({
  /** Normalised strokes captured by the signature pad (0..1 in both axes, y down). */
  strokes: z.array(z.array(point).max(4000)).max(300).default([]),
  padRatio: z.number().min(1).max(8).default(3),
  signerName: z.string().trim().min(1, 'Nom du signataire requis').max(80),
  reason: z.string().trim().max(120).default(''),
  pageTarget: z.enum(['last', 'first', 'all']).default('last'),
  position: z.enum(['bottom-right', 'bottom-left', 'top-right', 'top-left']).default('bottom-right'),
  widthMm: z.number().min(30).max(120).default(62),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#1F2430'),
  timestamp: z.boolean().default(true),
});

/** Convert normalised strokes into a smoothed SVG path (quadratic midpoints). */
export function strokesToSvgPath(strokes: readonly (readonly [number, number])[][], w: number, h: number): string {
  const f = (n: number) => Number(n.toFixed(2));
  return strokes
    .filter((s) => s.length > 1)
    .map((s) => {
      const pts = s.map(([x, y]) => [x * w, y * h] as const);
      let d = `M${f(pts[0]![0])} ${f(pts[0]![1])}`;
      for (let i = 1; i < pts.length - 1; i++) {
        const [x, y] = pts[i]!;
        const [nx, ny] = pts[i + 1]!;
        d += ` Q${f(x)} ${f(y)} ${f((x + nx) / 2)} ${f((y + ny) / 2)}`;
      }
      const last = pts.at(-1)!;
      return `${d} L${f(last[0])} ${f(last[1])}`;
    })
    .join(' ');
}

export const signatureSkill = defineSkill({
  id: 'pdf.sign-visual',
  version: '2.0.0',
  title: 'Signature visuelle',
  summary: 'Apposer une signature manuscrite vectorielle avec bloc d’identification horodaté.',
  category: 'secure',
  execution: 'local',
  output: 'pdf',
  modes: ['quick', 'enterprise'],
  input: { mimes: [MIME.pdf], minFiles: 1, maxFiles: 1, maxBytesPerFile: 500 * MB },
  options,
  fields: [
    { kind: 'signature', key: 'strokes', label: 'Signature', help: 'Tracez à la souris, au stylet ou au doigt. Sans tracé, le nom est composé en italique.' },
    { kind: 'text', key: 'signerName', label: 'Signataire', placeholder: 'Prénom Nom', maxLength: 80 },
    { kind: 'text', key: 'reason', label: 'Motif', placeholder: 'Bon pour accord', maxLength: 120, advanced: true },
    {
      kind: 'select',
      key: 'pageTarget',
      label: 'Page',
      options: [
        { value: 'last', label: 'Dernière page' },
        { value: 'first', label: 'Première page' },
        { value: 'all', label: 'Toutes les pages' },
      ],
    },
    {
      kind: 'select',
      key: 'position',
      label: 'Position',
      advanced: true,
      options: [
        { value: 'bottom-right', label: 'Bas droite' },
        { value: 'bottom-left', label: 'Bas gauche' },
        { value: 'top-right', label: 'Haut droite' },
        { value: 'top-left', label: 'Haut gauche' },
      ],
    },
    { kind: 'range', key: 'widthMm', label: 'Largeur', min: 30, max: 120, step: 1, unit: 'mm', advanced: true },
    { kind: 'color', key: 'color', label: 'Encre', advanced: true },
    { kind: 'toggle', key: 'timestamp', label: 'Horodatage et empreinte', advanced: true },
  ],
  async run(files, o, ctx) {
    const file = files[0]!;
    const doc = await loadPdf(file);
    const [bold, mono, italic] = await Promise.all([
      doc.embedFont(StandardFonts.HelveticaBold),
      doc.embedFont(StandardFonts.Courier),
      doc.embedFont(StandardFonts.TimesRomanItalic),
    ]);
    const pages = doc.getPages();
    const targets: PDFPage[] =
      o.pageTarget === 'all' ? pages : [o.pageTarget === 'first' ? pages[0]! : pages.at(-1)!];

    const hash = o.timestamp ? await sha256Hex(file.bytes) : '';
    const when = ctx.now().toISOString().slice(0, 16).replace('T', ' ');
    const meta = [
      ...(o.timestamp ? [`Signé le ${when} UTC`] : []),
      ...(o.reason ? [`Motif : ${o.reason}`] : []),
      ...(o.timestamp ? [`SHA-256 ${hash.slice(0, 24)}…`] : []),
    ].map((l) => encodableText(l, mono));
    const name = encodableText(o.signerName, bold);
    const path = strokesToSvgPath(o.strokes, mm(o.widthMm), mm(o.widthMm) / o.padRatio);
    const ink = hexToRgb01(o.color);

    for (const page of targets) {
      const frame = visualFrame(page);
      const bw = mm(o.widthMm);
      const sh = bw / o.padRatio;
      const bh = sh + 6 + 11 + meta.length * 8.5;
      const margin = mm(16);
      const vx = o.position.endsWith('right') ? frame.width - margin - bw : margin;
      const vyTop = o.position.startsWith('top') ? frame.height - margin : margin + bh;
      const angle = degrees(frame.rotation);
      const color = rgb(ink.r, ink.g, ink.b);

      if (path) {
        const tl = frame.toUser(vx, vyTop);
        page.drawSvgPath(path, { x: tl.x, y: tl.y, borderColor: color, borderWidth: 1.1, borderLineCap: 1, rotate: angle });
      } else {
        const size = Math.min(sh * 0.55, (bw / Math.max(1, italic.widthOfTextAtSize(name, 1))) * 0.9);
        const p = frame.toUser(vx + 2, vyTop - sh + sh * 0.25);
        page.drawText(encodableText(o.signerName, italic), { x: p.x, y: p.y, size, font: italic, color, rotate: angle });
      }

      const ruleY = vyTop - sh - 2;
      const a = frame.toUser(vx, ruleY);
      const b = frame.toUser(vx + bw, ruleY);
      page.drawLine({ start: a, end: b, thickness: 0.5, color: rgb(0.45, 0.45, 0.47) });

      const np = frame.toUser(vx, ruleY - 10);
      page.drawText(name, { x: np.x, y: np.y, size: 8.5, font: bold, color: rgb(0.1, 0.1, 0.12), rotate: angle });
      meta.forEach((line, i) => {
        const lp = frame.toUser(vx, ruleY - 19.5 - i * 8.5);
        page.drawText(line, { x: lp.x, y: lp.y, size: 6.5, font: mono, color: rgb(0.32, 0.32, 0.35), rotate: angle });
      });
    }

    doc.setProducer('Folio');
    ctx.log('info', `visual signature applied on ${targets.length} page(s)`, { drawn: Boolean(path) });
    return {
      files: [await pdfOutput(doc, `${stem(file.name)}-signe`)],
      report: { pages: targets.length, drawn: Boolean(path), ...(o.timestamp ? { signedAt: when, sourceSha256: hash } : {}) },
    };
  },
});
