import MarkdownIt, { type Token } from 'markdown-it';
import mentionsRaw from '../../../../../legal/mentions-legales.md?raw';
import privacyRaw from '../../../../../legal/politique-de-confidentialite.md?raw';
import cookiesRaw from '../../../../../legal/politique-cookies.md?raw';
import cguRaw from '../../../../../legal/cgu-cgv.md?raw';

export type LegalDocId = 'mentions' | 'privacy' | 'cookies' | 'cgu';

export interface LegalDocEntry {
  readonly id: LegalDocId;
  readonly code: string;
  readonly label: string;
  readonly title: string;
  readonly fileName: string;
  readonly rawMarkdown: string;
}

export const LEGAL_DOCUMENTS: readonly LegalDocEntry[] = [
  {
    id: 'mentions',
    code: 'LEX-01 · LCEN',
    label: 'Mentions légales',
    title: 'Mentions Légales (LCEN — Loi n° 2004-575)',
    fileName: 'folio-mentions-legales.md',
    rawMarkdown: mentionsRaw,
  },
  {
    id: 'privacy',
    code: 'LEX-02 · RGPD',
    label: 'Confidentialité (RGPD)',
    title: 'Politique de Confidentialité & Protection des Données (RGPD)',
    fileName: 'folio-politique-de-confidentialite.md',
    rawMarkdown: privacyRaw,
  },
  {
    id: 'cookies',
    code: 'LEX-03 · ePRIVACY',
    label: 'Cookies & Stockage',
    title: 'Politique relative aux Cookies et au Stockage Local (ePrivacy)',
    fileName: 'folio-politique-cookies.md',
    rawMarkdown: cookiesRaw,
  },
  {
    id: 'cgu',
    code: 'LEX-04 · CGU',
    label: 'Conditions (CGU)',
    title: 'Conditions Générales d’Utilisation du Service (CGU)',
    fileName: 'folio-cgu.md',
    rawMarkdown: cguRaw,
  },
];

const md = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: true,
  breaks: false,
});

md.renderer.rules.table_open = () => '<div class="legal-table-wrap"><table>\n';
md.renderer.rules.table_close = () => '</table></div>\n';
md.renderer.rules.link_open = (tokens: Token[], idx: number, options, _env, self) => {
  const href = String(tokens[idx]!.attrGet('href') ?? '');
  if (/^https?:/i.test(href)) {
    tokens[idx]!.attrSet('target', '_blank');
    tokens[idx]!.attrSet('rel', 'noopener noreferrer');
  }
  return self.renderToken(tokens, idx, options);
};

export function initLegalModal(): void {
  const modalEl = document.getElementById('legal-modal') as HTMLElement | null;
  const backdropEl = document.getElementById('legal-modal-backdrop') as HTMLElement | null;
  const closeBtn = document.getElementById('legal-modal-close') as HTMLButtonElement | null;
  const downloadBtn = document.getElementById('legal-modal-download') as HTMLButtonElement | null;
  const tablistEl = document.getElementById('legal-modal-tabs') as HTMLElement | null;
  const codeBadgeEl = document.getElementById('legal-modal-code') as HTMLElement | null;
  const titleEl = document.getElementById('legal-modal-title') as HTMLElement | null;
  const bodyEl = document.getElementById('legal-modal-body') as HTMLElement | null;

  if (!modalEl || !backdropEl || !closeBtn || !downloadBtn || !tablistEl || !codeBadgeEl || !titleEl || !bodyEl) {
    return;
  }

  let activeDocId: LegalDocId = 'mentions';
  let lastFocusedTrigger: HTMLElement | null = null;

  function renderTabs(): void {
    tablistEl!.replaceChildren();
    for (const doc of LEGAL_DOCUMENTS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.role = 'tab';
      btn.className = 'legal-tab';
      const isSelected = doc.id === activeDocId;
      btn.setAttribute('aria-selected', String(isSelected));
      btn.dataset.legalTab = doc.id;

      const codeSpan = document.createElement('span');
      codeSpan.className = 'legal-tab__code';
      codeSpan.textContent = doc.code;

      const labelSpan = document.createElement('span');
      labelSpan.className = 'legal-tab__label';
      labelSpan.textContent = doc.label;

      btn.append(codeSpan, labelSpan);
      btn.addEventListener('click', () => {
        selectDocument(doc.id);
      });
      tablistEl!.appendChild(btn);
    }
  }

  function selectDocument(docId: LegalDocId): void {
    const entry = LEGAL_DOCUMENTS.find((d) => d.id === docId) ?? LEGAL_DOCUMENTS[0]!;
    activeDocId = entry.id;
    renderTabs();
    codeBadgeEl!.textContent = entry.code;
    titleEl!.textContent = entry.title;

    // Render trusted static legal Markdown with raw HTML disabled
    const renderedHtml = md.render(entry.rawMarkdown);
    const parser = new DOMParser();
    const parsedDoc = parser.parseFromString(renderedHtml, 'text/html');
    bodyEl!.replaceChildren(...Array.from(parsedDoc.body.childNodes));
    bodyEl!.scrollTop = 0;
  }

  function openModal(docId: LegalDocId, trigger?: HTMLElement | null): void {
    lastFocusedTrigger = trigger ?? (document.activeElement as HTMLElement | null);
    selectDocument(docId);
    modalEl!.hidden = false;
    document.body.style.overflow = 'hidden';
    closeBtn!.focus();
  }

  function closeModal(): void {
    if (modalEl!.hidden) return;
    modalEl!.hidden = true;
    document.body.style.overflow = '';
    lastFocusedTrigger?.focus();
  }

  // Bind sidebar triggers
  const triggerButtons = document.querySelectorAll<HTMLButtonElement>('[data-legal-open]');
  triggerButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const docId = (btn.dataset.legalOpen as LegalDocId) || 'mentions';
      openModal(docId, btn);
    });
  });

  // Close actions
  closeBtn.addEventListener('click', closeModal);
  backdropEl.addEventListener('click', closeModal);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modalEl.hidden) {
      e.preventDefault();
      closeModal();
    }
  });

  // Download active legal document as .md
  downloadBtn.addEventListener('click', () => {
    const entry = LEGAL_DOCUMENTS.find((d) => d.id === activeDocId) ?? LEGAL_DOCUMENTS[0]!;
    const bytes = new TextEncoder().encode(entry.rawMarkdown);
    const blob = new Blob([bytes], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = entry.fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  });
}
