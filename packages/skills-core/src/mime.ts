/**
 * Content sniffing. The declared MIME type (from the browser or the client)
 * is never trusted: we look at magic bytes, and for text formats we require
 * valid UTF-8 without NUL bytes plus a matching extension.
 */
export const MIME = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  markdown: 'text/markdown',
  bibtex: 'application/x-bibtex',
  json: 'application/json',
  html: 'text/html',
  tex: 'application/x-tex',
  zip: 'application/zip',
} as const;

export const IMAGE_MIMES: readonly string[] = [MIME.png, MIME.jpeg, MIME.webp, MIME.svg];

export function isImageMime(mime: string): boolean {
  return IMAGE_MIMES.includes(mime);
}

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_MAGIC = [0xff, 0xd8, 0xff];
const RIFF_MAGIC = [0x52, 0x49, 0x46, 0x46]; // RIFF
const WEBP_MAGIC = [0x57, 0x45, 0x42, 0x50]; // WEBP
const ZIP_LOCAL_MAGIC = [0x50, 0x4b, 0x03, 0x04]; // PK\x03\x04
const ZIP_EMPTY_MAGIC = [0x50, 0x4b, 0x05, 0x06]; // PK\x05\x06
const ZIP_SPANNED_MAGIC = [0x50, 0x4b, 0x07, 0x08]; // PK\x07\x08

function startsWith(bytes: Uint8Array, magic: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + magic.length) return false;
  return magic.every((b, i) => bytes[offset + i] === b);
}

/**
 * The PDF spec tolerates minor leading whitespace/garbage before the header,
 * unless the file has an explicit text extension (.md, .markdown, .bib, .tex, .txt)
 * and does not start with %PDF- at offset 0.
 */
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

function looksLikeSvgText(bytes: Uint8Array): boolean {
  if (!isUtf8Text(bytes)) return false;
  const sample = new TextDecoder('utf-8').decode(bytes.subarray(0, Math.min(bytes.length, 4096))).trimStart();
  return /<svg[\s>]/i.test(sample);
}

/** Returns the detected MIME type, or null if the content is not recognised. */
export function sniffMime(bytes: Uint8Array, name: string): string | null {
  const ext = extensionOf(name);
  if (ext === 'svg' && looksLikeSvgText(bytes)) {
    return MIME.svg;
  }

  const textual: Record<string, string> = { md: MIME.markdown, markdown: MIME.markdown, bib: MIME.bibtex };
  const candidate = textual[ext];
  if (candidate && !startsWith(bytes, PDF_MAGIC, 0) && isUtf8Text(bytes)) {
    return candidate;
  }

  if (startsWith(bytes, PNG_MAGIC)) return MIME.png;
  if (startsWith(bytes, JPEG_MAGIC)) return MIME.jpeg;
  if (startsWith(bytes, RIFF_MAGIC, 0) && startsWith(bytes, WEBP_MAGIC, 8)) return MIME.webp;
  if (
    startsWith(bytes, ZIP_LOCAL_MAGIC) ||
    startsWith(bytes, ZIP_EMPTY_MAGIC) ||
    startsWith(bytes, ZIP_SPANNED_MAGIC)
  ) {
    return MIME.zip;
  }
  if (findPdfHeader(bytes) !== -1) return MIME.pdf;
  if (looksLikeSvgText(bytes)) return MIME.svg;

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

/**
 * Normalize and sanitize a relative path (e.g. from a .zip archive or markdown reference),
 * stripping any '..' traversal segments or leading slashes.
 */
export function sanitizeRelativePath(rawPath: string): string {
  const normalized = rawPath
    .normalize('NFC')
    .replace(/\\/g, '/')
    .replace(/[\u0000-\u001f\u007f"<>:|?*;]/g, '')
    .trim();
  const parts = normalized
    .split('/')
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0 && segment !== '.' && segment !== '..');
  if (parts.length === 0) return '';
  const last = sanitizeFileName(parts[parts.length - 1]!, '');
  if (!last) return '';
  parts[parts.length - 1] = last;
  return parts.join('/');
}

export function stem(name: string): string {
  const clean = sanitizeFileName(name);
  const dot = clean.lastIndexOf('.');
  return dot > 0 ? clean.slice(0, dot) : clean;
}
