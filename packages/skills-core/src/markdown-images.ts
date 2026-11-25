/**
 * Comprehensive Markdown image resolution & asset bundling engine.
 *
 * Supports all 4 image sources for both `md.pdf` and `md.latex-pdf`:
 * 1. Deposited image files (.png, .jpg, .jpeg, .webp, .svg) associated with the .md
 *    (automatic matching by exact relative path or filename + manual override map).
 * 2. Local .zip archives containing the .md and its asset tree (100% local decompression via fflate).
 * 3. Base64 / UTF-8 Data URIs (`data:image/png;base64,...`, `data:image/svg+xml;...`).
 * 4. Remote HTTP/HTTPS URLs (`https://...`) with SSRF protection, CORS/network error resilience,
 *    magic-byte verification, and in-memory caching.
 */
import { unzipSync } from 'fflate';
import { SkillError } from './errors.ts';
import { isImageMime, MIME, sanitizeFileName, sanitizeRelativePath, sniffMime, stem } from './mime.ts';
import type { DocumentFile } from './types.ts';

export type MarkdownImageSourceKind = 'local-path' | 'data-uri' | 'remote-url';

export interface MarkdownImageRef {
  /** Raw Markdown image tag `![alt](...)`. */
  readonly rawMatch: string;
  /** Alt text / caption from `![alt](...)`. */
  readonly alt: string;
  /** Raw src target extracted from `![alt](src "title")`. */
  readonly src: string;
  /** Optional title attribute from `![alt](src "title")`. */
  readonly title?: string;
  /** Classification of the image source. */
  readonly kind: MarkdownImageSourceKind;
  /** Normalized relative path for `local-path` references (e.g. `images/schema.png`). */
  readonly normalizedPath?: string;
  /** Basename for `local-path` references (e.g. `schema.png`). */
  readonly basename?: string;
}

export interface ResolvedMarkdownImage {
  readonly src: string;
  readonly kind: MarkdownImageSourceKind;
  readonly resolved: boolean;
  readonly matchType?: 'manual' | 'exact-path' | 'suffix-path' | 'filename' | 'data-uri' | 'remote-cache' | 'remote-fetch';
  readonly mime?: string;
  readonly bytes?: Uint8Array;
  /** Self-contained `data:image/...;base64,...` URI for instant print-HTML rendering. */
  readonly dataUri?: string;
  /** Materialized DocumentFile with a collision-free filename for LaTeX `\includegraphics`. */
  readonly latexFile?: DocumentFile;
  /** Matched user-deposited or zip-extracted file name, if applicable. */
  readonly matchedFileName?: string;
  /** Error/warning message if the image could not be resolved. */
  readonly error?: string;
}

export interface MarkdownImageStats {
  readonly totalImages: number;
  readonly resolvedImages: number;
  readonly missingImages: number;
  readonly bySource: {
    readonly local: number;
    readonly zip: number;
    readonly dataUri: number;
    readonly remote: number;
  };
}

export interface MarkdownImageResolutionResult {
  readonly mdFile: DocumentFile;
  readonly bibFile?: DocumentFile;
  readonly imageFiles: DocumentFile[];
  readonly refs: MarkdownImageRef[];
  readonly resolutions: Map<string, ResolvedMarkdownImage>;
  /** Map from raw Markdown `src` to the filename to use inside LaTeX `\includegraphics{...}`. */
  readonly latexPathMap: Record<string, string>;
  /** Materialized image files ready to be sent alongside the `.tex` to the LaTeX compiler. */
  readonly latexAssetFiles: DocumentFile[];
  readonly stats: MarkdownImageStats;
  readonly warnings: string[];
}

export interface ResolveMarkdownImagesOptions {
  /** Manual association overrides: `{ [markdownSrc]: depositedFileNameOrRelativePath }`. */
  readonly imageMappings?: Record<string, string>;
  /** Whether to fetch remote HTTP/HTTPS images. Defaults to true. */
  readonly fetchRemote?: boolean;
  /** Maximum bytes per remote image download. Defaults to 15 MB. */
  readonly maxRemoteBytes?: number;
  /** Timeout in milliseconds per remote image fetch. Defaults to 8000 ms. */
  readonly remoteTimeoutMs?: number;
  readonly signal?: AbortSignal;
  /** Injectable fetch implementation for deterministic unit testing. */
  readonly fetcher?: typeof fetch;
}

const MAX_ZIP_UNCOMPRESSED_BYTES = 75 * 1024 * 1024; // 75 MB ceiling against zip bombs
const DEFAULT_MAX_REMOTE_BYTES = 15 * 1024 * 1024; // 15 MB per remote image
const DEFAULT_REMOTE_TIMEOUT_MS = 8000;

interface CachedRemoteImage {
  readonly mime: string;
  readonly bytes: Uint8Array;
  readonly dataUri: string;
}

/** Process-wide in-memory cache for fetched remote images. */
const remoteImageCache = new Map<string, CachedRemoteImage>();

export function clearRemoteImageCache(): void {
  remoteImageCache.clear();
}

export function getRemoteImageCacheSize(): number {
  return remoteImageCache.size;
}

/** Encode a Uint8Array into a base64 string (works in Browser, WebWorker, and Node 22). */
export function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const sub = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...sub);
  }
  return globalThis.btoa(binary);
}

/** Decode a base64 string into a Uint8Array. */
export function base64ToUint8(b64: string): Uint8Array {
  const cleaned = b64.replace(/[\r\n\s]/g, '');
  const bin = globalThis.atob(cleaned);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    out[i] = bin.charCodeAt(i);
  }
  return out;
}

/**
 * Sanitize SVG bytes to strip active scripts, event handlers (`onload`, `onerror`, etc.),
 * and external `javascript:` links before embedding in print HTML or converting for LaTeX.
 */
export function sanitizeSvgBytes(bytes: Uint8Array): Uint8Array {
  const raw = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  const cleaned = raw
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<foreignObject\b[^<]*(?:(?!<\/foreignObject>)<[^<]*)*<\/foreignObject>/gi, '')
    .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(?:href|xlink:href)\s*=\s*(?:"\s*javascript:[^"]*"|'\s*javascript:[^']*')/gi, '');
  return new TextEncoder().encode(cleaned);
}

export function bytesToDataUri(bytes: Uint8Array, mime: string): string {
  const safeBytes = mime === MIME.svg ? sanitizeSvgBytes(bytes) : bytes;
  return `data:${mime};base64,${uint8ToBase64(safeBytes)}`;
}

export function extensionForImageMime(mime: string): string {
  switch (mime) {
    case MIME.png:
      return 'png';
    case MIME.jpeg:
      return 'jpg';
    case MIME.webp:
      return 'webp';
    case MIME.svg:
      return 'svg';
    default:
      return 'png';
  }
}

/**
 * Normalize a relative image path from a Markdown reference (e.g. `./images/schema.png?v=1` -> `images/schema.png`).
 */
export function normalizeMarkdownImagePath(rawSrc: string): string {
  let s = rawSrc.trim();
  // Strip query string or hash if present on relative file paths
  const qIdx = s.indexOf('?');
  if (qIdx !== -1) s = s.slice(0, qIdx);
  const hIdx = s.indexOf('#');
  if (hIdx !== -1) s = s.slice(0, hIdx);
  try {
    s = decodeURIComponent(s);
  } catch {
    // keep raw if malformed percent-encoding
  }
  s = s.replace(/\\/g, '/').replace(/^(?:\.\/)+/, '').replace(/^\/+/, '');
  return sanitizeRelativePath(s);
}

function parseRawImageTarget(rawInner: string): { src: string; title?: string } {
  const trimmed = rawInner.trim();
  // Angle-bracketed target: <./path with spaces/img.png> "optional title"
  if (trimmed.startsWith('<')) {
    const closeIdx = trimmed.indexOf('>');
    if (closeIdx !== -1) {
      const src = trimmed.slice(1, closeIdx).trim();
      const rest = trimmed.slice(closeIdx + 1).trim();
      const titleMatch = /^["'](.*)["']$/.exec(rest);
      return { src, ...(titleMatch?.[1] ? { title: titleMatch[1] } : {}) };
    }
  }
  // Data URI target: data:image/...
  if (/^data:image\//i.test(trimmed)) {
    return { src: trimmed };
  }
  // Standard target with optional quoted title at the end: path/to/img.png "My title"
  const titleMatch = /^(\S+)\s+["']([^"']*)["']$/.exec(trimmed);
  if (titleMatch) {
    return { src: titleMatch[1]!, title: titleMatch[2]! };
  }
  return { src: trimmed };
}

/**
 * Extract all Markdown image references `![alt](target)` outside of fenced and inline code blocks.
 */
export function extractMarkdownImageRefs(markdownSource: string): MarkdownImageRef[] {
  // Blank out fenced code blocks ```...``` and ~~~...~~~
  const withoutFences = markdownSource
    .replace(/^```[\s\S]*?^```/gm, '')
    .replace(/^~~~[\s\S]*?^~~~/gm, '');
  // Blank out inline code spans `...`
  const withoutInlineCode = withoutFences.replace(/`[^`\n]+`/g, '');

  const refs: MarkdownImageRef[] = [];
  const regex = /!\[([^\]]*)\]\(([^)\n]+)\)/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(withoutInlineCode)) !== null) {
    const alt = match[1] ?? '';
    const { src, title } = parseRawImageTarget(match[2] ?? '');
    if (!src) continue;

    if (/^data:image\//i.test(src)) {
      refs.push({
        rawMatch: match[0],
        alt,
        src,
        ...(title ? { title } : {}),
        kind: 'data-uri',
      });
    } else if (/^https?:\/\//i.test(src)) {
      refs.push({
        rawMatch: match[0],
        alt,
        src,
        ...(title ? { title } : {}),
        kind: 'remote-url',
      });
    } else {
      const normalizedPath = normalizeMarkdownImagePath(src);
      const base = normalizedPath.split('/').pop() ?? sanitizeFileName(src, '');
      refs.push({
        rawMatch: match[0],
        alt,
        src,
        ...(title ? { title } : {}),
        kind: 'local-path',
        normalizedPath,
        basename: base,
      });
    }
  }

  return refs;
}

export interface ExpandedInputBundle {
  readonly files: DocumentFile[];
  readonly zipExtractedNames: Set<string>;
}

/**
 * Unpacks any `.zip` archives in `files` 100% locally in memory using `fflate`.
 * Preserves each entry's normalized relative path (`relativePath`) so relative
 * references like `./images/schema.png` in the `.md` match their exact folder path.
 */
export function expandZipArchives(
  files: readonly DocumentFile[],
  maxTotalBytes = MAX_ZIP_UNCOMPRESSED_BYTES,
): ExpandedInputBundle {
  const out: DocumentFile[] = [];
  const zipExtractedNames = new Set<string>();
  let totalUncompressed = 0;

  for (const file of files) {
    const detected = sniffMime(file.bytes, file.name) ?? file.mime;
    if (detected !== MIME.zip) {
      out.push(file);
      continue;
    }

    let entries: Record<string, Uint8Array>;
    try {
      entries = unzipSync(file.bytes);
    } catch {
      throw new SkillError('CORRUPT_INPUT', `L’archive ZIP « ${file.name} » est invalide ou corrompue.`);
    }

    const sortedPaths = Object.keys(entries).sort();
    for (const rawEntryPath of sortedPaths) {
      if (rawEntryPath.endsWith('/')) continue;
      const normPath = rawEntryPath.replace(/\\/g, '/');
      const segments = normPath.split('/').filter(Boolean);
      if (segments.length === 0) continue;
      // Ignore macOS / Windows metadata files and hidden dotfiles
      if (
        segments.some((s) => s === '__MACOSX' || s.startsWith('.')) ||
        segments[segments.length - 1] === 'Thumbs.db'
      ) {
        continue;
      }

      const entryBytes = entries[rawEntryPath]!;
      if (entryBytes.byteLength === 0) continue;
      totalUncompressed += entryBytes.byteLength;
      if (totalUncompressed > maxTotalBytes) {
        throw new SkillError(
          'INPUT_TOO_LARGE',
          `L’archive ZIP « ${file.name} » dépasse la taille décompressée maximale autorisée.`,
        );
      }

      const safeRelPath = sanitizeRelativePath(normPath);
      if (!safeRelPath) continue;
      const baseName = sanitizeFileName(segments[segments.length - 1]!, '');
      if (!baseName) continue;

      const entryMime = sniffMime(entryBytes, baseName);
      if (
        entryMime === MIME.markdown ||
        entryMime === MIME.bibtex ||
        (entryMime && isImageMime(entryMime))
      ) {
        const doc: DocumentFile = {
          name: baseName,
          mime: entryMime,
          bytes: entryBytes,
          relativePath: safeRelPath,
        };
        out.push(doc);
        zipExtractedNames.add(safeRelPath);
        zipExtractedNames.add(baseName);
      }
    }
  }

  return { files: out, zipExtractedNames };
}

/**
 * Match a local Markdown image reference (e.g. `./images/schema.png` or `schema.png`)
 * against available deposited / zip-extracted image files.
 */
export function matchImageRefToFile(
  ref: MarkdownImageRef,
  imageFiles: readonly DocumentFile[],
  imageMappings?: Record<string, string>,
  mdRelativePath?: string,
): { file: DocumentFile; matchType: 'manual' | 'exact-path' | 'suffix-path' | 'filename' } | null {
  if (imageFiles.length === 0) return null;

  const normRef = ref.normalizedPath ?? normalizeMarkdownImagePath(ref.src);
  const refBase = ref.basename ?? (normRef.split('/').pop() || '');

  // 1. Check explicit user manual mapping (`imageMappings`)
  if (imageMappings) {
    const manualTarget =
      imageMappings[ref.src] ??
      (normRef ? imageMappings[normRef] : undefined) ??
      (refBase ? imageMappings[refBase] : undefined);
    if (manualTarget) {
      const normManual = sanitizeRelativePath(manualTarget);
      const baseManual = sanitizeFileName(manualTarget, '');
      const matched =
        imageFiles.find((f) => f.relativePath && f.relativePath === normManual) ??
        imageFiles.find((f) => f.name === baseManual || f.name === manualTarget) ??
        imageFiles.find((f) => f.name.toLowerCase() === baseManual.toLowerCase());
      if (matched) {
        return { file: matched, matchType: 'manual' };
      }
    }
  }

  if (!normRef) return null;

  // Determine directory prefix of the .md file if it came from a subfolder in a .zip
  const mdDir =
    mdRelativePath && mdRelativePath.includes('/')
      ? mdRelativePath.slice(0, mdRelativePath.lastIndexOf('/'))
      : '';
  const mdScopedPath = mdDir ? sanitizeRelativePath(`${mdDir}/${normRef}`) : normRef;

  // 2. Exact relativePath match (case-sensitive, then case-insensitive)
  for (const img of imageFiles) {
    if (!img.relativePath) continue;
    if (img.relativePath === normRef || img.relativePath === mdScopedPath) {
      return { file: img, matchType: 'exact-path' };
    }
  }
  const normRefLower = normRef.toLowerCase();
  const mdScopedLower = mdScopedPath.toLowerCase();
  for (const img of imageFiles) {
    if (!img.relativePath) continue;
    const relLower = img.relativePath.toLowerCase();
    if (relLower === normRefLower || relLower === mdScopedLower) {
      return { file: img, matchType: 'exact-path' };
    }
  }

  // 3. Suffix relativePath match (e.g. zip had top-level folder `archive/images/schema.png` and .md had `./images/schema.png`)
  if (normRef.includes('/')) {
    for (const img of imageFiles) {
      if (!img.relativePath) continue;
      if (
        img.relativePath.endsWith(`/${normRef}`) ||
        img.relativePath.toLowerCase().endsWith(`/${normRefLower}`)
      ) {
        return { file: img, matchType: 'suffix-path' };
      }
    }
  }

  // 4. Exact filename (basename) match (case-sensitive, then case-insensitive)
  if (refBase) {
    const exactName = imageFiles.find((f) => f.name === refBase);
    if (exactName) {
      return { file: exactName, matchType: 'filename' };
    }
    const lowerBase = refBase.toLowerCase();
    const ciName = imageFiles.find((f) => f.name.toLowerCase() === lowerBase);
    if (ciName) {
      return { file: ciName, matchType: 'filename' };
    }
  }

  return null;
}

/**
 * Parse and validate a `data:image/...` URI into bytes, MIME type, normalized Data URI, and DocumentFile.
 */
export function parseDataUriImage(
  dataUri: string,
  index: number,
): { mime: string; bytes: Uint8Array; dataUri: string; file: DocumentFile } | null {
  const match = /^data:(image\/(?:png|jpeg|jpg|webp|svg\+xml))(?:;charset=[^;,]+)?(?:;(base64|utf8))?,([\s\S]+)$/i.exec(
    dataUri.trim(),
  );
  if (!match) return null;

  const rawMime = match[1]!.toLowerCase();
  const encoding = (match[2] ?? '').toLowerCase();
  const payload = match[3] ?? '';

  const declaredMime = rawMime === 'image/jpg' ? MIME.jpeg : rawMime;
  let bytes: Uint8Array;
  try {
    if (encoding === 'base64') {
      bytes = base64ToUint8(payload);
    } else {
      const decodedText = decodeURIComponent(payload);
      bytes = new TextEncoder().encode(decodedText);
    }
  } catch {
    return null;
  }

  if (bytes.byteLength === 0) return null;
  const ext = extensionForImageMime(declaredMime);
  const fileName = `data-image-${index}.${ext}`;
  const sniffed = sniffMime(bytes, fileName);
  if (!sniffed || !isImageMime(sniffed)) {
    return null;
  }

  const finalBytes = sniffed === MIME.svg ? sanitizeSvgBytes(bytes) : bytes;
  const normalizedDataUri = bytesToDataUri(finalBytes, sniffed);
  return {
    mime: sniffed,
    bytes: finalBytes,
    dataUri: normalizedDataUri,
    file: {
      name: `data-image-${index}.${extensionForImageMime(sniffed)}`,
      mime: sniffed,
      bytes: finalBytes,
    },
  };
}

/**
 * SSRF guard for remote image URLs.
 * Blocks non-HTTP(S) schemes, embedded credentials, localhost, private RFC1918 networks,
 * link-local / cloud metadata endpoints (169.254.169.254), and IPv6 internal ranges.
 */
export function isSafeRemoteImageUrl(rawUrl: string): { safe: boolean; reason?: string; url?: URL } {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { safe: false, reason: 'URL distante syntaxiquement invalide.' };
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { safe: false, reason: `Protocole non autorisé (${parsed.protocol}) : seul HTTP/HTTPS est permis.` };
  }

  if (parsed.username || parsed.password) {
    return { safe: false, reason: 'Les identifiants intégrés dans les URLs sont interdits.' };
  }

  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!host) {
    return { safe: false, reason: 'Hôte distant manquant.' };
  }

  // Hostname blacklists (localhost, internal domains, cloud metadata)
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host === 'metadata.google.internal' ||
    host === 'metadata' ||
    host === 'instance-data'
  ) {
    return { safe: false, reason: `Hôte local ou interne interdit par la protection SSRF (${host}).` };
  }

  // Reject pure integer, hex or octal IP encodings (e.g. 2130706433 or 0x7f000001)
  if (/^(?:0x[0-9a-f]+|\d+)$/i.test(host)) {
    return { safe: false, reason: `Adresse IP numérique ambiguë interdite (${host}).` };
  }

  // IPv6 loopback, unspecified, unique-local (fc00::/7), link-local (fe80::/10)
  if (host.includes(':')) {
    const normV6 = host.toLowerCase();
    if (
      normV6 === '::1' ||
      normV6 === '::' ||
      normV6.startsWith('fc') ||
      normV6.startsWith('fd') ||
      normV6.startsWith('fe8') ||
      normV6.startsWith('fe9') ||
      normV6.startsWith('fea') ||
      normV6.startsWith('feb') ||
      normV6.startsWith('::ffff:127.') ||
      normV6.startsWith('::ffff:10.') ||
      normV6.startsWith('::ffff:192.168.') ||
      normV6.startsWith('::ffff:169.254.')
    ) {
      return { safe: false, reason: `Adresse IPv6 privée ou locale interdite par la protection SSRF (${host}).` };
    }
  }

  // IPv4 dotted-quad check
  const ipv4Match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (ipv4Match) {
    const octets = [
      Number(ipv4Match[1]),
      Number(ipv4Match[2]),
      Number(ipv4Match[3]),
      Number(ipv4Match[4]),
    ];
    if (octets.some((o) => Number.isNaN(o) || o < 0 || o > 255)) {
      return { safe: false, reason: `Adresse IPv4 invalide (${host}).` };
    }
    const [a, b] = octets as [number, number, number, number];
    if (
      a === 0 || // 0.0.0.0/8
      a === 10 || // 10.0.0.0/8 (RFC 1918)
      a === 127 || // 127.0.0.0/8 (Loopback)
      (a === 169 && b === 254) || // 169.254.0.0/16 (Link-local / Cloud Metadata)
      (a === 172 && b >= 16 && b <= 31) || // 172.16.0.0/12 (RFC 1918)
      (a === 192 && b === 168) || // 192.168.0.0/16 (RFC 1918)
      (a === 100 && b >= 64 && b <= 127) || // 100.64.0.0/10 (CGNAT)
      a >= 224 // Multicast & Reserved
    ) {
      return { safe: false, reason: `Plage IPv4 privée ou réservée bloquée par la protection SSRF (${host}).` };
    }
  }

  return { safe: true, url: parsed };
}

/**
 * Fetch a remote image with SSRF protection, timeout, size ceiling, magic-byte sniffing,
 * clean CORS failure recovery, and in-memory caching.
 */
export async function fetchRemoteImageSafe(
  rawUrl: string,
  index: number,
  opts: {
    maxBytes?: number;
    timeoutMs?: number;
    signal?: AbortSignal;
    fetcher?: typeof fetch;
  } = {},
): Promise<
  | {
      ok: true;
      fromCache: boolean;
      mime: string;
      bytes: Uint8Array;
      dataUri: string;
      file: DocumentFile;
    }
  | {
      ok: false;
      error: string;
    }
> {
  const guard = isSafeRemoteImageUrl(rawUrl);
  if (!guard.safe || !guard.url) {
    return { ok: false, error: guard.reason ?? 'URL bloquée par la politique de sécurité.' };
  }

  const normalizedUrl = guard.url.toString();
  const cached = remoteImageCache.get(normalizedUrl);
  if (cached) {
    const ext = extensionForImageMime(cached.mime);
    return {
      ok: true,
      fromCache: true,
      mime: cached.mime,
      bytes: cached.bytes,
      dataUri: cached.dataUri,
      file: {
        name: `remote-image-${index}.${ext}`,
        mime: cached.mime,
        bytes: cached.bytes,
      },
    };
  }

  const fetchFn = opts.fetcher ?? globalThis.fetch;
  if (typeof fetchFn !== 'function') {
    return { ok: false, error: 'Récupération réseau indisponible dans cet environnement.' };
  }

  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_REMOTE_BYTES;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_REMOTE_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onParentAbort = () => controller.abort();
  opts.signal?.addEventListener('abort', onParentAbort, { once: true });

  try {
    const res = await fetchFn(normalizedUrl, {
      method: 'GET',
      mode: 'cors',
      credentials: 'omit',
      redirect: 'follow',
      signal: controller.signal,
    });

    if (!res.ok) {
      return { ok: false, error: `Échec HTTP ${res.status} lors du chargement de « ${normalizedUrl} ».` };
    }

    // If redirected, verify final URL against SSRF as well
    if (res.url) {
      const redirectGuard = isSafeRemoteImageUrl(res.url);
      if (!redirectGuard.safe) {
        return { ok: false, error: redirectGuard.reason ?? 'Redirection bloquée par la protection SSRF.' };
      }
    }

    const rawBytes = new Uint8Array(await res.arrayBuffer());
    if (rawBytes.byteLength === 0) {
      return { ok: false, error: `L’image distante « ${normalizedUrl} » est vide.` };
    }
    if (rawBytes.byteLength > maxBytes) {
      return { ok: false, error: `L’image distante « ${normalizedUrl} » dépasse la limite de taille.` };
    }

    const urlPathName = sanitizeFileName(guard.url.pathname.split('/').pop() ?? 'remote.png', 'remote.png');
    const contentTypeHeader = (res.headers?.get?.('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
    const hintName =
      contentTypeHeader === MIME.svg && !urlPathName.toLowerCase().endsWith('.svg')
        ? `${urlPathName}.svg`
        : urlPathName;

    const sniffed = sniffMime(rawBytes, hintName);
    if (!sniffed || !isImageMime(sniffed)) {
      return {
        ok: false,
        error: `La ressource distante « ${normalizedUrl} » n’est pas une image valide (PNG, JPEG, WebP ou SVG attendu).`,
      };
    }

    const finalBytes = sniffed === MIME.svg ? sanitizeSvgBytes(rawBytes) : rawBytes;
    const dataUri = bytesToDataUri(finalBytes, sniffed);
    remoteImageCache.set(normalizedUrl, { mime: sniffed, bytes: finalBytes, dataUri });

    const ext = extensionForImageMime(sniffed);
    return {
      ok: true,
      fromCache: false,
      mime: sniffed,
      bytes: finalBytes,
      dataUri,
      file: {
        name: `remote-image-${index}.${ext}`,
        mime: sniffed,
        bytes: finalBytes,
      },
    };
  } catch (err) {
    if (opts.signal?.aborted) {
      throw new SkillError('ABORTED', 'Traitement annulé.');
    }
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      error: `Impossible de récupérer l’image distante « ${normalizedUrl} » (CORS ou réseau : ${msg.slice(0, 120)}).`,
    };
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener('abort', onParentAbort);
  }
}

/**
 * Build a collision-free LaTeX-safe filename (ASCII alphanumeric, hyphens, underscores, dot extension)
 * so `\includegraphics[width=0.85\linewidth]{...}` works reliably across Tectonic, pdflatex and ReportLab.
 */
export function toLatexSafeImageName(preferredName: string, mime: string, index: number, usedNames: Set<string>): string {
  const ext = extensionForImageMime(mime);
  const rawBase = stem(preferredName)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  const base = rawBase || `figure-${index}`;
  let candidate = `${base}.${ext}`;
  let counter = 2;
  while (usedNames.has(candidate.toLowerCase())) {
    candidate = `${base}-${counter}.${ext}`;
    counter++;
  }
  usedNames.add(candidate.toLowerCase());
  return candidate;
}

/**
 * Main entry point: unpacks any `.zip` input, locates the `.md`, `.bib` and image assets,
 * resolves every Markdown image reference (local/deposited, zip, Base64 Data URI, or remote HTTP/HTTPS),
 * preloads Data URIs for HTML print, and prepares collision-free asset files for LaTeX compilation.
 */
export async function resolveMarkdownImages(
  rawFiles: readonly DocumentFile[],
  opts: ResolveMarkdownImagesOptions = {},
): Promise<MarkdownImageResolutionResult> {
  const { files, zipExtractedNames } = expandZipArchives(rawFiles);

  const mdFile = files.find((f) => f.mime === MIME.markdown);
  if (!mdFile) {
    throw new SkillError(
      'INPUT_TYPE',
      'Aucun fichier Markdown (.md) trouvé parmi les fichiers déposés ou dans l’archive .zip.',
    );
  }

  const bibFile = files.find((f) => f.mime === MIME.bibtex);
  const imageFiles = files.filter((f) => isImageMime(f.mime));

  const markdownSource = new TextDecoder().decode(mdFile.bytes);
  const refs = extractMarkdownImageRefs(markdownSource);

  const resolutions = new Map<string, ResolvedMarkdownImage>();
  const latexPathMap: Record<string, string> = {};
  const latexAssetFiles: DocumentFile[] = [];
  const latexAssetByName = new Map<string, DocumentFile>();
  const usedLatexNames = new Set<string>();
  /** Reuse the same LaTeX asset filename when the same underlying DocumentFile is referenced multiple times. */
  const fileToLatexName = new Map<DocumentFile, string>();

  const warnings: string[] = [];
  let resolvedCount = 0;
  let missingCount = 0;
  const bySource = { local: 0, zip: 0, dataUri: 0, remote: 0 };

  let index = 0;
  for (const ref of refs) {
    index++;
    // If we already resolved this exact `src` string in the document, reuse the resolution
    const existing = resolutions.get(ref.src);
    if (existing) {
      if (existing.resolved) {
        resolvedCount++;
        if (existing.kind === 'data-uri') bySource.dataUri++;
        else if (existing.kind === 'remote-url') bySource.remote++;
        else if (existing.matchedFileName && zipExtractedNames.has(existing.matchedFileName)) bySource.zip++;
        else bySource.local++;
      } else {
        missingCount++;
      }
      continue;
    }

    if (ref.kind === 'data-uri') {
      const parsed = parseDataUriImage(ref.src, index);
      if (parsed) {
        const latexName = toLatexSafeImageName(parsed.file.name, parsed.mime, index, usedLatexNames);
        const latexFile: DocumentFile = {
          name: latexName,
          mime: parsed.mime,
          bytes: parsed.bytes,
        };
        latexAssetFiles.push(latexFile);
        latexAssetByName.set(latexName, latexFile);
        latexPathMap[ref.src] = latexName;

        resolutions.set(ref.src, {
          src: ref.src,
          kind: 'data-uri',
          resolved: true,
          matchType: 'data-uri',
          mime: parsed.mime,
          bytes: parsed.bytes,
          dataUri: parsed.dataUri,
          latexFile,
        });
        resolvedCount++;
        bySource.dataUri++;
      } else {
        const err = 'Data URI Base64 invalide ou format d’image non reconnu.';
        warnings.push(err);
        resolutions.set(ref.src, {
          src: ref.src,
          kind: 'data-uri',
          resolved: false,
          error: err,
        });
        missingCount++;
      }
      continue;
    }

    if (ref.kind === 'remote-url') {
      if (opts.fetchRemote === false) {
        const err = `Chargement des images distantes désactivé (${ref.src}).`;
        warnings.push(err);
        resolutions.set(ref.src, {
          src: ref.src,
          kind: 'remote-url',
          resolved: false,
          error: err,
        });
        missingCount++;
        continue;
      }

      const remoteRes = await fetchRemoteImageSafe(ref.src, index, {
        maxBytes: opts.maxRemoteBytes,
        timeoutMs: opts.remoteTimeoutMs,
        signal: opts.signal,
        fetcher: opts.fetcher,
      });

      if (remoteRes.ok) {
        const latexName = toLatexSafeImageName(remoteRes.file.name, remoteRes.mime, index, usedLatexNames);
        const latexFile: DocumentFile = {
          name: latexName,
          mime: remoteRes.mime,
          bytes: remoteRes.bytes,
        };
        latexAssetFiles.push(latexFile);
        latexAssetByName.set(latexName, latexFile);
        latexPathMap[ref.src] = latexName;

        resolutions.set(ref.src, {
          src: ref.src,
          kind: 'remote-url',
          resolved: true,
          matchType: remoteRes.fromCache ? 'remote-cache' : 'remote-fetch',
          mime: remoteRes.mime,
          bytes: remoteRes.bytes,
          dataUri: remoteRes.dataUri,
          latexFile,
        });
        resolvedCount++;
        bySource.remote++;
      } else {
        warnings.push(remoteRes.error);
        resolutions.set(ref.src, {
          src: ref.src,
          kind: 'remote-url',
          resolved: false,
          error: remoteRes.error,
        });
        missingCount++;
      }
      continue;
    }

    // Local relative path or filename reference
    const matched = matchImageRefToFile(ref, imageFiles, opts.imageMappings, mdFile.relativePath);
    if (matched) {
      const { file: imgFile, matchType } = matched;
      const safeBytes = imgFile.mime === MIME.svg ? sanitizeSvgBytes(imgFile.bytes) : imgFile.bytes;
      const dataUri = bytesToDataUri(safeBytes, imgFile.mime);

      let latexName = fileToLatexName.get(imgFile);
      if (!latexName) {
        latexName = toLatexSafeImageName(imgFile.name, imgFile.mime, index, usedLatexNames);
        fileToLatexName.set(imgFile, latexName);
        const latexFile: DocumentFile = {
          name: latexName,
          mime: imgFile.mime,
          bytes: safeBytes,
          ...(imgFile.relativePath ? { relativePath: imgFile.relativePath } : {}),
        };
        latexAssetFiles.push(latexFile);
        latexAssetByName.set(latexName, latexFile);
      }
      const latexFile = latexAssetByName.get(latexName)!;
      latexPathMap[ref.src] = latexName;

      const matchedKey = imgFile.relativePath ?? imgFile.name;
      resolutions.set(ref.src, {
        src: ref.src,
        kind: 'local-path',
        resolved: true,
        matchType,
        mime: imgFile.mime,
        bytes: safeBytes,
        dataUri,
        latexFile,
        matchedFileName: matchedKey,
      });
      resolvedCount++;
      if (zipExtractedNames.has(matchedKey) || zipExtractedNames.has(imgFile.name)) {
        bySource.zip++;
      } else {
        bySource.local++;
      }
    } else {
      const err = `Image locale non résolue : « ${ref.src} » (déposez le fichier « ${ref.basename || ref.src} » ou associez-le manuellement).`;
      warnings.push(err);
      resolutions.set(ref.src, {
        src: ref.src,
        kind: 'local-path',
        resolved: false,
        error: err,
      });
      missingCount++;
    }
  }

  return {
    mdFile,
    ...(bibFile ? { bibFile } : {}),
    imageFiles,
    refs,
    resolutions,
    latexPathMap,
    latexAssetFiles,
    stats: {
      totalImages: refs.length,
      resolvedImages: resolvedCount,
      missingImages: missingCount,
      bySource,
    },
    warnings,
  };
}
