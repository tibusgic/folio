import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  defineSkill,
  MIME,
  parsePageRanges,
  parsePageSelection,
  runSkill,
  sanitizeFileName,
  sha256Hex,
  SkillError,
  SkillRegistry,
  sniffMime,
} from '../src/index.ts';

describe('@folio/skills-core', () => {
  it('sniffs PDF magic bytes and rejects spoofed extensions', () => {
    const validPdf = new TextEncoder().encode('%PDF-1.7\n1 0 obj\n<<>>\nendobj');
    expect(sniffMime(validPdf, 'fake.txt')).toBe(MIME.pdf);

    const spoofedPdf = new TextEncoder().encode('<!doctype html><html>spoof</html>');
    expect(sniffMime(spoofedPdf, 'contract.pdf')).toBeNull();

    const validMd = new TextEncoder().encode('# Titre\n\nParagraphe UTF-8.');
    expect(sniffMime(validMd, 'notes.md')).toBe(MIME.markdown);

    const binaryWithNul = new Uint8Array([0x23, 0x00, 0x41]);
    expect(sniffMime(binaryWithNul, 'corrupt.md')).toBeNull();
  });

  it('sanitizes filenames against path traversal and header injection', () => {
    expect(sanitizeFileName('../../etc/passwd')).toBe('passwd');
    expect(sanitizeFileName('rapport\r\nInjected: true.pdf')).toBe('rapportInjected true.pdf');
    expect(sanitizeFileName('...hidden')).toBe('hidden');
  });

  it('parses human page ranges and detects out-of-bounds selections', () => {
    expect(parsePageRanges('1-3, 5, 8-', 10)).toEqual([[0, 1, 2], [4], [7, 8, 9]]);
    expect(parsePageSelection('3, 1-2, 2', 5)).toEqual([2, 0, 1]);
    expect(() => parsePageRanges('1-12', 10)).toThrowError(SkillError);
  });

  it('enforces skill contract, schema validation and audit SHA-256 digests', async () => {
    const echoPdfSkill = defineSkill({
      id: 'test.echo',
      version: '1.0.0',
      title: 'Echo',
      summary: 'Test skill',
      category: 'assemble',
      execution: 'local',
      output: 'pdf',
      modes: ['quick', 'enterprise'],
      input: { mimes: [MIME.pdf], minFiles: 1, maxFiles: 1, maxBytesPerFile: 1024 },
      options: z.object({ tag: z.string().min(2).default('ok') }),
      fields: [],
      async run(files, opts, ctx) {
        ctx.log('info', `tag=${opts.tag}`);
        return { files, report: { echoed: opts.tag } };
      },
    });

    const registry = new SkillRegistry().register(echoPdfSkill);
    expect(registry.has('test.echo')).toBe(true);

    const sampleBytes = new TextEncoder().encode('%PDF-1.7\n%test');
    const result = await runSkill(
      echoPdfSkill,
      [{ name: 'in.pdf', mime: MIME.pdf, bytes: sampleBytes }],
      { tag: 'audit' },
    );

    const expectedSha = await sha256Hex(sampleBytes);
    expect(result.record.inputs[0]?.sha256).toBe(expectedSha);
    expect(result.record.outputs[0]?.sha256).toBe(expectedSha);
    expect(result.record.report).toEqual({ echoed: 'audit' });
  });
});
