import { PDFDocument, degrees, type PDFPage } from 'pdf-lib';
import { z } from 'zod';
import { defineSkill, MIME, SkillError, stem } from '@folio/skills-core';
import { loadPdf, MB, pdfOutput, throwIfAborted } from '../util/pdf.ts';

const planEntry = z.object({
  file: z.number().int().min(-1),
  page: z.number().int().min(0),
  rotate: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).default(0),
  blank: z.boolean().optional(),
});

export type PagePlanEntry = z.input<typeof planEntry>;

/**
 * Merge, reorder, rotate, insert blank pages and delete pages across one or more PDFs.
 * The page plan is produced by the page grid; without a plan every page of
 * every file is appended in order (classic merge).
 */
export const assembleSkill = defineSkill({
  id: 'pdf.assemble',
  version: '2.0.0',
  title: 'Assembler',
  summary: 'Fusionner, réordonner, pivoter, insérer des pages blanches ou retirer des pages issues de plusieurs PDF.',
  category: 'assemble',
  execution: 'local',
  output: 'pdf',
  usesPagePlan: true,
  modes: ['quick', 'enterprise'],
  input: { mimes: [MIME.pdf], minFiles: 1, maxFiles: 50, maxBytesPerFile: 500 * MB },
  options: z.object({
    plan: z.array(planEntry).min(1).max(5000).optional(),
    outputName: z.string().trim().max(120).default(''),
  }),
  fields: [
    { kind: 'text', key: 'outputName', label: 'Nom du fichier', placeholder: 'assemblage.pdf', advanced: true, maxLength: 120 },
  ],
  async run(files, options, ctx) {
    const sources = [];
    for (const f of files) {
      throwIfAborted(ctx.signal);
      sources.push(await loadPdf(f));
    }

    const plan =
      options.plan ??
      sources.flatMap((doc, file) =>
        doc.getPageIndices().map((i) => ({ file, page: i + 1, rotate: 0 as const, blank: false })),
      );

    for (const entry of plan) {
      if (entry.blank || entry.file === -1) continue;
      const src = sources[entry.file];
      if (!src) throw new SkillError('INVALID_OPTIONS', `Plan de pages : fichier #${entry.file + 1} absent.`);
      if (entry.page < 1 || entry.page > src.getPageCount()) {
        throw new SkillError('INVALID_OPTIONS', `Plan de pages : page ${entry.page} absente de « ${files[entry.file]!.name} ».`);
      }
    }

    const firstSourcePage = sources[0]?.getPages()[0];
    const defaultSize: [number, number] = firstSourcePage
      ? [firstSourcePage.getSize().width, firstSourcePage.getSize().height]
      : [595.28, 841.89];

    // Copy all pages needed from a given source in ONE copyPages call so that
    // shared resources (fonts, images) are copied once instead of per page.
    const out = await PDFDocument.create();
    const copied = new Map<string, PDFPage[]>();
    for (let fileIndex = 0; fileIndex < sources.length; fileIndex++) {
      const wanted = plan
        .filter((e) => !e.blank && e.file === fileIndex)
        .map((e) => e.page - 1);
      if (!wanted.length) continue;
      const pages = await out.copyPages(sources[fileIndex]!, wanted);
      wanted.forEach((pageIdx, k) => {
        const key = `${fileIndex}:${pageIdx}`;
        copied.set(key, [...(copied.get(key) ?? []), pages[k]!]);
      });
      ctx.progress((fileIndex + 1) / sources.length / 2, `copie ${files[fileIndex]!.name}`);
    }

    let blankCount = 0;
    plan.forEach((entry, i) => {
      if (entry.blank || entry.file === -1) {
        const blankPage = out.addPage(defaultSize);
        if (entry.rotate) blankPage.setRotation(degrees(entry.rotate % 360));
        blankCount++;
      } else {
        const page = copied.get(`${entry.file}:${entry.page - 1}`)!.shift()!;
        if (entry.rotate) page.setRotation(degrees((page.getRotation().angle + entry.rotate) % 360));
        out.addPage(page);
      }
      if (i % 50 === 0) ctx.progress(0.5 + (i / plan.length) / 2);
    });

    out.setProducer('Folio');
    out.setCreator('Folio · pdf.assemble');
    ctx.log('info', `assembled ${plan.length} page(s) from ${files.length} file(s)`, { blankPages: blankCount });

    const name = options.outputName || (files.length === 1 ? `${stem(files[0]!.name)}-organise` : 'assemblage');
    return {
      files: [await pdfOutput(out, name)],
      report: { pages: plan.length, sources: files.length, blankPages: blankCount },
    };
  },
});
