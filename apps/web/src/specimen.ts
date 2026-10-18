import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { MIME, type DocumentFile } from '@folio/skills-core';

const SPECIMEN_MARKDOWN = `---
title: Architecture Documentaire Zero-Trust & Pipelines Typographiques
subtitle: Spécification de référence — Moteur Folio v2.0
author:
  - Dr. Camille Vasseur
  - Ing. Henri Delacroix
date: 2026-10-18
organization: Institut des Systèmes Documentaires Critiques
abstract: Ce mémoire présente l'architecture découplée en Skills de la plateforme Folio. Les opérations sensibles s'exécutent localement en WebAssembly/WebWorker ou dans un sas RAM-disk à rétention zéro.
---

# Principes d'ingénierie

La manipulation de pièces contractuelles ou académiques impose une **traçabilité cryptographique** stricte [@vasseur2026; @rams1976, p. 42]. Toute transformation $T$ appliquée à un document $D$ produit une empreinte déterministe :

$$
H(D) = \\operatorname{SHA256}(D) \\in \\{0,1\\}^{256}
$$

## Garanties de confidentialité

- Validation par octets magiques (\`%PDF-1.7\`) indépendante de l'extension.
- Isolation mémoire dans un \`DedicatedWorkerGlobalScope\` sans fuite de descripteurs.
- Purge immédiate sur disque RAM (\`/dev/shm\`) pour la compilation TeX.

## Matrice de performance des pipelines

| Pipeline | Exécution | Complexité | Rétention serveur |
| --- | --- | --- | --- |
| pdf.assemble | 100 % Local | O(N) pages | 0 octet |
| md.pdf | 100 % Local | O(L) lignes | 0 octet |
| md.latex-pdf | Éphémère RAM | O(L) + TeX | 0 octet (purgé) |
| pdf.encrypt | Éphémère RAM | AES-256 R6 | 0 octet (purgé) |

\`\`\`typescript
export interface SkillContract<TOptions> {
  readonly id: string;
  readonly execution: 'local' | 'remote-ephemeral';
  run(files: DocumentFile[], options: TOptions): Promise<SkillOutput>;
}
\`\`\`
`;

export function createSpecimenMarkdown(): DocumentFile {
  return {
    name: 'specification-folio-v2.md',
    mime: MIME.markdown,
    bytes: new TextEncoder().encode(SPECIMEN_MARKDOWN),
  };
}

export async function createSpecimenPdf(): Promise<DocumentFile> {
  const doc = await PDFDocument.create();
  doc.setTitle('Spécimen Institutionnel Folio — Rapport Trimestriel');
  doc.setAuthor('Direction de la Conformité — Folio');
  doc.setSubject('Audit technique & financier');
  doc.setKeywords(['audit', 'conformite', 'sha256', 'folio']);
  doc.setCreator('Folio Specimen Generator');

  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const fontBody = await doc.embedFont(StandardFonts.Helvetica);
  const fontMono = await doc.embedFont(StandardFonts.Courier);

  const pagesSpec = [
    {
      heading: '1. Synthèse Exécutive & Gouvernance',
      lines: [
        'Le présent document constitue un spécimen multi-pages vectoriel destiné aux tests',
        'de fusion, découpe, filigrane, signature manuscrite et extraction structurée.',
        'Aucune donnée ne quitte le poste client lors des traitements locaux.',
      ],
    },
    {
      heading: '2. Indicateurs Techniques & Intégrité',
      lines: [
        'Metrique                   Valeur Cible        Statut',
        'Chiffrement                AES-256 (PDF 2.0)   Conforme',
        'Empreinte documentaire     SHA-256             Vérifiée',
        'Fuite mémoire Canvas       0 Mo après purge    Validé',
      ],
    },
    {
      heading: '3. Annexe Réglementaire & Attestation',
      lines: [
        '• Article 1 : Conservation locale prioritaire dans le navigateur.',
        '• Article 2 : Destruction synchrone des tampons en mémoire vive.',
        '• Article 3 : Horodatage UTC sur chaque opération d’entreprise.',
      ],
    },
  ];

  pagesSpec.forEach((spec, idx) => {
    const page = doc.addPage([595.28, 841.89]); // A4
    page.drawText('FOLIO · DOSSIER TECHNIQUE CONFIDENTIEL', {
      x: 54,
      y: 785,
      size: 8.5,
      font: fontMono,
      color: rgb(0.45, 0.44, 0.41),
    });

    page.drawText(spec.heading, {
      x: 54,
      y: 745,
      size: 16,
      font: fontBold,
      color: rgb(0.09, 0.09, 0.11),
    });

    spec.lines.forEach((line, lIdx) => {
      page.drawText(line, {
        x: 54,
        y: 705 - lIdx * 22,
        size: 11,
        font: fontBody,
        color: rgb(0.15, 0.15, 0.18),
      });
    });

    page.drawText(`Page ${idx + 1} / ${pagesSpec.length}`, {
      x: 54,
      y: 48,
      size: 9,
      font: fontMono,
      color: rgb(0.5, 0.5, 0.52),
    });
  });

  const bytes = await doc.save();
  return {
    name: 'dossier-institutionnel-specimen.pdf',
    mime: MIME.pdf,
    bytes,
  };
}
