import { describe, expect, it } from 'vitest';
import { MIME, runSkill, SkillError } from '@folio/skills-core';
import { markdownLatexSkill, markdownToLatex } from '../src/index.ts';
import { createSpecimenEndiannessMarkdown } from '../../../apps/web/src/specimen.ts';

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

  it('compiles endianess.md with auto-wrapped tabularx tables, bold cells without literal **, language FR/EN (Sommaire/Contents), and source display modes', () => {
    const endianMd = new TextDecoder().decode(createSpecimenEndiannessMarkdown().bytes);

    const frBundle = markdownToLatex(endianMd, {
      documentClass: 'article',
      paper: 'a4paper',
      fontSize: '11pt',
      language: 'fr',
      sourceDisplay: 'footnotes',
      toc: true,
      numberSections: true,
      bibliographyStyle: 'plainnat',
    });

    // No literal ** or stray * anywhere in the generated LaTeX
    expect(frBundle.tex).not.toContain('**');
    // Nested italic inside bold (**Au niveau matériel (*hardware*) :** in endianess.md)
    expect(frBundle.tex).toContain('\\textbf{Au niveau matériel (\\emph{hardware}) :}');
    expect(frBundle.tex).toContain('\\textbf{Au niveau logiciel (\\emph{software}) :}');
    // Code headers like `+0` in table headers are bolded without **
    expect(frBundle.tex).toContain('\\textbf{\\texttt{+0}}');
    // Bold cells in table body keep bold
    expect(frBundle.tex).toContain('\\textbf{Big-endian}');
    expect(frBundle.tex).toContain('\\textbf{CVE-2025-52980}');
    // Wide CVE table uses tabularx{\textwidth} with X column so it never overflows page margins
    expect(frBundle.tex).toContain('\\begin{tabularx}{\\textwidth}');
    expect(frBundle.tex).toContain('>{\\raggedright\\arraybackslash}X');
    // French language -> Sommaire + French localized default date
    expect(frBundle.tex).toContain('\\renewcommand{\\contentsname}{Sommaire}');
    expect(frBundle.meta.date).toMatch(/^\d+(?:er)?\s+[a-zéû]+\s+\d{4}$/);
    // Non-floating minipage table so the last table never floats after ## Source
    expect(frBundle.tex).toContain('\\begin{minipage}{\\textwidth}');
    // Footnotes mode for sources
    expect(frBundle.tex).toContain('\\textsuperscript{[1]}');
    expect(frBundle.tex).toContain('\\footnotetext[1]');

    // English language + bibliography source display mode + report documentClass
    const enBundle = markdownToLatex(endianMd, {
      documentClass: 'report',
      paper: 'a4paper',
      fontSize: '11pt',
      language: 'en',
      sourceDisplay: 'bibliography',
      toc: true,
      numberSections: true,
      bibliographyStyle: 'plainnat',
    });
    expect(enBundle.tex).toContain('\\renewcommand{\\contentsname}{Contents}');
    expect(enBundle.tex).toContain('\\renewcommand{\\bibname}{References}');
    expect(enBundle.tex).not.toContain('\\renewcommand{\\refname}');
    expect(enBundle.tex).toContain('\\chapter{Définition}');
    expect(enBundle.meta.date).toMatch(/^[A-Z][a-z]+\s+\d+,\s+\d{4}$/);
    expect(enBundle.tex).toContain('\\href{https://www.cve.org/CVERecord?id=CVE-2025-52980}{Fiche CVE.org} [1]');
    expect(enBundle.tex).toContain('[1] \\href{https://www.cve.org/CVERecord?id=CVE-2025-52980}{CVE-2025-52980}');

    // Inline URL source display mode
    const inlineBundle = markdownToLatex(endianMd, {
      documentClass: 'article',
      paper: 'a4paper',
      fontSize: '11pt',
      language: 'fr',
      sourceDisplay: 'inline-url',
      toc: true,
      numberSections: true,
      bibliographyStyle: 'plainnat',
    });
    expect(inlineBundle.tex).toContain(
      '\\href{https://fr.wikipedia.org/wiki/Boutisme}{Wikipédia — Boutisme} ({\\small\\url{https://fr.wikipedia.org/wiki/Boutisme}})',
    );
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

  it('loads graphicx/float/caption packages and converts ![Légende](image.png) into figure[H] environment', async () => {
    const md = `# Figures Académiques

![Légende](image.png)
`;
    const bundle = markdownToLatex(md, {
      documentClass: 'article',
      paper: 'a4paper',
      fontSize: '11pt',
      toc: false,
      numberSections: true,
      bibliographyStyle: 'plainnat',
    });

    expect(bundle.tex).toContain('\\usepackage{graphicx}');
    expect(bundle.tex).toContain('\\usepackage{float}');
    expect(bundle.tex).toContain('\\usepackage{caption}');
    expect(bundle.tex).toContain(
      [
        '\\begin{figure}[H]',
        '  \\centering',
        '  \\includegraphics[width=0.85\\linewidth]{image.png}',
        '  \\caption{Légende}',
        '\\end{figure}',
      ].join('\n'),
    );
    expect(bundle.figures).toBe(1);

    // Also test markdownLatexSkill with deposited image + relative path + manual association
    const onePxPng = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
      0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
      0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x60, 0x60, 0x60, 0x60,
      0x00, 0x00, 0x00, 0x05, 0x00, 0x01, 0x87, 0xa1, 0x4e, 0x9d, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45,
      0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
    ]);
    const res = await runSkill(
      markdownLatexSkill,
      [
        {
          name: 'memoire.md',
          mime: MIME.markdown,
          bytes: new TextEncoder().encode('# Test\n\n![Architecture réseau](./images/schema.png)\n'),
        },
        { name: 'schema.png', mime: MIME.png, bytes: onePxPng },
      ],
      { outputTarget: 'tex' },
    );

    const texOut = new TextDecoder().decode(res.files[0]!.bytes);
    expect(texOut).toContain('\\includegraphics[width=0.85\\linewidth]{schema.png}');
    expect(texOut).toContain('\\caption{Architecture réseau}');
    expect(res.record.report?.resolvedImages).toBe(1);
  });
});
