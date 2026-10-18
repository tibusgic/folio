export type SkillErrorCode =
  | 'UNKNOWN_SKILL'
  | 'DUPLICATE_SKILL'
  | 'INPUT_COUNT'
  | 'INPUT_TYPE'
  | 'INPUT_TOO_LARGE'
  | 'INVALID_OPTIONS'
  | 'ENCRYPTED_INPUT'
  | 'CORRUPT_INPUT'
  | 'FORBIDDEN_CONTENT'
  | 'REMOTE_UNAVAILABLE'
  | 'REMOTE_REJECTED'
  | 'TIMEOUT'
  | 'ABORTED'
  | 'SKILL_FAILED';

export interface SerializedSkillError {
  readonly name: 'SkillError';
  readonly code: SkillErrorCode;
  readonly message: string;
  readonly details?: Record<string, unknown>;
}

/**
 * The only error type that may cross the engine boundary. `message` is
 * user-facing (French) and must never contain file contents or server paths.
 */
export class SkillError extends Error {
  override readonly name = 'SkillError';
  constructor(
    readonly code: SkillErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }

  toJSON(): SerializedSkillError {
    return { name: this.name, code: this.code, message: this.message, ...(this.details ? { details: this.details } : {}) };
  }

  static from(value: unknown): SkillError {
    if (value instanceof SkillError) return value;
    if (isSerializedSkillError(value)) return new SkillError(value.code, value.message, value.details);
    if (value instanceof DOMException && value.name === 'AbortError') {
      return new SkillError('ABORTED', 'Traitement annulé.');
    }
    // Do not leak internal messages; keep them in details for the enterprise log only.
    const internal = value instanceof Error ? value.message : String(value);
    return new SkillError('SKILL_FAILED', 'Le traitement a échoué.', { internal: internal.slice(0, 300) });
  }
}

export function isSerializedSkillError(value: unknown): value is SerializedSkillError {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { name?: unknown }).name === 'SkillError' &&
    typeof (value as { code?: unknown }).code === 'string' &&
    typeof (value as { message?: unknown }).message === 'string'
  );
}
