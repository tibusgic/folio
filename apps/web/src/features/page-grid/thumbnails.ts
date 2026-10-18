/**
 * Memory-safe PDF thumbnail manager.
 * Fixes audit issue A2:
 * - Uses binary Blob URLs instead of huge base64 data-URLs.
 * - Caps thumbnail raster width to 220px.
 * - Calls `page.cleanup()` and `pdfDoc.destroy()` in a `finally` block.
 * - Exposes `revokeThumbnails()` to release all ObjectURLs on reset.
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

const MAX_THUMB_PAGES_PER_FILE = 80;

export async function renderFileThumbnails(
  bytes: Uint8Array,
  fileIndex: number,
  fileName: string,
): Promise<PageThumbItem[]> {
  const loadingTask = pdfjsLib.getDocument({
    data: bytes.slice(),
    disableFontFace: true,
    verbosity: 0,
  });

  let doc: Awaited<typeof loadingTask.promise> | null = null;
  const items: PageThumbItem[] = [];

  try {
    doc = await loadingTask.promise;
    const count = Math.min(doc.numPages, MAX_THUMB_PAGES_PER_FILE);

    for (let pageNo = 1; pageNo <= count; pageNo++) {
      const page = await doc.getPage(pageNo);
      const baseViewport = page.getViewport({ scale: 1 });
      const scale = Math.min(0.45, 220 / Math.max(1, baseViewport.width));
      const viewport = page.getViewport({ scale });

      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.floor(viewport.width));
      canvas.height = Math.max(1, Math.floor(viewport.height));
      const ctx = canvas.getContext('2d', { alpha: false });

      if (ctx) {
        await page.render({ canvasContext: ctx, viewport, canvas }).promise;
      }
      page.cleanup();

      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.8));
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

export function revokeThumbnails(items: readonly PageThumbItem[]): void {
  for (const item of items) {
    if (item.objectUrl) {
      URL.revokeObjectURL(item.objectUrl);
    }
  }
}
