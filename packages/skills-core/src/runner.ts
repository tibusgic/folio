import { SkillError } from './errors.ts';
import { sha256Hex } from './hash.ts';
import { sanitizeFileName, sniffMime } from './mime.ts';
import type { DocumentFile, ExecutionSite, InputSpec, LogEntry, LogLevel, Skill, SkillContext } from './types.ts';

export interface FileDigest {
  readonly name: string;
  readonly mime: string;
  readonly bytes: number;
  readonly sha256: string;
}

/** Audit record of one execution. Serialisable, contains no document content. */
export interface RunRecord {
  readonly runId: string;
  readonly skillId: string;
  readonly skillVersion: string;
  readonly execution: ExecutionSite;
  readonly startedAt: string;
  readonly durationMs: number;
  readonly inputs: FileDigest[];
  readonly outputs: FileDigest[];
  readonly report?: Record<string, unknown>;
  readonly logs: LogEntry[];
}

export interface RunResult {
  readonly files: DocumentFile[];
  readonly record: RunRecord;
}

export interface RunOptions {
  signal?: AbortSignal;
  onLog?: (entry: LogEntry) => void;
  onProgress?: (fraction: number, label?: string) => void;
  clock?: () => Date;
  /** Monotonic timer, injectable for deterministic tests. */
  timer?: () => number;
}

/** Validate count, size and sniffed type. Returns files with their *sniffed* MIME. */
export function validateInputs(files: readonly DocumentFile[], spec: InputSpec): DocumentFile[] {
  if (files.length < spec.minFiles || files.length > spec.maxFiles) {
    const expected = spec.minFiles === spec.maxFiles ? `${spec.minFiles}` : `${spec.minFiles} à ${spec.maxFiles}`;
    throw new SkillError('INPUT_COUNT', `Cet outil attend ${expected} fichier(s), ${files.length} reçu(s).`, {
      min: spec.minFiles,
      max: spec.maxFiles,
      received: files.length,
    });
  }
  return files.map((file, index) => {
    if (file.bytes.byteLength > spec.maxBytesPerFile) {
      throw new SkillError('INPUT_TOO_LARGE', `« ${sanitizeFileName(file.name)} » dépasse la taille maximale.`, {
        index,
        limit: spec.maxBytesPerFile,
        size: file.bytes.byteLength,
      });
    }
    const sniffed = sniffMime(file.bytes, file.name);
    if (!sniffed || !spec.mimes.includes(sniffed)) {
      throw new SkillError('INPUT_TYPE', `« ${sanitizeFileName(file.name)} » n'est pas d'un type accepté.`, {
        index,
        accepted: [...spec.mimes],
        detected: sniffed,
      });
    }
    return { name: sanitizeFileName(file.name), mime: sniffed, bytes: file.bytes };
  });
}

export function parseOptions<T>(skill: Skill<T>, raw: unknown): T {
  const parsed = skill.options.safeParse(raw ?? {});
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => ({ path: i.path.map(String).join('.'), message: i.message }));
    throw new SkillError('INVALID_OPTIONS', 'Réglages invalides.', { issues });
  }
  return parsed.data;
}

async function digest(file: DocumentFile): Promise<FileDigest> {
  return { name: file.name, mime: file.mime, bytes: file.bytes.byteLength, sha256: await sha256Hex(file.bytes) };
}

function newRunId(): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Executes a skill under the full contract: input validation, schema parsing,
 * abort handling, output validation and audit digests.
 */
export async function runSkill<T>(
  skill: Skill<T>,
  files: readonly DocumentFile[],
  rawOptions: unknown,
  opts: RunOptions = {},
): Promise<RunResult> {
  const clock = opts.clock ?? (() => new Date());
  const timer = opts.timer ?? (() => performance.now());
  const signal = opts.signal ?? new AbortController().signal;
  const t0 = timer();
  const startedAt = clock().toISOString();
  const logs: LogEntry[] = [];

  const log = (level: LogLevel, message: string, data?: Record<string, unknown>) => {
    const entry: LogEntry = { t: Math.round(timer() - t0), level, skill: skill.id, message, ...(data ? { data } : {}) };
    logs.push(entry);
    opts.onLog?.(entry);
  };

  const ctx: SkillContext = {
    signal,
    log,
    progress: (fraction, label) => opts.onProgress?.(Math.min(1, Math.max(0, fraction)), label),
    now: clock,
  };

  try {
    if (signal.aborted) throw new SkillError('ABORTED', 'Traitement annulé.');
    const inputs = validateInputs(files, skill.input);
    const options = parseOptions(skill, rawOptions);
    const inputDigests = await Promise.all(inputs.map(digest));
    log('info', `start ${skill.id}@${skill.version}`, { files: inputs.length, site: skill.execution });

    const output = await skill.run(inputs, options, ctx);
    if (signal.aborted) throw new SkillError('ABORTED', 'Traitement annulé.');
    if (!output.files.length) throw new SkillError('SKILL_FAILED', 'Le traitement n’a produit aucun fichier.');

    const outputs = output.files.map((f) => ({ ...f, name: sanitizeFileName(f.name, 'resultat') }));
    const outputDigests = await Promise.all(outputs.map(digest));
    const durationMs = Math.round(timer() - t0);
    log('info', `done in ${durationMs} ms`, { outputs: outputs.length });

    return {
      files: outputs,
      record: {
        runId: newRunId(),
        skillId: skill.id,
        skillVersion: skill.version,
        execution: skill.execution,
        startedAt,
        durationMs,
        inputs: inputDigests,
        outputs: outputDigests,
        ...(output.report ? { report: output.report } : {}),
        logs,
      },
    };
  } catch (error) {
    const err = SkillError.from(error);
    log('error', `${err.code}: ${err.message}`, err.details);
    throw err;
  }
}
