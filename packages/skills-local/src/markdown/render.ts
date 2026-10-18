import MarkdownIt, { type Token } from 'markdown-it';
// @ts-expect-error markdown-it-footnote ships pure ESM without bundled d.ts
import footnotePlugin from 'markdown-it-footnote';
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
}

export interface RenderedDocument {
  html: string;
  meta: FrontMatter;
  headings: { level: number; text: string; id: string }[];
  stats: { words: number; equations: number; tables: number; codeBlocks: number };
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

/**
 * Raw HTML is disabled: the output is rendered in a sandboxed iframe, but we
 * still never pass author HTML through. Remote images are blocked by the
 * document CSP (img-src data:) so a document cannot "phone home".
 */
function createParser(): MarkdownItInstance {
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
  const md = createParser();
  const { meta, body } = parseFrontMatter(source);
  const env = {};
  const tokens: Token[] = md.parse(body, env);

  const headings: RenderedDocument['headings'] = [];
  const used = new Map<string, number>();
  const stats = { words: 0, equations: 0, tables: 0, codeBlocks: 0 };

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
