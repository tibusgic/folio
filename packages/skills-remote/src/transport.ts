import { MIME, sanitizeFileName, SkillError, type DocumentFile, type SkillContext } from '@folio/skills-core';

const MB = 1024 * 1024;
export { MB };

let apiBaseUrl = '/api/v2';

export function setRemoteApiBase(url: string): void {
  apiBaseUrl = url.replace(/\/+$/, '');
}

export function getRemoteApiBase(): string {
  return apiBaseUrl;
}

export interface RemoteCallParams {
  endpoint: string;
  files: readonly DocumentFile[];
  options: Record<string, unknown>;
  ctx: SkillContext;
  fallbackFilename: string;
  fallbackMime?: string;
}

/**
 * Sends a multipart payload to the ephemeral backend, streams the response,
 * reads X-Folio-Report metadata headers, and maps HTTP failures to SkillError.
 */
export async function callRemoteSkill(params: RemoteCallParams): Promise<{ files: DocumentFile[]; report?: Record<string, unknown> }> {
  const { endpoint, files, options, ctx, fallbackFilename, fallbackMime = MIME.pdf } = params;
  const form = new FormData();

  for (const f of files) {
    const bufferCopy = new Uint8Array(f.bytes);
    const blob = new Blob([bufferCopy as unknown as BlobPart], { type: f.mime });
    form.append('files', blob, sanitizeFileName(f.name));
  }
  form.append('options', JSON.stringify(options));

  ctx.progress(0.15, 'chiffrement & envoi vers le worker éphémère');

  let res: Response;
  try {
    res = await fetch(`${apiBaseUrl}${endpoint}`, {
      method: 'POST',
      body: form,
      signal: ctx.signal,
      headers: {
        'X-Folio-Client': '2.0.0',
      },
    });
  } catch (err) {
    if (ctx.signal.aborted) throw new SkillError('ABORTED', 'Traitement annulé.');
    throw new SkillError(
      'REMOTE_UNAVAILABLE',
      'Le serveur de traitement éphémère est injoignable.',
      { internal: String(err).slice(0, 200) },
    );
  }

  ctx.progress(0.75, 'réception & purge serveur');

  if (!res.ok) {
    let message = `Le serveur a rejeté la requête (HTTP ${res.status}).`;
    let details: Record<string, unknown> | undefined;
    try {
      const payload = (await res.json()) as { code?: string; message?: string; detail?: unknown };
      if (payload.message) message = payload.message;
      else if (typeof payload.detail === 'string') message = payload.detail;
      details = payload as Record<string, unknown>;
    } catch {
      // ignore non-json error body
    }
    if (res.status === 413) {
      throw new SkillError('INPUT_TOO_LARGE', 'Le fichier dépasse la limite autorisée par le serveur éphémère.');
    }
    if (res.status === 504) {
      throw new SkillError('TIMEOUT', 'Délai d’exécution dépassé sur le serveur éphémère.');
    }
    throw new SkillError('REMOTE_REJECTED', message, details);
  }

  const bytes = new Uint8Array(await res.arrayBuffer());
  const contentType = (res.headers.get('content-type') ?? fallbackMime).split(';')[0]!.trim();

  let filename = fallbackFilename;
  const disposition = res.headers.get('content-disposition');
  if (disposition) {
    const utf8Match = /filename\*=UTF-8''([^;\n]+)/i.exec(disposition);
    const plainMatch = /filename="?([^";\n]+)"?/i.exec(disposition);
    if (utf8Match?.[1]) {
      try {
        filename = decodeURIComponent(utf8Match[1]);
      } catch {
        filename = utf8Match[1];
      }
    } else if (plainMatch?.[1]) {
      filename = plainMatch[1];
    }
  }

  let report: Record<string, unknown> | undefined;
  const reportHeader = res.headers.get('x-folio-report');
  if (reportHeader) {
    try {
      report = JSON.parse(reportHeader) as Record<string, unknown>;
    } catch {
      // ignore malformed header
    }
  }

  ctx.progress(1, 'terminé');
  return {
    files: [{ name: sanitizeFileName(filename, fallbackFilename), mime: contentType, bytes }],
    ...(report ? { report } : {}),
  };
}
