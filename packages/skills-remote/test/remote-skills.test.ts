import { describe, expect, it } from 'vitest';
import { MIME, runSkill, SkillError } from '@folio/skills-core';
import { markdownLatexSkill, markdownToLatex } from '../src/index.ts';

describe('@folio/skills-remote (Markdown -> LaTeX pipeline)', () => {
  it('compiles Markdown with YAML front-matter, math, tables and citations into complete LaTeX', () => {
    const md = `---
title: Cryptographie Documentaire
subtitle: Preuves formelles
author:
  - Alice Bernard
  - Marc Mercier
date: 2026-10-18
abstract: Analyse des propriétés de résistance aux collisions.
---

# Cadre formel

D'après les travaux fondateurs [@shannon1949; @diffie1976, p. 12], l'entropie $H(X)$ vérifie :

$$
H(X) = -\\sum_{i=1}^n P(x_i) \\log_2 P(x_i)
$$

| Algorithme | Taille de bloc | Sécurité |
| --- | --- | --- |
| AES-256 | 128 bits | 256 bits |
| SHA-256 | 512 bits | 256 bits |
`;

    const bundle = markdownToLatex(md, {
      documentClass: 'article',
      paper: 'a4paper',
      fontSize: '11pt',
      toc: true,
      numberSections: true,
      bibliographyStyle: 'plainnat',
    });

    expect(bundle.tex).toContain('\\documentclass[11pt,a4paper]{article}');
    expect(bundle.tex).toContain('\\title{Cryptographie Documentaire\\\\[0.4em]\\large Preuves formelles}');
    expect(bundle.tex).toContain('Alice Bernard \\and Marc Mercier');
    expect(bundle.tex).toContain('\\begin{abstract}');
    expect(bundle.tex).toContain('\\cite[p. 12]{shannon1949,diffie1976}');
    expect(bundle.tex).toContain('\\toprule');
    expect(bundle.tex).toContain('AES-256 & 128 bits & 256 bits \\\\');
    expect(bundle.equations).toBe(2);
    expect(bundle.tables).toBe(1);
    expect(bundle.citations).toEqual(['shannon1949', 'diffie1976']);
  });

  it('rejects dangerous LaTeX shell-escape or file-inclusion macros', () => {
    const maliciousMd = `# Test\n\n$$\\write18{cat /etc/passwd}$$\n`;
    expect(() =>
      markdownToLatex(maliciousMd, {
        documentClass: 'article',
        paper: 'a4paper',
        fontSize: '11pt',
        toc: false,
        numberSections: true,
        bibliographyStyle: 'plainnat',
      }),
    ).toThrowError(SkillError);
  });

  it('exports .tex source locally when outputTarget is tex', async () => {
    const mdBytes = new TextEncoder().encode('---\ntitle: Note Technique\n---\n\n# Un\n\nTexte avec $x^2$.\n');
    const res = await runSkill(
      markdownLatexSkill,
      [{ name: 'note.md', mime: MIME.markdown, bytes: mdBytes }],
      { outputTarget: 'tex' },
    );

    expect(res.files).toHaveLength(1);
    expect(res.files[0]?.name).toBe('note.tex');
    expect(new TextDecoder().decode(res.files[0]!.bytes)).toContain('\\section{Un}');
  });
});
