# POLITIQUE DE CONFIDENTIALITÉ ET DE PROTECTION DES DONNÉES PERSONNELLES (RGPD)

*En vigueur au 18 octobre 2026*

La présente Politique de Confidentialité a pour objet d'informer de manière claire, transparente et exhaustive les utilisateurs (ci-après l'« **Utilisateur** » ou « **vous** ») de la plateforme documentaire **FOLIO** (accessible à l'adresse `https://pdf.tibus-dev.fr`, ci-après la « **Plateforme** ») sur la manière dont leurs données à caractère personnel et leurs fichiers documentaires sont traités, conformément au **Règlement (UE) 2016/679 du Parlement européen et du Conseil du 27 avril 2016** (Règlement Général sur la Protection des Données, dit « **RGPD** ») et à la **Loi n° 78-17 du 6 janvier 1978 modifiée** relative à l'informatique, aux fichiers et aux libertés (dite « **Loi Informatique et Libertés** »).

---

## 1. IDENTITÉ DU RESPONSABLE DE TRAITEMENT

La Plateforme étant éditée à titre non professionnel, gratuit et sans création de compte utilisateur sous le régime de l'article 6, III, 2° de la Loi n° 2004-575 du 21 juin 2004 (LCEN), le Responsable de Traitement au sens de l'article 4, paragraphe 7 du RGPD est l'Éditeur personne physique de la Plateforme, dont l'identité complète est déclarée auprès de l'hébergeur **OVH SAS** (2 rue Kellermann, 59100 Roubaix, France).

- **Contact dédié à la protection des données et à l'exercice des droits RGPD** : `contact@tibus-dev.fr`

---

## 2. ENGAGEMENT ARCHITECTURAL : « PRIVACY-BY-DESIGN » ET RÉTENTION ZÉRO

La Plateforme a été conçue dès l'origine selon les principes de **protection des données dès la conception (*Privacy by Design*)** et de **protection des données par défaut (*Privacy by Default*)** prévus à l'article 25 du RGPD :

1. **Absence de compte utilisateur et d'inscription** : L'accès à l'intégralité des fonctionnalités de la Plateforme ne requiert aucune inscription, aucun identifiant, aucune adresse électronique ni aucun formulaire de collecte de données nominatives.
2. **Absence de ressources tierces (Zéro fuite vers des CDN externes)** : Les polices typographiques (`Geist Variable`, `JetBrains Mono Variable`), icônes, feuilles de style et moteurs d'exécution sont intégralement auto-hébergés sur le serveur de la Plateforme et protégés par une politique de sécurité du contenu stricte (`Content-Security-Policy: default-src 'self'`). Votre navigateur n'effectue aucune requête vers Google Fonts, Cloudflare CDN, unpkg ou jsDelivr lors de votre visite.
3. **Transparence par outil (Badge d'exécution temps réel)** : Chaque outil (« Skill ») affiche en permanence un badge explicite indiquant si le traitement s'effectue **`100% LOCAL · SUR VOTRE MACHINE`** ou via **`SERVEUR ÉPHÉMÈRE CHIFFRÉ · RÉTENTION ZÉRO`**.

---

## 3. SORT DES FICHIERS ET DOCUMENTS SOUMIS PAR L'UTILISATEUR

Les documents PDF, Markdown (`.md`) ou BibTeX (`.bib`) que vous manipulez peuvent contenir des données à caractère personnel ou des informations confidentielles. Leur traitement suit deux régimes techniques strictement distincts :

### 3.1. Outils à exécution 100 % locale (In-Browser / WebWorker)
Pour les pipelines suivants :
- **Assembler / Fusionner / Réorganiser / Pivoter** (`pdf.assemble`)
- **Scinder / Extraire des plages de pages** (`pdf.split`)
- **Filigrane vectoriel & Tampon d'audit** (`pdf.watermark`)
- **Signature visuelle manuscrite** (`pdf.sign-visual`)
- **Inspection technique & Sécurité** (`pdf.inspect`)
- **Réécriture ou purge des métadonnées Info/XMP** (`pdf.metadata`)
- **Extraction structurée PDF vers Markdown/JSON** (`pdf.extract`)
- **Composition Markdown vers PDF papier** (`md.pdf`)
- **Export du code source LaTeX** (`md.latex-pdf` en mode `.tex`)

**Sort des fichiers** : Vos documents **ne quittent jamais votre appareil**. Ils sont lus et transformés exclusivement dans la mémoire vive de votre propre navigateur web (via l'API standard `Web Worker` et `WebCrypto`). L'Éditeur et l'hébergeur n'ont techniquement aucun accès, même fugace, ni au contenu ni au nom de vos fichiers.

### 3.2. Outils à exécution via Serveur Éphémère Chiffré (`Zero-Retention RAM Disk`)
Pour les quatre pipelines nécessitant un binaire système natif :
- **Compilation académique Markdown → LaTeX → PDF** (`md.latex-pdf` en mode `.pdf`)
- **Compression vectorielle intelligente** (`pdf.compress`)
- **Chiffrement cryptographique AES-256** (`pdf.encrypt`)
- **Déverrouillage PDF** (`pdf.unlock`)

**Sort des fichiers et mesures techniques de sécurité (Article 32 du RGPD)** :
1. **Chiffrement en transit** : Le document est transmis entre votre navigateur et le serveur via un tunnel chiffré HTTPS/TLS.
2. **Traitement exclusif en mémoire vive volatile (RAM)** : Le fichier est reçu dans un répertoire éphémère isolé (permissions Unix `0700`) monté en mémoire vive (`tmpfs` `/dev/shm`), sur un conteneur dont le système de fichiers racine est verrouillé en lecture seule (`read_only: true`).
3. **Absence de fuite des mots de passe** : Lors d'un chiffrement ou déverrouillage PDF, le mot de passe saisi n'est jamais passé en argument de ligne de commande système (`argv`), mais transmis via un descripteur éphémère en RAM détruit immédiatement après usage.
4. **Écrasement binaire et suppression immédiate avant réponse HTTP** : Dès la génération du fichier de sortie en mémoire, et **avant même que la réponse HTTP ne vous soit renvoyée**, le serveur écrase les octets temporaires par des zéros binaires (`0x00`) et supprime le répertoire de travail en RAM. L'en-tête HTTP `X-Folio-Zero-Retention: purged-in-ram` atteste de cette purge synchrone.
5. **Durée de conservation des fichiers sur le serveur** : **Zéro seconde après le traitement** (strictement limitée au temps de calcul, inférieur à 45 secondes maximum). Aucune sauvegarde, aucune mise en cache (`Cache-Control: no-store`) et aucune journalisation du contenu ou des noms des fichiers n'est effectuée.

---

## 4. TABLEAU RÉCAPITULATIF DES TRAITEMENTS, FINALITÉS, BASES LÉGALES ET DURÉES DE CONSERVATION

Conformément aux articles 13 et 30 du RGPD, le tableau ci-dessous détaille l'ensemble des traitements susceptibles d'intervenir lors de l'utilisation de la Plateforme :

| Catégorie de données | Finalité du traitement | Base légale (Art. 6 RGPD) | Durée de conservation |
| :--- | :--- | :--- | :--- |
| **Fichiers traités en mode 100 % Local** (PDF, Markdown, signatures, métadonnées) | Exécution locale des transformations documentaires dans le navigateur de l'Utilisateur | Aucun traitement par l'Éditeur (les données restent sur l'équipement de l'Utilisateur) | **0 seconde** côté serveur (conservées uniquement dans la RAM de l'onglet navigateur jusqu'à sa fermeture) |
| **Fichiers et mots de passe traités en mode Serveur Éphémère** (`md.latex-pdf`, `pdf.compress`, `pdf.encrypt`, `pdf.unlock`) | Exécution à la demande de la compilation LaTeX, de la compression ou du chiffrement AES-256 | **Exécution d'un service demandé par l'Utilisateur** (Art. 6, § 1, b du RGPD) | **Purge immédiate et synchrone en RAM** dès la fin du calcul (durée maximale de traitement plafonnée à 45 secondes). **0 octet conservé après la requête.** |
| **Journaux techniques de connexion du serveur web** (adresse IP, horodatage, URL appelée, code statut HTTP, User-Agent) | Sécurité de l'infrastructure, prévention des attaques par déni de service (DoS), détection des abus et respect des obligations légales de conservation des données de connexion | **Intérêt légitime** de sécurisation du réseau (Art. 6, § 1, f du RGPD) et **Obligation légale** (Art. 6, § 1, c du RGPD / LCEN) | **12 mois glissants** maximum pour les journaux de sécurité système, puis suppression automatique. |
| **Correspondances envoyées volontairement au contact support** (adresse e-mail, contenu du message) | Réponse aux demandes d'assistance technique, aux signalements ou aux demandes d'exercice des droits RGPD | **Intérêt légitime** (Art. 6, § 1, f du RGPD) et **Obligation légale** (Art. 6, § 1, c du RGPD pour les demandes de droits) | Durée du traitement de la demande, puis **12 mois** maximum (ou **5 ans** en archivage intermédiaire pour la preuve du traitement d'une demande d'exercice de droits RGPD). |

---

## 5. DESTINATAIRES DES DONNÉES ET SOUS-TRAITANTS TECHNIQUES

Vos données ne font l'objet d'aucune cession, location, revente ou communication à des tiers commerciaux, courtiers en données ou régies publicitaires.

Le seul sous-traitant technique intervenant au titre de l'hébergement de l'infrastructure serveur est :
- **OVH SAS (OVHcloud)** — 2 rue Kellermann, 59100 Roubaix, France, agissant en qualité d'hébergeur d'infrastructure certifié (ISO/IEC 27001, ISO/IEC 27701) conformément à l'article 28 du RGPD.

Les journaux techniques peuvent uniquement être communiqués aux autorités judiciaires ou administratives légalement habilitées, sur réquisition écrite formelle fondée sur le droit français.

---

## 6. ABSENCE DE TRANSFERT DE DONNÉES HORS DE L'UNION EUROPÉENNE

L'intégralité de l'infrastructure serveur de la Plateforme est localisée en **France (Union Européenne)**. Aucun flux de données personnelles ni aucun fichier documentaire n'est transféré vers un pays tiers situé en dehors de l'Espace Économique Européen (EEE).

---

## 7. DROITS DES PERSONNES CONCERNÉES (ARTICLES 15 À 22 DU RGPD)

Conformément au RGPD et à la Loi Informatique et Libertés, vous disposez des droits suivants sur les données à caractère personnel vous concernant :
- **Droit d'accès** (Article 15 du RGPD) : obtenir la confirmation que des données vous concernant sont ou ne sont pas traitées et, lorsqu'elles le sont, en obtenir une copie.
- **Droit de rectification** (Article 16 du RGPD) : demander la correction de données inexactes ou incomplètes.
- **Droit à l'effacement / « droit à l'oubli »** (Article 17 du RGPD) : demander la suppression de vos données dans les limites prévues par la loi.
- **Droit à la limitation du traitement** (Article 18 du RGPD) et **droit d'opposition** (Article 21 du RGPD).
- **Droit à la portabilité** (Article 20 du RGPD) pour les données que vous auriez fournies.
- **Droit de définir des directives post-mortem** relatives au sort de vos données après votre décès (Article 85 de la Loi Informatique et Libertés).

> **Remarque importante relative aux fichiers documentaires** : Compte tenu de l'architecture à **rétention zéro** de la Plateforme, l'Éditeur ne conserve aucun fichier, aucun document PDF/Markdown/LaTeX ni aucune empreinte d'utilisateur sur ses serveurs. Par conséquent, conformément à l'article 11 du RGPD (*Traitement ne nécessitant pas l'identification*), l'Éditeur n'est matériellement jamais en mesure de retrouver, consulter, restituer ou supprimer un document après son traitement, celui-ci ayant déjà été intégralement détruit de la mémoire vive à la milliseconde où la réponse HTTP a été émise.

### Modalités d'exercice de vos droits
Pour exercer vos droits (notamment au titre d'un échange par courrier électronique ou d'une requête figurant dans les journaux techniques), vous pouvez adresser votre demande par voie électronique à :
- **Adresse e-mail** : `contact@tibus-dev.fr`

Une réponse vous sera adressée dans un délai d'un (1) mois à compter de la réception de la demande, conformément à l'article 12, paragraphe 3 du RGPD.

---

## 8. DROIT D'INTRODUIRE UNE RÉCLAMATION AUPRÈS DE LA CNIL

Si vous estimez, après nous avoir contactés, que vos droits « Informatique et Libertés » ne sont pas respectés, vous disposez du droit d'introduire une réclamation auprès de l'autorité de contrôle compétente en France :

- **Commission Nationale de l'Informatique et des Libertés (CNIL)**
- **Adresse postale** : 3 Place de Fontenoy — TSA 80715 — 75334 Paris Cedex 07, France
- **Téléphone** : +33 (0)1 53 73 22 22
- **Téléservice de plainte en ligne** : [https://www.cnil.fr/fr/plaintes](https://www.cnil.fr/fr/plaintes)
