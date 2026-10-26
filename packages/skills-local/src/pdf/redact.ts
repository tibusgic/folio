import {
  decodePDFRawStream,
  degrees,
  PDFArray,
  PDFName,
  PDFRawStream,
  PDFRef,
  rgb,
  StandardFonts,
  type PDFDocument,
  type PDFPage,
} from 'pdf-lib';
import { z } from 'zod';
import { defineSkill, MIME, parsePageSelection, stem } from '@folio/skills-core';
import { loadPdf, MB, mm, pdfOutput, throwIfAborted, visualFrame } from '../util/pdf.ts';

const latin1Decoder = new TextDecoder('latin1');

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const IBAN_RE = /\b[A-Z]{2}\d{2}(?:[\s-]?[A-Z0-9]{4}){3,7}(?:[\s-]?[A-Z0-9]{1,3})?\b/g;
const PHONE_RE = /(?:(?:\+|00)33[\s.-]?|0)[1-9](?:[\s.-]?\d{2}){4}\b/g;
const SSN_SIREN_RE = /\b(?:[12]\s?\d{2}\s?(?:0[1-9]|1[0-2])\s?\d{2}\s?\d{3}\s?\d{3}(?:\s?\d{2})?|\d{3}\s?\d{3}\s?\d{3}(?:\s?\d{5})?)\b/g;

const options = z.object({
  redactEmails: z.boolean().default(true),
  redactIbans: z.boolean().default(true),
  redactPhones: z.boolean().default(true),
  redactSsn: z.boolean().default(true),
  customTerms: z.string().trim().max(500).default(''),
  zoneBand: z.enum(['none', 'header', 'footer', 'both']).default('none'),
  pages: z.string().trim().max(500).default(''),
  stripMetadata: z.boolean().default(true),
});

type RedactOptions = z.output<typeof options>;

interface RedactionBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

interface StreamRedactionResult {
  readonly modifiedStreamText: string;
  readonly changed: boolean;
  readonly boxes: RedactionBox[];
  readonly counts: {
    emails: number;
    ibans: number;
    phones: number;
    ssn: number;
    custom: number;
  };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hexToLatin1(hex: string): string {
  const clean = hex.replace(/\s+/g, '');
  let out = '';
  for (let i = 0; i + 1 < clean.length; i += 2) {
    out += String.fromCharCode(parseInt(clean.slice(i, i + 2), 16));
  }
  return out;
}

function latin1ToHex(str: string): string {
  let out = '';
  for (let i = 0; i < str.length; i++) {
    out += (str.charCodeAt(i) & 0xff).toString(16).padStart(2, '0').toUpperCase();
  }
  return out;
}

function unescapePdfLiteral(lit: string): string {
  return lit
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\\(/g, '(')
    .replace(/\\\)/g, ')')
    .replace(/\\\\/g, '\\');
}

function escapePdfLiteral(str: string): string {
  return str.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

/**
 * Scrubs sensitive matches inside a decoded text string and returns the masked
 * string (same character length so glyph advances remain stable) plus match spans.
 */
function maskSensitiveText(
  input: string,
  o: RedactOptions,
  customRegexes: readonly RegExp[],
  counts: StreamRedactionResult['counts'],
): { masked: string; spans: { start: number; end: number }[] } {
  let masked = input;
  const spans: { start: number; end: number }[] = [];

  const applyPattern = (re: RegExp, key: keyof StreamRedactionResult['counts']) => {
    const clone = new RegExp(re.source, re.flags);
    masked = masked.replace(clone, (match, offset: number) => {
      counts[key]++;
      spans.push({ start: offset, end: offset + match.length });
      return '*'.repeat(match.length);
    });
  };

  if (o.redactEmails) applyPattern(EMAIL_RE, 'emails');
  if (o.redactIbans) applyPattern(IBAN_RE, 'ibans');
  if (o.redactPhones) applyPattern(PHONE_RE, 'phones');
  if (o.redactSsn) applyPattern(SSN_SIREN_RE, 'ssn');
  for (const cre of customRegexes) {
    applyPattern(cre, 'custom');
  }

  return { masked, spans };
}

/**
 * Parses a decoded PDF content stream, scrubs sensitive text tokens in-place
 * (both `<HEX>` and `(literal)` forms) so copy-paste is impossible, and records
 * bounding boxes for solid visual black-out bars.
 */
function scrubContentStream(
  streamText: string,
  o: RedactOptions,
  customRegexes: readonly RegExp[],
): StreamRedactionResult {
  const counts = { emails: 0, ibans: 0, phones: 0, ssn: 0, custom: 0 };
  const boxes: RedactionBox[] = [];
  let changed = false;

  let curFontSize = 11;
  let curX = 54;
  let curY = 700;

  const lines = streamText.split('\n');
  const outLines = lines.map((line) => {
    const tfMatch = /\/[A-Za-z0-9._+-]+\s+(\d+(?:\.\d+)?)\s+Tf\b/.exec(line);
    if (tfMatch) {
      curFontSize = Math.max(6, parseFloat(tfMatch[1]!));
    }

    const tmMatch =
      /(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+Tm\b/.exec(
        line,
      );
    if (tmMatch) {
      const scaleY = Math.abs(parseFloat(tmMatch[4]!));
      if (scaleY > 1 && curFontSize === 11) curFontSize = scaleY;
      curX = parseFloat(tmMatch[5]!);
      curY = parseFloat(tmMatch[6]!);
    }

    const tdMatch = /(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+T[dD]\b/.exec(line);
    if (tdMatch) {
      curX += parseFloat(tdMatch[1]!);
      curY += parseFloat(tdMatch[2]!);
    }

    let modifiedLine = line;

    // 1. Hex string tokens <...>
    modifiedLine = modifiedLine.replace(/<([0-9A-Fa-f\s]{4,})>/g, (full, hexInner: string) => {
      const decoded = hexToLatin1(hexInner);
      const { masked, spans } = maskSensitiveText(decoded, o, customRegexes, counts);
      if (!spans.length) return full;
      changed = true;
      const charW = curFontSize * 0.52;
      for (const sp of spans) {
        boxes.push({
          x: curX + sp.start * charW,
          y: curY - curFontSize * 0.22,
          width: Math.max(18, (sp.end - sp.start) * charW + 4),
          height: curFontSize * 1.18,
        });
      }
      return `<${latin1ToHex(masked)}>`;
    });

    // 2. Literal string tokens (...)
    modifiedLine = modifiedLine.replace(/\(((?:\\.|[^\\()])+)\)/g, (full, litInner: string) => {
      const decoded = unescapePdfLiteral(litInner);
      const { masked, spans } = maskSensitiveText(decoded, o, customRegexes, counts);
      if (!spans.length) return full;
      changed = true;
      const charW = curFontSize * 0.52;
      for (const sp of spans) {
        boxes.push({
          x: curX + sp.start * charW,
          y: curY - curFontSize * 0.22,
          width: Math.max(18, (sp.end - sp.start) * charW + 4),
          height: curFontSize * 1.18,
        });
      }
      return `(${escapePdfLiteral(masked)})`;
    });

    return modifiedLine;
  });

  return {
    modifiedStreamText: outLines.join('\n'),
    changed,
    boxes,
    counts,
  };
}

function getPageStreamRefs(doc: PDFDocument, page: PDFPage): { ref?: PDFRef; stream: PDFRawStream }[] {
  const contents = page.node.get(PDFName.of('Contents'));
  if (!contents) return [];

  const result: { ref?: PDFRef; stream: PDFRawStream }[] = [];
  const collect = (item: unknown) => {
    if (item instanceof PDFRef) {
      const looked = doc.context.lookup(item);
      if (looked instanceof PDFRawStream) {
        result.push({ ref: item, stream: looked });
      } else if (looked instanceof PDFArray) {
        for (let i = 0; i < looked.size(); i++) collect(looked.get(i));
      }
    } else if (item instanceof PDFRawStream) {
      result.push({ stream: item });
    } else if (item instanceof PDFArray) {
      for (let i = 0; i < item.size(); i++) collect(item.get(i));
    }
  };
  collect(contents);
  return result;
}

export const redactSkill = defineSkill({
  id: 'pdf.redact',
  version: '2.0.0',
  title: 'Caviardage RGPD',
  summary: 'Masquage irréversible des données sensibles (e-mails, IBAN, téléphones, NIR, noms) avec destruction dans le flux PDF pour empêcher tout copier-coller.',
  category: 'secure',
  execution: 'local',
  output: 'pdf',
  modes: ['quick', 'enterprise'],
  input: {
    mimes: [MIME.pdf],
    minFiles: 1,
    maxFiles: 1,
    maxBytesPerFile: 300 * MB,
  },
  options,
  fields: [
    { kind: 'toggle', key: 'redactEmails', label: 'Masquer les adresses e-mail' },
    { kind: 'toggle', key: 'redactIbans', label: 'Masquer les IBAN & RIB' },
    { kind: 'toggle', key: 'redactPhones', label: 'Masquer les numéros de téléphone' },
    { kind: 'toggle', key: 'redactSsn', label: 'Masquer les NIR (Sécurité sociale) & SIRET', advanced: true },
    {
      kind: 'text',
      key: 'customTerms',
      label: 'Termes ou noms propres à caviarder',
      placeholder: 'Camille Vasseur, ACME SAS, Secret',
      help: 'Séparés par des virgules. Détruit le texte sous-jacent et appose un bloc noir.',
      maxLength: 500,
    },
    {
      kind: 'select',
      key: 'zoneBand',
      label: 'Masquage géométrique de bande',
      advanced: true,
      options: [
        { value: 'none', label: 'Aucune bande géométrique' },
        { value: 'header', label: 'Caviarder la bande d’en-tête (haut 22 mm)' },
        { value: 'footer', label: 'Caviarder la bande de pied de page (bas 22 mm)' },
        { value: 'both', label: 'Caviarder en-tête et pied de page' },
      ],
    },
    { kind: 'pages', key: 'pages', label: 'Pages cibles', placeholder: 'toutes', advanced: true },
    {
      kind: 'toggle',
      key: 'stripMetadata',
      label: 'Purger les métadonnées (Info + XMP)',
      help: 'Évite toute fuite du nom de l’auteur dans les propriétés du fichier.',
    },
  ],
  async run(files, o, ctx) {
    const file = files[0]!;
    const doc = await loadPdf(file);
    const monoFont = await doc.embedFont(StandardFonts.CourierBold);
    const pages = doc.getPages();
    const targetIndices = parsePageSelection(o.pages, pages.length);

    const customTermsList = o.customTerms
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t.length >= 2);
    const customRegexes = customTermsList.map((term) => new RegExp(escapeRegExp(term), 'gi'));

    const totals = {
      emails: 0,
      ibans: 0,
      phones: 0,
      ssn: 0,
      custom: 0,
      zones: 0,
    };

    for (let k = 0; k < targetIndices.length; k++) {
      throwIfAborted(ctx.signal);
      const pageIdx = targetIndices[k]!;
      const page = pages[pageIdx]!;
      const streamEntries = getPageStreamRefs(doc, page);

      const pageBoxes: RedactionBox[] = [];

      for (const entry of streamEntries) {
        try {
          const decodedBytes = decodePDFRawStream(entry.stream).decode();
          const streamStr = latin1Decoder.decode(decodedBytes);
          const scrubbed = scrubContentStream(streamStr, o, customRegexes);
          if (scrubbed.changed && entry.ref) {
            const newRawBytes = new Uint8Array(scrubbed.modifiedStreamText.length);
            for (let i = 0; i < scrubbed.modifiedStreamText.length; i++) {
              newRawBytes[i] = scrubbed.modifiedStreamText.charCodeAt(i) & 0xff;
            }
            const replacementStream = doc.context.flateStream(newRawBytes);
            doc.context.assign(entry.ref, replacementStream);
          }
          pageBoxes.push(...scrubbed.boxes);
          totals.emails += scrubbed.counts.emails;
          totals.ibans += scrubbed.counts.ibans;
          totals.phones += scrubbed.counts.phones;
          totals.ssn += scrubbed.counts.ssn;
          totals.custom += scrubbed.counts.custom;
        } catch {
          // Non-standard stream filter; continue with visual redaction
        }
      }

      // Draw opaque black-out boxes over every matched span
      for (const box of pageBoxes) {
        page.drawRectangle({
          x: box.x - 1,
          y: box.y - 1,
          width: box.width + 2,
          height: box.height + 2,
          color: rgb(0.07, 0.07, 0.09),
          opacity: 1,
        });
      }

      // Optional geometric header/footer redaction bands
      if (o.zoneBand !== 'none') {
        const frame = visualFrame(page);
        const bandH = mm(22);
        const drawBand = (vy: number) => {
          const corner = frame.toUser(mm(10), vy);
          page.drawRectangle({
            x: corner.x,
            y: corner.y,
            width: frame.width - mm(20),
            height: bandH,
            color: rgb(0.07, 0.07, 0.09),
            opacity: 1,
            rotate: degrees(frame.rotation),
          });
          const labelPos = frame.toUser(mm(14), vy + mm(8));
          page.drawText('ZONE CAVIARDEE · CONFORMITE RGPD', {
            x: labelPos.x,
            y: labelPos.y,
            size: 7.5,
            font: monoFont,
            color: rgb(0.85, 0.84, 0.8),
            rotate: degrees(frame.rotation),
          });
          totals.zones++;
        };
        if (o.zoneBand === 'header' || o.zoneBand === 'both') {
          drawBand(frame.height - bandH - mm(6));
        }
        if (o.zoneBand === 'footer' || o.zoneBand === 'both') {
          drawBand(mm(6));
        }
      }

      ctx.progress((k + 1) / targetIndices.length, `caviardage page ${pageIdx + 1}`);
    }

    if (o.stripMetadata) {
      doc.catalog.delete(PDFName.of('Metadata'));
      doc.context.trailerInfo.Info = doc.context.register(doc.context.obj({}));
    } else {
      doc.setProducer('Folio · pdf.redact');
    }

    const totalRedactions =
      totals.emails + totals.ibans + totals.phones + totals.ssn + totals.custom + totals.zones;
    ctx.log('info', `redacted ${totalRedactions} item(s)`, totals);

    return {
      files: [await pdfOutput(doc, `${stem(file.name)}-caviarde`)],
      report: {
        redactedTotal: totalRedactions,
        ...totals,
        metadataStripped: o.stripMetadata,
      },
    };
  },
});
