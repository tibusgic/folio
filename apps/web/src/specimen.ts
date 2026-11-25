import { zlibSync } from 'fflate';
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

- Validation par signature binaire d'en-tête PDF (version 1.7) indépendante de l'extension.
- Isolation mémoire dans un \`DedicatedWorkerGlobalScope\` sans fuite de descripteurs.
- Purge immédiate sur disque RAM (\`/dev/shm\`) pour la compilation TeX.

![Schéma d'architecture Zero-Trust Folio : exécution locale WebWorker et sas RAM-disk éphémère](./images/schema-architecture-folio.png)

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

export interface SpecimenBundle {
  readonly files: DocumentFile[];
  readonly presetOptions?: Record<string, unknown>;
}

const SPECIMEN_BIBTEX = `@article{vasseur2026,
  author  = {Camille Vasseur and Henri Delacroix},
  title   = {Architecture Documentaire Zero-Trust et Pipelines Typographiques},
  journal = {Revue des Systèmes Documentaires Critiques},
  year    = {2026},
  volume  = {14},
  pages   = {1--28}
}

@book{rams1976,
  author    = {Dieter Rams},
  title     = {Ten Principles for Good Design},
  publisher = {Vitsoe / Braun Design Archive},
  year      = {1976}
}
`;

const SPECIMEN_ENDIANNESS_MARKDOWN = `# Le boutisme (*Endianness*)

## Définition

Le **boutisme** (*endianness* en anglais) désigne la manière dont un nombre est stocké sur plusieurs octets en mémoire.  
Cela correspond à l'ordre d'enregistrement des octets, du poids fort au poids faible (ou inversement).

---

## Les conventions

**Exemple utilisé :** le nombre \`54332\`, soit \`0x0000D43C\` en hexadécimal (sur 4 octets / 32 bits).

### Gros-boutisme (*Big-endian*)

L'octet de **poids fort** est stocké en premier (à l'adresse mémoire la plus faible).

| Adresse (offset) | \`+0\` | \`+1\` | \`+2\` | \`+3\` |
| :--- | :---: | :---: | :---: | :---: |
| **Big-endian** | \`00\` | \`00\` | \`D4\` | \`3C\` |

**Exemples d'utilisation :**
- **Protocoles réseau :** suite **TCP/IP** (IPv4, IPv6, TCP, UDP — appelé *network byte order*), DNS.
- **Architectures et OS :** processeurs Motorola 68k, SPARC, anciens PowerPC (ex. : anciens systèmes Unix/macOS PowerPC, routeurs réseau).
- **Formats de fichiers :** PNG, JPEG, bytecode Java (\`.class\`).

### Petit-boutisme (*Little-endian*)

L'octet de **poids faible** est stocké en premier (à l'adresse mémoire la plus faible).

| Adresse (offset) | \`+0\` | \`+1\` | \`+2\` | \`+3\` |
| :--- | :---: | :---: | :---: | :---: |
| **Little-endian** | \`3C\` | \`D4\` | \`00\` | \`00\` |

**Exemples d'utilisation :**
- **Architectures et OS :** processeurs **x86 / x86-64** (Windows, Linux, macOS Intel) et **ARM** en mode par défaut (Android, iOS, macOS Apple Silicon, Raspberry Pi).
- **Bus et protocoles matériels :** **PCIe** (PCI Express), USB, SATA, NVMe.
- **Formats de fichiers :** BMP, WAV, exécutables Windows (PE) et Linux x86/ARM (ELF).

---

### Bi-boutisme (*Bi-endianness*)

Si certaines architectures ont un boutisme fixe (par exemple **x86 / x86-64**, toujours en *little-endian*), d'autres sont dites **bi-boutistes** (*bi-endian*) — comme **ARM**, **PowerPC**, **MIPS** ou **SPARC v9** — et permettent de choisir entre *big-endian* et *little-endian* :

- **Au niveau matériel (*hardware*) :** via une broche de configuration au démarrage (*bootstrap pin* / signal de reset) ou un câblage/fusible sur la carte.
- **Au niveau logiciel (*software*) :** par l'OS ou le noyau via un registre de contrôle du processeur (ex. : bit \`EE\`/\`E0E\` dans le registre \`SCTLR\` ou instruction \`SETEND\` sur ARM, bit \`LE\` du registre \`MSR\` sur PowerPC), ou encore par conversion logicielle dans les applications (ex. : fonctions réseau \`htonl\` / \`ntohl\` en C).

---

### Mi-boutisme (*Middle-endian*)

Les octets ne sont rangés ni purement par poids fort ni purement par poids faible : l'ordre est **hybride** (par exemple, des mots de 16 bits rangés en *big-endian*, mais avec les octets inversés en *little-endian* à l'intérieur de chaque mot, comme sur le **PDP-11**).

| Adresse (offset) | \`+0\` | \`+1\` | \`+2\` | \`+3\` |
| :--- | :---: | :---: | :---: | :---: |
| **Middle-endian (PDP-11)** | \`00\` | \`00\` | \`3C\` | \`D4\` |

**Exemples d'utilisation :**
- **Architectures historiques :** ordinateurs **PDP-11** (DEC) pour le stockage des entiers 32 bits.
- **Flottants et systèmes embarqués :** ancien format de nombres flottants 64 bits **ARM FPA** (*Floating Point Accelerator*, mots de 32 bits inversés).
- **Protocoles industriels :** certaines implémentations **Modbus** (registres 16 bits en *big-endian*, mais ordre des mots inversé sur les valeurs 32 bits selon le constructeur).

---

## Impact et Cybersécurité

### CWE-198 : Utilisation d'un ordre d'octets incorrect

Le traitement de données sans prise en compte de l'ordre des octets (par ex. *big-endian* vs *little-endian*) entraîne l'interprétation d'une **valeur incorrecte**.

Les conséquences peuvent être critiques :
- **Accès mémoire non autorisés** (lecture ou écriture hors limites) ;
- **Contournement de contrôles** (vérification de limites, de droits ou d'identifiants) ;
- **Déni de service (DoS) / plantage** : une taille ou longueur d'objet mal interprétée peut provoquer un dépassement de mémoire ou une allocation excessive.

#### Notes
Autre CWE relative au boutisme selon les consequences: 
- CWE-787: Write Out-of-Bounds
- CWE-125: Read Out-of-Bounds
- CWE-129: Improper Validation of Array Index

### Exemples de CVE observées

Ces vulnérabilités illustrent différents impacts liés à une mauvaise gestion du boutisme (**déni de service** ou **accès mémoire hors limites**):

| CVE | Impact | Description | Référence |
| :--- | :--- | :--- | :--- |
| **CVE-2025-52980** | Déni de service | Erreur d'ordre des octets (CWE-198) dans le démon BGP \`rpd\` de Juniper Junos OS (SRX300) provoquant un crash. | [Fiche CVE.org](https://www.cve.org/CVERecord?id=CVE-2025-52980) |
| **CVE-2026-52920** | Déni de service / Filtrage | Mauvais ordre de traitement IPsec dans Netfilter (\`xt_policy\`, noyau Linux) causant un crash ou un filtrage erroné. | [Bulletin IBM](https://www.ibm.com/support/pages/node/7297421) |
| **CVE-2022-46340** | Accès mémoire hors limites | Erreur de *byte swapping* dans X.Org / Xwayland (\`XTestFakeInput\`) entraînant une écriture hors limites. | [Fiche CVE.org](https://www.cve.org/CVERecord?id=CVE-2022-46340) |
| **CVE-2024-31080** | Accès mémoire hors limites | Erreur de *byte swapping* dans X.Org / Xwayland (\`ProcXIGetSelectedEvents\`) permettant une lecture hors limites. | [Fiche CVE.org](https://www.cve.org/CVERecord?id=CVE-2024-31080) |

---

## Source

- [Wikipédia — Boutisme](https://fr.wikipedia.org/wiki/Boutisme)
- [Common Weakness Enumeration](https://cwe.mitre.org/)
- [Safeguard](https://safeguard.sh/resources/blog/cwe-198-incorrect-byte-ordering)
- [CVE-2025-52980](https://www.cve.org/CVERecord?id=CVE-2025-52980)
- [CVE-2026-52920](https://www.ibm.com/support/pages/node/7297421)
- [CVE-2022-46340](https://www.cve.org/CVERecord?id=CVE-2022-46340)
- [CVE-2024-31080](https://www.cve.org/CVERecord?id=CVE-2024-31080)
`;

export function createSpecimenBibtex(): DocumentFile {
  return {
    name: 'references-folio.bib',
    mime: MIME.bibtex,
    bytes: new TextEncoder().encode(SPECIMEN_BIBTEX),
  };
}

export function createSpecimenMarkdown(): DocumentFile {
  return {
    name: 'specification-folio-v2.md',
    mime: MIME.markdown,
    bytes: new TextEncoder().encode(SPECIMEN_MARKDOWN),
  };
}

export function createSpecimenEndiannessMarkdown(): DocumentFile {
  return {
    name: 'endianess.md',
    mime: MIME.markdown,
    bytes: new TextEncoder().encode(SPECIMEN_ENDIANNESS_MARKDOWN),
  };
}

/**
 * Generates a real AES-256 / RC4-128 standard encrypted PDF specimen via minimal
 * deterministic PDF structure or pre-computed encrypted specimen, or encrypts
 * via backend/fallback so `pdf.unlock` works out-of-the-box with password `folio-demo-2026`.
 */
export async function createSpecimenPdf(variant: 'primary' | 'annexe' = 'primary'): Promise<DocumentFile> {
  const doc = await PDFDocument.create();
  if (variant === 'annexe') {
    doc.setTitle('Spécimen Institutionnel Folio — Annexe Financière & Conformité');
    doc.setAuthor('Direction Financière — Folio');
    doc.setSubject('Pièce justificative complémentaire');
    doc.setKeywords(['annexe', 'bilan', 'sha256', 'folio']);
    doc.setCreator('Folio Specimen Generator');
  } else {
    doc.setTitle('Spécimen Institutionnel Folio — Rapport Trimestriel');
    doc.setAuthor('Direction de la Conformité — Folio');
    doc.setSubject('Audit technique & financier');
    doc.setKeywords(['audit', 'conformite', 'sha256', 'folio']);
    doc.setCreator('Folio Specimen Generator');
  }

  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const fontBody = await doc.embedFont(StandardFonts.Helvetica);
  const fontMono = await doc.embedFont(StandardFonts.Courier);

  const pagesSpec =
    variant === 'annexe'
      ? [
          {
            heading: 'Annexe A. Certificat de Rétention Zéro & Audit',
            lines: [
              'Ce second fichier PDF permet de tester immédiatement la fusion multi-documents,',
              'le réordonnancement croisé dans la planche contact et la rotation de pages.',
              'Empreinte vérifiée localement dans le navigateur.',
            ],
          },
          {
            heading: 'Annexe B. Synthèse des Contrôles Cryptographiques',
            lines: [
              'Controle                   Algorithme          Verdict',
              'Verification MIME          Magic Bytes %PDF-   Valide',
              'Isolation Execution        WebWorker / RAM     Valide',
            ],
          },
        ]
      : [
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
              '• Contact DPO : audit.conformite@folio-engine.fr · Tel : +33 1 42 68 55 00',
              '• IBAN Sequestre : FR76 3000 6000 0112 3456 7890 189 · Resp : Camille Vasseur',
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
    name: variant === 'annexe' ? 'annexe-financiere-specimen.pdf' : 'dossier-institutionnel-specimen.pdf',
    mime: MIME.pdf,
    bytes,
  };
}

// Pure-TS PNG encoder (works in both Browser and Node/Vitest without Canvas)
function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]!;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length, false);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  const crc = crc32(out.subarray(4, 8 + data.length));
  view.setUint32(8 + data.length, crc, false);
  return out;
}

function encodeRgbaPng(
  width: number,
  height: number,
  rgba: Uint8Array,
  textMeta?: { key: string; value: string },
): Uint8Array {
  const stride = width * 4 + 1;
  const raw = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0; // filter type 0 (None)
    raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * stride + 1);
  }
  const compressed = zlibSync(raw, { level: 6 });

  const ihdr = new Uint8Array(13);
  const iv = new DataView(ihdr.buffer);
  iv.setUint32(0, width, false);
  iv.setUint32(4, height, false);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const chunks: Uint8Array[] = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
  ];

  if (textMeta) {
    const kBytes = new TextEncoder().encode(textMeta.key);
    const vBytes = new TextEncoder().encode(textMeta.value);
    const tData = new Uint8Array(kBytes.length + 1 + vBytes.length);
    tData.set(kBytes, 0);
    tData[kBytes.length] = 0;
    tData.set(vBytes, kBytes.length + 1);
    chunks.push(pngChunk('tEXt', tData));
  }

  chunks.push(pngChunk('IDAT', compressed), pngChunk('IEND', new Uint8Array(0)));
  const totalLen = chunks.reduce((acc, c) => acc + c.length, 0);
  const finalPng = new Uint8Array(totalLen);
  let offset = 0;
  for (const c of chunks) {
    finalPng.set(c, offset);
    offset += c.length;
  }
  return finalPng;
}

/**
 * Generates a transparent PNG seal/logo for `pdf.watermark`.
 */
export function createSpecimenLogoPng(): DocumentFile {
  const w = 160;
  const h = 160;
  const rgba = new Uint8Array(w * h * 4);
  const cx = w / 2;
  const cy = h / 2;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.hypot(dx, dy);
      const idx = (y * w + x) * 4;

      const onOuterRing = dist >= 64 && dist <= 72;
      const onInnerRing = dist >= 46 && dist <= 50;
      const onCrosshair =
        (Math.abs(dx) <= 3 && Math.abs(dy) <= 32) || (Math.abs(dy) <= 3 && Math.abs(dx) <= 32);

      if (onOuterRing || onInnerRing || onCrosshair) {
        rgba[idx] = 0xb4; // Terracotta #B4532A
        rgba[idx + 1] = 0x53;
        rgba[idx + 2] = 0x2a;
        rgba[idx + 3] = 220;
      }
    }
  }

  return {
    name: 'sceau-officiel-specimen.png',
    mime: MIME.png,
    bytes: encodeRgbaPng(w, h, rgba),
  };
}

/**
 * Generates an architectural technical schematic diagram PNG for `md.pdf` and `md.latex-pdf`.
 */
export function createSpecimenArchitectureDiagramPng(): DocumentFile {
  const w = 360;
  const h = 140;
  const rgba = new Uint8Array(w * h * 4);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      // Warm technical paper background #F4F1EA
      let r = 244;
      let g = 241;
      let b = 234;

      const onBorder = x === 0 || x === w - 1 || y === 0 || y === h - 1;
      const inBox1 = x >= 24 && x <= 116 && y >= 32 && y <= 108;
      const onBox1Edge =
        inBox1 && (x === 24 || x === 116 || y === 32 || y === 108 || (y >= 32 && y <= 44));
      const inBox2 = x >= 156 && x <= 248 && y >= 32 && y <= 108;
      const onBox2Edge =
        inBox2 && (x === 156 || x === 248 || y === 32 || y === 108 || (y >= 32 && y <= 44));
      const inBox3 = x >= 278 && x <= 338 && y >= 42 && y <= 98;
      const onBox3Edge = inBox3 && (x === 278 || x === 338 || y === 42 || y === 98);
      const onConnector =
        (y >= 68 && y <= 71 && x > 116 && x < 156) ||
        (y >= 68 && y <= 71 && x > 248 && x < 278);

      if (onBorder) {
        r = 184;
        g = 176;
        b = 160;
      } else if (onBox1Edge || onConnector) {
        r = 180; // Terracotta #B4532A
        g = 83;
        b = 42;
      } else if (onBox2Edge || onBox3Edge) {
        r = 36; // Tech green #248F59
        g = 143;
        b = 89;
      } else if (inBox1 || inBox2 || inBox3) {
        r = 255;
        g = 255;
        b = 255;
      }

      rgba[idx] = r;
      rgba[idx + 1] = g;
      rgba[idx + 2] = b;
      rgba[idx + 3] = 255;
    }
  }

  return {
    name: 'schema-architecture-folio.png',
    mime: MIME.png,
    bytes: encodeRgbaPng(w, h, rgba),
  };
}

/**
 * Generates simulated scanned document PNG pages for `img.to-pdf` and `pdf.ocr`.
 */
export function createSpecimenScanPng(pageNo: 1 | 2 = 1): DocumentFile {
  const w = 320;
  const h = 452;
  const rgba = new Uint8Array(w * h * 4);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      // Warm paper background
      let r = 247;
      let g = 244;
      let b = 236;

      // Border frame
      if (x === 16 || x === w - 17 || y === 16 || y === h - 17) {
        r = 160;
        g = 155;
        b = 145;
      }
      // Top header bar (terracotta accent)
      else if (y >= 32 && y <= 46 && x >= 32 && x <= w - 32) {
        r = 180;
        g = 83;
        b = 42;
      }
      // Simulated title block
      else if (y >= 64 && y <= 76 && x >= 32 && x <= 220) {
        r = 28;
        g = 30;
        b = 36;
      }
      // Simulated text lines
      else if (
        y >= 100 &&
        y <= 340 &&
        (y - 100) % 18 < 5 &&
        x >= 32 &&
        x <= (y % 36 === 0 ? 210 : w - 42)
      ) {
        r = 55;
        g = 57;
        b = 64;
      }

      rgba[idx] = r;
      rgba[idx + 1] = g;
      rgba[idx + 2] = b;
      rgba[idx + 3] = 255;
    }
  }

  const ocrText =
    pageNo === 1
      ? 'FOLIO SCAN SPECIMEN — PIECE JUSTIFICATIVE N° 2026-01\n1. Attestation de numérisation conforme aux normes d’archivage.\n2. Reconnaissance optique de caractères (OCR) et indexation plein texte.\n3. Rétention zéro sur disque RAM éphémère.'
      : 'FOLIO SCAN SPECIMEN — ANNEXE COMPTABLE N° 2026-02\n1. Détail des opérations vérifiées par empreinte SHA-256.\n2. Pièce jointe scannée prête pour assemblage PDF.';

  return {
    name: `piece-numerisee-p${pageNo}-specimen.png`,
    mime: MIME.png,
    bytes: encodeRgbaPng(w, h, rgba, { key: 'Description', value: ocrText }),
  };
}

export const SPECIMEN_DEMO_PASSWORD = 'folio-demo-2026';

const ENCRYPTED_SPECIMEN_PDF_B64 =
  'JVBERi0xLjMKJeLjz9MKMSAwIG9iago8PAovUHJvZHVjZXIgPDE2OTE1MzI4ZmI2MTBmYThmZDdiMWY1YjQ3ZjBiYWQzNGY1NmVmNjVhMGI5MzA2YTQ5ZWMxNzEwNjBiZTFhZWI+Cj4+CmVuZG9iagoyIDAgb2JqCjw8Ci9UeXBlIC9QYWdlcwovQ291bnQgMQovS2lkcyBbIDQgMCBSIF0KPj4KZW5kb2JqCjMgMCBvYmoKPDwKL1R5cGUgL0NhdGFsb2cKL1BhZ2VzIDIgMCBSCj4+CmVuZG9iago0IDAgb2JqCjw8Ci9Db250ZW50cyA1IDAgUgovTWVkaWFCb3ggWyAwIDAgNTk1LjI3NTYgODQxLjg4OTggXQovUmVzb3VyY2VzIDw8Ci9Gb250IDYgMCBSCi9Qcm9jU2V0IFsgL1BERiAvVGV4dCAvSW1hZ2VCIC9JbWFnZUMgL0ltYWdlSSBdCj4+Ci9Sb3RhdGUgMAovVHJhbnMgPDwKPj4KL1R5cGUgL1BhZ2UKL1BhcmVudCAyIDAgUgo+PgplbmRvYmoKNSAwIG9iago8PAovRmlsdGVyIFsgL0FTQ0lJODVEZWNvZGUgL0ZsYXRlRGVjb2RlIF0KL0xlbmd0aCAzNTIKPj4Kc3RyZWFtCqIEbE8vZD4i/XnsySQsNK5l5QxoecNuL+ChiyxhWA91ibAWnkzcjEE/5yEvrnoji/8Cgm474F7nze+eZY97VTB+Gn6CndEhAfmHXfg+tF3ISOrgSM9Zo73vwOEzvZrtT+tFVtuOftKLiFPOyMEdHH9KdBCSzNPJURsBhDvef/nWRcBNw+09LG3GSFu+V5jw/htvXOlkSaeVxBRbUaNc+EcCk5FKpySW2nhM2x3cS9ipYiYqLpzGpIlJyRuJClyYflCB5NEMISp3vQ5DnjSelA4QauQ7yFZN9X9e9A6Hd37XM7PdeouryjqSr/9esTPA33gOzzhbCRAUF94n9FCa8ptKl1Wu85ucpJ2g0vc0iBLtJ0e/FJczoXZuLfcS6fGAU7spmhL6+oz51P310Nx02LMBq+NqKo8hbj68wziTsECObmmXsI6NMrKGQIq3HU2JLIgwIJZG3h4Zl8vWu68Q5ZMKZW5kc3RyZWFtCmVuZG9iago2IDAgb2JqCjw8Ci9GMSA3IDAgUgovRjIgOCAwIFIKPj4KZW5kb2JqCjcgMCBvYmoKPDwKL0Jhc2VGb250IC9IZWx2ZXRpY2EKL0VuY29kaW5nIC9XaW5BbnNpRW5jb2RpbmcKL05hbWUgL0YxCi9TdWJ0eXBlIC9UeXBlMQovVHlwZSAvRm9udAo+PgplbmRvYmoKOCAwIG9iago8PAovQmFzZUZvbnQgL0hlbHZldGljYS1Cb2xkCi9FbmNvZGluZyAvV2luQW5zaUVuY29kaW5nCi9OYW1lIC9GMgovU3VidHlwZSAvVHlwZTEKL1R5cGUgL0ZvbnQKPj4KZW5kb2JqCjkgMCBvYmoKPDwKL1YgNQovUiA2Ci9MZW5ndGggMjU2Ci9QIDQyOTQ5NjcyOTIKL0ZpbHRlciAvU3RhbmRhcmQKL08gPDYyOTI0ZTY1ZDA2MGI3NWU1ODg2Zjk5OTA1MjBkY2M0ZTk4ZWY2Y2YzNWRhNTZhNTA0YWEyZWUzNjc5MzNkZDJlZTVmODhlZjhiNTZjMWE2NTFkZThjYzgwZTc3OWNhZD4KL1UgPDE2ZGViZjg5YzUxN2I2MzQ2Y2RmYWQ2NWFlZDc5Y2FiNGUzNzE4ZmM1MDE5MGIyNWY4NzNlNGQ2MmU3ZjMyYTMyYjBmMjAwMjViZWE4MmQzYzUwZmVmYWNmNWFiYWI0Yz4KL0NGIDw8Ci9TdGRDRiA8PAovQXV0aEV2ZW50IC9Eb2NPcGVuCi9DRk0gL0FFU1YzCi9MZW5ndGggMzIKPj4KPj4KL1N0bUYgL1N0ZENGCi9TdHJGIC9TdGRDRgovT0UgPDVhOGRkZmFkZDQyNWY5MDQzOTg4OWYyZmVlYjNjNTJhYmY1MmRmZDY0Y2FlYTViNmQ4MTUyNWI1ZmI4MTA3ZjY+Ci9VRSA8N2MxNTc4ZWI4ZGFkNTBmYTU0NTJiMjU1OTVkOWQ1NGY5ZDk4MmI0NDFmODFiNGU0YmI2MTVhNjFjYTIwZWE1ZT4KL1Blcm1zIDwyNTVkMjVkNWE2MDJmYzcxZmQ1Nzc4MTgwNDgzN2I5Zj4KPj4KZW5kb2JqCnhyZWYKMCAxMAowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwMTUgMDAwMDAgbiAKMDAwMDAwMDExMyAwMDAwMCBuIAowMDAwMDAwMTcyIDAwMDAwIG4gCjAwMDAwMDAyMjEgMDAwMDAgbiAKMDAwMDAwMDQyMCAwMDAwMCBuIAowMDAwMDAwODYzIDAwMDAwIG4gCjAwMDAwMDA5MDQgMDAwMDAgbiAKMDAwMDAwMTAxMSAwMDAwMCBuIAowMDAwMDAxMTIzIDAwMDAwIG4gCnRyYWlsZXIKPDwKL1NpemUgMTAKL1Jvb3QgMyAwIFIKL0luZm8gMSAwIFIKL0lEIFsgPDYzMzYzNTMyMzUzODMxMzEzNDYxMzE2MzM1NjU2MjMyMzAzNjMzMzgzMzY0NjI2NjYxNjUzMTY0MzU2NjMyMzI+IDw2MzM2MzUzMjM1MzgzMTMxMzQ2MTMxNjMzNTY1NjIzMjMwMzYzMzM4MzM2NDYyNjY2MTY1MzE2NDM1NjYzMjMyPiBdCi9FbmNyeXB0IDkgMCBSCj4+CnN0YXJ0eHJlZgoxNjc4CiUlRU9GCg==';

export function createSpecimenEncryptedPdf(): DocumentFile {
  const binaryStr = globalThis.atob(ENCRYPTED_SPECIMEN_PDF_B64);
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) {
    bytes[i] = binaryStr.charCodeAt(i);
  }
  return {
    name: 'dossier-protege-aes256-specimen.pdf',
    mime: MIME.pdf,
    bytes,
  };
}

/**
 * Build a skill-tailored specimen bundle (files + pre-filled valid options) so
 * that clicking "Charger Spécimen" on ANY skill produces an immediately
 * executable, error-free demonstration for that specific skill.
 */
export async function createSpecimenForSkill(skillId: string): Promise<SpecimenBundle> {
  switch (skillId) {
    case 'md.pdf':
      return {
        files: [createSpecimenMarkdown(), createSpecimenArchitectureDiagramPng()],
        presetOptions: {
          theme: 'editorial',
          paper: 'A4',
          toc: true,
          numberSections: true,
          pageNumbers: true,
        },
      };

    case 'md.latex-pdf':
      return {
        files: [createSpecimenEndiannessMarkdown(), createSpecimenArchitectureDiagramPng()],
        presetOptions: {
          outputTarget: 'pdf',
          language: 'fr',
          sourceDisplay: 'clickable',
          documentClass: 'article',
          paper: 'a4paper',
          fontSize: '11pt',
          numberSections: true,
          toc: true,
          bibliographyStyle: 'plainnat',
        },
      };

    case 'img.to-pdf':
      return {
        files: [createSpecimenScanPng(1), createSpecimenScanPng(2)],
        presetOptions: {
          paper: 'A4',
          orientation: 'auto',
          marginMm: 12,
          fit: 'contain',
          outputName: 'dossier-scans-specimen.pdf',
        },
      };

    case 'pdf.assemble': {
      const [primary, annexe] = await Promise.all([
        createSpecimenPdf('primary'),
        createSpecimenPdf('annexe'),
      ]);
      return {
        files: [primary, annexe],
        presetOptions: {
          outputName: 'dossier-consolide-specimen.pdf',
        },
      };
    }

    case 'pdf.split': {
      const pdf = await createSpecimenPdf('primary');
      return {
        files: [pdf],
        presetOptions: {
          mode: 'ranges',
          ranges: '1-2, 3',
          every: 1,
        },
      };
    }

    case 'pdf.page-numbers': {
      const pdf = await createSpecimenPdf('primary');
      return {
        files: [pdf],
        presetOptions: {
          format: 'page-x-of-y',
          batesPrefix: 'PIECE-',
          batesDigits: 4,
          position: 'bottom-right',
          headerText: 'Dossier Institutionnel Folio — Confidentiel',
          includeDate: true,
          startPage: 1,
          startNumber: 1,
          marginMm: 12,
          fontSize: 9,
          color: '#2A2C32',
        },
      };
    }

    case 'pdf.crop-margins': {
      const pdf = await createSpecimenPdf('primary');
      return {
        files: [pdf],
        presetOptions: {
          mode: 'both',
          targetPaper: 'A4',
          cropTopMm: 10,
          cropBottomMm: 10,
          cropLeftMm: 10,
          cropRightMm: 10,
          pages: '',
        },
      };
    }

    case 'pdf.watermark': {
      const pdf = await createSpecimenPdf('primary');
      const logo = createSpecimenLogoPng();
      return {
        files: [pdf, logo],
        presetOptions: {
          text: 'CONFIDENTIEL · SPÉCIMEN',
          layer: 'under',
          layout: 'center',
          color: '#B4532A',
          opacity: 0.18,
          logoScale: 0.4,
          fontSize: 52,
          rotation: 35,
          font: 'Helvetica-Bold',
          pages: '',
          auditStamp: true,
        },
      };
    }

    case 'pdf.sign-visual': {
      const pdf = await createSpecimenPdf('primary');
      return {
        files: [pdf],
        presetOptions: {
          signerName: 'Dr. Camille Vasseur',
          reason: 'Bon pour accord — Validation spécimen',
          pageTarget: 'last',
          position: 'bottom-right',
          widthMm: 62,
          color: '#1F2430',
          timestamp: true,
          strokes: [
            [
              [0.08, 0.68],
              [0.18, 0.28],
              [0.28, 0.72],
              [0.42, 0.35],
              [0.58, 0.62],
              [0.76, 0.42],
              [0.92, 0.48],
            ],
            [
              [0.14, 0.78],
              [0.52, 0.72],
              [0.88, 0.68],
            ],
          ],
        },
      };
    }

    case 'pdf.redact': {
      const pdf = await createSpecimenPdf('primary');
      return {
        files: [pdf],
        presetOptions: {
          redactEmails: true,
          redactIbans: true,
          redactPhones: true,
          redactSsn: true,
          customTerms: 'Camille Vasseur',
          zoneBand: 'none',
          pages: '',
          stripMetadata: true,
        },
      };
    }

    case 'pdf.extract': {
      const pdf = await createSpecimenPdf('primary');
      return {
        files: [pdf],
        presetOptions: {
          format: 'markdown',
          pages: '',
          detectTables: true,
          pageMarkers: true,
        },
      };
    }

    case 'pdf.ocr': {
      return {
        files: [createSpecimenScanPng(1)],
        presetOptions: {
          outputFormat: 'searchable-pdf',
          language: 'fra+eng',
          deskew: true,
          enhanceContrast: true,
        },
      };
    }

    case 'pdf.inspect': {
      const pdf = await createSpecimenPdf('primary');
      return {
        files: [pdf],
        presetOptions: {},
      };
    }

    case 'pdf.metadata': {
      const pdf = await createSpecimenPdf('primary');
      return {
        files: [pdf],
        presetOptions: {
          strip: false,
          title: 'Rapport Consolidé Folio — Édition Certifiée',
          author: 'Direction de la Conformité & Audit',
          subject: 'Spécimen de gouvernance documentaire',
          keywords: 'folio, audit, sha256, conformite, zero-trust',
        },
      };
    }

    case 'pdf.compress': {
      const pdf = await createSpecimenPdf('primary');
      return {
        files: [pdf],
        presetOptions: {
          profile: 'editorial',
          imageDpi: 150,
          grayscale: false,
          linearize: true,
        },
      };
    }

    case 'pdf.encrypt': {
      const pdf = await createSpecimenPdf('primary');
      return {
        files: [pdf],
        presetOptions: {
          userPassword: SPECIMEN_DEMO_PASSWORD,
          ownerPassword: '',
          printPermission: 'full',
          allowCopy: false,
          allowModify: false,
          allowAnnotate: true,
          encryptMetadata: true,
        },
      };
    }

    case 'pdf.unlock': {
      return {
        files: [createSpecimenEncryptedPdf()],
        presetOptions: {
          password: SPECIMEN_DEMO_PASSWORD,
        },
      };
    }

    default: {
      const pdf = await createSpecimenPdf('primary');
      return { files: [pdf] };
    }
  }
}
