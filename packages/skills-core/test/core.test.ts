import { describe, expect, it } from 'vitest';
import { zipSync } from 'fflate';
import { z } from 'zod';
import {
  clearRemoteImageCache,
  defineSkill,
  extractMarkdownImageRefs,
  fetchRemoteImageSafe,
  getRemoteImageCacheSize,
  isSafeRemoteImageUrl,
  MIME,
  parsePageRanges,
  parsePageSelection,
  resolveMarkdownImages,
  runSkill,
  sanitizeFileName,
  sha256Hex,
  SkillError,
  SkillRegistry,
  sniffMime,
  uint8ToBase64,
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

  it('sniffs WebP, SVG and ZIP magic bytes and resolves all 4 Markdown image sources', async () => {
    // 1x1 PNG
    const pngBytes = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
      0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
      0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x60, 0x60, 0x60, 0x60,
      0x00, 0x00, 0x00, 0x05, 0x00, 0x01, 0x87, 0xa1, 0x4e, 0x9d, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45,
      0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
    ]);
    // WebP magic bytes: RIFF....WEBP
    const webpBytes = new Uint8Array([
      0x52, 0x49, 0x46, 0x46, 0x14, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20,
    ]);
    // SVG with malicious script that must be sanitized
    const svgBytes = new TextEncoder().encode(
      '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50"><script>alert(1)</script><rect width="100" height="50"/></svg>',
    );

    expect(sniffMime(webpBytes, 'photo.webp')).toBe(MIME.webp);
    expect(sniffMime(svgBytes, 'diagram.svg')).toBe(MIME.svg);

    const b64Png = uint8ToBase64(pngBytes);
    const mdContent = [
      '# Document Illustré',
      '',
      '![Schéma par chemin relatif](./images/schema.png)',
      '',
      '![Diagramme associé manuellement](expected-name.svg)',
      '',
      `![Icône Base64](data:image/png;base64,${b64Png})`,
      '',
      '![Graphique distant](https://cdn.example.com/chart.png)',
    ].join('\n');

    const refs = extractMarkdownImageRefs(mdContent);
    expect(refs).toHaveLength(4);
    expect(refs.map((r) => r.kind)).toEqual(['local-path', 'local-path', 'data-uri', 'remote-url']);

    // Pack .md + images/schema.png inside a .zip archive
    const zipped = zipSync({
      'dossier/rapport.md': new TextEncoder().encode(mdContent),
      'dossier/images/schema.png': pngBytes,
    });
    expect(sniffMime(zipped, 'bundle.zip')).toBe(MIME.zip);

    clearRemoteImageCache();
    let fetchCalls = 0;
    const mockFetcher: typeof fetch = async () => {
      fetchCalls++;
      return new Response(pngBytes, {
        status: 200,
        headers: { 'content-type': 'image/png' },
      });
    };

    const resolved = await resolveMarkdownImages(
      [
        { name: 'bundle.zip', mime: MIME.zip, bytes: zipped },
        { name: 'custom-uploaded.svg', mime: MIME.svg, bytes: svgBytes },
      ],
      {
        imageMappings: { 'expected-name.svg': 'custom-uploaded.svg' },
        fetcher: mockFetcher,
      },
    );

    expect(resolved.stats.totalImages).toBe(4);
    expect(resolved.stats.resolvedImages).toBe(4);
    expect(resolved.stats.missingImages).toBe(0);
    expect(resolved.stats.bySource).toEqual({
      local: 1,
      zip: 1,
      dataUri: 1,
      remote: 1,
    });
    expect(fetchCalls).toBe(1);
    expect(getRemoteImageCacheSize()).toBe(1);

    // Second fetch to the same URL hits the in-memory cache without network call
    const cachedHit = await fetchRemoteImageSafe('https://cdn.example.com/chart.png', 2, {
      fetcher: mockFetcher,
    });
    expect(cachedHit.ok).toBe(true);
    if (cachedHit.ok) {
      expect(cachedHit.fromCache).toBe(true);
    }
    expect(fetchCalls).toBe(1);

    // Sanitized SVG Data URI must not contain <script>
    const svgRes = resolved.resolutions.get('expected-name.svg');
    expect(svgRes?.resolved).toBe(true);
    expect(new TextDecoder().decode(svgRes!.bytes!)).not.toContain('<script>');

    // SSRF Guard blocks localhost, RFC1918 and cloud metadata IPs
    expect(isSafeRemoteImageUrl('http://127.0.0.1/admin.png').safe).toBe(false);
    expect(isSafeRemoteImageUrl('http://169.254.169.254/latest/meta-data/').safe).toBe(false);
    expect(isSafeRemoteImageUrl('http://192.168.1.10/secret.png').safe).toBe(false);
    expect(isSafeRemoteImageUrl('http://localhost:8080/test.png').safe).toBe(false);
    expect(isSafeRemoteImageUrl('file:///etc/passwd').safe).toBe(false);
    expect(isSafeRemoteImageUrl('https://assets.example.org/fig1.png').safe).toBe(true);
  });
});
