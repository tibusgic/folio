import { EncryptedPDFError, PDFDocument, type PDFFont, type PDFPage } from 'pdf-lib';
import { SkillError, MIME, type DocumentFile } from '@folio/skills-core';

export const MB = 1024 * 1024;

/** Load a PDF and map pdf-lib failures to typed, user-facing errors. */
export async function loadPdf(file: DocumentFile, opts: { updateMetadata?: boolean } = {}): Promise<PDFDocument> {
  try {
    return await PDFDocument.load(file.bytes, { updateMetadata: opts.updateMetadata ?? false });
  } catch (error) {
    if (error instanceof EncryptedPDFError || /encrypted/i.test(String(error))) {
      throw new SkillError('ENCRYPTED_INPUT', `« ${file.name} » est protégé par mot de passe.`);
    }
    throw new SkillError('CORRUPT_INPUT', `« ${file.name} » est illisible ou corrompu.`, {
      internal: String(error).slice(0, 200),
    });
  }
}

export async function pdfOutput(doc: PDFDocument, name: string): Promise<DocumentFile> {
  const bytes = await doc.save({ useObjectStreams: true });
  return { name: name.toLowerCase().endsWith('.pdf') ? name : `${name}.pdf`, mime: MIME.pdf, bytes };
}

export function hexToRgb01(hex: string): { r: number; g: number; b: number } {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  const v = m ? parseInt(m[1]!, 16) : 0x808080;
  return { r: ((v >> 16) & 255) / 255, g: ((v >> 8) & 255) / 255, b: (v & 255) / 255 };
}

/**
 * Standard 14 fonts only encode WinAnsi. Replace unencodable characters
 * instead of crashing the whole job on an emoji or a CJK glyph.
 */
export function encodableText(text: string, font: PDFFont): string {
  let out = '';
  for (const ch of text) {
    try {
      font.encodeText(ch);
      out += ch;
    } catch {
      out += '?';
    }
  }
  return out;
}

export interface VisualFrame {
  /** Width/height as the user sees the page (after /Rotate). */
  readonly width: number;
  readonly height: number;
  /** Page /Rotate value normalised to 0 | 90 | 180 | 270. */
  readonly rotation: 0 | 90 | 180 | 270;
  /** Map a point in visual space (origin bottom-left) to PDF user space. */
  toUser(x: number, y: number): { x: number; y: number };
}

/**
 * Viewers display a page rotated clockwise by /Rotate. Drawing in visual
 * space keeps stamps and signatures upright on landscape-scanned pages.
 * To draw upright text, use rotate = visualAngle + frame.rotation.
 */
export function visualFrame(page: PDFPage): VisualFrame {
  const { width: W, height: H } = page.getSize();
  const rotation = ((((page.getRotation().angle % 360) + 360) % 360) as 0 | 90 | 180 | 270);
  switch (rotation) {
    case 90:
      return { width: H, height: W, rotation, toUser: (x, y) => ({ x: W - y, y: x }) };
    case 180:
      return { width: W, height: H, rotation, toUser: (x, y) => ({ x: W - x, y: H - y }) };
    case 270:
      return { width: H, height: W, rotation, toUser: (x, y) => ({ x: y, y: H - x }) };
    default:
      return { width: W, height: H, rotation: 0, toUser: (x, y) => ({ x, y }) };
  }
}

export function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new SkillError('ABORTED', 'Traitement annulé.');
}

export const mm = (v: number) => (v * 72) / 25.4;
