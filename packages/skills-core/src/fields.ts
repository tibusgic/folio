/**
 * Declarative UI descriptors. A host renders forms from these; skills never
 * import UI code. `key` maps 1:1 to a property of the skill's zod options schema.
 */
interface BaseField {
  readonly key: string;
  readonly label: string;
  readonly help?: string;
  /** Hidden in "quick" mode, default value from the schema is used instead. */
  readonly advanced?: boolean;
  /** Only show when another field has a given value. */
  readonly showIf?: { readonly key: string; readonly equals: string | number | boolean | readonly (string | number | boolean)[] };
}

export type FieldSpec =
  | (BaseField & { readonly kind: 'text'; readonly placeholder?: string; readonly maxLength?: number })
  | (BaseField & { readonly kind: 'textarea'; readonly rows?: number; readonly mono?: boolean })
  | (BaseField & { readonly kind: 'password'; readonly autocomplete?: 'new-password' | 'current-password' })
  | (BaseField & { readonly kind: 'number'; readonly min: number; readonly max: number; readonly step?: number; readonly unit?: string })
  | (BaseField & { readonly kind: 'range'; readonly min: number; readonly max: number; readonly step?: number; readonly unit?: string })
  | (BaseField & { readonly kind: 'select'; readonly options: readonly { readonly value: string; readonly label: string }[] })
  | (BaseField & { readonly kind: 'toggle' })
  | (BaseField & { readonly kind: 'color' })
  | (BaseField & { readonly kind: 'pages'; readonly placeholder?: string })
  | (BaseField & { readonly kind: 'signature' });

export type FieldKind = FieldSpec['kind'];

export function isFieldVisible(field: FieldSpec, values: Record<string, unknown>, mode: 'quick' | 'enterprise'): boolean {
  if (field.advanced && mode === 'quick') return false;
  if (!field.showIf) return true;
  const actual = values[field.showIf.key];
  const expected = field.showIf.equals;
  return Array.isArray(expected) ? expected.includes(actual as never) : actual === expected;
}
