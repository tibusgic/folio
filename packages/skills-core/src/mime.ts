/**
 * Content sniffing. The declared MIME type (from the browser or the client)
 * is never trusted: we look at magic bytes, and for text formats we require
 * valid UTF-8 without NUL bytes plus a matching extension.
 */
export const MIME = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpeg: 'image/jpeg',
  markdown: 'text/markdown',
  bibtex: 'application/x-bibtex',
  json: 'application/json',
  html: 'text/html',
  tex: 'application/x-tex',
  zip: 'application/zip',
} as const;

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-

function startsWith(bytes: Uint8Array, magic: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + magic.length) return false;
  return magic.every((b, i) => bytes[offset + i] === b);
}

/** The PDF spec tolerates garbage before the header; Acrobat scans the first 1024 bytes. */
export function findPdfHeader(bytes: Uint8Array): number {
  const limit = Math.min(bytes.length - PDF_MAGIC.length, 1024);
  for (let i = 0; i <= limit; i++) if (startsWith(bytes, PDF_MAGIC, i)) return i;
  return -1;
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot + 1).toLowerCase();
}

function isUtf8Text(bytes: Uint8Array): boolean {
  if (bytes.includes(0)) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

/** Returns the detected MIME type, or null if the content is not recognised. */
export function sniffMime(bytes: Uint8Array, name: string): string | null {
  if (findPdfHeader(bytes) !== -1) return MIME.pdf;
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return MIME.png;
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return MIME.jpeg;

  const ext = extensionOf(name);
  const textual: Record<string, string> = { md: MIME.markdown, markdown: MIME.markdown, bib: MIME.bibtex };
  const candidate = textual[ext];
  if (candidate && isUtf8Text(bytes)) return candidate;
  return null;
}

/** Remove path components, control chars and characters unsafe in headers. */
export function sanitizeFileName(name: string, fallback = 'document'): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  const cleaned = base
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f"<>:|?*;]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .slice(0, 120);
  return cleaned || fallback;
}

export function stem(name: string): string {
  const clean = sanitizeFileName(name);
  const dot = clean.lastIndexOf('.');
  return dot > 0 ? clean.slice(0, dot) : clean;
}
