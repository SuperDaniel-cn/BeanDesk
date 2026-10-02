/**
 * Message-catalogue primitives.
 *
 * The English catalogue is the canonical shape of the UI. Every other locale is
 * checked against it at compile time (see `locales/zh-CN.ts`), so a missing or
 * misspelled key fails `bun run build` rather than silently rendering a raw key
 * to a user. That guarantee is the whole reason this layer exists instead of
 * bare string constants.
 */

/**
 * Plural forms keyed by CLDR category. `Intl.PluralRules` decides which one
 * applies for a given count, so languages with richer rules than English
 * (Russian's `few`/`many`, Arabic's `zero`/`two`) only need to add the forms
 * they actually use. `other` is the mandatory fallback.
 */
export type PluralForms = Partial<Record<Intl.LDMLPluralRule, string>> & {
  other: string
}

/** A leaf value: either a plain string or a set of plural forms. */
export type Message = string | PluralForms

/** A nested catalogue of messages. */
export interface Catalog {
  [key: string]: Message | Catalog
}

/** Values that may be interpolated into a message's `{placeholders}`. */
export type Vars = Record<string, string | number>

/** Dot-delimited paths to every leaf message in a catalogue. */
export type LeafPaths<T, Prefix extends string = ''> = {
  [K in keyof T & string]: T[K] extends Message
    ? `${Prefix}${K}`
    : LeafPaths<T[K], `${Prefix}${K}.`>
}[keyof T & string]

/**
 * Compile-time guard. `NoMissingKeys<X>` is only well-formed when `X` is
 * `never`, so instantiating it with the set of keys a locale is missing
 * produces a type error naming those keys.
 */
export type NoMissingKeys<Missing extends never> = Missing

/** The CLDR plural categories `Intl.PluralRules` can select. */
const PLURAL_CATEGORIES = new Set<string>(['zero', 'one', 'two', 'few', 'many', 'other'])

/**
 * Distinguish a plural-form leaf from a nested catalogue. Both are plain
 * objects, so the test is structural: every key must be a CLDR category with a
 * string value, and `other` must be present.
 */
export function isPluralForms(value: Message | Catalog): value is PluralForms {
  if (typeof value !== 'object' || value === null) return false

  const entries = Object.entries(value)
  if (entries.length === 0) return false
  if (!entries.every(([key, form]) => PLURAL_CATEGORIES.has(key) && typeof form === 'string')) {
    return false
  }
  return typeof (value as PluralForms).other === 'string'
}
