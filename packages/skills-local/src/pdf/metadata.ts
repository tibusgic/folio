import { decodePDFRawStream, PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';
import { z } from 'zod';
import { defineSkill, MIME, SkillError, stem } from '@folio/skills-core';
import { loadPdf, MB, pdfOutput } from '../util/pdf.ts';

const latin1 = new TextDecoder('latin1');

/** Cheap, bounded token scan on the raw file (no regex on the full buffer). */
function hasToken(bytes: Uint8Array, token: string): boolean {
  const needle = Array.from(token, (c) => c.charCodeAt(0));
  outer: for (let i = 0; i <= bytes.length - needle.length; i++) {
    for (let k = 0; k < needle.length; k++) if (bytes[i + k] !== needle[k]) continue outer;
    return true;
  }
  return false;
}

function readXmp(doc: PDFDocument): string | null {
  const ref = doc.catalog.get(PDFName.of('Metadata'));
  const obj = ref ? doc.context.lookup(ref) : undefined;
  if (!(obj instanceof PDFRawStream)) return null;
  try {
    return new TextDecoder('utf-8').decode(decodePDFRawStream(obj).decode());
  } catch {
    return null;
  }
}

function xmpField(xmp: string, tag: string): string | undefined {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`);
  const m = re.exec(xmp)?.[1];
  if (!m) {
    const attr = new RegExp(`${tag}="([^"]*)"`).exec(xmp)?.[1];
    return attr?.trim() || undefined;
  }
  const li = /<rdf:li[^>]*>([\s\S]*?)<\/rdf:li>/.exec(m)?.[1];
  return (li ?? m).replace(/<[^>]+>/g, '').trim() || undefined;
}

export const inspectSkill = defineSkill({
  id: 'pdf.inspect',
  version: '2.0.0',
  title: 'Inspection',
  summary: 'Métadonnées Info/XMP, version, formats de page et signaux de sécurité (JavaScript, pièces jointes, signatures).',
  category: 'inspect',
  execution: 'local',
  output: 'data',
  modes: ['enterprise'],
  input: { mimes: [MIME.pdf], minFiles: 1, maxFiles: 1, maxBytesPerFile: 500 * MB },
  options: z.object({}),
  fields: [],
  async run(files, _o, ctx) {
    const file = files[0]!;
    let doc: PDFDocument;
    try {
      doc = await PDFDocument.load(file.bytes, { ignoreEncryption: true, updateMetadata: false });
    } catch (e) {
      throw new SkillError('CORRUPT_INPUT', `« ${file.name} » est illisible ou corrompu.`, { internal: String(e).slice(0, 200) });
    }
    const header = latin1.decode(file.bytes.subarray(0, 1024));
    const sizes = new Map<string, number>();
    for (const p of doc.getPages()) {
      const { width, height } = p.getSize();
      const key = `${Math.round((width * 25.4) / 72)}×${Math.round((height * 25.4) / 72)} mm`;
      sizes.set(key, (sizes.get(key) ?? 0) + 1);
    }
    const xmp = readXmp(doc);
    const iso = (d: Date | undefined) => (d ? d.toISOString() : undefined);
    const report = {
      file: { name: file.name, bytes: file.bytes.byteLength },
      pdfVersion: /%PDF-(\d\.\d)/.exec(header)?.[1] ?? null,
      pages: doc.getPageCount(),
      pageSizes: Object.fromEntries(sizes),
      encrypted: doc.isEncrypted,
      info: {
        title: doc.getTitle(),
        author: doc.getAuthor(),
        subject: doc.getSubject(),
        keywords: doc.getKeywords(),
        creator: doc.getCreator(),
        producer: doc.getProducer(),
        created: iso(doc.getCreationDate()),
        modified: iso(doc.getModificationDate()),
      },
      xmp: xmp
        ? {
            present: true,
            bytes: xmp.length,
            title: xmpField(xmp, 'dc:title'),
            creator: xmpField(xmp, 'dc:creator'),
            creatorTool: xmpField(xmp, 'xmp:CreatorTool'),
            producer: xmpField(xmp, 'pdf:Producer'),
            pdfaPart: xmpField(xmp, 'pdfaid:part'),
          }
        : { present: false },
      security: {
        javascript: hasToken(file.bytes, '/JavaScript') || hasToken(file.bytes, '/JS '),
        launchActions: hasToken(file.bytes, '/Launch'),
        embeddedFiles: hasToken(file.bytes, '/EmbeddedFiles'),
        digitalSignature: hasToken(file.bytes, '/ByteRange'),
        forms: doc.catalog.has(PDFName.of('AcroForm')),
      },
    };
    ctx.log('info', 'inspection complete', { pages: report.pages, xmp: report.xmp.present });
    const bytes = new TextEncoder().encode(JSON.stringify(report, null, 2));
    return { files: [{ name: `${stem(file.name)}.inspection.json`, mime: MIME.json, bytes }], report };
  },
});

export const metadataSkill = defineSkill({
  id: 'pdf.metadata',
  version: '2.0.0',
  title: 'Métadonnées',
  summary: 'Réécrire titre, auteur, sujet et mots-clés, ou purger toutes les métadonnées (Info + XMP).',
  category: 'inspect',
  execution: 'local',
  output: 'pdf',
  modes: ['enterprise'],
  input: { mimes: [MIME.pdf], minFiles: 1, maxFiles: 1, maxBytesPerFile: 500 * MB },
  options: z.object({
    strip: z.boolean().default(false),
    title: z.string().trim().max(300).default(''),
    author: z.string().trim().max(200).default(''),
    subject: z.string().trim().max(300).default(''),
    keywords: z.string().trim().max(500).default(''),
  }),
  fields: [
    { kind: 'toggle', key: 'strip', label: 'Purger toutes les métadonnées', help: 'Supprime le dictionnaire Info et le flux XMP (auteur, logiciel, dates).' },
    { kind: 'text', key: 'title', label: 'Titre', showIf: { key: 'strip', equals: false } },
    { kind: 'text', key: 'author', label: 'Auteur', showIf: { key: 'strip', equals: false } },
    { kind: 'text', key: 'subject', label: 'Sujet', showIf: { key: 'strip', equals: false } },
    { kind: 'text', key: 'keywords', label: 'Mots-clés', placeholder: 'séparés par des virgules', showIf: { key: 'strip', equals: false } },
  ],
  async run(files, o, ctx) {
    const file = files[0]!;
    const doc = await loadPdf(file);
    if (o.strip) {
      doc.catalog.delete(PDFName.of('Metadata'));
      doc.context.trailerInfo.Info = doc.context.register(doc.context.obj({}));
      ctx.log('info', 'Info dictionary and XMP stream removed');
    } else {
      if (o.title) doc.setTitle(o.title, { showInWindowTitleBar: true });
      if (o.author) doc.setAuthor(o.author);
      if (o.subject) doc.setSubject(o.subject);
      if (o.keywords) doc.setKeywords(o.keywords.split(',').map((k) => k.trim()).filter(Boolean));
      doc.setProducer('Folio');
      doc.setModificationDate(ctx.now());
    }
    return {
      files: [await pdfOutput(doc, `${stem(file.name)}${o.strip ? '-sans-meta' : ''}`)],
      report: { stripped: o.strip },
    };
  },
});
