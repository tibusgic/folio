import type { Skill, SkillErrorCode } from '@folio/skills-core';

export interface ErrorDiagnosticGuide {
  readonly code: SkillErrorCode;
  readonly badge: string;
  readonly title: string;
  readonly why: string;
  readonly howToFix: string;
  readonly workingExampleTitle: string;
  readonly workingExampleDetails: readonly string[];
  readonlyworkingExampleCode?: string;
}

const MIME_HUMAN_LABELS: Record<string, string> = {
  'application/pdf': 'Document PDF vectoriel ou paginé (.pdf, en-tête binaire %PDF-1.x)',
  'text/markdown': 'Document texte Markdown UTF-8 (.md, .markdown)',
  'application/x-bibtex': 'Bibliographie BibTeX UTF-8 (.bib)',
  'image/png': 'Image PNG (.png)',
  'image/jpeg': 'Image JPEG (.jpg, .jpeg)',
};

function formatAcceptedMimes(skill: Skill<any>): string {
  return skill.input.mimes.map((m) => MIME_HUMAN_LABELS[m] ?? m).join(' ou ');
}

/**
 * Builds a contextual explanation and concrete working example for any SkillError
 * encountered by the user on the currently active skill.
 */
export function buildErrorDiagnostic(
  code: SkillErrorCode,
  message: string,
  skill: Skill<any>,
  details?: Record<string, unknown>,
): ErrorDiagnosticGuide {
  const acceptedDesc = formatAcceptedMimes(skill);
  const { minFiles, maxFiles, maxBytesPerFile } = skill.input;
  const maxMb = Math.round(maxBytesPerFile / (1024 * 1024));

  switch (code) {
    case 'INPUT_TYPE': {
      const isMdSkill = skill.input.mimes.includes('text/markdown');
      const isImgOnlySkill = skill.id === 'img.to-pdf';
      return {
        code,
        badge: `ERR · ${code} · COMPATIBILITÉ DE FORMAT`,
        title: `Format de fichier incompatible avec « ${skill.title} »`,
        why:
          `${message} Folio n’analyse pas uniquement l’extension du nom de fichier : ` +
          `le moteur inspecte la signature binaire réelle (magic bytes « %PDF- », « PNG », « JPEG » ou séquences UTF-8 sans octets nuls). ` +
          `Un fichier non conforme aux formats acceptés par « ${skill.title} » ou corrompu est automatiquement bloqué.`,
        howToFix:
          `Importez un fichier conforme aux formats attendus par le pipeline « ${skill.title} » : ${acceptedDesc}. ` +
          `Vous pouvez également cliquer sur « Charger le spécimen compatible » ci-dessous pour tester immédiatement l’outil avec un fichier valide.`,
        workingExampleTitle: `Exemple de fichier valide pour « ${skill.title} » (${skill.id})`,
        workingExampleDetails: isMdSkill
          ? [
              `Fichier accepté : « rapport-architecture.md » encodé en UTF-8 (avec ou sans en-tête YAML front-matter).`,
              ...(skill.id === 'md.latex-pdf'
                ? [`Optionnel (2e fichier) : « references.bib » au format BibTeX pour résoudre les citations [@cle2026].`]
                : []),
              `Signature attendue : Texte UTF-8 valide avec extension .md ou .markdown.`,
            ]
          : isImgOnlySkill
            ? [
                `Fichiers acceptés : de 1 à 50 images PNG (.png) ou JPEG (.jpg, .jpeg).`,
                `Signatures binaires attendues : 89 50 4E 47 (PNG) ou FF D8 FF (JPEG).`,
                `Astuce : si vous avez déjà un PDF, utilisez plutôt « Assembler » (pdf.assemble) ou « Recadrage & Format A4 » (pdf.crop-margins).`,
              ]
            : skill.id === 'pdf.watermark'
              ? [
                  `Fichier principal requis : 1 document PDF (« contrat.pdf »).`,
                  `Second fichier optionnel : 1 logo PNG transparent (« logo-entreprise.png ») à apposer en filigrane.`,
                ]
              : skill.id === 'pdf.ocr'
                ? [
                    `Fichier accepté : 1 document PDF scanné (.pdf) OU 1 image de scan (.png, .jpg).`,
                    `Sortie au choix : PDF consultable avec couche texte sélectionnable, ou extraction Markdown (.md).`,
                  ]
                : [
                    `Fichier accepté : « contrat-institutionnel.pdf » (PDF 1.4 à 2.0 standard).`,
                    `Signature binaire attendue : Les 1024 premiers octets doivent contenir l’en-tête magique « %PDF-1.x ».`,
                    `Capacité pour cet outil : ${minFiles === maxFiles ? `${minFiles} fichier PDF` : `de ${minFiles} à ${maxFiles} fichiers`} (max. ${maxMb} Mo/fichier).`,
                  ],
        readonlyworkingExampleCode: isMdSkill
          ? `---\ntitle: Note de Synthèse\nauthor: Dr. Camille Vasseur\ndate: 2026-10-25\n---\n\n# 1. Introduction\nTexte en **gras** et formule $E = mc^2$.`
          : isImgOnlySkill
            ? ` Fichiers attendus : scan-page-1.png, scan-page-2.jpg (en-têtes binaires PNG/JPEG valides)`
            : `%PDF-1.7\n% Document PDF standard non corrompu (généré par Word, LibreOffice, LaTeX, Acrobat ou Folio)`,
      };
    }

    case 'INPUT_COUNT': {
      const capLabel = minFiles === maxFiles ? `exactement ${minFiles} fichier` : `entre ${minFiles} et ${maxFiles} fichiers`;
      return {
        code,
        badge: `ERR · ${code} · NOMBRE DE FICHIERS`,
        title: `Nombre de fichiers invalide pour « ${skill.title} »`,
        why:
          `${message} Le pipeline « ${skill.title} » (${skill.id}) impose ${capLabel} en entrée afin de garantir un traitement déterministe.`,
        howToFix:
          minFiles === 1 && maxFiles === 1
            ? `Déposez un unique fichier (${acceptedDesc}) dans la zone d’importation avant de lancer l’exécution.`
            : `Sélectionnez ${capLabel} compatibles (${acceptedDesc}) dans la zone d’importation.`,
        workingExampleTitle: `Configuration d’entrée valide pour « ${skill.title} »`,
        workingExampleDetails: [
          `Nombre de fichiers requis : ${capLabel}.`,
          `Types MIME acceptés : ${skill.input.mimes.join(', ')}.`,
          skill.id === 'pdf.assemble'
            ? `Exemple : Déposez « chapitre-1.pdf » et « chapitre-2.pdf » (jusqu’à 50 PDF) pour les fusionner et réordonner leurs pages.`
            : skill.id === 'img.to-pdf'
              ? `Exemple : Déposez « scan-recto.png » et « scan-verso.png » (jusqu’à 50 images PNG/JPEG) pour générer un PDF A4.`
              : skill.id === 'pdf.watermark'
                ? `Exemple : Déposez « dossier.pdf » seul, ou « dossier.pdf » accompagné d’un logo « sceau.png ».`
                : skill.id === 'md.latex-pdf'
                  ? `Exemple : Déposez « article.md » seul, ou « article.md » accompagné de « bibliographie.bib ».`
                  : `Exemple : Déposez un seul fichier compatible pour lui appliquer « ${skill.title} ».`,
        ],
      };
    }

    case 'INPUT_TOO_LARGE': {
      return {
        code,
        badge: `ERR · ${code} · QUOTA MÉMOIRE`,
        title: `Fichier dépassant la capacité maximale autorisée (${maxMb} Mo)`,
        why:
          `${message} Pour préserver l’isolation mémoire du navigateur (WebWorker) et du sas RAM-disk éphémère sans risque de dépassement (Out-Of-Memory), « ${skill.title} » limite chaque fichier à ${maxMb} Mo.`,
        howToFix:
          `Compressez préalablement votre document via l’outil « Compression vectorielle » (pdf.compress) ou découpez-le en lots plus légers avec « Scinder » (pdf.split).`,
        workingExampleTitle: `Seuils de dimensionnement recommandés`,
        workingExampleDetails: [
          `Taille maximale par fichier sur « ${skill.title} » : ${maxMb} Mo.`,
          `Profil recommandé pour alléger un PDF lourd : utilisez « Compression vectorielle » en profil « Éditorial (150 DPI) » ou « Compact (110 DPI) ».`,
        ],
      };
    }

    case 'ENCRYPTED_INPUT': {
      const isUnlock = skill.id === 'pdf.unlock';
      return {
        code,
        badge: `ERR · ${code} · PROTECTION CRYPTOGRAPHIQUE`,
        title: isUnlock
          ? `Échec du déverrouillage : mot de passe erroné ou document non chiffré`
          : `Le fichier PDF est verrouillé par un mot de passe`,
        why: isUnlock
          ? `${message} Le déchiffrement AES/RC4 n’a pas pu aboutir : soit le mot de passe saisi ne correspond ni au mot de passe lecteur (user) ni au mot de passe propriétaire (owner), soit le fichier fourni n’était pas chiffré.`
          : `${message} Les pipelines de manipulation locale (« ${skill.title} ») refusent d’altérer un PDF chiffré sans déverrouillage préalable afin de respecter l’intégrité cryptographique du conteneur.`,
        howToFix: isUnlock
          ? `Vérifiez la casse du mot de passe actuel dans le panneau de droite, ou chargez le spécimen chiffré de démonstration dont le mot de passe est pré-rempli (« folio-demo-2026 »).`
          : `Ouvrez d’abord le pipeline « Déverrouillage PDF » (pdf.unlock), saisissez le mot de passe du document pour obtenir une copie déverrouillée, puis utilisez cette copie dans « ${skill.title} ».`,
        workingExampleTitle: isUnlock
          ? `Exemple fonctionnel pour « Déverrouillage PDF » (pdf.unlock)`
          : `Flux de travail recommandé pour un PDF protégé`,
        workingExampleDetails: isUnlock
          ? [
              `Fichier d’entrée : un PDF réellement chiffré (ex. « dossier-protege-aes256-specimen.pdf »).`,
              `Paramètre « Mot de passe actuel » : le mot de passe exact (ex. « folio-demo-2026 » pour le spécimen).`,
            ]
          : [
              `Étape 1 : Sélectionnez l’outil « Déverrouillage PDF » dans la colonne de gauche.`,
              `Étape 2 : Déposez votre PDF protégé et renseignez son mot de passe pour télécharger « document-deverrouille.pdf ».`,
              `Étape 3 : Revenez sur « ${skill.title} » et importez « document-deverrouille.pdf ».`,
            ],
      };
    }

    case 'CORRUPT_INPUT': {
      return {
        code,
        badge: `ERR · ${code} · STRUCTURE PDF ENDOMMAGÉE`,
        title: `Structure interne du fichier illisible ou tronquée`,
        why:
          `${message} Bien que le fichier commence par une signature reconnue, sa table de références croisées (xref), son catalogue racine (/Root) ou ses flux d’objets internes sont incomplets ou corrompus.`,
        howToFix:
          `Ré-exportez le document depuis son logiciel d’origine (Imprimer en PDF / Enregistrer sous) ou testez le pipeline avec le spécimen certifié.`,
        workingExampleTitle: `Critères de conformité structurelle PDF`,
        workingExampleDetails: [
          `Présence de l’en-tête « %PDF-1.x » ou « %PDF-2.0 ».`,
          `Présence du dictionnaire « /Root » (Catalog) et de l’arbre « /Pages ».`,
          `Présence du marqueur de fin de flux « %%EOF » non tronqué.`,
        ],
      };
    }

    case 'INVALID_OPTIONS': {
      return {
        code,
        badge: `ERR · ${code} · PARAMÈTRES D’EXÉCUTION`,
        title: `Un ou plusieurs réglages du pipeline « ${skill.title} » sont invalides`,
        why:
          `${message} Les paramètres saisis dans l’inspecteur de droite ne respectent pas le contrat de validation du pipeline (plage de pages hors limites du document, champ obligatoire vide ou valeur hors bornes).`,
        howToFix:
          `Vérifiez les champs du panneau « Paramètres d’exécution » à droite (ou cliquez sur « Charger le spécimen compatible » pour pré-remplir des réglages valides).`,
        workingExampleTitle: `Exemples de réglages valides pour « ${skill.title} »`,
        workingExampleDetails:
          skill.id === 'pdf.split'
            ? [
                `Pour un document de 3 pages : saisissez « 1-2, 3 » ou « 1, 2-3 » dans le champ « Plages ».`,
                `Attention : saisir « 1-5 » sur un PDF qui ne comporte que 3 pages déclenchera cette erreur.`,
                `Alternative : choisissez la méthode « Toutes les N pages » avec N = 1.`,
              ]
            : skill.id === 'pdf.encrypt'
              ? [
                  `Champ « Mot de passe d’ouverture » : minimum 4 caractères (ex. « Contrat#2026 »).`,
                  `Droit d’impression : « Haute résolution autorisée », « Basse résolution » ou « Impression interdite ».`,
                ]
              : skill.id === 'pdf.unlock'
                ? [
                    `Champ « Mot de passe actuel » : ne doit pas être vide (ex. « folio-demo-2026 »).`,
                  ]
                : skill.id === 'pdf.sign-visual'
                  ? [
                      `Champ « Signataire » : obligatoire (ex. « Dr. Camille Vasseur »).`,
                      `Zone « Signature » : tracez votre signature à la souris/doigt ou laissez le moteur composer le nom en italique.`,
                    ]
                  : skill.id === 'pdf.watermark'
                    ? [
                        `Champ « Texte » : indiquez un texte (1 à 200 caractères) ou joignez un second fichier logo PNG transparent.`,
                        `Position du calque : choisissez « En arrière-plan (Sous le texte) » ou « En superposition ».`,
                      ]
                    : skill.id === 'pdf.page-numbers'
                      ? [
                          `Champ « Commencer à la page n° » : doit être inférieur ou égal au nombre total de pages du PDF chargé.`,
                          `Style de numérotation : « Page X sur Y », « X / Y », ou « Bates Stamping (PIECE-0001) ».`,
                        ]
                      : skill.id === 'pdf.crop-margins'
                        ? [
                            `Marges de rognage (haut, bas, gauche, droite) : la somme des marges opposées ne doit pas dépasser la taille de la page (gardez ex. 10 à 25 mm).`,
                          ]
                        : [
                            `Assurez-vous que les numéros de pages indiqués ne dépassent pas le nombre total de pages du PDF chargé.`,
                          ],
        ...(details?.issues
          ? {
              readonlyworkingExampleCode: JSON.stringify(details.issues, null, 2),
            }
          : {}),
      };
    }

    case 'FORBIDDEN_CONTENT': {
      return {
        code,
        badge: `ERR · ${code} · POLITIQUE ZERO-TRUST`,
        title: `Macro ou instruction LaTeX bloquée par le pare-feu de sécurité`,
        why:
          `${message} Pour empêcher toute exécution de commande système (shell-escape) ou lecture de fichiers sur le serveur éphémère, Folio interdit les primitives TeX bas niveau telles que \\write18, \\input, \\include, \\openout ou \\catcode.`,
        howToFix:
          `Retirez la macro signalée de votre fichier Markdown/LaTeX et utilisez uniquement des commandes typographiques et mathématiques standards (AMSmath, booktabs, hyperref).`,
        workingExampleTitle: `Exemple de formule et syntaxe LaTeX autorisées`,
        workingExampleDetails: [
          `Équations en ligne : $H(D) = \\operatorname{SHA256}(D)$`,
          `Blocs d’équations : $$ \\int_0^\\infty e^{-x^2} dx = \\frac{\\sqrt{\\pi}}{2} $$`,
          `Citations bibliographiques : [@vasseur2026; @rams1976, p. 42]`,
        ],
      };
    }

    default: {
      return {
        code,
        badge: `ERR · ${code} · DIAGNOSTIC PIPELINE`,
        title: `Le traitement « ${skill.title} » n’a pas pu aboutir`,
        why:
          `${message} Une anomalie est survenue lors de l’exécution du pipeline ou de la communication avec le worker.`,
        howToFix:
          `Vérifiez que votre fichier respecte les spécifications (${acceptedDesc}, max ${maxMb} Mo) ou testez le pipeline avec le spécimen de référence ci-dessous.`,
        workingExampleTitle: `Spécimen de référence pour « ${skill.title} »`,
        workingExampleDetails: [
          `Formats acceptés : ${acceptedDesc}.`,
          `Capacité : ${minFiles === maxFiles ? `${minFiles} fichier` : `${minFiles} à ${maxFiles} fichiers`}.`,
          `Cliquez sur « Charger le spécimen compatible » pour préconfigurer un exemple 100 % fonctionnel.`,
        ],
      };
    }
  }
}
