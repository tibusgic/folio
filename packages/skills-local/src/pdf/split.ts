import { PDFDocument } from 'pdf-lib';
import { z } from 'zod';
import { defineSkill, MIME, parsePageRanges, SkillError, stem } from '@folio/skills-core';
import { loadPdf, MB, pdfOutput, throwIfAborted } from '../util/pdf.ts';

export const splitSkill = defineSkill({
  id: 'pdf.split',
  version: '2.0.0',
  title: 'Scinder',
  summary: 'Extraire des plages de pages ou découper un document en parts égales.',
  category: 'assemble',
  execution: 'local',
  output: 'pdf',
  modes: ['quick', 'enterprise'],
  input: { mimes: [MIME.pdf], minFiles: 1, maxFiles: 1, maxBytesPerFile: 500 * MB },
  options: z.object({
    mode: z.enum(['ranges', 'every']).default('ranges'),
    ranges: z.string().trim().max(500).default(''),
    every: z.number().int().min(1).max(1000).default(1),
  }),
  fields: [
    {
      kind: 'select',
      key: 'mode',
      label: 'Méthode',
      options: [
        { value: 'ranges', label: 'Par plages' },
        { value: 'every', label: 'Toutes les N pages' },
      ],
    },
    { kind: 'pages', key: 'ranges', label: 'Plages', placeholder: '1-3, 5, 8-', help: 'Un fichier par plage. « 8- » va jusqu’à la fin.', showIf: { key: 'mode', equals: 'ranges' } },
    { kind: 'number', key: 'every', label: 'Pages par fichier', min: 1, max: 1000, showIf: { key: 'mode', equals: 'every' } },
  ],
  async run(files, options, ctx) {
    const file = files[0]!;
    const src = await loadPdf(file);
    const count = src.getPageCount();

    let groups: number[][];
    if (options.mode === 'every') {
      groups = [];
      for (let i = 0; i < count; i += options.every) {
        groups.push(Array.from({ length: Math.min(options.every, count - i) }, (_, k) => i + k));
      }
    } else {
      if (!options.ranges) throw new SkillError('INVALID_OPTIONS', 'Indiquez au moins une plage de pages.');
      groups = parsePageRanges(options.ranges, count);
    }

    const base = stem(file.name);
    const pad = String(groups.length).length;
    const outputs = [];
    for (const [i, group] of groups.entries()) {
      throwIfAborted(ctx.signal);
      const out = await PDFDocument.create();
      (await out.copyPages(src, group)).forEach((p) => out.addPage(p));
      out.setProducer('Folio');
      const label = group.length === 1 ? `p${group[0]! + 1}` : `p${group[0]! + 1}-${group.at(-1)! + 1}`;
      outputs.push(await pdfOutput(out, `${base}-${String(i + 1).padStart(pad, '0')}-${label}`));
      ctx.progress((i + 1) / groups.length);
    }
    ctx.log('info', `split into ${outputs.length} file(s)`, { pageCount: count });
    return { files: outputs, report: { parts: outputs.length, sourcePages: count } };
  },
});
