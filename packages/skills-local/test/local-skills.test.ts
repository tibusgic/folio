import { describe, expect, it } from 'vitest';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { MIME, runSkill } from '@folio/skills-core';
import {
  analyzePages,
  assembleSkill,
  inspectSkill,
  markdownPrintSkill,
  metadataSkill,
  signatureSkill,
  splitSkill,
  toMarkdown,
  watermarkSkill,
} from '../src/index.ts';

async function makeSamplePdf(pageCount: number, title = 'Sample'): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(title);
  doc.setAuthor('Test Suite');
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= pageCount; i++) {
    const page = doc.addPage([400, 600]);
    page.drawText(`Page ${i}`, { x: 50, y: 500, size: 14, font });
  }
  return doc.save();
}

describe('@folio/skills-local', () => {
  it('assembles, reorders and rotates pages across multiple PDFs', async () => {
    const pdfA = await makeSamplePdf(2, 'Doc A');
    const pdfB = await makeSamplePdf(2, 'Doc B');

    const res = await runSkill(
      assembleSkill,
      [
        { name: 'a.pdf', mime: MIME.pdf, bytes: pdfA },
        { name: 'b.pdf', mime: MIME.pdf, bytes: pdfB },
      ],
      {
        plan: [
          { file: 1, page: 2, rotate: 90 },
          { file: 0, page: 1, rotate: 0 },
        ],
        outputName: 'custom-merge',
      },
    );

    expect(res.files).toHaveLength(1);
    expect(res.files[0]?.name).toBe('custom-merge.pdf');
    const merged = await PDFDocument.load(res.files[0]!.bytes);
    expect(merged.getPageCount()).toBe(2);
    expect(merged.getPage(0).getRotation().angle).toBe(90);
  });

  it('splits a PDF by explicit ranges', async () => {
    const pdf = await makeSamplePdf(5);
    const res = await runSkill(
      splitSkill,
      [{ name: 'five.pdf', mime: MIME.pdf, bytes: pdf }],
      { mode: 'ranges', ranges: '1-2, 4-5' },
    );

    expect(res.files).toHaveLength(2);
    const part1 = await PDFDocument.load(res.files[0]!.bytes);
    const part2 = await PDFDocument.load(res.files[1]!.bytes);
    expect(part1.getPageCount()).toBe(2);
    expect(part2.getPageCount()).toBe(2);
  });

  it('applies vector watermarks and audit SHA-256 footers', async () => {
    const pdf = await makeSamplePdf(2);
    const res = await runSkill(
      watermarkSkill,
      [{ name: 'contract.pdf', mime: MIME.pdf, bytes: pdf }],
      {
        text: 'CONFIDENTIEL — ÉPREUVE',
        layout: 'stamp',
        auditStamp: true,
      },
    );

    expect(res.files).toHaveLength(1);
    expect(res.record.report?.sourceSha256).toBeTypeOf('string');
    const outDoc = await PDFDocument.load(res.files[0]!.bytes);
    expect(outDoc.getPageCount()).toBe(2);
  });

  it('renders a smoothed vector signature onto target pages', async () => {
    const pdf = await makeSamplePdf(2);
    const res = await runSkill(
      signatureSkill,
      [{ name: 'accord.pdf', mime: MIME.pdf, bytes: pdf }],
      {
        signerName: 'Claire Moreau',
        reason: 'Validation finale',
        strokes: [
          [
            [0.1, 0.5],
            [0.4, 0.2],
            [0.8, 0.6],
          ],
        ],
        pageTarget: 'last',
        timestamp: true,
      },
    );

    expect(res.files).toHaveLength(1);
    expect(res.record.report?.drawn).toBe(true);
  });

  it('inspects PDF metadata and strips Info/XMP dictionaries on request', async () => {
    const pdf = await makeSamplePdf(1, 'Confidentiel');
    const inspected = await runSkill(
      inspectSkill,
      [{ name: 'meta.pdf', mime: MIME.pdf, bytes: pdf }],
      {},
    );
    expect((inspected.record.report?.info as { title?: string })?.title).toBe('Confidentiel');

    const stripped = await runSkill(
      metadataSkill,
      [{ name: 'meta.pdf', mime: MIME.pdf, bytes: pdf }],
      { strip: true },
    );
    const reInspected = await runSkill(
      inspectSkill,
      [{ name: 'clean.pdf', mime: MIME.pdf, bytes: stripped.files[0]!.bytes }],
      {},
    );
    expect((reInspected.record.report?.info as { title?: string })?.title).toBeUndefined();
  });

  it('reconstructs headings, lists and aligned tables from positioned text runs', () => {
    const blocks = analyzePages([
      {
        number: 1,
        width: 595,
        height: 842,
        runs: [
          { str: 'Rapport Annuel', x: 50, y: 780, width: 140, fontSize: 18 },
          { str: 'Introduction générale au bilan.', x: 50, y: 730, width: 200, fontSize: 10 },
          { str: '• Premier point clé', x: 50, y: 690, width: 120, fontSize: 10 },
          { str: '• Second point clé', x: 50, y: 674, width: 120, fontSize: 10 },
          { str: 'Trimestre', x: 50, y: 620, width: 60, fontSize: 10 },
          { str: 'Revenu', x: 200, y: 620, width: 50, fontSize: 10 },
          { str: 'T1', x: 50, y: 604, width: 20, fontSize: 10 },
          { str: '120 k€', x: 200, y: 604, width: 45, fontSize: 10 },
        ],
      },
    ]);

    const md = toMarkdown(blocks);
    expect(md).toContain('# Rapport Annuel');
    expect(md).toContain('- Premier point clé');
    expect(md).toContain('| Trimestre | Revenu |');
    expect(md).toContain('| T1 | 120 k€ |');
  });

  it('renders Markdown to paginated HTML with MathML equations and blocks raw HTML XSS', async () => {
    const mdSource = `---
title: Étude Académique
author: Pr. Laurent
date: 2026-10-18
---

# Section Principale

Formule d'Euler : $e^{i\\pi} + 1 = 0$.

<script>alert("xss")</script>

$$
\\int_0^\\infty e^{-x^2} dx = \\frac{\\sqrt{\\pi}}{2}
$$
`;
    const res = await runSkill(
      markdownPrintSkill,
      [{ name: 'article.md', mime: MIME.markdown, bytes: new TextEncoder().encode(mdSource) }],
      { paper: 'A4', theme: 'editorial', toc: true, numberSections: true, pageNumbers: true },
    );

    const html = new TextDecoder().decode(res.files[0]!.bytes);
    expect(html).toContain('Étude Académique');
    expect(html).toContain('<math');
    expect(html).toContain('break-inside: avoid');
    expect(html).not.toContain('<script>alert("xss")</script>');
  });
});
