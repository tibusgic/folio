/**
 * Folio Skill contract.
 *
 * A Skill is a pure document transformation: `(files, options, ctx) -> files`.
 * It knows nothing about the DOM, the network transport or the UI that hosts it.
 * The UI renders a Skill exclusively from its serialisable manifest.
 */
import type { z } from 'zod';
import type { FieldSpec } from './fields.ts';

/** Where the bytes are processed. Drives the privacy badge shown to the user. */
export type ExecutionSite = 'local' | 'remote-ephemeral';

export type SkillCategory = 'assemble' | 'secure' | 'convert' | 'extract' | 'inspect';

/** UI modes in which the skill is offered. */
export type UiMode = 'quick' | 'enterprise';

/** What the output represents, so the host can pick an adequate presenter. */
export type OutputKind = 'pdf' | 'print-html' | 'data' | 'source';

export interface DocumentFile {
  readonly name: string;
  readonly mime: string;
  readonly bytes: Uint8Array;
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  /** Milliseconds since run start. */
  readonly t: number;
  readonly level: LogLevel;
  readonly skill: string;
  readonly message: string;
  readonly data?: Record<string, unknown>;
}

export interface SkillContext {
  readonly signal: AbortSignal;
  log(level: LogLevel, message: string, data?: Record<string, unknown>): void;
  /** fraction in [0, 1]. */
  progress(fraction: number, label?: string): void;
  /** Injected clock so audit stamps are deterministic in tests. */
  now(): Date;
}

export interface SkillOutput {
  files: DocumentFile[];
  /** Structured, JSON-serialisable report (sizes, counts, warnings...). */
  report?: Record<string, unknown>;
}

export interface InputSpec {
  /** Accepted MIME types, checked against sniffed content, never the extension alone. */
  readonly mimes: readonly string[];
  readonly minFiles: number;
  readonly maxFiles: number;
  readonly maxBytesPerFile: number;
}

/** Serialisable part of a skill: can cross worker / network boundaries. */
export interface SkillManifest {
  readonly id: string;
  readonly version: string;
  readonly title: string;
  readonly summary: string;
  readonly category: SkillCategory;
  readonly execution: ExecutionSite;
  readonly input: InputSpec;
  readonly fields: readonly FieldSpec[];
  readonly modes: readonly UiMode[];
  readonly output: OutputKind;
  /** Skill consumes a page plan built in the page grid (reorder / rotate / delete). */
  readonly usesPagePlan?: boolean;
}

export interface Skill<TOptions = unknown> extends SkillManifest {
  readonly options: z.ZodType<TOptions>;
  run(files: DocumentFile[], options: TOptions, ctx: SkillContext): Promise<SkillOutput>;
}

/** Helper that infers TOptions from the zod schema. */
export function defineSkill<S extends z.ZodType>(
  def: Omit<Skill<z.output<S>>, 'options'> & { options: S },
): Skill<z.output<S>> {
  return def as unknown as Skill<z.output<S>>;
}

export function toManifest(skill: Skill<any>): SkillManifest {
  const { options: _o, run: _r, ...manifest } = skill;
  return structuredClone(manifest);
}
