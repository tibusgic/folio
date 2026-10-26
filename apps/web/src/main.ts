import '@fontsource-variable/geist';
import '@fontsource-variable/jetbrains-mono';
import './design-system/tokens.css';

import { zipSync } from 'fflate';
import {
  isFieldVisible,
  MIME,
  runSkill,
  sanitizeFileName,
  sha256Hex,
  SkillError,
  SkillRegistry,
  sniffMime,
  type DocumentFile,
  type RunRecord,
  type RunResult,
  type Skill,
  type SkillCategory,
  type SkillErrorCode,
  type UiMode,
} from '@folio/skills-core';
import { localSkills } from '@folio/skills-local';
import { remoteSkills } from '@folio/skills-remote';
import { buildErrorDiagnostic } from './features/error-help/error-help-modal.ts';
import { initLegalModal } from './features/legal/legal-modal.ts';
import {
  createBlankPageThumbItem,
  duplicatePageThumbItem,
  renderFileThumbnails,
  revokeThumbnails,
  type PageThumbItem,
} from './features/page-grid/thumbnails.ts';
import { renderSkillForm, type FormController } from './features/tool-panel/form-renderer.ts';
import { createSpecimenForSkill } from './specimen.ts';
import type { WorkerRequest, WorkerResponse } from './workers/skill.worker.ts';

interface LoadedFileEntry {
  readonly file: DocumentFile;
  readonly sha256: string;
}

const CATEGORY_LABELS: Record<SkillCategory, string> = {
  assemble: '01 · Assemblage & Découpe',
  convert: '02 · Édition & Compression',
  secure: '03 · Sécurité & Signatures',
  extract: '04 · Extraction Structurée',
  inspect: '05 · Conformité & XMP',
};

/**
 * Primary / flagship skills directly visible in the main rail & strip.
 * Secondary / specialized skills are housed inside the "Autres outils" menu.
 */
const PRIMARY_SKILL_IDS = new Set<string>([
  'pdf.assemble',
  'pdf.split',
  'md.pdf',
  'md.latex-pdf',
  'pdf.compress',
  'pdf.watermark',
  'pdf.sign-visual',
  'pdf.encrypt',
]);

const registry = new SkillRegistry().registerAll([...localSkills, ...remoteSkills]);

// State
let currentMode: UiMode = 'quick';
let activeSkill: Skill<any> = registry.get('pdf.assemble');
let isMoreSkillsOpen = false;
let loadedFiles: LoadedFileEntry[] = [];
let pagePlanItems: PageThumbItem[] = [];
let formController: FormController | null = null;
let lastOutputs: DocumentFile[] = [];
let activePreviewUrls: string[] = [];
let activePageSheetIndex: number | null = null;
const auditHistory: RunRecord[] = [];

// Worker setup for local skills
const skillWorker = new Worker(new URL('./workers/skill.worker.ts', import.meta.url), { type: 'module' });
let currentAbortController: AbortController | null = null;
let currentWorkerJobId: string | null = null;

// DOM references
const htmlRoot = document.documentElement;
const modeQuickBtn = document.getElementById('mode-quick-btn') as HTMLButtonElement;
const modeEnterpriseBtn = document.getElementById('mode-enterprise-btn') as HTMLButtonElement;
const sampleDocBtn = document.getElementById('sample-doc-btn') as HTMLButtonElement;
const themeToggleBtn = document.getElementById('theme-toggle-btn') as HTMLButtonElement;

const sheetBackdrop = document.getElementById('sheet-backdrop') as HTMLElement;
const skillsRailEl = document.getElementById('skills-rail') as HTMLElement;
const closeSkillsSheetBtn = document.getElementById('close-skills-sheet-btn') as HTMLButtonElement;
const optionsInspectorEl = document.getElementById('options-inspector') as HTMLElement;
const closeOptionsSheetBtn = document.getElementById('close-options-sheet-btn') as HTMLButtonElement;

const skillTablist = document.getElementById('skill-tablist') as HTMLElement;
const mobileSkillStrip = document.getElementById('mobile-skill-strip') as HTMLElement;
const skillCountBadge = document.getElementById('skill-count-badge') as HTMLElement;

const activeSkillIdEl = document.getElementById('active-skill-id') as HTMLElement;
const activeSkillTitleEl = document.getElementById('active-skill-title') as HTMLElement;
const activeSkillSummaryEl = document.getElementById('active-skill-summary') as HTMLElement;
const activeSkillVersionEl = document.getElementById('active-skill-version') as HTMLElement;
const privacyBadgeEl = document.getElementById('privacy-badge') as HTMLElement;
const privacyBadgeTextEl = document.getElementById('privacy-badge-text') as HTMLElement;
const specMimesEl = document.getElementById('spec-mimes') as HTMLElement;
const specCapacityEl = document.getElementById('spec-capacity') as HTMLElement;

const dropzoneEl = document.getElementById('dropzone') as HTMLElement;
const fileInputEl = document.getElementById('file-input') as HTMLInputElement;
const cameraInputEl = document.getElementById('camera-input') as HTMLInputElement;
const browseFilesBtn = document.getElementById('browse-files-btn') as HTMLButtonElement;
const cameraScanBtn = document.getElementById('camera-scan-btn') as HTMLButtonElement;
const clearFilesBtn = document.getElementById('clear-files-btn') as HTMLButtonElement;
const fileTableWrap = document.getElementById('file-table-wrap') as HTMLElement;
const fileSummaryCount = document.getElementById('file-summary-count') as HTMLElement;
const fileListEl = document.getElementById('file-list') as HTMLElement;

const pageGridPanel = document.getElementById('page-grid-panel') as HTMLElement;
const pageGridEl = document.getElementById('page-grid') as HTMLElement;
const insertBlankPageBtn = document.getElementById('insert-blank-page-btn') as HTMLButtonElement;
const rotateAllPlanBtn = document.getElementById('rotate-all-plan-btn') as HTMLButtonElement;
const reversePlanBtn = document.getElementById('reverse-plan-btn') as HTMLButtonElement;
const resetPlanBtn = document.getElementById('reset-plan-btn') as HTMLButtonElement;

const pageActionSheet = document.getElementById('page-action-sheet') as HTMLElement;
const pageActionBackdrop = document.getElementById('page-action-backdrop') as HTMLElement;
const pageActionCode = document.getElementById('page-action-sheet-code') as HTMLElement;
const pageActionTitle = document.getElementById('page-action-sheet-title') as HTMLElement;
const pageActionCloseBtn = document.getElementById('page-action-close-btn') as HTMLButtonElement;
const pageActRotCwBtn = document.getElementById('page-act-rot-cw') as HTMLButtonElement;
const pageActRotCcwBtn = document.getElementById('page-act-rot-ccw') as HTMLButtonElement;
const pageActDuplicateBtn = document.getElementById('page-act-duplicate') as HTMLButtonElement;
const pageActMovePrevBtn = document.getElementById('page-act-move-prev') as HTMLButtonElement;
const pageActMoveNextBtn = document.getElementById('page-act-move-next') as HTMLButtonElement;
const pageActDeleteBtn = document.getElementById('page-act-delete') as HTMLButtonElement;

const fieldsContainer = document.getElementById('fields-container') as HTMLElement;
const optionsForm = document.getElementById('skill-options-form') as HTMLFormElement;
const runSkillBtn = document.getElementById('run-skill-btn') as HTMLButtonElement;
const progressWrap = document.getElementById('progress-bar-wrap') as HTMLElement;
const progressFill = document.getElementById('progress-fill') as HTMLElement;
const progressLabel = document.getElementById('progress-label') as HTMLElement;
const cancelRunBtn = document.getElementById('cancel-run-btn') as HTMLButtonElement;

const mobileSkillsBtn = document.getElementById('mobile-skills-btn') as HTMLButtonElement;
const mobileDockSkillName = document.getElementById('mobile-dock-skill-name') as HTMLElement;
const mobileAddBtn = document.getElementById('mobile-add-btn') as HTMLButtonElement;
const mobileDockFilesCount = document.getElementById('mobile-dock-files-count') as HTMLElement;
const mobileOptionsBtn = document.getElementById('mobile-options-btn') as HTMLButtonElement;
const mobileDockOptionsLabel = document.getElementById('mobile-dock-options-label') as HTMLElement;
const mobileRunBtn = document.getElementById('mobile-run-btn') as HTMLButtonElement;
const mobileRunBtnLabel = document.getElementById('mobile-run-btn-label') as HTMLElement;

const outputPanel = document.getElementById('output-panel') as HTMLElement;
const outputMetaTag = document.getElementById('output-meta-tag') as HTMLElement;
const outputChainBar = document.getElementById('output-chain-bar') as HTMLElement;
const chainSkillSelect = document.getElementById('chain-skill-select') as HTMLSelectElement;
const chainSkillBtn = document.getElementById('chain-skill-btn') as HTMLButtonElement;
const outputFileList = document.getElementById('output-file-list') as HTMLElement;
const outputPreviewContainer = document.getElementById('output-preview-container') as HTMLElement;
const downloadAllBtn = document.getElementById('download-all-btn') as HTMLButtonElement;
const printHtmlBtn = document.getElementById('print-html-btn') as HTMLButtonElement;

const auditLogEl = document.getElementById('audit-log') as HTMLElement;
const exportAuditBtn = document.getElementById('export-audit-btn') as HTMLButtonElement;

const toastRegion = document.getElementById('toast-region') as HTMLElement;
const toastCode = document.getElementById('toast-code') as HTMLElement;
const toastMessage = document.getElementById('toast-message') as HTMLElement;
const toastHelpBtn = document.getElementById('toast-help-btn') as HTMLButtonElement;
const toastCloseBtn = document.getElementById('toast-close-btn') as HTMLButtonElement;

const errorHelpModal = document.getElementById('error-help-modal') as HTMLElement;
const errorHelpBackdrop = document.getElementById('error-help-backdrop') as HTMLElement;
const errorHelpBadge = document.getElementById('error-help-badge') as HTMLElement;
const errorHelpTitle = document.getElementById('error-help-title') as HTMLElement;
const errorHelpWhy = document.getElementById('error-help-why') as HTMLElement;
const errorHelpFix = document.getElementById('error-help-fix') as HTMLElement;
const errorHelpExampleTitle = document.getElementById('error-help-example-title') as HTMLElement;
const errorHelpExampleList = document.getElementById('error-help-example-list') as HTMLElement;
const errorHelpExampleCode = document.getElementById('error-help-example-code') as HTMLElement;
const errorHelpCloseBtn = document.getElementById('error-help-close') as HTMLButtonElement;
const errorHelpDismissBtn = document.getElementById('error-help-dismiss') as HTMLButtonElement;
const errorHelpLoadSpecimenBtn = document.getElementById('error-help-load-specimen') as HTMLButtonElement;

let lastErrorState: {
  code: SkillErrorCode;
  message: string;
  details?: Record<string, unknown>;
} | null = null;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} Mo`;
}

/**
 * Truncates long filenames in the center so both the leading identifier
 * and the file extension remain readable on narrow mobile viewports.
 */
export function truncateMiddle(name: string, maxLength = 30): string {
  if (name.length <= maxLength) return name;
  const dotIndex = name.lastIndexOf('.');
  const ext = dotIndex > 0 && name.length - dotIndex <= 8 ? name.slice(dotIndex) : '';
  const stem = ext ? name.slice(0, dotIndex) : name;
  const keep = Math.max(6, maxLength - ext.length - 1);
  const head = Math.ceil(keep * 0.62);
  const tail = Math.max(3, keep - head);
  return `${stem.slice(0, head)}…${stem.slice(-tail)}${ext}`;
}

function showToast(
  code: SkillErrorCode,
  message: string,
  details?: Record<string, unknown>,
): void {
  lastErrorState = { code, message, ...(details ? { details } : {}) };
  toastCode.textContent = code;
  toastMessage.textContent = message;
  toastHelpBtn.hidden = false;
  toastRegion.hidden = false;
}

function openErrorHelpModal(
  code: SkillErrorCode,
  message: string,
  details?: Record<string, unknown>,
): void {
  const guide = buildErrorDiagnostic(code, message, activeSkill, details);
  errorHelpBadge.textContent = guide.badge;
  errorHelpTitle.textContent = guide.title;
  errorHelpWhy.textContent = guide.why;
  errorHelpFix.textContent = guide.howToFix;
  errorHelpExampleTitle.textContent = guide.workingExampleTitle;

  errorHelpExampleList.replaceChildren();
  for (const bullet of guide.workingExampleDetails) {
    const li = document.createElement('li');
    li.textContent = bullet;
    errorHelpExampleList.appendChild(li);
  }

  if (guide.readonlyworkingExampleCode) {
    errorHelpExampleCode.textContent = guide.readonlyworkingExampleCode;
    errorHelpExampleCode.hidden = false;
  } else {
    errorHelpExampleCode.textContent = '';
    errorHelpExampleCode.hidden = true;
  }

  errorHelpModal.hidden = false;
  errorHelpCloseBtn.focus();
}

function closeErrorHelpModal(): void {
  if (errorHelpModal.hidden) return;
  errorHelpModal.hidden = true;
}

toastHelpBtn.addEventListener('click', () => {
  if (!lastErrorState) return;
  openErrorHelpModal(lastErrorState.code, lastErrorState.message, lastErrorState.details);
});

errorHelpCloseBtn.addEventListener('click', closeErrorHelpModal);
errorHelpDismissBtn.addEventListener('click', closeErrorHelpModal);
errorHelpBackdrop.addEventListener('click', closeErrorHelpModal);

errorHelpLoadSpecimenBtn.addEventListener('click', () => {
  closeErrorHelpModal();
  toastRegion.hidden = true;
  void loadSpecimenForActiveSkill();
});

toastCloseBtn.addEventListener('click', () => {
  toastRegion.hidden = true;
});

function revokeOutputPreviews(): void {
  for (const u of activePreviewUrls) URL.revokeObjectURL(u);
  activePreviewUrls = [];
}

// Mobile Bottom Sheet Management (Skills Rail & Options Inspector)
function closeAllMobileSheets(): void {
  skillsRailEl.classList.remove('is-sheet-open');
  optionsInspectorEl.classList.remove('is-sheet-open');
  mobileSkillsBtn.setAttribute('aria-expanded', 'false');
  mobileOptionsBtn.setAttribute('aria-expanded', 'false');
  sheetBackdrop.hidden = true;
}

function toggleMobileSheet(target: 'skills' | 'options'): void {
  const isSkills = target === 'skills';
  const sheetEl = isSkills ? skillsRailEl : optionsInspectorEl;
  const otherEl = isSkills ? optionsInspectorEl : skillsRailEl;
  const willOpen = !sheetEl.classList.contains('is-sheet-open');

  otherEl.classList.remove('is-sheet-open');
  sheetEl.classList.toggle('is-sheet-open', willOpen);

  mobileSkillsBtn.setAttribute('aria-expanded', String(isSkills && willOpen));
  mobileOptionsBtn.setAttribute('aria-expanded', String(!isSkills && willOpen));
  sheetBackdrop.hidden = !willOpen;
}

sheetBackdrop.addEventListener('click', closeAllMobileSheets);
closeSkillsSheetBtn.addEventListener('click', closeAllMobileSheets);
closeOptionsSheetBtn.addEventListener('click', closeAllMobileSheets);

mobileSkillsBtn.addEventListener('click', () => toggleMobileSheet('skills'));
mobileOptionsBtn.addEventListener('click', () => toggleMobileSheet('options'));
mobileAddBtn.addEventListener('click', () => {
  closeAllMobileSheets();
  fileInputEl.click();
});
mobileRunBtn.addEventListener('click', () => {
  closeAllMobileSheets();
  void executeActiveSkill();
});

function syncMobileDockState(): void {
  mobileDockSkillName.textContent = activeSkill.title;
  mobileDockFilesCount.textContent =
    loadedFiles.length === 0 ? '+ Fichier' : `${loadedFiles.length} chargé(s)`;

  const values = formController ? formController.getValues() : {};
  const visibleFieldsCount = activeSkill.fields.filter((f) =>
    isFieldVisible(f, values, currentMode),
  ).length;
  mobileDockOptionsLabel.textContent =
    visibleFieldsCount > 0 ? `Réglages (${visibleFieldsCount})` : 'Auto';
}

// Render Left Rail Skills Catalog & Mobile Horizontal Quick-Swipe Strip
function createSkillTabButton(skill: Skill<any>): HTMLButtonElement {
  const isSelected = skill.id === activeSkill.id;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.role = 'tab';
  btn.className = 'skill-tab';
  btn.setAttribute('aria-selected', String(isSelected));
  btn.dataset.skillId = skill.id;

  const nameSpan = document.createElement('span');
  nameSpan.textContent = skill.title;

  const siteBadge = document.createElement('span');
  const isLocal = skill.execution === 'local';
  siteBadge.className = `skill-tab__site ${isLocal ? 'skill-tab__site--local' : 'skill-tab__site--remote'}`;
  siteBadge.textContent = isLocal ? 'LOCAL' : 'ÉPHÉMÈRE';

  btn.append(nameSpan, siteBadge);
  btn.addEventListener('click', () => {
    selectSkill(skill.id);
    closeAllMobileSheets();
  });
  return btn;
}

function renderSkillRail(): void {
  skillTablist.replaceChildren();
  mobileSkillStrip.replaceChildren();

  const visibleSkills = registry.list({ mode: currentMode });
  skillCountBadge.textContent = String(visibleSkills.length);

  if (!visibleSkills.some((s) => s.id === activeSkill.id)) {
    activeSkill = visibleSkills[0]!;
  }

  const primarySkills = visibleSkills.filter((s) => PRIMARY_SKILL_IDS.has(s.id));
  const secondarySkills = visibleSkills.filter((s) => !PRIMARY_SKILL_IDS.has(s.id));
  const isSecondaryActive = secondarySkills.some((s) => s.id === activeSkill.id);
  if (isSecondaryActive) {
    isMoreSkillsOpen = true;
  }

  const primaryByCat = new Map<SkillCategory, Skill<any>[]>();
  for (const s of primarySkills) {
    primaryByCat.set(s.category, [...(primaryByCat.get(s.category) ?? []), s]);
  }

  for (const [cat, skills] of primaryByCat) {
    const groupHeader = document.createElement('div');
    groupHeader.className = 'skill-group-label';
    groupHeader.textContent = CATEGORY_LABELS[cat];
    skillTablist.appendChild(groupHeader);

    for (const skill of skills) {
      skillTablist.appendChild(createSkillTabButton(skill));

      // Mobile Quick-Swipe Horizontal Pill (Primary tools)
      const isSelected = skill.id === activeSkill.id;
      const pill = document.createElement('button');
      pill.type = 'button';
      pill.className = 'mobile-skill-pill';
      pill.setAttribute('aria-selected', String(isSelected));
      pill.textContent = skill.title;
      pill.addEventListener('click', () => selectSkill(skill.id));
      mobileSkillStrip.appendChild(pill);
    }
  }

  // Secondary / Specialized Tools housed in "Autres outils" collapsible menu
  if (secondarySkills.length > 0) {
    const moreSection = document.createElement('div');
    moreSection.className = 'more-skills-section';

    const toggleBtn = document.createElement('button');
    toggleBtn.type = 'button';
    toggleBtn.id = 'more-skills-toggle-btn';
    toggleBtn.className = `more-skills-toggle${isSecondaryActive ? ' has-active-skill' : ''}`;
    toggleBtn.setAttribute('aria-expanded', String(isMoreSkillsOpen));
    toggleBtn.setAttribute('aria-controls', 'more-skills-dropdown');

    const toggleLeft = document.createElement('span');
    toggleLeft.className = 'more-skills-toggle__label';
    toggleLeft.textContent = isSecondaryActive
      ? `Autres outils · ${activeSkill.title}`
      : 'Autres outils';

    const toggleRight = document.createElement('span');
    toggleRight.className = 'more-skills-toggle__meta';

    const countBadge = document.createElement('span');
    countBadge.className = 'mono-tag';
    countBadge.textContent = `+${secondarySkills.length}`;

    const chevron = document.createElement('span');
    chevron.className = 'more-skills-toggle__chevron';
    chevron.setAttribute('aria-hidden', 'true');
    chevron.textContent = isMoreSkillsOpen ? '▴' : '▾';

    toggleRight.append(countBadge, chevron);
    toggleBtn.append(toggleLeft, toggleRight);

    const dropdown = document.createElement('div');
    dropdown.id = 'more-skills-dropdown';
    dropdown.className = 'more-skills-dropdown';
    dropdown.hidden = !isMoreSkillsOpen;

    const secondaryByCat = new Map<SkillCategory, Skill<any>[]>();
    for (const s of secondarySkills) {
      secondaryByCat.set(s.category, [...(secondaryByCat.get(s.category) ?? []), s]);
    }

    for (const [cat, skills] of secondaryByCat) {
      const subHeader = document.createElement('div');
      subHeader.className = 'skill-group-label skill-group-label--sub';
      subHeader.textContent = CATEGORY_LABELS[cat];
      dropdown.appendChild(subHeader);

      for (const skill of skills) {
        dropdown.appendChild(createSkillTabButton(skill));
      }
    }

    toggleBtn.addEventListener('click', () => {
      isMoreSkillsOpen = !isMoreSkillsOpen;
      toggleBtn.setAttribute('aria-expanded', String(isMoreSkillsOpen));
      chevron.textContent = isMoreSkillsOpen ? '▴' : '▾';
      dropdown.hidden = !isMoreSkillsOpen;
    });

    moreSection.append(toggleBtn, dropdown);
    skillTablist.appendChild(moreSection);

    // Mobile Strip: if a secondary skill is active, show its pill; plus an "Autres outils" trigger
    if (isSecondaryActive) {
      const activePill = document.createElement('button');
      activePill.type = 'button';
      activePill.className = 'mobile-skill-pill';
      activePill.setAttribute('aria-selected', 'true');
      activePill.textContent = activeSkill.title;
      mobileSkillStrip.appendChild(activePill);
    }

    const moreMobilePill = document.createElement('button');
    moreMobilePill.type = 'button';
    moreMobilePill.className = 'mobile-skill-pill mobile-skill-pill--more';
    moreMobilePill.setAttribute('aria-selected', 'false');
    moreMobilePill.textContent = `Autres outils (+${secondarySkills.length}) ▾`;
    moreMobilePill.addEventListener('click', () => {
      isMoreSkillsOpen = true;
      renderSkillRail();
      toggleMobileSheet('skills');
    });
    mobileSkillStrip.appendChild(moreMobilePill);
  }
}

function selectSkill(skillId: string): void {
  activeSkill = registry.get(skillId);
  renderSkillRail();
  updateActiveToolBanner();
  formController = renderSkillForm(fieldsContainer, activeSkill, currentMode);
  renderLoadedFileTable();
  updatePageGridVisibility();
  syncMobileDockState();

  const incompatibleFile = loadedFiles.find((e) => !activeSkill.input.mimes.includes(e.file.mime));
  if (incompatibleFile) {
    showToast(
      'INPUT_TYPE',
      `Le fichier chargé « ${incompatibleFile.file.name} » (${incompatibleFile.file.mime}) n'est pas compatible avec « ${activeSkill.title} ».`,
      { accepted: [...activeSkill.input.mimes], detected: incompatibleFile.file.mime },
    );
  } else {
    toastRegion.hidden = true;
  }
}

function updateActiveToolBanner(): void {
  activeSkillIdEl.textContent = activeSkill.id;
  activeSkillTitleEl.textContent = activeSkill.title;
  activeSkillSummaryEl.textContent = activeSkill.summary;
  activeSkillVersionEl.textContent = `v${activeSkill.version}`;

  const isLocal = activeSkill.execution === 'local';
  privacyBadgeEl.className = `privacy-badge ${isLocal ? 'privacy-badge--local' : 'privacy-badge--remote'}`;
  privacyBadgeTextEl.textContent = isLocal
    ? '100% LOCAL · SUR VOTRE MACHINE'
    : 'SERVEUR ÉPHÉMÈRE CHIFFRÉ · RÉTENTION ZÉRO';

  specMimesEl.textContent = activeSkill.input.mimes.join(', ');
  const { minFiles, maxFiles } = activeSkill.input;
  specCapacityEl.textContent =
    minFiles === maxFiles ? `${minFiles} fichier` : `${minFiles}–${maxFiles} fichiers`;

  fileInputEl.accept = activeSkill.input.mimes.join(',');
  fileInputEl.multiple = activeSkill.input.maxFiles > 1;
}

// File ingestion with strict magic-byte validation + SHA-256
async function ingestBrowserFiles(rawList: FileList | File[]): Promise<void> {
  const incoming = Array.from(rawList);
  if (!incoming.length) return;

  if (activeSkill.input.maxFiles === 1) {
    clearLoadedFiles();
  }

  for (const raw of incoming) {
    const bytes = new Uint8Array(await raw.arrayBuffer());
    const detectedMime = sniffMime(bytes, raw.name);
    if (!detectedMime) {
      showToast(
        'INPUT_TYPE',
        `Le fichier « ${sanitizeFileName(raw.name)} » a été rejeté : signature binaire (magic bytes) non reconnue.`,
      );
      continue;
    }

    if (!activeSkill.input.mimes.includes(detectedMime)) {
      showToast(
        'INPUT_TYPE',
        `Le fichier « ${sanitizeFileName(raw.name)} » (${detectedMime}) est incompatible avec l’outil « ${activeSkill.title} ».`,
        { accepted: [...activeSkill.input.mimes], detected: detectedMime },
      );
      continue;
    }

    const docFile: DocumentFile = {
      name: sanitizeFileName(raw.name),
      mime: detectedMime,
      bytes,
    };
    const sha256 = await sha256Hex(bytes);
    const fileIndex = loadedFiles.push({ file: docFile, sha256 }) - 1;

    if (detectedMime === MIME.pdf) {
      const thumbs = await renderFileThumbnails(bytes, fileIndex, docFile.name);
      pagePlanItems.push(...thumbs);
    }
  }

  renderLoadedFileTable();
  renderPageGrid();
  updatePageGridVisibility();
  syncMobileDockState();
}

function clearLoadedFiles(): void {
  loadedFiles = [];
  revokeThumbnails(pagePlanItems, []);
  pagePlanItems = [];
  renderLoadedFileTable();
  renderPageGrid();
  updatePageGridVisibility();
  syncMobileDockState();
}

function renderLoadedFileTable(): void {
  fileListEl.replaceChildren();
  clearFilesBtn.hidden = loadedFiles.length === 0;
  fileTableWrap.hidden = loadedFiles.length === 0;
  fileSummaryCount.textContent = `${loadedFiles.length} fichier(s)`;

  loadedFiles.forEach((entry, idx) => {
    const isCompatible = activeSkill.input.mimes.includes(entry.file.mime);
    const row = document.createElement('div');
    row.className = 'file-row';
    row.role = 'listitem';

    const mainLine = document.createElement('div');
    mainLine.className = 'file-row__main';

    const nameEl = document.createElement('span');
    nameEl.className = 'file-row__name';
    nameEl.title = entry.file.name;
    nameEl.textContent = truncateMiddle(entry.file.name, 30);

    const statusBadge = document.createElement('span');
    statusBadge.className = isCompatible ? 'file-row__status' : 'file-row__status file-row__status--warn';
    statusBadge.textContent = isCompatible ? 'PRÊT' : 'INCOMPATIBLE';

    mainLine.append(nameEl, statusBadge);

    const metaLine = document.createElement('div');
    metaLine.className = 'file-row__meta';

    const mimeEl = document.createElement('code');
    mimeEl.className = 'mono-tag';
    mimeEl.textContent = entry.file.mime;

    const sizeEl = document.createElement('code');
    sizeEl.textContent = formatBytes(entry.file.bytes.byteLength);

    const hashEl = document.createElement('span');
    hashEl.className = 'file-row__hash';
    hashEl.title = `SHA-256 : ${entry.sha256}`;
    hashEl.textContent = `SHA-256 ${entry.sha256.slice(0, 12)}…`;

    if (!isCompatible) {
      const whyBtn = document.createElement('button');
      whyBtn.type = 'button';
      whyBtn.className = 'file-row__why-btn';
      whyBtn.textContent = 'Pourquoi ? Voir exemple';
      whyBtn.addEventListener('click', () => {
        openErrorHelpModal(
          'INPUT_TYPE',
          `« ${entry.file.name} » (${entry.file.mime}) n'est pas d'un type accepté par « ${activeSkill.title} ».`,
          { accepted: [...activeSkill.input.mimes], detected: entry.file.mime },
        );
      });
      metaLine.append(mimeEl, sizeEl, whyBtn);
    } else {
      metaLine.append(mimeEl, sizeEl, hashEl);
    }

    const rmBtn = document.createElement('button');
    rmBtn.type = 'button';
    rmBtn.className = 'icon-btn';
    rmBtn.textContent = 'Retirer';
    rmBtn.addEventListener('click', () => {
      loadedFiles.splice(idx, 1);
      revokeThumbnails(pagePlanItems, []);
      pagePlanItems = [];
      void rebuildAllThumbnails();
      renderLoadedFileTable();
      syncMobileDockState();
    });

    metaLine.appendChild(rmBtn);
    row.append(mainLine, metaLine);
    fileListEl.appendChild(row);
  });
}

async function rebuildAllThumbnails(): Promise<void> {
  revokeThumbnails(pagePlanItems, []);
  pagePlanItems = [];
  for (let i = 0; i < loadedFiles.length; i++) {
    const entry = loadedFiles[i]!;
    if (entry.file.mime === MIME.pdf) {
      const thumbs = await renderFileThumbnails(entry.file.bytes, i, entry.file.name);
      pagePlanItems.push(...thumbs);
    }
  }
  renderPageGrid();
  updatePageGridVisibility();
}

function updatePageGridVisibility(): void {
  const show = Boolean(activeSkill.usesPagePlan && pagePlanItems.length > 0);
  pageGridPanel.hidden = !show;
}

// Contextual Page Action Bottom Sheet (Rotate, Duplicate, Move, Delete)
function openPageActionSheet(index: number): void {
  const item = pagePlanItems[index];
  if (!item) return;
  activePageSheetIndex = index;
  pageActionCode.textContent = `PAGE #${String(index + 1).padStart(2, '0')} · ${item.rotate}°`;
  pageActionTitle.textContent = `${truncateMiddle(item.fileName, 26)} (p.${item.pageNumber})`;
  pageActMovePrevBtn.disabled = index === 0;
  pageActMoveNextBtn.disabled = index >= pagePlanItems.length - 1;
  pageActionSheet.hidden = false;
  pageActRotCwBtn.focus();
}

function closePageActionSheet(): void {
  if (pageActionSheet.hidden) return;
  const restoreIdx = activePageSheetIndex;
  activePageSheetIndex = null;
  pageActionSheet.hidden = true;
  if (restoreIdx !== null && restoreIdx >= 0) {
    const cards = pageGridEl.querySelectorAll<HTMLElement>('.page-card');
    cards[Math.min(restoreIdx, cards.length - 1)]?.focus();
  }
}

pageActionCloseBtn.addEventListener('click', closePageActionSheet);
pageActionBackdrop.addEventListener('click', closePageActionSheet);

pageActRotCwBtn.addEventListener('click', () => {
  if (activePageSheetIndex === null) return;
  const item = pagePlanItems[activePageSheetIndex];
  if (!item) return;
  item.rotate = (((item.rotate + 90) % 360) as 0 | 90 | 180 | 270);
  renderPageGrid(activePageSheetIndex);
  closePageActionSheet();
});

pageActRotCcwBtn.addEventListener('click', () => {
  if (activePageSheetIndex === null) return;
  const item = pagePlanItems[activePageSheetIndex];
  if (!item) return;
  item.rotate = (((item.rotate + 270) % 360) as 0 | 90 | 180 | 270);
  renderPageGrid(activePageSheetIndex);
  closePageActionSheet();
});

pageActDuplicateBtn.addEventListener('click', () => {
  if (activePageSheetIndex === null) return;
  const item = pagePlanItems[activePageSheetIndex];
  if (!item) return;
  const dup = duplicatePageThumbItem(item);
  pagePlanItems.splice(activePageSheetIndex + 1, 0, dup);
  const nextIdx = activePageSheetIndex + 1;
  renderPageGrid(nextIdx);
  closePageActionSheet();
});

pageActMovePrevBtn.addEventListener('click', () => {
  if (activePageSheetIndex === null || activePageSheetIndex <= 0) return;
  const idx = activePageSheetIndex;
  const [moved] = pagePlanItems.splice(idx, 1);
  pagePlanItems.splice(idx - 1, 0, moved!);
  activePageSheetIndex = idx - 1;
  renderPageGrid(activePageSheetIndex);
  closePageActionSheet();
});

pageActMoveNextBtn.addEventListener('click', () => {
  if (activePageSheetIndex === null || activePageSheetIndex >= pagePlanItems.length - 1) return;
  const idx = activePageSheetIndex;
  const [moved] = pagePlanItems.splice(idx, 1);
  pagePlanItems.splice(idx + 1, 0, moved!);
  activePageSheetIndex = idx + 1;
  renderPageGrid(activePageSheetIndex);
  closePageActionSheet();
});

pageActDeleteBtn.addEventListener('click', () => {
  if (activePageSheetIndex === null) return;
  const idx = activePageSheetIndex;
  const removed = pagePlanItems.splice(idx, 1);
  revokeThumbnails(removed, pagePlanItems);
  renderPageGrid(Math.min(idx, pagePlanItems.length - 1));
  updatePageGridVisibility();
  closePageActionSheet();
});

// Accessible Drag & Drop + Touch Handle Reorder Contact Sheet
let draggedIndex: number | null = null;

function renderPageGrid(focusIndex?: number): void {
  pageGridEl.replaceChildren();

  pagePlanItems.forEach((item, index) => {
    const card = document.createElement('div');
    card.className = 'page-card';
    card.role = 'option';
    card.tabIndex = 0;
    card.draggable = true;
    card.dataset.pageIndex = String(index);
    card.setAttribute(
      'aria-label',
      `Page ${index + 1} issue de ${item.fileName} (page source ${item.pageNumber})`,
    );

    // Head bar with Touch Drag Handle (touch-action: none) + Quick Actions
    const head = document.createElement('div');
    head.className = 'page-card__head';

    const dragHandle = document.createElement('button');
    dragHandle.type = 'button';
    dragHandle.className = 'page-card__drag-handle';
    dragHandle.title = 'Maintenir et glisser pour réordonner la page';
    dragHandle.setAttribute('aria-label', `Déplacer la page ${index + 1}`);
    dragHandle.textContent = `⠿ #${String(index + 1).padStart(2, '0')}`;

    // Native Pointer / Touch Drag-and-Drop on the handle (prevents scroll conflict on iOS/Android)
    let pointerActive = false;
    let targetDropIndex: number | null = null;

    dragHandle.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.stopPropagation();
      pointerActive = true;
      targetDropIndex = index;
      dragHandle.setPointerCapture(e.pointerId);
      card.classList.add('is-dragging');
    });

    dragHandle.addEventListener('pointermove', (e) => {
      if (!pointerActive) return;
      e.preventDefault();
      const elUnderPointer = document.elementFromPoint(e.clientX, e.clientY);
      const hoveredCard = elUnderPointer?.closest<HTMLElement>('.page-card');
      pageGridEl
        .querySelectorAll('.page-card.is-drop-target')
        .forEach((c) => c.classList.remove('is-drop-target'));

      if (hoveredCard && hoveredCard !== card) {
        const candidateIdx = Number(hoveredCard.dataset.pageIndex);
        if (!Number.isNaN(candidateIdx)) {
          targetDropIndex = candidateIdx;
          hoveredCard.classList.add('is-drop-target');
        }
      }
    });

    const finishPointerDrag = (e: PointerEvent) => {
      if (!pointerActive) return;
      pointerActive = false;
      if (dragHandle.hasPointerCapture(e.pointerId)) {
        dragHandle.releasePointerCapture(e.pointerId);
      }
      card.classList.remove('is-dragging');
      pageGridEl
        .querySelectorAll('.page-card.is-drop-target')
        .forEach((c) => c.classList.remove('is-drop-target'));

      if (targetDropIndex !== null && targetDropIndex !== index) {
        const [moved] = pagePlanItems.splice(index, 1);
        pagePlanItems.splice(targetDropIndex, 0, moved!);
        renderPageGrid(targetDropIndex);
      }
      targetDropIndex = null;
    };

    dragHandle.addEventListener('pointerup', finishPointerDrag);
    dragHandle.addEventListener('pointercancel', finishPointerDrag);

    const actions = document.createElement('div');
    actions.className = 'page-card__actions';

    const rotBtn = document.createElement('button');
    rotBtn.type = 'button';
    rotBtn.className = 'icon-btn desktop-only';
    rotBtn.title = 'Pivoter de 90° (R)';
    rotBtn.textContent = '↻';
    rotBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      item.rotate = (((item.rotate + 90) % 360) as 0 | 90 | 180 | 270);
      renderPageGrid(index);
    });

    const menuBtn = document.createElement('button');
    menuBtn.type = 'button';
    menuBtn.className = 'icon-btn';
    menuBtn.title = 'Actions sur la page (pivoter, dupliquer, supprimer)';
    menuBtn.setAttribute('aria-label', `Menu d’actions pour la page ${index + 1}`);
    menuBtn.textContent = '⋯';
    menuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openPageActionSheet(index);
    });

    actions.append(rotBtn, menuBtn);
    head.append(dragHandle, actions);

    // Thumbnail image (or lightweight vector placeholder when beyond mobile RAM cap)
    const thumbWrap = document.createElement('div');
    thumbWrap.className = 'page-card__thumb';
    if (item.blank) {
      const placeholder = document.createElement('div');
      placeholder.className = 'page-card__placeholder page-card__placeholder--blank';
      placeholder.textContent = `PAGE BLANCHE · A4${item.rotate ? ` · ${item.rotate}°` : ''}`;
      thumbWrap.appendChild(placeholder);
    } else if (item.objectUrl) {
      const img = document.createElement('img');
      img.src = item.objectUrl;
      img.alt = `${item.fileName} page ${item.pageNumber}`;
      img.draggable = false;
      img.loading = 'lazy';
      img.style.transform = `rotate(${item.rotate}deg)`;
      thumbWrap.appendChild(img);
    } else {
      const placeholder = document.createElement('div');
      placeholder.className = 'page-card__placeholder';
      placeholder.textContent = `PAGE ${item.pageNumber} · ${item.rotate}°`;
      thumbWrap.appendChild(placeholder);
    }

    // Footnote with middle truncation
    const foot = document.createElement('div');
    foot.className = 'page-card__foot';
    foot.textContent = item.blank
      ? `Intercalaire vierge · #${item.pageNumber}${item.rotate ? ` · ${item.rotate}°` : ''}`
      : `${truncateMiddle(item.fileName, 18)} · p.${item.pageNumber}${item.rotate ? ` · ${item.rotate}°` : ''}`;

    // Keyboard accessibility (Alt+ArrowLeft/Right to reorder, R to rotate, Delete to remove, Enter for action sheet)
    card.addEventListener('keydown', (e) => {
      if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        e.preventDefault();
        const target = e.key === 'ArrowLeft' ? index - 1 : index + 1;
        if (target >= 0 && target < pagePlanItems.length) {
          const [moved] = pagePlanItems.splice(index, 1);
          pagePlanItems.splice(target, 0, moved!);
          renderPageGrid(target);
        }
      } else if (e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        item.rotate = (((item.rotate + 90) % 360) as 0 | 90 | 180 | 270);
        renderPageGrid(index);
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        const removed = pagePlanItems.splice(index, 1);
        revokeThumbnails(removed, pagePlanItems);
        renderPageGrid(Math.min(index, pagePlanItems.length - 1));
      }
    });

    // Desktop HTML5 Drag & Drop fallback
    card.addEventListener('dragstart', () => {
      draggedIndex = index;
      card.classList.add('is-dragging');
    });
    card.addEventListener('dragend', () => {
      draggedIndex = null;
      card.classList.remove('is-dragging');
    });
    card.addEventListener('dragover', (e) => {
      e.preventDefault();
    });
    card.addEventListener('drop', (e) => {
      e.preventDefault();
      if (draggedIndex === null || draggedIndex === index) return;
      const [moved] = pagePlanItems.splice(draggedIndex, 1);
      pagePlanItems.splice(index, 0, moved!);
      draggedIndex = null;
      renderPageGrid(index);
    });

    card.append(head, thumbWrap, foot);
    pageGridEl.appendChild(card);
  });

  if (focusIndex !== undefined && focusIndex >= 0) {
    const cards = pageGridEl.querySelectorAll<HTMLElement>('.page-card');
    cards[focusIndex]?.focus();
  }
}

insertBlankPageBtn.addEventListener('click', () => {
  const blankCount = pagePlanItems.filter((p) => p.blank).length;
  const blankItem = createBlankPageThumbItem(blankCount + 1);
  pagePlanItems.push(blankItem);
  renderPageGrid(pagePlanItems.length - 1);
  updatePageGridVisibility();
});

rotateAllPlanBtn.addEventListener('click', () => {
  if (pagePlanItems.length === 0) return;
  for (const item of pagePlanItems) {
    item.rotate = (((item.rotate + 90) % 360) as 0 | 90 | 180 | 270);
  }
  renderPageGrid();
});

reversePlanBtn.addEventListener('click', () => {
  if (pagePlanItems.length <= 1) return;
  pagePlanItems.reverse();
  renderPageGrid();
});

resetPlanBtn.addEventListener('click', () => {
  void rebuildAllThumbnails();
});

// Dropzone & Mobile Native Picker / Camera Events
dropzoneEl.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;
  if (target.closest('button')) return;
  fileInputEl.click();
});
dropzoneEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    fileInputEl.click();
  }
});
browseFilesBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  fileInputEl.click();
});
cameraScanBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  cameraInputEl.click();
});
fileInputEl.addEventListener('change', () => {
  if (fileInputEl.files) void ingestBrowserFiles(fileInputEl.files);
  fileInputEl.value = '';
});
cameraInputEl.addEventListener('change', () => {
  if (cameraInputEl.files) void ingestBrowserFiles(cameraInputEl.files);
  cameraInputEl.value = '';
});
['dragenter', 'dragover'].forEach((evt) => {
  dropzoneEl.addEventListener(evt, (e) => {
    e.preventDefault();
    dropzoneEl.classList.add('is-dragover');
  });
});
['dragleave', 'drop'].forEach((evt) => {
  dropzoneEl.addEventListener(evt, (e) => {
    e.preventDefault();
    dropzoneEl.classList.remove('is-dragover');
  });
});
dropzoneEl.addEventListener('drop', (e: DragEvent) => {
  if (e.dataTransfer?.files) void ingestBrowserFiles(e.dataTransfer.files);
});
clearFilesBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  clearLoadedFiles();
});

// Execute Skill (Worker for local, main thread fetch for remote-ephemeral)
function runLocalSkillInWorker(
  skillId: string,
  files: DocumentFile[],
  options: Record<string, unknown>,
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const jobId = `job_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    currentWorkerJobId = jobId;

    const onMessage = (ev: MessageEvent<WorkerResponse>) => {
      const msg = ev.data;
      if (msg.jobId !== jobId) return;

      if (msg.type === 'progress') {
        progressFill.style.width = `${Math.round(msg.fraction * 100)}%`;
        if (msg.label) progressLabel.textContent = msg.label;
      } else if (msg.type === 'result') {
        skillWorker.removeEventListener('message', onMessage);
        currentWorkerJobId = null;
        resolve(msg.result);
      } else if (msg.type === 'error') {
        skillWorker.removeEventListener('message', onMessage);
        currentWorkerJobId = null;
        reject(SkillError.from(msg.error));
      }
    };

    skillWorker.addEventListener('message', onMessage);

    const clonedFiles: DocumentFile[] = files.map((f) => ({
      name: f.name,
      mime: f.mime,
      bytes: f.bytes.slice(),
    }));
    const transferables = clonedFiles.map((f) => f.bytes.buffer);

    skillWorker.postMessage(
      {
        type: 'run',
        jobId,
        skillId,
        files: clonedFiles,
        options,
      } satisfies WorkerRequest,
      transferables,
    );
  });
}

async function executeActiveSkill(): Promise<void> {
  toastRegion.hidden = true;
  if (loadedFiles.length === 0) {
    showToast('INPUT_COUNT', 'Veuillez sélectionner au moins un fichier avant de lancer le pipeline.');
    return;
  }

  const rawOptions = formController ? formController.getValues() : {};
  if (activeSkill.usesPagePlan && pagePlanItems.length > 0) {
    rawOptions.plan = pagePlanItems.map((p) => ({
      file: p.fileIndex,
      page: p.pageNumber,
      rotate: p.rotate,
      ...(p.blank ? { blank: true } : {}),
    }));
  }

  runSkillBtn.disabled = true;
  mobileRunBtn.disabled = true;
  mobileRunBtnLabel.textContent = 'En cours…';
  progressWrap.hidden = false;
  progressFill.style.width = '8%';
  progressLabel.textContent = 'Initialisation…';

  currentAbortController = new AbortController();

  try {
    const inputDocs = loadedFiles.map((e) => e.file);
    let result: RunResult;

    if (activeSkill.execution === 'local') {
      result = await runLocalSkillInWorker(activeSkill.id, inputDocs, rawOptions);
    } else {
      result = await runSkill(activeSkill, inputDocs, rawOptions, {
        signal: currentAbortController.signal,
        onProgress: (fraction, label) => {
          progressFill.style.width = `${Math.round(fraction * 100)}%`;
          if (label) progressLabel.textContent = label;
        },
      });
    }

    presentOutput(result);
    appendAuditRecord(result.record);
    closeAllMobileSheets();
    outputPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch (err) {
    const skillErr = SkillError.from(err);
    showToast(skillErr.code, skillErr.message, skillErr.details);
  } finally {
    runSkillBtn.disabled = false;
    mobileRunBtn.disabled = false;
    mobileRunBtnLabel.textContent = 'Convertir';
    progressWrap.hidden = true;
    currentAbortController = null;
  }
}

cancelRunBtn.addEventListener('click', () => {
  if (currentWorkerJobId) {
    skillWorker.postMessage({ type: 'abort', jobId: currentWorkerJobId } satisfies WorkerRequest);
  }
  currentAbortController?.abort();
});

optionsForm.addEventListener('submit', (e) => {
  e.preventDefault();
  void executeActiveSkill();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (!errorHelpModal.hidden) {
      e.preventDefault();
      closeErrorHelpModal();
      return;
    }
    if (!pageActionSheet.hidden) {
      e.preventDefault();
      closePageActionSheet();
      return;
    }
    if (!sheetBackdrop.hidden) {
      e.preventDefault();
      closeAllMobileSheets();
      return;
    }
  }
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
    e.preventDefault();
    void executeActiveSkill();
  }
});

// Output Presentation & Pipeline Chaining ("Envoyer le résultat vers…")
function populateChainSkillOptions(files: readonly DocumentFile[]): void {
  chainSkillSelect.replaceChildren();
  const primary = files[0];
  if (!primary) {
    outputChainBar.hidden = true;
    return;
  }

  const allSkills = registry.list();
  const compatibleTargets = allSkills.filter(
    (s) => s.id !== activeSkill.id && s.input.mimes.includes(primary.mime),
  );

  if (compatibleTargets.length === 0) {
    outputChainBar.hidden = true;
    return;
  }

  for (const target of compatibleTargets) {
    const opt = document.createElement('option');
    opt.value = target.id;
    const siteTag = target.execution === 'local' ? '100% Local' : 'Éphémère';
    opt.textContent = `${target.title} (${target.id} · ${siteTag})`;
    chainSkillSelect.appendChild(opt);
  }
  outputChainBar.hidden = false;
}

async function chainOutputToSelectedSkill(): Promise<void> {
  const targetSkillId = chainSkillSelect.value;
  if (!targetSkillId || lastOutputs.length === 0) return;

  const targetSkill = registry.get(targetSkillId);
  const compatibleOutputs = lastOutputs
    .filter((f) => targetSkill.input.mimes.includes(f.mime))
    .slice(0, targetSkill.input.maxFiles);

  if (compatibleOutputs.length === 0) return;

  // If the target skill requires enterprise mode and we are in quick mode, switch automatically
  if (!targetSkill.modes.includes(currentMode)) {
    setUiMode('enterprise');
  }

  toastRegion.hidden = true;
  clearLoadedFiles();

  for (let i = 0; i < compatibleOutputs.length; i++) {
    const doc = {
      name: compatibleOutputs[i]!.name,
      mime: compatibleOutputs[i]!.mime,
      bytes: compatibleOutputs[i]!.bytes.slice(),
    };
    const sha256 = await sha256Hex(doc.bytes);
    loadedFiles.push({ file: doc, sha256 });
  }

  outputPanel.hidden = true;
  selectSkill(targetSkill.id);
  await rebuildAllThumbnails();
  syncMobileDockState();

  const workspaceMain = document.getElementById('workspace-main');
  workspaceMain?.scrollTo({ top: 0, behavior: 'smooth' });
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

chainSkillBtn.addEventListener('click', () => {
  void chainOutputToSelectedSkill();
});

function presentOutput(result: RunResult): void {
  revokeOutputPreviews();
  lastOutputs = result.files;
  outputPanel.hidden = false;
  populateChainSkillOptions(result.files);

  const totalBytes = result.files.reduce((acc, f) => acc + f.bytes.byteLength, 0);
  outputMetaTag.textContent = `${result.files.length} fichier(s) · ${formatBytes(totalBytes)} · ${result.record.durationMs} ms`;

  outputFileList.replaceChildren();
  result.record.outputs.forEach((digest, idx) => {
    const file = result.files[idx]!;
    const row = document.createElement('div');
    row.className = 'file-row';

    const mainLine = document.createElement('div');
    mainLine.className = 'file-row__main';

    const name = document.createElement('span');
    name.className = 'file-row__name';
    name.title = file.name;
    name.textContent = truncateMiddle(file.name, 30);

    const status = document.createElement('span');
    status.className = 'file-row__status';
    status.textContent = 'GÉNÉRÉ';

    mainLine.append(name, status);

    const metaLine = document.createElement('div');
    metaLine.className = 'file-row__meta';

    const mime = document.createElement('code');
    mime.className = 'mono-tag';
    mime.textContent = file.mime;

    const size = document.createElement('code');
    size.textContent = formatBytes(file.bytes.byteLength);

    const hash = document.createElement('span');
    hash.className = 'file-row__hash';
    hash.textContent = `SHA-256 ${digest.sha256.slice(0, 12)}…`;

    const dlBtn = document.createElement('button');
    dlBtn.type = 'button';
    dlBtn.className = 'btn btn--ghost btn--sm';
    dlBtn.textContent = 'Enregistrer';
    dlBtn.addEventListener('click', () => triggerDownload(file));

    metaLine.append(mime, size, hash, dlBtn);
    row.append(mainLine, metaLine);
    outputFileList.appendChild(row);
  });

  outputPreviewContainer.replaceChildren();
  const primary = result.files[0]!;
  printHtmlBtn.hidden = primary.mime !== MIME.html;

  if (primary.mime === MIME.pdf) {
    const blob = new Blob([new Uint8Array(primary.bytes)], { type: MIME.pdf });
    const url = URL.createObjectURL(blob);
    activePreviewUrls.push(url);
    const iframe = document.createElement('iframe');
    iframe.src = url;
    iframe.title = 'Aperçu du document PDF généré';
    outputPreviewContainer.appendChild(iframe);
  } else if (primary.mime === MIME.html) {
    const htmlStr = new TextDecoder().decode(primary.bytes);
    const iframe = document.createElement('iframe');
    iframe.sandbox.add('allow-same-origin', 'allow-modals');
    iframe.srcdoc = htmlStr;
    iframe.title = 'Aperçu paginé prêt à imprimer en PDF';
    outputPreviewContainer.appendChild(iframe);

    printHtmlBtn.onclick = () => {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    };
  } else {
    const pre = document.createElement('pre');
    pre.textContent = new TextDecoder().decode(primary.bytes);
    outputPreviewContainer.appendChild(pre);
  }
}

function triggerDownload(file: DocumentFile): void {
  const blob = new Blob([new Uint8Array(file.bytes)], { type: file.mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

downloadAllBtn.addEventListener('click', () => {
  if (!lastOutputs.length) return;
  if (lastOutputs.length === 1) {
    triggerDownload(lastOutputs[0]!);
    return;
  }
  const zipEntries: Record<string, Uint8Array> = {};
  for (const f of lastOutputs) {
    zipEntries[f.name] = f.bytes;
  }
  const zipped = zipSync(zipEntries, { level: 6 });
  triggerDownload({
    name: `folio-lot-${Date.now()}.zip`,
    mime: MIME.zip,
    bytes: zipped,
  });
});

// Enterprise Audit Log
function appendAuditRecord(rec: RunRecord): void {
  auditHistory.unshift(rec);
  auditLogEl.replaceChildren();

  for (const item of auditHistory) {
    const div = document.createElement('div');
    div.className = 'audit-entry';
    const inHashes = item.inputs.map((i) => `${i.name} (${i.sha256.slice(0, 12)}…)`).join(', ');
    const outHashes = item.outputs.map((o) => `${o.name} (${o.sha256.slice(0, 12)}…)`).join(', ');
    const reportJson = item.report ? ` · report=${JSON.stringify(item.report)}` : '';
    div.textContent = `[${item.startedAt}] run=${item.runId} skill=${item.skillId}@${item.skillVersion} site=${item.execution} (${item.durationMs}ms) IN=[${inHashes}] -> OUT=[${outHashes}]${reportJson}`;
    auditLogEl.appendChild(div);
  }
}

exportAuditBtn.addEventListener('click', () => {
  const bytes = new TextEncoder().encode(JSON.stringify(auditHistory, null, 2));
  triggerDownload({
    name: `folio-audit-${new Date().toISOString().slice(0, 10)}.json`,
    mime: MIME.json,
    bytes,
  });
});

// Mode & Theme Toggles
function setUiMode(mode: UiMode): void {
  currentMode = mode;
  htmlRoot.setAttribute('data-mode', mode);
  modeQuickBtn.classList.toggle('is-active', mode === 'quick');
  modeQuickBtn.setAttribute('aria-pressed', String(mode === 'quick'));
  modeEnterpriseBtn.classList.toggle('is-active', mode === 'enterprise');
  modeEnterpriseBtn.setAttribute('aria-pressed', String(mode === 'enterprise'));
  renderSkillRail();
  formController = renderSkillForm(fieldsContainer, activeSkill, currentMode, formController?.getValues());
  syncMobileDockState();
}

modeQuickBtn.addEventListener('click', () => setUiMode('quick'));
modeEnterpriseBtn.addEventListener('click', () => setUiMode('enterprise'));

themeToggleBtn.addEventListener('click', () => {
  const next = htmlRoot.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  htmlRoot.setAttribute('data-theme', next);
});

async function loadSpecimenForActiveSkill(): Promise<void> {
  toastRegion.hidden = true;
  clearLoadedFiles();
  const bundle = await createSpecimenForSkill(activeSkill.id);

  for (let i = 0; i < bundle.files.length; i++) {
    const doc = bundle.files[i]!;
    const sha256 = await sha256Hex(doc.bytes);
    loadedFiles.push({ file: doc, sha256 });
    if (doc.mime === MIME.pdf) {
      const thumbs = await renderFileThumbnails(doc.bytes, i, doc.name);
      pagePlanItems.push(...thumbs);
    }
  }

  if (bundle.presetOptions) {
    formController = renderSkillForm(
      fieldsContainer,
      activeSkill,
      currentMode,
      bundle.presetOptions,
    );
  }

  renderLoadedFileTable();
  renderPageGrid();
  updatePageGridVisibility();
  syncMobileDockState();
}

sampleDocBtn.addEventListener('click', () => {
  void loadSpecimenForActiveSkill();
});

// Initial Boot
selectSkill('pdf.assemble');
initLegalModal();
