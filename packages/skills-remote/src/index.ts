import type { Skill } from '@folio/skills-core';
import { markdownLatexSkill, markdownToLatex, escapeLatex, assertSafeLatexFragment, type LatexRenderOptions, type LatexBundle } from './latex.ts';
import { compressSkill } from './compress.ts';
import { encryptSkill, unlockSkill } from './encrypt.ts';
import { ocrSkill } from './ocr.ts';
import { setRemoteApiBase, getRemoteApiBase, callRemoteSkill } from './transport.ts';

export const remoteSkills: readonly Skill<any>[] = [
  markdownLatexSkill,
  compressSkill,
  encryptSkill,
  unlockSkill,
  ocrSkill,
];

export {
  markdownLatexSkill,
  markdownToLatex,
  escapeLatex,
  assertSafeLatexFragment,
  compressSkill,
  encryptSkill,
  unlockSkill,
  ocrSkill,
  setRemoteApiBase,
  getRemoteApiBase,
  callRemoteSkill,
  type LatexRenderOptions,
  type LatexBundle,
};
