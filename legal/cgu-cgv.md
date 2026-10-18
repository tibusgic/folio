# CONDITIONS GÉNÉRALES D'UTILISATION (CGU)

*En vigueur au 18 octobre 2026*

---

## ARTICLE 1 — OBJET ET CHAMP D'APPLICATION

Les présentes Conditions Générales d'Utilisation (ci-après les « **CGU** ») ont pour objet de définir les modalités et conditions dans lesquelles les utilisateurs (ci-après l'« **Utilisateur** ») accèdent et utilisent la plateforme web de traitement documentaire **FOLIO**, accessible gratuitement à l'adresse `https://pdf.tibus-dev.fr` (ci-après la « **Plateforme** »).

Toute utilisation de la Plateforme implique l'acceptation sans réserve, pleine et entière des présentes CGU par l'Utilisateur. Si l'Utilisateur n'accepte pas tout ou partie des présentes stipulations, il lui appartient de renoncer à tout usage de la Plateforme.

---

## ARTICLE 2 — STATUT DE LA PLATEFORME ET GRATUITÉ DU SERVICE

### 2.1. Édition non professionnelle et gratuité intégrale
La Plateforme est éditée à titre non professionnel au sens de l'article 6, III, 2° de la Loi n° 2004-575 du 21 juin 2004 (LCEN) et mise à la disposition du public **à titre entièrement gratuit**, en libre accès, sans création de compte, sans abonnement, sans achat intégré et sans contrepartie publicitaire.

### 2.2. Inapplicabilité des dispositions relatives aux contrats de vente à distance
En l'absence de toute transaction financière, de tout paiement d'un prix et de toute fourniture de données personnelles à titre de contrepartie commerciale au sens de l'article L. 221-1 et de l'article L. 224-25-2 du Code de la consommation, l'utilisation de la Plateforme ne constitue pas une vente ni une prestation de services à titre onéreux. À ce titre, les dispositions relatives à la facturation, aux modalités de paiement, au remboursement et au droit de rétractation légal de quatorze (14) jours ne trouvent pas à s'appliquer. L'Utilisateur peut cesser d'utiliser la Plateforme à tout moment et sans formalité, simplement en fermant son navigateur.

---

## ARTICLE 3 — DESCRIPTION DES SERVICES DOCUMENTAIRES (« SKILLS »)

La Plateforme met à disposition deux modes d'interface (**Mode Rapide / B2C** et **Mode Entreprise / Audit & Batch**) donnant accès à douze (12) pipelines de traitement documentaire (« Skills ») répartis en deux catégories techniques :

### 3.1. Pipelines exécutés 100 % en local sur le terminal de l'Utilisateur (`local`)
Ces pipelines s'exécutent intégralement au sein du navigateur web de l'Utilisateur via un processus isolé (`Web Worker`) :
1. **`pdf.assemble` (Assembler)** : Fusion, réorganisation par glisser-déposer ou au clavier, rotation par pas de 90° et suppression de pages issues d'un ou plusieurs fichiers PDF.
2. **`pdf.split` (Scinder)** : Découpe d'un document PDF par plages de pages personnalisées ou par lots réguliers de $N$ pages.
3. **`pdf.watermark` (Filigrane & tampon)** : Apposition de filigranes vectoriels (centré, mosaïque ou tampon d'angle) et d'une ligne d'audit horodatée incluant l'empreinte SHA-256 du document source.
4. **`pdf.sign-visual` (Signature visuelle)** : Apposition d'un tracé manuscrit vectoriel lissé (SVG) accompagné d'un cartouche d'identification et d'un horodatage UTC. *(Avertissement juridique : cette signature constitue une marque visuelle d'approbation et un scellement d'audit SHA-256, mais ne constitue pas une signature électronique qualifiée reposant sur un certificat délivré par un Prestataire de Services de Confiance Qualifié au sens du Règlement (UE) n° 910/2014 « eIDAS »).*
5. **`pdf.inspect` (Inspection)** : Lecture des métadonnées `Info` et `XMP`, des dimensions de pages et détection des signaux de sécurité internes (`/JavaScript`, `/Launch`, `/EmbeddedFiles`, `/ByteRange`, `AcroForm`).
6. **`pdf.metadata` (Métadonnées)** : Modification ou purge complète des dictionnaires `Info` et des flux `XMP` d'un fichier PDF.
7. **`pdf.extract` (Extraction structurée)** : Reconstruction des titres, paragraphes, listes et tableaux d'un PDF doté d'une couche texte vers un fichier Markdown (`.md`) ou JSON structuré (`.json`).
8. **`md.pdf` (Markdown → PDF)** : Composition typographique d'un fichier Markdown (avec en-tête YAML, formules mathématiques KaTeX MathML, notes de bas de page et sauts de page intelligents) destinée à l'impression PDF vectorielle du navigateur.

### 3.2. Pipelines exécutés via Serveur Éphémère Chiffré à Rétention Zéro (`remote-ephemeral`)
Ces pipelines s'exécutent dans un espace mémoire vive temporaire (`/dev/shm` en RAM) sur le serveur, lequel est intégralement écrasé et purgé avant le renvoi du fichier résultant :
9. **`md.latex-pdf` (Markdown → LaTeX → PDF)** : Transformation d'un document Markdown (et d'une éventuelle bibliographie `.bib`) en code source LaTeX (`.tex`) ou en document PDF académique compilé via `pdflatex` en environnement confiné (`-no-shell-escape`).
10. **`pdf.compress` (Compression vectorielle)** : Rééchantillonnage bicubique des images matricielles selon le profil choisi (72 à 600 DPI) tout en préservant les polices et tracés vectoriels.
11. **`pdf.encrypt` (Chiffrement AES-256)** : Chiffrement cryptographique AES-256 d'un fichier PDF avec mot de passe lecteur, mot de passe propriétaire et gestion granulaire des permissions (impression, copie, modification, annotations).
12. **`pdf.unlock` (Déverrouillage PDF)** : Suppression du chiffrement d'un fichier PDF dont l'Utilisateur détient légitimement le mot de passe.

---

## ARTICLE 4 — OBLIGATIONS ET RESPONSABILITÉ DE L'UTILISATEUR

### 4.1. Licéité et propriété des fichiers soumis
L'Utilisateur est seul et unique responsable des fichiers, textes, images et données qu'il traite au moyen de la Plateforme. Il garantit détenir l'ensemble des droits de propriété intellectuelle et autorisations nécessaires sur les documents soumis.

Il est formellement interdit d'utiliser la Plateforme pour traiter, générer, chiffrer ou déverrouiller :
1. Tout document au contenu illicite, diffamatoire, injurieux, pédopornographique, incitant à la haine, à la violence ou au terrorisme, ou portant atteinte à la dignité humaine.
2. Tout document contrefaisant ou portant atteinte aux droits d'auteur, aux secrets d'affaires ou à la vie privée de tiers.
3. Tout fichier protégé par un mot de passe (`pdf.unlock`) dont l'Utilisateur ne serait pas le détenteur légitime ou pour lequel il n'aurait pas reçu l'autorisation expresse du titulaire des droits.

### 4.2. Sécurité technique et interdiction des attaques logiques
L'Utilisateur s'interdit formellement :
- De soumettre des fichiers piégés (« *zip bombs* », « *PDF decompression bombs* », scripts malveillants ou charges utiles d'exploitation).
- D'introduire dans les documents Markdown ou LaTeX des primitives d'exécution système ou d'accès au système de fichiers (telles que `\write18`, `\input`, `\include`, `\openout`, `\catcode`), lesquelles sont systématiquement bloquées par le pare-feu applicatif de la Plateforme.
- D'entraver ou de tenter de saturer le fonctionnement du serveur éphémère par des requêtes automatisées massives.

---

## ARTICLE 5 — GARANTIES, DISPONIBILITÉ ET LIMITATION DE RESPONSABILITÉ DE L'ÉDITEUR

### 5.1. Fourniture du service « en l'état »
La Plateforme étant fournie à titre strictement gratuit et non professionnel, elle est mise à disposition **« en l'état » (*as is*)**, sans aucune garantie expresse ou implicite de disponibilité continue (SLA), d'absence d'interruption, de performance ou d'adéquation à un besoin professionnel particulier.

L'Éditeur se réserve le droit de modifier, suspendre ou interrompre, temporairement ou définitivement, tout ou partie de la Plateforme pour des opérations de maintenance, de mise à jour de sécurité ou pour toute autre raison, sans préavis ni indemnité.

### 5.2. Sauvegarde préalable et perte de mots de passe
Compte tenu de la politique stricte de **rétention zéro** appliquée par la Plateforme :
- **Conservation d'une copie originale** : Il appartient impérativement à l'Utilisateur de conserver une copie de sauvegarde originale de ses fichiers sur son propre support avant toute opération de découpe, de compression, de purge de métadonnées ou de chiffrement.
- **Irréversibilité du chiffrement AES-256** : Lorsqu'un Utilisateur chiffre un document via l'outil `pdf.encrypt`, le mot de passe choisi n'est jamais stocké par l'Éditeur. **En cas d'oubli ou de perte du mot de passe par l'Utilisateur, l'Éditeur est dans l'impossibilité absolue technique et cryptographique de déverrouiller ou de récupérer le document.**

### 5.3. Limitation de responsabilité
Dans toute la mesure permise par la législation applicable, l'Éditeur ne saurait en aucun cas être tenu responsable des dommages directs ou indirects (tels que perte de données, altération visuelle d'un document complexe lors d'une conversion, perte d'exploitation, perte de chance ou préjudice commercial) résultant de l'utilisation ou de l'impossibilité d'utiliser la Plateforme.

---

## ARTICLE 6 — MODIFICATION DES CGU

L'Éditeur se réserve la faculté d'adapter ou de mettre à jour les présentes CGU à tout moment afin de tenir compte des évolutions techniques de la Plateforme ou des évolutions législatives et réglementaires. La version applicable est celle publiée sur la Plateforme à la date d'utilisation par l'Utilisateur.

---

## ARTICLE 7 — DROIT APPLICABLE ET RÈGLEMENT DES LITIGES

Les présentes CGU sont soumises au **droit français**.

En cas de difficulté ou de réclamation relative à l'utilisation de la Plateforme, l'Utilisateur est invité à contacter préalablement l'Éditeur à l'adresse électronique suivante afin de rechercher une solution amiable : `contact@tibus-dev.fr`.

À défaut de règlement amiable, tout litige relatif à la validité, l'interprétation ou l'exécution des présentes CGU sera porté devant les juridictions françaises compétentes conformément aux règles de procédure civile en vigueur.
