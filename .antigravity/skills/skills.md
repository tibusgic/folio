1. Back-end : L'API et le moteur de traitement
Le Back-end sera une API REST sans état (stateless). Il ne stocke rien de manière permanente : il reçoit un fichier, le traite en RAM ou dans un dossier temporaire, le renvoie et nettoie les traces.

Stack recommandée : Python avec FastAPI (pour sa rapidité et sa documentation Swagger générée automatiquement).

Les routes (Endpoints)
POST /api/merge

Entrée : Multipart form-data contenant une liste de fichiers .pdf.

Traitement : Utiliser la librairie pypdf pour concaténer les pages dans l'ordre d'arrivée.

Sortie : Un fichier merged.pdf en flux binaire (StreamingResponse).

POST /api/split

Entrée : Un fichier .pdf et une chaîne de caractères pour les pages (ex: "1-3, 5").

Traitement : Extraire les pages demandées avec pypdf. Si plusieurs fichiers sont générés, les empaqueter dans un .zip via le module zipfile.

POST /api/compress

Entrée : Un fichier .pdf et un niveau de compression (Faible, Moyen, Fort).

Traitement : Faire un appel système via le module subprocess vers Ghostscript (gs) avec les paramètres de compression adéquats.

La gestion du cycle de vie
Sécurité : Vérifier que les MIME types des fichiers envoyés sont bien application/pdf.

Nettoyage (Garbage Collection) : Utiliser les BackgroundTasks de FastAPI pour supprimer les fichiers temporaires du serveur après que la réponse ait été envoyée à l'utilisateur.

2. Front-end : L'interface utilisateur
Le Front-end doit être réactif et fonctionner comme une SPA (Single Page Application) simple.

Stack recommandée : HTML, Tailwind CSS (pour un design moderne sans écrire de CSS complexe) et JavaScript natif (Vanilla JS).

Les composants UI
Menu de navigation (Sidebar/Header) : Des tuiles claires pour sélectionner l'outil ("Fusionner", "Diviser", "Compresser").

La zone de dépôt (Dropzone) :

Une large zone au centre de l'écran avec un événement JS dragover et drop.

Changement de couleur au survol quand on glisse un fichier.

Le panneau de configuration :

Apparaît une fois le fichier chargé.

Pour la fusion : Permet de réorganiser l'ordre des fichiers (la librairie JS SortableJS est parfaite pour ça).

Pour la division : Un champ texte pour saisir les numéros de pages.

Feedback visuel : Un spinner de chargement pendant l'appel API (la compression peut prendre quelques secondes) et un bouton "Télécharger" qui apparaît au retour de l'API.

La logique JavaScript (Fetch)
Intercepter le bouton d'envoi.

Construire un objet FormData avec les fichiers et les options.

Envoyer une requête asynchrone (fetch()) vers l'endpoint FastAPI correspondant.

Convertir la réponse en Blob (fichier binaire) pour déclencher automatiquement le téléchargement dans le navigateur.

3. L'intégration (Docker)
Le point fort du projet est de tout packager dans un seul conteneur.

Image de base : python:3.11-slim

Dépendances système : Installer Ghostscript et QPDF via apt-get install dans le Dockerfile.

Structure : Le backend FastAPI servira lui-même les fichiers statiques du Front-end (HTML/JS) sur la route racine /, rendant l'application accessible sur un port unique (ex: 8000).