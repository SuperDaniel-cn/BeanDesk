/**
 * The locale registry — plain data, deliberately free of React.
 *
 * Kept separate from the provider so that React Fast Refresh can reload the
 * provider cleanly (a module exporting both components and constants cannot be
 * hot-refreshed), and so tests and tooling can import the catalogue without
 * pulling in React.
 */

import type { Catalog } from './catalog'
import { en } from './locales/en'
import { zhCN } from './locales/zh-CN'

export interface LocaleDefinition {
  /** Endonym — a language is always listed in its own language. */
  label: string
  catalog: Catalog
}

export const LOCALES = {
  en: { label: 'English', catalog: en },
  'zh-CN': { label: '中文', catalog: zhCN },
} satisfies Record<string, LocaleDefinition>

export type Locale = keyof typeof LOCALES

export const SUPPORTED_LOCALES = Object.keys(LOCALES) as Locale[]

/** Used only when the machine's languages are ones this app does not ship. */
export const DEFAULT_LOCALE: Locale = 'en'

/** localStorage key holding an explicit user choice. */
export const STORAGE_KEY = 'beancount-opc:locale'
