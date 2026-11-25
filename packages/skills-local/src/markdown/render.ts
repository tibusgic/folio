import MarkdownIt, { type Token } from 'markdown-it';
// @ts-expect-error markdown-it-footnote ships pure ESM without bundled d.ts
import footnotePlugin from 'markdown-it-footnote';
import {
  bytesToDataUri,
  MIME,
  parseDataUriImage,
  type ResolvedMarkdownImage,
} from '@folio/skills-core';
import { asList, asText, parseFrontMatter, type FrontMatter } from './frontmatter.ts';
import { mathPlugin } from './math.ts';
import { printCss, type Paper, type PrintTheme } from './print-css.ts';

type MarkdownItInstance = InstanceType<typeof MarkdownIt>;
const footnote = footnotePlugin as (md: MarkdownItInstance) => void;

export interface RenderOptions {
  paper: Paper;
  theme: PrintTheme;
  toc: boolean;
  numberSections: boolean;
  pageNumbers: boolean;
  resolvedImages?: ReadonlyMap<string, ResolvedMarkdownImage>;
}

export interface RenderedDocument {
  html: string;
  meta: FrontMatter;
  headings: { level: number; text: string; id: string }[];
  stats: { words: number; equations: number; tables: number; codeBlocks: number; images: number };
}

export const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function slugify(text: string): string {
  return (
    text
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'section'
  );
}

function buildMissingImagePlaceholderDataUri(label: string): string {
  const safeLabel = escapeHtml(label.slice(0, 64) || 'Image non résolue');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="520" height="140" viewBox="0 0 520 140"><rect x="2" y="2" width="516" height="136" rx="4" fill="#f4f1ea" stroke="#cbc4b4" stroke-width="1.5" stroke-dasharray="6 4"/><text x="260" y="64" text-anchor="middle" font-family="monospace" font-size="12" fill="#b4532a">IMAGE NON ASSOCIÉE</text><text x="260" y="88" text-anchor="middle" font-family="monospace" font-size="11" fill="#5d6068">${safeLabel}</text></svg>`;
  return bytesToDataUri(new TextEncoder().encode(svg), MIME.svg);
}

/**
 * Raw HTML is disabled: the output is rendered in a sandboxed iframe, but we
 * still never pass author HTML through. All resolved images (local, zip, Base64,
 * or pre-fetched remote HTTP/HTTPS) are embedded as self-contained Data URLs so
 * the document CSP (`img-src data: blob:`) remains hermetic and offline-ready.
 */
function createParser(resolvedImages?: ReadonlyMap<string, ResolvedMarkdownImage>): MarkdownItInstance {
  const md = new MarkdownIt({ html: false, linkify: true, typographer: true, breaks: false });
  md.use(mathPlugin).use(footnote);

  const defaultFence = md.renderer.rules.fence!;
  md.renderer.rules.fence = (tokens: Token[], idx: number, options, env, self) => {
    const lang = tokens[idx]!.info.trim().split(/\s+/)[0] ?? '';
    const html = defaultFence(tokens, idx, options, env, self);
    return lang ? html.replace(/^<pre>/, `<pre data-lang="${escapeHtml(lang)}">`) : html;
  };
  md.renderer.rules.table_open = () => '<figure class="table"><table>\n';
  md.renderer.rules.table_close = () => '</table></figure>\n';
  md.renderer.rules.link_open = (tokens: Token[], idx: number, options, _env, self) => {
    const href = String(tokens[idx]!.attrGet('href') ?? '');
    if (/^https?:/i.test(href)) tokens[idx]!.attrSet('rel', 'noopener noreferrer');
    return self.renderToken(tokens, idx, options);
  };

  // Transform `![Ma légende](...)` into a centered `<figure class="image-figure">` with `<figcaption>`.
  md.renderer.rules.image = (tokens: Token[], idx: number, options, env, self) => {
    const token = tokens[idx]!;
    const rawSrc = String(token.attrGet('src') ?? '').trim();
    const title = String(token.attrGet('title') ?? '').trim();
    const rawAlt =
      (token.children ? self.renderInlineAsText(token.children, options, env) : '') ||
      String(token.attrGet('alt') ?? '');
    const captionText = rawAlt.trim();

    let finalSrc = '';
    let isMissing = false;

    const preResolved = resolvedImages?.get(rawSrc);
    if (preResolved?.resolved && preResolved.dataUri) {
      finalSrc = preResolved.dataUri;
    } else if (/^data:image\//i.test(rawSrc)) {
      const parsed = parseDataUriImage(rawSrc, idx + 1);
      if (parsed) {
        finalSrc = parsed.dataUri;
      } else {
        isMissing = true;
        finalSrc = buildMissingImagePlaceholderDataUri(rawSrc.slice(0, 40));
      }
    } else {
      isMissing = true;
      finalSrc = buildMissingImagePlaceholderDataUri(rawSrc);
    }

    const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';
    const statusAttr = isMissing ? ` data-image-status="missing" data-original-src="${escapeHtml(rawSrc)}"` : '';
    const figClass = isMissing ? 'image-figure image-figure--missing' : 'image-figure';
    const figcaption = captionText ? `<figcaption>${escapeHtml(captionText)}</figcaption>` : '';

    return `<figure class="${figClass}"><img src="${escapeHtml(finalSrc)}" alt="${escapeHtml(captionText)}"${titleAttr}${statusAttr} loading="eager" decoding="sync" />${figcaption}</figure>`;
  };

  // Unwrap `<p>...</p>` when a paragraph contains only images so `<figure>` is emitted at block level.
  md.core.ruler.after('inline', 'figure_unwrap', (state) => {
    const t = state.tokens;
    for (let i = 0; i + 2 < t.length; i++) {
      if (t[i]!.type === 'paragraph_open' && t[i + 1]!.type === 'inline' && t[i + 2]!.type === 'paragraph_close') {
        const children = t[i + 1]!.children ?? [];
        const hasImage = children.some((c: Token) => c.type === 'image');
        const onlyImagesAndWhitespace =
          hasImage &&
          children.every(
            (c: Token) =>
              c.type === 'image' ||
              c.type === 'softbreak' ||
              c.type === 'hardbreak' ||
              (c.type === 'text' && c.content.trim() === ''),
          );
        if (onlyImagesAndWhitespace) {
          t.splice(i + 2, 1);
          t.splice(i, 1);
          i--;
        }
      }
    }
  });

  // `\newpage` alone in a paragraph -> explicit page break (same convention as LaTeX).
  md.core.ruler.push('page_break', (state) => {
    const t = state.tokens;
    for (let i = 0; i + 2 < t.length; i++) {
      if (t[i]!.type === 'paragraph_open' && t[i + 1]!.type === 'inline' && /^\\(newpage|pagebreak)$/.test(t[i + 1]!.content.trim()) && t[i + 2]!.type === 'paragraph_close') {
        const tok = new state.Token('html_block', '', 0);
        tok.content = '<div class="page-break" role="presentation"></div>\n';
        t.splice(i, 3, tok);
      }
    }
  });
  return md;
}

export function renderMarkdownDocument(source: string, opts: RenderOptions): RenderedDocument {
  const md = createParser(opts.resolvedImages);
  const { meta, body } = parseFrontMatter(source);
  const env = {};
  const tokens: Token[] = md.parse(body, env);

  const headings: RenderedDocument['headings'] = [];
  const used = new Map<string, number>();
  const stats = { words: 0, equations: 0, tables: 0, codeBlocks: 0, images: 0 };

  tokens.forEach((tok: Token, i: number) => {
    if (tok.type === 'heading_open') {
      const text =
        tokens[i + 1]!.children
          ?.filter((c: Token) => c.type === 'text' || c.type === 'code_inline')
          .map((c: Token) => c.content)
          .join('') ?? '';
      const base = slugify(text);
      const n = used.get(base) ?? 0;
      used.set(base, n + 1);
      const id = n ? `${base}-${n}` : base;
      tok.attrSet('id', id);
      headings.push({ level: Number(tok.tag.slice(1)), text, id });
    }
    if (tok.type === 'math_block') stats.equations++;
    if (tok.type === 'table_open') stats.tables++;
    if (tok.type === 'fence' || tok.type === 'code_block') stats.codeBlocks++;
    if (tok.type === 'inline') {
      stats.words += tok.content.split(/\s+/).filter(Boolean).length;
      stats.equations += tok.children?.filter((c: Token) => c.type === 'math_inline').length ?? 0;
      stats.images += tok.children?.filter((c: Token) => c.type === 'image').length ?? 0;
    }
  });

  const title = asText(meta.title);
  const authors = asList(meta.author);
  const metaLine = [authors.join(', '), asText(meta.date), asText(meta.organization ?? meta.affiliation), asText(meta.version) && `v${asText(meta.version)}`]
    .filter(Boolean)
    .map((v) => `<span>${escapeHtml(v)}</span>`)
    .join('');

  const titleBlock = title
    ? `<header class="title-block"><h1>${md.renderInline(title)}</h1>${meta.subtitle ? `<p class="subtitle">${md.renderInline(asText(meta.subtitle))}</p>` : ''}${metaLine ? `<div class="meta">${metaLine}</div>` : ''}</header>${meta.abstract ? `<section class="abstract">${md.render(asText(meta.abstract))}</section>` : ''}`
    : '';

  const tocItems = headings.filter((h) => h.level >= 2 && h.level <= 3);
  const toc =
    opts.toc && tocItems.length
      ? `<nav class="toc" aria-label="Sommaire"><h2>Sommaire</h2><ol>${tocItems
          .map((h) => `<li class="l${h.level}"><a href="#${h.id}">${escapeHtml(h.text)}</a></li>`)
          .join('')}</ol></nav>`
      : '';

  const lang = /^[a-z]{2}(-[A-Z]{2})?$/.test(asText(meta.lang)) ? asText(meta.lang) : 'fr';
  const html = `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:">
<meta name="generator" content="Folio md.pdf">
${authors.length ? `<meta name="author" content="${escapeHtml(authors.join(', '))}">` : ''}
<title>${escapeHtml(title || 'Document')}</title>
<style>${printCss(opts)}</style>
</head>
<body>
${titleBlock}
${toc}
<main>
${md.renderer.render(tokens, md.options, env)}
</main>
</body>
</html>
`;
  return { html, meta, headings, stats };
}
