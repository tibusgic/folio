import type { Skill } from '@folio/skills-core';
import { assembleSkill } from './pdf/assemble.ts';
import { splitSkill } from './pdf/split.ts';
import { pageNumbersSkill } from './pdf/page-numbers.ts';
import { imagesToPdfSkill } from './pdf/images-to-pdf.ts';
import { cropMarginsSkill } from './pdf/crop.ts';
import { watermarkSkill } from './pdf/watermark.ts';
import { signatureSkill } from './pdf/signature.ts';
import { redactSkill } from './pdf/redact.ts';
import { inspectSkill, metadataSkill } from './pdf/metadata.ts';
import { extractSkill } from './extract/skill.ts';
import { markdownPrintSkill } from './markdown/skill.ts';

export const localSkills: readonly Skill<any>[] = [
  assembleSkill,
  splitSkill,
  pageNumbersSkill,
  markdownPrintSkill,
  imagesToPdfSkill,
  cropMarginsSkill,
  extractSkill,
  watermarkSkill,
  signatureSkill,
  redactSkill,
  inspectSkill,
  metadataSkill,
];

export {
  assembleSkill,
  splitSkill,
  pageNumbersSkill,
  imagesToPdfSkill,
  cropMarginsSkill,
  watermarkSkill,
  signatureSkill,
  redactSkill,
  inspectSkill,
  metadataSkill,
  extractSkill,
  markdownPrintSkill,
};
export { analyzePages, toMarkdown, bodySize, type PageText, type TextRun, type Block } from './extract/structure.ts';
export { setPdfjsLoader } from './extract/pdfjs.ts';
export { renderMarkdownDocument, slugify, escapeHtml } from './markdown/render.ts';
export { parseFrontMatter, asList, asText, type FrontMatter } from './markdown/frontmatter.ts';
export { strokesToSvgPath } from './pdf/signature.ts';
export { visualFrame } from './util/pdf.ts';
