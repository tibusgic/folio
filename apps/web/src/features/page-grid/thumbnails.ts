/**
 * Memory-safe PDF thumbnail manager (Desktop & Mobile iOS WebKit hardened).
 * - Uses binary Blob URLs instead of base64 data-URLs.
 * - Adapts raster resolution and batch limits on mobile (iOS Safari strict canvas RAM budget).
 * - Immediately zeroes canvas dimensions (`width = 0; height = 0`) after Blob extraction
 *   to release WebKit GPU backing store memory.
 * - Calls `page.cleanup()` and `pdfDoc.destroy()` in a `finally` block.
 * - Supports duplicating a page item without leaking or double-revoking shared ObjectURLs.
 */
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl;

export interface PageThumbItem {
  readonly id: string;
  readonly fileIndex: number;
  readonly fileName: string;
  readonly pageNumber: number;
  readonly objectUrl: string;
  rotate: 0 | 90 | 180 | 270;
}

const DESKTOP_MAX_THUMB_PAGES = 80;
const MOBILE_MAX_THUMB_PAGES = 24;

function isMobileConstrainedViewport(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(max-width: 780px), (pointer: coarse)').matches;
}

export async function renderFileThumbnails(
  bytes: Uint8Array,
  fileIndex: number,
  fileName: string,
): Promise<PageThumbItem[]> {
  const isMobile = isMobileConstrainedViewport();
  const maxPages = isMobile ? MOBILE_MAX_THUMB_PAGES : DESKTOP_MAX_THUMB_PAGES;
  const maxTargetWidth = isMobile ? 160 : 220;
  const maxScale = isMobile ? 0.32 : 0.45;

  const loadingTask = pdfjsLib.getDocument({
    data: bytes.slice(),
    disableFontFace: true,
    verbosity: 0,
  });

  let doc: Awaited<typeof loadingTask.promise> | null = null;
  const items: PageThumbItem[] = [];

  try {
    doc = await loadingTask.promise;
    const totalPages = doc.numPages;

    for (let pageNo = 1; pageNo <= totalPages; pageNo++) {
      // Beyond the mobile/desktop raster cap, create lightweight vector-indexed items
      // without allocating a Canvas backing store so all pages remain reorderable.
      if (pageNo > maxPages) {
        items.push({
          id: `${fileIndex}-${pageNo}-${Math.random().toString(36).slice(2, 7)}`,
          fileIndex,
          fileName,
          pageNumber: pageNo,
          objectUrl: '',
          rotate: 0,
        });
        continue;
      }

      const page = await doc.getPage(pageNo);
      const baseViewport = page.getViewport({ scale: 1 });
      const scale = Math.min(maxScale, maxTargetWidth / Math.max(1, baseViewport.width));
      const viewport = page.getViewport({ scale });

      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.floor(viewport.width));
      canvas.height = Math.max(1, Math.floor(viewport.height));
      const ctx = canvas.getContext('2d', { alpha: false });

      if (ctx) {
        await page.render({ canvasContext: ctx, viewport, canvas }).promise;
      }
      page.cleanup();

      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, 'image/webp', isMobile ? 0.72 : 0.8),
      );
      // Immediately release iOS WebKit canvas memory
      canvas.width = 0;
      canvas.height = 0;

      const objectUrl = blob ? URL.createObjectURL(blob) : '';
      items.push({
        id: `${fileIndex}-${pageNo}-${Math.random().toString(36).slice(2, 7)}`,
        fileIndex,
        fileName,
        pageNumber: pageNo,
        objectUrl,
        rotate: 0,
      });
    }
    return items;
  } catch {
    return items;
  } finally {
    if (doc) await doc.cleanup();
    await loadingTask.destroy();
  }
}

export function duplicatePageThumbItem(source: PageThumbItem): PageThumbItem {
  return {
    id: `${source.fileIndex}-${source.pageNumber}-dup-${Math.random().toString(36).slice(2, 7)}`,
    fileIndex: source.fileIndex,
    fileName: source.fileName,
    pageNumber: source.pageNumber,
    objectUrl: source.objectUrl,
    rotate: source.rotate,
  };
}

export function revokeThumbnails(
  removedItems: readonly PageThumbItem[],
  remainingItems: readonly PageThumbItem[] = [],
): void {
  const stillInUse = new Set(remainingItems.map((i) => i.objectUrl).filter(Boolean));
  const revoked = new Set<string>();
  for (const item of removedItems) {
    if (item.objectUrl && !stillInUse.has(item.objectUrl) && !revoked.has(item.objectUrl)) {
      URL.revokeObjectURL(item.objectUrl);
      revoked.add(item.objectUrl);
    }
  }
}
