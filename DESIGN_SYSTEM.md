# FOLIO DESIGN SYSTEM — Guide de Direction Artistique & Architecture UI/UX

> **Identité & Philosophie** : **Industrial / Editorial Precision UI (Mobile-First & Touch-Hardened)**  
> **Inspirations directes** : Dieter Rams (Braun), Linear, Raycast, Craft Docs, ingénierie documentaire suisse.  
> **Manifeste Anti-Slop IA** : Strictement **zéro** dégradé violet/néon, **zéro** blob flou en arrière-plan, **zéro** carte en glassmorphism flottante (`backdrop-filter`), **zéro** `box-shadow` diffuse, **zéro** coin sur-arrondi (`rounded-2xl`/`pill`). La hiérarchie repose exclusivement sur des **filets techniques de 1px** (`--rule-hairline`, `--rule-strong`), des **aplats francs** (Encre Carbone / Papier Éditorial), une **dualité typographique Sans/Mono** rigoureuse et des **accents fonctionnels de haute précision** (Terracotta, Vert Technique, Ambre, Rouge Alerte).

---

## 1. ADN Visuel & Fondamentaux (Design Tokens)

### 1.1 Palette Chromatique : Dualité « Encre Sombre » (`dark`) & « Papier Éditorial » (`light`)

Le thème est piloté par l'attribut `data-theme="dark"` (défaut) ou `data-theme="light"` sur la balise `<html>`.

| Token CSS | Rôle Sémantique | Thème `dark` (Encre) | Thème `light` (Papier) | Usage précis |
| :--- | :--- | :--- | :--- | :--- |
| `--bg-canvas` | Fond de toile / Puits | `#111214` | `#f3efe6` | Fond `body`, intérieur des champs (`.input`), cartes en creux (`.page-card`, `.audit-entry`), rail du switch segmenté |
| `--bg-surface` | Surface principale | `#17181c` | `#faf7f0` | Topbar, rails latéraux (`.rail`, `.inspector`), panneaux (`.panel`), modales, bottom sheets |
| `--bg-subtle` | Surface secondaire | `#141519` | `#ede8dd` | Barres d'en-tête de panneau (`.panel__bar`), pieds de formulaire (`.inspector__submit`), `<th>` de tableaux |
| `--bg-elevated` | Surface surélevée / Active | `#1e2026` | `#ece7dc` | États `:hover` / `:active` / sélectionnés (`aria-selected="true"`), boutons par défaut, tags (`.mono-tag`), toasts |
| `--ink-primary` | Encre principale | `#ece9e2` | `#16171a` | Titres, valeurs clés, textes principaux, labels de champs |
| `--ink-secondary` | Encre secondaire | `#a09d96` | `#4e4d48` | Résumés, descriptions, options non actives, texte courant de prose |
| `--ink-muted` | Encre technique atténuée | `#6c6a64` | `#78756e` | `.mono-label`, métadonnées secondaires, empreintes SHA-256, aides de champs (`.field__help`) |
| `--rule-hairline` | Filet de structure (1px) | `#282a32` | `#d6d0c3` | Grille principale, séparateurs de panneaux, bordures de lignes et de cellules |
| `--rule-strong` | Filet d'emphase (1px) | `#3a3d47` | `#b8b0a0` | Bordures d'inputs, boutons, modales, dropzone (`dashed`), onglet actif |
| `--accent-terracotta` | Accent primaire (Braun) | `#d0532f` | `#b84322` | CTA primaire, indicateur d'onglet actif (filet gauche `3px`), codes outils (`.skill-code`), focus ring, liens |
| `--accent-terracotta-hover` | Terracotta survol | `#e0613c` | `#9f3719` | Survol bouton primaire et liens d'action |
| `--accent-terracotta-active`| Terracotta pressé | `#b94422` | `#872d13` | État `:active` bouton primaire |
| `--accent-tech-green` | Statut OK / Local | `#248f59` | `#186b40` | Badges `LOCAL`, LED de succès, bordure du panneau de résultat (`.panel--output`), bloc d'exemple valide |
| `--accent-tech-green-bg` | Fond statut OK | `rgba(36, 143, 89, 0.12)` | `rgba(24, 107, 64, 0.1)` | Fond translucide des badges `LOCAL` / `PRÊT` |
| `--accent-amber` | Statut Éphémère / Attention| `#d4881c` | `#9e6208` | Badges `ÉPHÉMÈRE` / `REMOTE`, avertissements non bloquants |
| `--accent-amber-bg` | Fond statut Ambre | `rgba(212, 136, 28, 0.13)` | `rgba(158, 98, 8, 0.11)` | Fond translucide des badges `ÉPHÉMÈRE` |
| `--accent-danger` | Erreur / Destruction | `#c93b3b` | `#a82828` | Toasts d'erreur, badges `INCOMPATIBLE`, actions destructrices |

---

### 1.2 Typographie & Règle de Dualité Sans / Monospace

L'identité éditoriale repose sur le dialogue constant entre une linéale néo-grotesque (**Geist Variable**) pour la lecture humaine et une police à chasse fixe (**JetBrains Mono Variable**) pour tout ce qui relève de la machine, de la mesure ou de la taxonomie.

- **Polices (`@fontsource-variable`)** :
  - `--font-sans`: `"Geist Variable", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`
  - `--font-mono`: `"JetBrains Mono Variable", "SFMono-Regular", Consolas, monospace`
- **Discipline numérique** : Tous les éléments techniques (`code`, `pre`, `kbd`, `.mono-label`, `.mono-tag`, `.skill-code`) forcent `font-variant-numeric: tabular-nums;` pour un alignement vertical parfait des chiffres, tailles de fichiers etcompteurs.
- **Quand utiliser `--font-mono` ?**
  1. **Labels de section & en-têtes de panneaux (`.mono-label`)** : `10.5px`, `font-weight: 600`, ` uppercase`, `letter-spacing: 0.09em`, couleur `--ink-muted`.
  2. **Codes d'identification (`.skill-code`)** : ex. `pdf.assemble`, `PAGE #01`, `LEX-01 · LCEN`, `ERR · INPUT_TYPE` en `11.5px`, `font-weight: 600`, couleur `--accent-terracotta`.
  3. **Tags & Compteurs (`.mono-tag`)** : ex. `17`, `v2.0.0`, `application/pdf` en `11px`, `padding: 1px 6px`, fond `--bg-elevated`, bordure `1px solid var(--rule-hairline)`.
  4. **Unités dynamiques de formulaire (`.field__unit`)** : affichées à droite du label en `11px`, couleur `--accent-terracotta` (ex. `150 DPI`, `#B4532A`).
  5. **Saisies numériques ou techniques (`.input--mono`, `.textarea--mono`)** : plages de pages (`1-3, 5`), nombres, hash SHA-256, logs d'audit.
- **Hiérarchie Éditoriale (`--font-sans`)** :
  - **Base (`body`)** : `14px`, `line-height: 1.45`, `-webkit-font-smoothing: antialiased`.
  - **Titre d'outil (`.tool-title`)** : `22px` (`19px` sur mobile `<= 640px`), `font-weight: 650`, `letter-spacing: -0.015em`.
  - **Résumé d'outil (`.tool-summary`)** : `13.5px`, couleur `--ink-secondary`, longueur de ligne plafonnée à `max-width: 65ch`.
  - **Prose longue (`.legal-prose`)** : `13.5px`, `line-height: 1.65`, `h1` (`20px`, filet inférieur `--rule-strong`), `h2` (`15px`, filet supérieur `--rule-hairline`), `h3` (`12px`, `--font-mono`, uppercase, `--accent-terracotta`).

---

### 1.3 Rayons, Bordures, Ombres & Mouvement

1. **Rayons de bordure ultra-tendus (Angles mécaniques)** :
   - `--radius-xs: 2px` : Boutons, inputs, selects, tags, badges, onglets, cartes de pages.
   - `--radius-sm: 4px` : Panneaux (`.panel`), dropzone, switch segmenté, fenêtres modales desktop.
   - `--radius-sheet: 8px` : Uniquement sur les coins supérieurs (`8px 8px 0 0`) des Bottom Sheets mobiles.
2. **Politique « Zéro Ombre » (`box-shadow: none`)** :
   - Aucune ombre portée n'est utilisée dans le Design System.
   - Les plans sont séparés par des contrastes de luminance (`--bg-canvas` vs `--bg-surface` vs `--bg-elevated`), des bordures `1px solid` et des filets d'accentuation directionnels :
     - **Filet gauche `3px solid`** : Onglet actif (`.skill-tab[aria-selected="true"]` en terracotta), entrée d'audit ou bloc d'exemple valide (en `--accent-tech-green`), citation blockquote (en terracotta).
     - **Filet gauche `4px solid`** : Toast d'alerte (`.toast` en `--accent-danger`).
     - **Filet supérieur `3px solid`** : Modale de diagnostic (`.error-help-modal__dialog` en `--accent-terracotta`).
     - **Filet inférieur `2px solid`** : Onglet de modale actif (`.legal-tab[aria-selected="true"]` en `--accent-terracotta`).
3. **Animations & Transitions sobres et fonctionnelles** :
   - Pas de micro-rebonds superflus. Les états `:hover` et `:active` changent instantanément de couleur de fond/bordure pour une réactivité d'instrument matériel.
   - Seules 3 transitions physiques existent :
     - Ouverture des Bottom Sheets mobiles : `transition: transform 0.22s cubic-bezier(0.22, 1, 0.36, 1)`
     - Barre de progression : `transition: width 0.15s linear`
     - Rotation de miniature PDF : `transition: transform 0.15s ease`
   - Support strict de `@media (prefers-reduced-motion: reduce)` désactivant toute transition.
   - Encapsulation systématique des effets `:hover` dans `@media (hover: hover) and (pointer: fine)` pour éviter les états collants (« sticky hover ») sur écrans tactiles.

---

## 2. Architecture Spatiale, Composants & Ergonomie

### 2.1 Grille « Technical Workbench » (Desktop) vs « Touch Stage + Bottom Sheets » (Mobile)

- **Sur Desktop (`> 960px`)** :
  - **Topbar (`52px` min-height)** : Marque technique à gauche (`[F/02]` en badge terracotta + `FOLIO` + sous-titre mono `DOCUMENT ENGINE · TIER-1`) et barre d'outils à droite (Switch segmenté de mode avec point LED `.segmented__dot`, bouton d'action rapide « Charger Spécimen », bascule de thème « Papier / Encre »).
  - **Workbench 3 colonnes (`grid-template-columns: 264px minmax(0, 1fr) 330px`)** :
    1. **Rail gauche (`264px`, `.rail`)** : En-tête `PIPELINES / SKILLS` + compteur `.mono-tag`, liste verticale d'outils groupés par catégories numérotées (`01 · Assemblage & Découpe`, `02 · Édition...`), menu accordéon « Autres outils » pour les fonctions secondaires, et pied de rail affichant 3 lignes de télémétrie technique (`.spec-row` : Architecture, Chiffrement, Télémétrie) + navigation légale discrète.
    2. **Scène centrale (`minmax(0, 1fr)`, `.stage`)** : Flux vertical (`padding: 20px 24px`, `gap: 18px`) contenant la bannière de l'outil actif (`.tool-banner`), la zone d'importation (`.dropzone`), les panneaux de travail (`.panel`) et le panneau de résultat (`.panel--output`).
    3. **Inspecteur droit (`330px`, `.inspector`)** : Formulaire de configuration contextuel avec pile de champs scrollable (`.fields-stack`) et bloc de soumission épinglé en bas (`.inspector__submit` sur fond `--bg-subtle`) contenant la barre de progression et le bouton primaire pleine largeur avec raccourci clavier `<kbd>⌘↵</kbd>`.

- **Sur Tablette & Mobile (`<= 960px` et `<= 640px`)** :
  - La grille passe à 1 colonne (`grid-template-columns: 1fr`) avec un ruban horizontal de sélection rapide en haut de scène (`.mobile-skill-strip`) et un **Dock d'action fixe en zone de pouce** en bas d'écran (`.mobile-dock`, `grid-template-columns: 1.1fr 1fr 1fr 1.25fr`, gérant `env(safe-area-inset-bottom)`).
  - Chaque bouton du dock affiche un couple Clé/Valeur technique (`.mobile-dock__k` en mono `9px` uppercase + `.mobile-dock__v` en sans `12px` gras) et un CTA principal à droite (`.mobile-dock__cta`).
  - Les colonnes latérales (`.rail` et `.inspector`) se transforment automatiquement en **Slide-up Bottom Sheets** (`max-height: 82dvh`, `border-radius: 8px 8px 0 0`) dotées d'une pilule de préhension `.sheet-grabber__pill` (`36x4px`).
  - **Ergonomie tactile durcie (Apple HIG / WCAG 2.2 AA)** :
    - Cibles tactiles minimales de `44x44px` (`--touch-target-min: 44px`).
    - Police des champs `.input`, `.select`, `.textarea` forcée à `16px !important` sous `960px` pour empêcher le zoom automatique d'iOS Safari au focus.
    - Les tableaux multi-colonnes (`.file-row`) se replient en cartes Clé-Valeur condensées sans défilement horizontal.
    - Troncature centrale intelligente des noms de fichiers longs (`truncateMiddle("rapport-financier-annuel-2026.pdf", 30)` → `rapport-financi…l-2026.pdf`) pour toujours préserver la fin du nom et l'extension.

---

### 2.2 Anatomie des Composants Signature

1. **Bannière d'Outil (`.tool-banner`) & Cartouches Clé-Valeur (`.kv-cell`)** :
   - À gauche : Topline contenant le code technique en terracotta (`<code class="skill-code">pdf.assemble</code>`) + le badge de confidentialité à LED (`.privacy-badge--local` vert ou `--remote` ambre), suivi du titre `<h1>` et du résumé `<p>`.
   - À droite : Cellules de spécifications techniques encadrées (`.kv-cell`) superposant une clé mono uppercase `9.5px` (`MIMES ACCEPTÉS`, `CAPACITÉ`) et une valeur `<code>` `11.5px`.

2. **Dropzone Technique à Viseur (`.dropzone`)** :
   - Bordure pointillée `1px dashed var(--rule-strong)` qui devient pleine et terracotta (`border: 1px solid var(--accent-terracotta)`) avec fond `--bg-elevated` au survol ou lors d'un `dragover`.
   - À gauche, un **viseur optique carré** (`.dropzone__crosshair` : `40x40px`, bordure `1px solid var(--rule-strong)`, signe `+` en JetBrains Mono `18px` terracotta).

3. **Panneaux Modulaires (`.panel`)** :
   - Structure systématique : conteneur `--bg-surface` bordé de `--rule-hairline` (`--accent-tech-green` pour `.panel--output`), coiffé d'une barre `.panel__bar` sur fond `--bg-subtle` avec `.mono-label` à gauche et actions `.btn--ghost.btn--sm` à droite.

4. **Boutons (`.btn`)** :
   - `.btn` (défaut) : Fond `--bg-elevated`, bordure `1px solid var(--rule-strong)`, texte `--ink-primary`, `font-weight: 600`, `border-radius: 2px`.
   - `.btn--primary` : Fond et bordure `--accent-terracotta`, texte `#fff`.
   - `.btn--ghost` : Fond `transparent`, bordure `1px solid var(--rule-hairline)`, passe à `--bg-elevated` + bordure `--rule-strong` au survol, et bordure terracotta au clic (`:active`).
   - `.btn--block` : Pleine largeur (`width: 100%`), `justify-content: space-between`, permettant de loger le libellé à gauche et le raccourci clavier `<kbd class="btn__kbd">⌘↵</kbd>` à droite.

5. **Formulaires de Précision (`.field`)** :
   - Tous les champs (`.input`, `.select`, `.textarea`) ont un fond en creux (`--bg-canvas`) et une bordure franche (`1px solid var(--rule-strong)`).
   - Le label (`.field__label`) est en `display: flex; justify-content: space-between` afin d'accueillir à droite un indicateur de valeur/unité en temps réel (`.field__unit` en mono terracotta) pour les sliders, champs numériques ou sélecteurs de couleur.

6. **Toast d'Erreur & Modale de Diagnostic Pédagogique (`.toast` + `.error-help-modal`)** :
   - Les erreurs ne sont jamais de simples messages vagues : le toast affiche le code d'erreur machine en mono rouge (`INPUT_TYPE`, `INVALID_OPTIONS`, etc.), l'explication, et un lien souligné en mono terracotta : *« Pourquoi cela ne fonctionne pas ? Voir un exemple valide → »*.
   - Ce lien ouvre une modale de diagnostic structurée en 3 blocs : *Pourquoi ce réglage/fichier échoue*, *Comment résoudre le problème*, et un bloc encadré d'un filet gauche vert (`3px solid var(--accent-tech-green)`) montrant un *Exemple concret fonctionnel* avec un bouton permettant de charger directement un spécimen valide en un clic.

---

## 3. Ressources & Fichiers Directement Réutilisables

### 3.1 Dépendances & Chargement des Polices

Dans `package.json` :
```json
{
  "dependencies": {
    "@fontsource-variable/geist": "^5.1.0",
    "@fontsource-variable/jetbrains-mono": "^5.1.0"
  }
}
```

Dans le point d'entrée TypeScript/JavaScript (`main.ts`) :
```ts
import '@fontsource-variable/geist';
import '@fontsource-variable/jetbrains-mono';
import './design-system/tokens.css';
```

### 3.2 Feuille de Tokens & Fondations CSS Prête à Copier-Coller (`tokens-foundation.css`)

Le fichier complet des styles du projet actuel est disponible dans [`apps/web/src/design-system/tokens.css`](file:///home/ubuntu/test/apps/web/src/design-system/tokens.css). Voici le socle universel (variables, reset, typographie, layout, boutons, panneaux, formulaires, modales et dock mobile) prêt à être injecté dans votre nouveau projet :

```css
/**
 * FOLIO DESIGN SYSTEM — Core Tokens & UI Primitives
 * Industrial / Editorial UI (Mobile-First & Touch-Hardened)
 */

:root,
html[data-theme="dark"] {
  --bg-canvas: #111214;
  --bg-surface: #17181c;
  --bg-elevated: #1e2026;
  --bg-subtle: #141519;

  --ink-primary: #ece9e2;
  --ink-secondary: #a09d96;
  --ink-muted: #6c6a64;

  --rule-hairline: #282a32;
  --rule-strong: #3a3d47;

  /* Precision functional accents */
  --accent-terracotta: #d0532f;
  --accent-terracotta-hover: #e0613c;
  --accent-terracotta-active: #b94422;
  --accent-tech-green: #248f59;
  --accent-tech-green-bg: rgba(36, 143, 89, 0.12);
  --accent-amber: #d4881c;
  --accent-amber-bg: rgba(212, 136, 28, 0.13);
  --accent-danger: #c93b3b;
}

html[data-theme="light"] {
  --bg-canvas: #f3efe6;
  --bg-surface: #faf7f0;
  --bg-elevated: #ece7dc;
  --bg-subtle: #ede8dd;

  --ink-primary: #16171a;
  --ink-secondary: #4e4d48;
  --ink-muted: #78756e;

  --rule-hairline: #d6d0c3;
  --rule-strong: #b8b0a0;

  --accent-terracotta: #b84322;
  --accent-terracotta-hover: #9f3719;
  --accent-terracotta-active: #872d13;
  --accent-tech-green: #186b40;
  --accent-tech-green-bg: rgba(24, 107, 64, 0.1);
  --accent-amber: #9e6208;
  --accent-amber-bg: rgba(158, 98, 8, 0.11);
  --accent-danger: #a82828;
}

:root {
  --font-sans: "Geist Variable", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  --font-mono: "JetBrains Mono Variable", "SFMono-Regular", Consolas, monospace;
  --radius-xs: 2px;
  --radius-sm: 4px;
  --radius-sheet: 8px;

  --touch-target-min: 44px;
  --safe-top: env(safe-area-inset-top, 0px);
  --safe-bottom: env(safe-area-inset-bottom, 0px);
  --safe-left: env(safe-area-inset-left, 0px);
  --safe-right: env(safe-area-inset-right, 0px);
  --mobile-dock-height: calc(64px + var(--safe-bottom));
}
```

### 3.3 Configuration Tailwind CSS Équivalente (Optionnelle)

Si le nouveau projet utilise **Tailwind CSS**, voici le mapping exact des tokens pour garantir zéro dérive visuelle :

```js
// tailwind.config.js
export default {
  darkMode: ['selector', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        canvas: 'var(--bg-canvas)',
        surface: 'var(--bg-surface)',
        elevated: 'var(--bg-elevated)',
        subtle: 'var(--bg-subtle)',
        ink: {
          primary: 'var(--ink-primary)',
          secondary: 'var(--ink-secondary)',
          muted: 'var(--ink-muted)',
        },
        rule: {
          hairline: 'var(--rule-hairline)',
          strong: 'var(--rule-strong)',
        },
        terracotta: {
          DEFAULT: 'var(--accent-terracotta)',
          hover: 'var(--accent-terracotta-hover)',
          active: 'var(--accent-terracotta-active)',
        },
        techgreen: {
          DEFAULT: 'var(--accent-tech-green)',
          bg: 'var(--accent-tech-green-bg)',
        },
        amber: {
          DEFAULT: 'var(--accent-amber)',
          bg: 'var(--accent-amber-bg)',
        },
        danger: 'var(--accent-danger)',
      },
      fontFamily: {
        sans: ['var(--font-sans)'],
        mono: ['var(--font-mono)'],
      },
      borderRadius: {
        xs: 'var(--radius-xs)',       // 2px
        sm: 'var(--radius-sm)',       // 4px
        sheet: 'var(--radius-sheet)', // 8px
      },
      boxShadow: {
        none: 'none',
      },
    },
  },
};
```

---

## 4. System Prompt DA (À fournir à l'agent IA du nouveau projet)

Copiez-collez le bloc ci-dessous dans les instructions système (`System Prompt`, `.cursorrules`, `CLAUDE.md` ou prompt initial) de l'agent chargé de développer le nouveau site :

```markdown
### SYSTEM PROMPT — DIRECTION ARTISTIQUE & DESIGN SYSTEM « FOLIO INDUSTRIAL / EDITORIAL »

Tu agis en tant que Principal UI/UX Art Director et Lead Frontend Engineer. Tu dois concevoir et coder l'intégralité de cette application en respectant scrupuleusement la Direction Artistique **FOLIO Industrial / Editorial UI** (inspirée par Dieter Rams / Braun, Linear, Raycast et l'édition technique suisse).

#### 1. INTERDICTIONS FORMELLES (ANTI-IA SLOP)
- **ZÉRO dégradé décoratif** (`linear-gradient`, `radial-gradient`), zéro lueur néon, zéro blob flou en arrière-plan.
- **ZÉRO glassmorphism** (`backdrop-filter: blur()`), zéro carte flottante translucide.
- **ZÉRO ombre portée** (`box-shadow: none` partout). La profondeur s'exprime uniquement par l'étagement des aplats (`--bg-canvas`, `--bg-surface`, `--bg-subtle`, `--bg-elevated`) et des filets techniques de `1px solid` (`--rule-hairline`, `--rule-strong`).
- **ZÉRO coin sur-arrondi** : utilise uniquement `--radius-xs: 2px` (boutons, inputs, tags, cartes), `--radius-sm: 4px` (panneaux, modales) et `--radius-sheet: 8px` (coins supérieurs des bottom sheets mobiles).

#### 2. PALETTE & THÈMES (`data-theme="dark"` Encre / `data-theme="light"` Papier)
Utilise exclusivement ces variables CSS sur `:root` :
- **Mode Dark (`html[data-theme="dark"]`, par défaut)** :
  `--bg-canvas: #111214`, `--bg-surface: #17181c`, `--bg-elevated: #1e2026`, `--bg-subtle: #141519`, `--ink-primary: #ece9e2`, `--ink-secondary: #a09d96`, `--ink-muted: #6c6a64`, `--rule-hairline: #282a32`, `--rule-strong: #3a3d47`, `--accent-terracotta: #d0532f` (hover `#e0613c`, active `#b94422`), `--accent-tech-green: #248f59` (bg `rgba(36, 143, 89, 0.12)`), `--accent-amber: #d4881c` (bg `rgba(212, 136, 28, 0.13)`), `--accent-danger: #c93b3b`.
- **Mode Light (`html[data-theme="light"]`, papier chaud)** :
  `--bg-canvas: #f3efe6`, `--bg-surface: #faf7f0`, `--bg-elevated: #ece7dc`, `--bg-subtle: #ede8dd`, `--ink-primary: #16171a`, `--ink-secondary: #4e4d48`, `--ink-muted: #78756e`, `--rule-hairline: #d6d0c3`, `--rule-strong: #b8b0a0`, `--accent-terracotta: #b84322` (hover `#9f3719`, active `#872d13`), `--accent-tech-green: #186b40` (bg `rgba(24, 107, 64, 0.1)`), `--accent-amber: #9e6208` (bg `rgba(158, 98, 8, 0.11)`), `--accent-danger: #a82828`.

#### 3. DUALITÉ TYPOGRAPHIQUE (`Geist Variable` + `JetBrains Mono Variable`)
- **Texte & Titres (`--font-sans: "Geist Variable", sans-serif`)** : Base `14px` (`line-height: 1.45`), titres d'outils `22px` (`font-weight: 650`, `letter-spacing: -0.015em`), résumés `13.5px` (`--ink-secondary`, `max-width: 65ch`).
- **Balisage Technique (`--font-mono: "JetBrains Mono Variable", monospace`, toujours avec `font-variant-numeric: tabular-nums`)** :
  - En-têtes de panneaux (`.mono-label`) : `10.5px`, `600`, `uppercase`, `letter-spacing: 0.09em`, `--ink-muted`.
  - Identifiants & codes (`.skill-code`) : `11.5px`, `600`, `--accent-terracotta` (ex: `sys.module`, `MOD-01`).
  - Compteurs & métadonnées (`.mono-tag`) : `11px`, `padding: 1px 6px`, fond `--bg-elevated`, bordure `1px solid var(--rule-hairline)`, `border-radius: 2px`.
  - Unités dynamiques dans les labels de formulaires (`.field__unit`) : `11px`, `--accent-terracotta`.

#### 4. ARCHITECTURE SPATIALE & COMPOSANTS SIGNATURE
- **Desktop (`> 960px`)** : Topbar technique fixe (`52px`, badge marque `[X/01]` en terracotta, switch segmenté à point LED `.segmented__dot`, switch thème « Papier / Encre ») + Grille Workbench 3 colonnes (`264px minmax(0, 1fr) 330px`) divisée par des filets `1px solid var(--rule-hairline)` (Rail de navigation à gauche avec télémétrie en pied de colonne, Scène centrale, Inspecteur de paramètres à droite avec bouton d'action primaire pleine largeur `.btn--primary.btn--block` affichant `<kbd>⌘↵</kbd>`).
- **Signature visuelle des états actifs** :
  - Onglet actif : fond `--bg-elevated`, bordure `--rule-strong` et **filet gauche `3px solid var(--accent-terracotta)`**.
  - Panneau de résultat / succès : bordure `1px solid var(--accent-tech-green)` + point LED `.status-led--ok` (`8x8px` vert).
  - Modale de diagnostic : bordure `1px solid var(--rule-strong)` et **filet supérieur `3px solid var(--accent-terracotta)`**.
- **Mobile-First & Touch-Hardened (`<= 960px`)** :
  - Les rails latéraux deviennent des **Slide-up Bottom Sheets** (`max-height: 82dvh`, `border-radius: 8px 8px 0 0`, transition `0.22s cubic-bezier(0.22, 1, 0.36, 1)`) avec pilule `.sheet-grabber__pill`.
  - **Sticky Bottom Dock (`.mobile-dock`)** en zone de pouce (`grid-template-columns: 1.1fr 1fr 1fr 1.25fr`, `padding-bottom: env(safe-area-inset-bottom)`) avec boutons Clé/Valeur (`.mobile-dock__k` + `.mobile-dock__v`) et CTA terracotta.
  - Cibles tactiles `>= 44px`, inputs forcés à `16px` sur mobile (anti-zoom iOS), et effets `:hover` strictement isolés dans `@media (hover: hover) and (pointer: fine)`.
```
