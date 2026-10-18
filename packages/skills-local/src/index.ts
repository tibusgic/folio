import type { Skill } from '@folio/skills-core';
import { assembleSkill } from './pdf/assemble.ts';
import { splitSkill } from './pdf/split.ts';
import { watermarkSkill } from './pdf/watermark.ts';
import { signatureSkill } from './pdf/signature.ts';
import { inspectSkill, metadataSkill } from './pdf/metadata.ts';
import { extractSkill } from './extract/skill.ts';
import { markdownPrintSkill } from './markdown/skill.ts';

export const localSkills: readonly Skill<any>[] = [
  assembleSkill,
  splitSkill,
  markdownPrintSkill,
  extractSkill,
  watermarkSkill,
  signatureSkill,
  inspectSkill,
  metadataSkill,
];

export { assembleSkill, splitSkill, watermarkSkill, signatureSkill, inspectSkill, metadataSkill, extractSkill, markdownPrintSkill };
export { analyzePages, toMarkdown, bodySize, type PageText, type TextRun, type Block } from './extract/structure.ts';
export { setPdfjsLoader } from './extract/pdfjs.ts';
export { renderMarkdownDocument, slugify, escapeHtml } from './markdown/render.ts';
export { parseFrontMatter, asList, asText, type FrontMatter } from './markdown/frontmatter.ts';
export { strokesToSvgPath } from './pdf/signature.ts';
export { visualFrame } from './util/pdf.ts';
