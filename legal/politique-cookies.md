# POLITIQUE DE GESTION DES COOKIES ET TRACEURS (DIRECTIVE ePRIVACY)

*En vigueur au 18 octobre 2026*

La présente Politique de Gestion des Cookies et Traceurs est établie en application de l'**article 5, paragraphe 3 de la Directive 2002/58/CE modifiée** (dite « **Directive ePrivacy** »), transposée en droit français à l'**article 82 de la Loi n° 78-17 du 6 janvier 1978 modifiée** (« Loi Informatique et Libertés »), ainsi que des lignes directrices et recommandations adoptées par la **Commission Nationale de l'Informatique et des Libertés (CNIL)** le 17 septembre 2020.

---

## 1. POLITIQUE « ZÉRO COOKIE PUBLICITAIRE OU DE TRAÇAGE »

La plateforme **FOLIO** (`https://pdf.tibus-dev.fr`) a fait le choix éthique et technique de **ne déposer aucun cookie publicitaire, aucun traceur de profilage, aucun pixel de suivi sur les réseaux sociaux et aucun cookie de mesure d'audience tiers** (tel que Google Analytics) sur le terminal des Utilisateurs.

Lors de votre navigation et de l'utilisation des outils documentaires de la Plateforme :
- **0 cookie HTTP (`Set-Cookie`)** n'est émis par le serveur d'application ni par le serveur web.
- **0 requête réseau tierce** n'est déclenchée vers des régies publicitaires ou des fournisseurs externes de polices ou de scripts.

---

## 2. STOCKAGE LOCAL STRICTEMENT TECHNIQUE ET NÉCESSAIRE (EXEMPTÉ DE CONSENTEMENT)

Pour assurer le fonctionnement visuel de l'interface et le traitement local de vos documents dans votre navigateur, la Plateforme utilise exclusivement les mécanismes natifs et éphémères suivants de votre navigateur, lesquels entrent dans le champ de l'**exemption légale de consentement** prévue à l'article 82 de la Loi Informatique et Libertés (traceurs ayant pour finalité exclusive de permettre ou faciliter la communication par voie électronique ou strictement nécessaires à la fourniture d'un service de communication en ligne à la demande expresse de l'utilisateur) :

| Nom / Mécanisme | Type de stockage | Finalité exclusive | Durée de conservation | Base légale (Art. 82 LIL) |
| :--- | :--- | :--- | :--- | :--- |
| **`Blob URL` / `ArrayBuffer` en mémoire WebWorker** | Mémoire vive (RAM) de l'onglet du navigateur | Rendu des vignettes de pages PDF (`URL.createObjectURL`) et exécution locale des pipelines documentaires sans envoi au serveur | **Session de l'onglet** (révoqué automatiquement dès la fermeture de l'onglet ou le clic sur « Vider la sélection » via `URL.revokeObjectURL`) | Strictement nécessaire à la fourniture du service demandé par l'Utilisateur (exempté de consentement) |
| **Préférence d'affichage (Thème Encre sombre / Papier clair & Mode Rapide / Entreprise)** | Attribut DOM / Mémoire de session locale | Mémoriser le choix ergonomique d'affichage sélectionné volontairement par l'Utilisateur dans la barre d'outils | **Session en cours** (ou jusqu'à effacement manuel des données du site dans le navigateur, et en tout état de cause **13 mois maximum**) | Choix d'interface exprimé par l'Utilisateur (exempté de consentement selon les lignes directrices CNIL) |

Conformément aux lignes directrices de la CNIL, l'utilisation exclusive de ces mécanismes purement techniques et strictement nécessaires au service demandé **dispense la Plateforme d'imposer un bandeau de recueil de consentement (« cookie wall » ou modale intrusive)** lors de l'arrivée sur le Site.

---

## 3. GESTION ET PURGE DES DONNÉES LOCALES PAR L'UTILISATEUR

Bien qu'aucun traceur soumis au consentement ne soit utilisé, vous gardez à tout moment la maîtrise totale de la mémoire locale de votre navigateur :

1. **Depuis l'interface de la Plateforme** :
   - Un simple clic sur le bouton **« Vider la sélection »** ou la fermeture de l'onglet de votre navigateur provoque la révocation immédiate des objets binaires en mémoire (`URL.revokeObjectURL` et `pdfDoc.cleanup()`).
2. **Depuis les paramètres de votre navigateur web** :
   - **Mozilla Firefox** : Menu `Paramètres` > `Vie privée et sécurité` > `Cookies et données de sites` > `Effacer les données`.
   - **Google Chrome / Chromium / Brave** : Menu `Paramètres` > `Confidentialité et sécurité` > `Supprimer les données de navigation`.
   - **Apple Safari** : Menu `Réglages` > `Confidentialité` > `Gérer les données de sites web`.
   - **Microsoft Edge** : Menu `Paramètres` > `Cookies et autorisations de site` > `Gérer et supprimer les cookies et les données de site`.

---

## 4. CONTACT

Pour toute question relative à la présente Politique de Gestion des Cookies et Traceurs, vous pouvez contacter l'Éditeur à l'adresse électronique suivante : `contact@tibus-dev.fr`.
