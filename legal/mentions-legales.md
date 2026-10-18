# MENTIONS LÉGALES

*En vigueur au 18 octobre 2026*

Conformément aux dispositions de l'article 6 de la Loi n° 2004-575 du 21 juin 2004 pour la confiance dans l'économie numérique (dite « **LCEN** »), modifiée par la Loi n° 2024-449 du 21 mai 2024 visant à sécuriser et réguler l'espace numérique, ainsi qu'aux dispositions du Règlement (UE) 2022/2065 du 19 octobre 2022 relatif à un marché unique des services numériques (« **Digital Services Act** » ou « **DSA** »), il est porté à la connaissance des utilisateurs et visiteurs du site web **FOLIO** (accessible à l'adresse `https://pdf.tibus-dev.fr`, ci-après le « **Site** » ou la « **Plateforme** ») les présentes mentions légales.

---

## 1. ÉDITEUR DU SITE (RÉGIME LÉGAL DE L'ANONYMAT NON-PROFESSIONNEL)

Le Site est édité à titre strictement **non professionnel**, gratuit, sans but lucratif ni activité commerciale ou publicitaire, par une personne physique qui a choisi de conserver l'anonymat vis-à-vis du public, conformément au droit qui lui est expressément conféré par l'**article 6, III, 2° de la Loi n° 2004-575 du 21 juin 2004 pour la confiance dans l'économie numérique (LCEN)** :

> *« Les personnes éditant à titre non professionnel un service de communication au public en ligne peuvent ne tenir à la disposition du public, pour préserver leur anonymat, que le nom, la dénomination ou la raison sociale et l'adresse du prestataire mentionné au 2 du I, sous réserve de lui avoir communiqué les éléments d'identification personnelle prévus au 1°. »*

Conformément à ces dispositions légales :
- L'intégralité des éléments d'identification personnelle de l'Éditeur et Directeur de la publication (nom, prénom, domicile et coordonnées téléphoniques) a été dûment et régulièrement communiquée lors de la souscription des services d'hébergement au prestataire technique désigné à l'Article 2 ci-dessous, lequel est tenu au secret professionnel et ne peut divulguer ces éléments qu'à l'autorité judiciaire agissant dans le cadre d'une réquisition légale (article 6, II et III de la LCEN).
- **Point de contact électronique de l'Éditeur (Support, exercice des droits RGPD et signalement de contenus illicites au titre de l'article 16 du DSA)** : `contact@tibus-dev.fr`
- **Pseudonyme / Désignation publique de l'Éditeur** : Équipe technique FOLIO (`tibus-dev`).

---

## 2. PRESTATAIRE D'HÉBERGEMENT ET INFRASTRUCTURE TECHNIQUE

Le Site et son infrastructure applicative sont hébergés exclusivement au sein de l'Union Européenne par :

- **Dénomination sociale** : **OVH SAS** (opérant sous le nom commercial **OVHcloud**)
- **Forme juridique et capital social** : Société par Actions Simplifiée (SAS) au capital de 50 000 000 €
- **Siège social** : 2 rue Kellermann, 59100 Roubaix, France
- **Immatriculation** : RCS Lille Métropole 424 761 419 — Code APE 2620Z
- **Numéro de TVA intracommunautaire** : FR 22 424 761 419
- **Contact téléphonique** : 1007 (depuis la France) ou +33 (0)9 72 10 10 07
- **Site web et formulaire de contact** : [https://www.ovhcloud.com/fr/](https://www.ovhcloud.com/fr/)
- **Localisation physique des centres de données (Datacenters)** : France / Union Européenne.

---

## 3. NATURE DU SERVICE ET ARCHITECTURE TECHNIQUE « PRIVACY-FIRST »

La Plateforme **FOLIO** met gratuitement à la disposition du public un atelier documentaire numérique permettant la manipulation, l'assemblage, l'inspection, le chiffrement et la conversion de fichiers électroniques (notamment aux formats PDF, Markdown et LaTeX).

L'architecture technique de la Plateforme repose sur un principe de **minimisation absolue et de souveraineté technique** :
1. **Traitements exécutés 100 % localement sur le terminal de l'Utilisateur (In-Browser / WebWorker)** : Les opérations d'assemblage, de découpe, de rotation, de filigrane vectoriel, de signature visuelle, d'extraction structurée, d'inspection/purge de métadonnées XMP et d'édition Markdown vers PDF (`md.pdf`) s'exécutent intégralement dans la mémoire vive du navigateur web de l'Utilisateur. Aucun fichier ni octet issu du document n'est transmis sur le réseau ni vers le serveur de l'Éditeur.
2. **Traitements exécutés via sas serveur éphémère à rétention zéro (`Zero-Retention RAM Disk`)** : Lorsque l'opération requiert l'exécution d'un moteur natif isolé (compilation académique LaTeX `md.latex-pdf`, compression bicubique Ghostscript `pdf.compress`, chiffrement/déverrouillage cryptographique AES-256 `pdf.encrypt` et `pdf.unlock`), le fichier transite via une connexion chiffrée TLS, est traité exclusivement en mémoire vive volatile (`/dev/shm` en RAM), puis ses octets temporaires sont écrasés par des zéros binaires (`0x00`) et détruits **avant même la clôture de la requête HTTP**. Aucune copie n'est inscrite sur un support de stockage persistant.

---

## 4. PROPRIÉTÉ INTELLECTUELLE

### 4.1. Éléments composant la Plateforme
L'architecture générale de la Plateforme, son système de design industriel et éditorial, ses feuilles de style, son code source (packages `@folio/skills-core`, `@folio/skills-local`, `@folio/skills-remote`, interface web et moteur d'exécution éphémère), ses algorithmes d'analyse de mise en page, ses textes, sa dénomination et son habillage graphique sont la propriété exclusive de l'Éditeur ou font l'objet de licences d'utilisation régulières (composants open-source sous licences MIT, Apache-2.0, BSD ou OFL, dont les mentions de droits d'auteur respectives sont conservées conformément à leurs termes).

Sauf autorisation écrite et préalable de l'Éditeur, toute reproduction, représentation, modification, publication, adaptation ou exploitation commerciale de tout ou partie de la Plateforme, par quelque procédé que ce soit, est strictement interdite et susceptible de constituer un acte de contrefaçon sanctionné par les articles L. 335-2 et suivants du Code de la propriété intellectuelle.

### 4.2. Documents traités par les Utilisateurs
L'Éditeur ne revendique aucun droit de propriété intellectuelle ni aucune licence d'exploitation sur les documents, fichiers, textes, formules, images ou métadonnées soumis, transformés ou générés par les Utilisateurs au moyen de la Plateforme. L'Utilisateur conserve l'entière titularité des droits qu'il détient sur ses documents d'origine et sur les fichiers résultant de leur traitement.

---

## 5. SIGNALEMENT D'UN CONTENU ILLICITE OU D'UN ABUS (DSA / LCEN)

Bien que la Plateforme ne stocke ni n'héberge publiquement aucun fichier soumis par ses Utilisateurs, toute personne ou autorité souhaitant signaler une utilisation abusive du service ou une atteinte à des droits protégés peut adresser une notification motivée par courrier électronique à l'adresse suivante : `contact@tibus-dev.fr`.

---

## 6. DROIT APPLICABLE

Les présentes mentions légales sont régies par le **droit français**. En cas de différend relatif à leur interprétation ou à leur exécution, et à défaut de résolution amiable, compétence expresse est attribuée aux juridictions françaises territorialement compétentes selon les règles de droit commun.
