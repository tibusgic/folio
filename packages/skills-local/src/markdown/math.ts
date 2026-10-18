import katex from 'katex';
import type MarkdownIt from 'markdown-it';
import type { StateBlock, StateInline, Token } from 'markdown-it';

type MarkdownItInstance = InstanceType<typeof MarkdownIt>;

/**
 * `$inline$` and `$$display$$` math rendered by KaTeX to MathML only:
 * native browser rendering, no web fonts, no CSS, print-crisp.
 * `trust: false` blocks \href/\includegraphics; maxExpand bounds macro bombs.
 */
export function renderTex(tex: string, displayMode: boolean): string {
  return katex.renderToString(tex, {
    displayMode,
    output: 'mathml',
    throwOnError: false,
    trust: false,
    strict: 'ignore',
    maxExpand: 500,
    maxSize: 20,
  });
}

function mathInline(state: StateInline, silent: boolean): boolean {
  const src = state.src;
  const start = state.pos;
  if (src.charCodeAt(start) !== 0x24 /* $ */ || src.charCodeAt(start + 1) === 0x24) return false;
  const first = src[start + 1];
  if (first === undefined || /\s/.test(first)) return false;

  let end = start + 1;
  for (;;) {
    end = src.indexOf('$', end);
    if (end === -1) return false;
    if (src[end - 1] === '\\') {
      end++;
      continue;
    }
    break;
  }
  if (end === start + 1 || /\s/.test(src[end - 1]!) || /\d/.test(src[end + 1] ?? '')) return false;

  if (!silent) {
    const token = state.push('math_inline', 'math', 0);
    token.content = src.slice(start + 1, end);
    token.markup = '$';
  }
  state.pos = end + 1;
  return true;
}

function mathBlock(state: StateBlock, startLine: number, endLine: number, silent: boolean): boolean {
  if (state.sCount[startLine]! - state.blkIndent >= 4) return false;
  const pos = state.bMarks[startLine]! + state.tShift[startLine]!;
  const max = state.eMarks[startLine]!;
  if (state.src.slice(pos, pos + 2) !== '$$') return false;

  const firstLine = state.src.slice(pos + 2, max);
  let next = startLine;
  let content: string | null = null;

  if (firstLine.trim().endsWith('$$')) {
    content = firstLine.trim().slice(0, -2);
  } else {
    const lines = [firstLine];
    for (next = startLine + 1; next < endLine; next++) {
      const s = state.bMarks[next]! + state.tShift[next]!;
      const line = state.src.slice(s, state.eMarks[next]!);
      if (line.trim().endsWith('$$')) {
        lines.push(line.trim().slice(0, -2));
        content = lines.join('\n');
        break;
      }
      lines.push(line);
    }
  }
  if (content === null) return false;
  if (silent) return true;

  state.line = next + 1;
  const token = state.push('math_block', 'math', 0);
  token.block = true;
  token.content = content.trim();
  token.map = [startLine, state.line];
  token.markup = '$$';
  return true;
}

export function mathPlugin(md: MarkdownItInstance): void {
  md.inline.ruler.after('escape', 'math_inline', mathInline);
  md.block.ruler.before('fence', 'math_block', mathBlock, { alt: ['paragraph', 'reference', 'blockquote', 'list'] });
  md.renderer.rules.math_inline = (tokens: Token[], idx: number) => renderTex(tokens[idx]!.content, false);
  md.renderer.rules.math_block = (tokens: Token[], idx: number) => `<div class="equation">${renderTex(tokens[idx]!.content, true)}</div>\n`;
}
