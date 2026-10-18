/**
 * Paper typography for the browser's PDF engine (Chromium/Skia, WebKit,
 * Gecko). Text stays vector; pagination is driven by CSS Paged Media.
 */
export type PrintTheme = 'editorial' | 'technical';
export type Paper = 'A4' | 'Letter';

export function printCss(opts: { paper: Paper; theme: PrintTheme; pageNumbers: boolean; numberSections: boolean }): string {
  const serif = `"Iowan Old Style", "Charter", "Bitstream Charter", "Palatino Linotype", "Book Antiqua", Georgia, serif`;
  const sans = `"Helvetica Neue", "Geist", "Inter", Arial, sans-serif`;
  const mono = `"JetBrains Mono", "Berkeley Mono", "SFMono-Regular", Menlo, Consolas, monospace`;
  const body = opts.theme === 'editorial' ? serif : sans;

  return `
@page { size: ${opts.paper}; margin: 24mm 21mm 26mm 21mm;
  ${opts.pageNumbers ? `@bottom-right { content: counter(page) " / " counter(pages); font: 7.5pt ${mono}; color: #6b6d73; }` : ''}
}
@page :first { @bottom-right { content: none; } }

:root { --ink: #16181d; --muted: #5d6068; --rule: #cbc4b4; --accent: #b4532a; --wash: #f4f1ea; }
html { font-family: ${body}; font-size: ${opts.theme === 'editorial' ? '10.5pt' : '9.75pt'}; line-height: 1.48; color: var(--ink);
  hyphens: auto; -webkit-hyphens: auto; font-kerning: normal; text-rendering: optimizeLegibility;
  font-variant-numeric: ${opts.theme === 'editorial' ? 'oldstyle-nums proportional-nums' : 'lining-nums'};
  -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { margin: 0; counter-reset: h2; }
@media screen {
  html { background: #e6e1d6; }
  body { box-sizing: border-box; max-width: ${opts.paper === 'A4' ? '210mm' : '216mm'}; min-height: 100vh; margin: 0 auto; padding: 24mm 21mm; background: #fff; }
}

p { margin: 0 0 0.62em; orphans: 3; widows: 3; ${opts.theme === 'editorial' ? 'text-align: justify;' : ''} }
h1, h2, h3, h4 { font-family: ${opts.theme === 'editorial' ? serif : sans}; line-height: 1.18; break-after: avoid; page-break-after: avoid; break-inside: avoid; font-weight: 600; letter-spacing: -0.005em; }
h1 { font-size: 19pt; margin: 1.3em 0 0.45em; }
h2 { font-size: 13.5pt; margin: 1.5em 0 0.45em; padding-top: 0.45em; border-top: 0.5pt solid var(--rule); }
h3 { font-size: 11pt; margin: 1.2em 0 0.35em; }
h4 { font-size: 10pt; margin: 1em 0 0.3em; font-style: italic; font-weight: 500; }
${opts.numberSections ? `
h2 { counter-increment: h2; counter-reset: h3; } h2::before { content: counter(h2) "  "; color: var(--accent); font-family: ${mono}; font-size: 0.8em; }
h3 { counter-increment: h3; } h3::before { content: counter(h2) "." counter(h3) "  "; color: var(--muted); font-family: ${mono}; font-size: 0.8em; }` : ''}

/* Keep atomic blocks whole across pages. */
pre, table, figure, blockquote, .equation, img, .callout { break-inside: avoid; page-break-inside: avoid; }
tr, li { break-inside: avoid; }
thead { display: table-header-group; }
.page-break { break-after: page; page-break-after: always; height: 0; }

a { color: var(--accent); text-decoration: none; }
strong { font-weight: 650; }
hr { border: 0; text-align: center; margin: 1.4em 0; }
hr::after { content: "⁂"; color: var(--muted); letter-spacing: 0.4em; }
ul, ol { padding-left: 1.35em; margin: 0 0 0.7em; }
li { margin: 0.15em 0; }
li::marker { color: var(--muted); }

code, pre, kbd { font-family: ${mono}; font-variant-ligatures: none; }
:not(pre) > code { font-size: 0.86em; padding: 0.05em 0.3em; background: var(--wash); border-radius: 2px; }
pre { font-size: 8.25pt; line-height: 1.5; margin: 0.4em 0 1em; padding: 8pt 10pt; background: var(--wash); border-left: 2pt solid var(--accent); white-space: pre-wrap; overflow-wrap: anywhere; }
pre[data-lang]::before { content: attr(data-lang); display: block; margin-bottom: 4pt; font-size: 6.75pt; letter-spacing: 0.1em; text-transform: uppercase; color: var(--muted); }

figure.table { margin: 0.6em 0 1.1em; }
table { width: 100%; border-collapse: collapse; font-size: 8.75pt; line-height: 1.35; font-variant-numeric: lining-nums tabular-nums; }
th { text-align: left; font-weight: 600; border-bottom: 0.8pt solid var(--ink); padding: 4pt 6pt; }
td { padding: 3.5pt 6pt; vertical-align: top; border-bottom: 0.4pt solid var(--rule); }
th[style*="right"], td[style*="right"] { text-align: right; }

blockquote { margin: 0.4em 0 1em; padding: 0 0 0 11pt; border-left: 0.8pt solid var(--rule); color: var(--muted); font-style: italic; }
.equation { margin: 0.8em 0; text-align: center; }
math { font-size: 1.04em; }
math[display="block"] { display: block math; margin: 0 auto; }
img { max-width: 100%; }

.title-block { margin: 0 0 12mm; padding-bottom: 6mm; border-bottom: 0.6pt solid var(--ink); }
.title-block h1 { font-size: 25pt; margin: 0 0 3mm; line-height: 1.08; letter-spacing: -0.015em; border: 0; }
.title-block .subtitle { font-size: 12pt; color: var(--muted); margin: 0 0 4mm; font-style: italic; }
.title-block .meta { font: 7.75pt/1.6 ${mono}; color: var(--muted); letter-spacing: 0.02em; display: flex; gap: 6mm; flex-wrap: wrap; }
.abstract { margin: 0 0 9mm; font-size: 0.95em; } .abstract::before { content: "Résumé"; display: block; font: 600 7pt ${mono}; letter-spacing: 0.12em; text-transform: uppercase; color: var(--accent); margin-bottom: 2mm; }

nav.toc { break-after: page; } nav.toc h2 { border: 0; } nav.toc h2::before { content: none; }
nav.toc ol { list-style: none; padding: 0; margin: 0; }
nav.toc li { display: flex; gap: 4pt; margin: 2pt 0; } nav.toc li.l3 { padding-left: 12pt; font-size: 0.94em; color: var(--muted); }
nav.toc a { color: inherit; flex: 1; }

.footnotes { margin-top: 2.2em; font-size: 8.25pt; border-top: 0.5pt solid var(--rule); } .footnotes hr { display: none; }
.footnote-ref a { font-size: 0.75em; vertical-align: super; line-height: 0; }
`;
}
