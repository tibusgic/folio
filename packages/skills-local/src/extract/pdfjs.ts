import { SkillError } from '@folio/skills-core';
import type { PageText, TextRun } from './structure.ts';

type Pdfjs = typeof import('pdfjs-dist');

/**
 * pdf.js must be configured differently in a browser worker (workerSrc) and in
 * Node (legacy build). Hosts inject the loader; the default is the browser build.
 */
let loader: () => Promise<Pdfjs> = () => import('pdfjs-dist');

export function setPdfjsLoader(fn: () => Promise<Pdfjs>): void {
  loader = fn;
}

export async function readPageTexts(bytes: Uint8Array, pageIndices: readonly number[] | null, signal: AbortSignal): Promise<{ pageCount: number; pages: PageText[] }> {
  const pdfjs = await loader();
  // pdf.js transfers the buffer to its worker: hand it a copy, keep the caller's bytes intact.
  const task = pdfjs.getDocument({
    data: bytes.slice(),
    disableFontFace: true,
    useSystemFonts: false,
    verbosity: 0,
  });
  let doc: Awaited<typeof task.promise> | undefined;
  try {
    doc = await task.promise;
    const indices = pageIndices ?? Array.from({ length: doc.numPages }, (_, i) => i);
    const pages: PageText[] = [];
    for (const idx of indices) {
      if (signal.aborted) throw new SkillError('ABORTED', 'Traitement annulé.');
      const page = await doc.getPage(idx + 1);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      const runs: TextRun[] = [];
      for (const item of content.items) {
        if (!('str' in item) || !item.str) continue;
        const [, , c, d, e, f] = item.transform as number[];
        runs.push({ str: item.str, x: e!, y: f!, width: item.width, fontSize: Math.hypot(c!, d!) || item.height });
      }
      pages.push({ number: idx + 1, width: viewport.width, height: viewport.height, runs });
      page.cleanup();
    }
    return { pageCount: doc.numPages, pages };
  } catch (error) {
    if (error instanceof SkillError) throw error;
    if ((error as { name?: string })?.name === 'PasswordException') {
      throw new SkillError('ENCRYPTED_INPUT', 'Document protégé par mot de passe.');
    }
    throw new SkillError('CORRUPT_INPUT', 'Impossible de lire le texte de ce PDF.', { internal: String(error).slice(0, 200) });
  } finally {
    // Always release pdf.js memory (page caches, font data, worker-side objects).
    if (doc) await doc.cleanup();
    await task.destroy();
  }
}
