import { describe, expect, it } from 'vitest';
import { parseOptions, runSkill, SkillRegistry, validateInputs } from '@folio/skills-core';
import { localSkills } from '@folio/skills-local';
import { remoteSkills } from '@folio/skills-remote';
import { buildErrorDiagnostic } from '../src/features/error-help/error-help-modal.ts';
import { extractDefaultValues } from '../src/features/tool-panel/form-renderer.ts';
import { createSpecimenForSkill } from '../src/specimen.ts';

const registry = new SkillRegistry().registerAll([...localSkills, ...remoteSkills]);

describe('@folio/web specimens & error diagnostic guides', () => {
  it('provides a valid, executable specimen bundle (files + presetOptions) for every skill', async () => {
    for (const skill of [...localSkills, ...remoteSkills]) {
      const bundle = await createSpecimenForSkill(skill.id);
      const validatedFiles = validateInputs(bundle.files, skill.input);
      expect(validatedFiles.length).toBeGreaterThanOrEqual(skill.input.minFiles);
      expect(validatedFiles.length).toBeLessThanOrEqual(skill.input.maxFiles);

      const mergedOptions = {
        ...extractDefaultValues(skill),
        ...(bundle.presetOptions ?? {}),
      };
      const parsedOpts = parseOptions(skill, mergedOptions);
      expect(parsedOpts).toBeDefined();

      // Run all non-pdfjs/non-network skills end-to-end with their specimen bundle
      if (skill.execution === 'local' && skill.id !== 'pdf.extract') {
        const res = await runSkill(skill, bundle.files, mergedOptions);
        expect(res.files.length).toBeGreaterThan(0);
      }
    }
  });

  it('builds contextual error explanations and working examples for all error types', () => {
    const split = registry.get('pdf.split');
    const typeDiag = buildErrorDiagnostic(
      'INPUT_TYPE',
      '« notes.md » n’est pas d’un type accepté.',
      split,
    );
    expect(typeDiag.title).toContain('Scinder');
    expect(typeDiag.why).toContain('magic bytes');
    expect(typeDiag.workingExampleDetails.length).toBeGreaterThan(0);

    const optDiag = buildErrorDiagnostic(
      'INVALID_OPTIONS',
      'Indiquez au moins une plage de pages.',
      split,
    );
    expect(optDiag.workingExampleDetails.some((d) => d.includes('1-2, 3'))).toBe(true);
  });
});
