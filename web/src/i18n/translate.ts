/**
 * Pure translation helpers — no React, so they can be unit-tested directly.
 */

import { isPluralForms, type Catalog, type Message, type Vars } from './catalog'

const PLACEHOLDER = /\{(\w+)\}/g

/** Walk a dot-delimited path, stopping before it descends into plural forms. */
export function resolveMessage(catalog: Catalog, key: string): Message | undefined {
  let node: Message | Catalog = catalog

  for (const segment of key.split('.')) {
    if (typeof node === 'string' || isPluralForms(node)) return undefined
    const next: Message | Catalog | undefined = node[segment]
    if (next === undefined) return undefined
    node = next
  }

  return node as Message
}

/** Substitute `{placeholders}`; numbers are grouped per the active locale. */
export function interpolate(text: string, vars: Vars | undefined, locale: string): string {
  if (!vars) return text

  return text.replace(PLACEHOLDER, (match, name: string) => {
    const value = vars[name]
    if (value === undefined) return match
    if (typeof value === 'number') {
      return new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value)
    }
    return value
  })
}

/** Pick the right plural form for `vars.count`, then interpolate. */
export function selectMessage(message: Message, locale: string, vars?: Vars): string {
  if (!isPluralForms(message)) return interpolate(message, vars, locale)

  const count = Number(vars?.count ?? 0)
  const category = new Intl.PluralRules(locale).select(count)
  return interpolate(message[category] ?? message.other, vars, locale)
}

/**
 * Look up `key` and render it. An unknown key returns the key itself rather
 * than throwing: a missing string should degrade the UI, not blank the page.
 * The type system is what prevents that from shipping.
 */
export function translate(
  catalog: Catalog,
  locale: string,
  key: string,
  vars?: Vars,
): string {
  const message = resolveMessage(catalog, key)
  if (message === undefined) {
    if (import.meta.env.DEV) {
      console.warn(`[i18n] missing message: ${key} (${locale})`)
    }
    return key
  }
  return selectMessage(message, locale, vars)
}

/** Exact tag first, then the bare language. `zh-Hans-CN` still finds `zh-CN`. */
export function matchLocale<L extends string>(
  supported: readonly L[],
  candidate: string | null | undefined,
): L | undefined {
  if (!candidate) return undefined
  const wanted = candidate.trim().toLowerCase()
  if (!wanted) return undefined

  const exact = supported.find((locale) => locale.toLowerCase() === wanted)
  if (exact) return exact

  const base = wanted.split('-')[0]
  return supported.find((locale) => locale.toLowerCase().split('-')[0] === base)
}

/**
 * An explicit stored choice wins. Otherwise walk the machine's preference
 * list. The fallback is only for a language this app does not ship.
 */
export function detectLocale<L extends string>(
  supported: readonly L[],
  stored: string | null | undefined,
  preferred: readonly (string | undefined)[],
  fallback: L,
): L {
  const storedMatch = matchLocale(supported, stored)
  if (storedMatch) return storedMatch

  for (const candidate of preferred) {
    const preferredMatch = matchLocale(supported, candidate)
    if (preferredMatch) return preferredMatch
  }

  return fallback
}
