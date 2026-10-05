/**
 * Locale provider and hooks.
 *
 * ## Adding a language
 * 1. Copy `locales/en.ts` to `locales/<tag>.ts` and translate the values.
 * 2. Register it in `registry.ts` — `label` is the endonym shown in the switcher.
 * 3. Run `bun run build`. Any key you missed is a compile error naming its path.
 *
 * Keep `{placeholders}` verbatim: the UI fills in dates, counts, and
 * currency codes. Do not translate the names inside the braces.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

import { invoke, isTauri } from '@tauri-apps/api/core'

import {
  formatCurrency as formatCurrencyRaw,
  formatDate as formatDateRaw,
  formatNumber as formatNumberRaw,
  formatSignedCurrency as formatSignedCurrencyRaw,
} from '@/lib/format'

import type { Vars } from './catalog'
import type { MessageKey } from './locales/en'
import {
  DEFAULT_LOCALE,
  LOCALES,
  STORAGE_KEY,
  SUPPORTED_LOCALES,
  type Locale,
} from './registry'
import { detectLocale, matchLocale, translate } from './translate'

function readStoredLocale(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY)
  } catch {
    // Private browsing / storage disabled — fall back to detection.
    return null
  }
}

function machineLanguages(): readonly string[] {
  if (typeof navigator === 'undefined') return []
  return navigator.languages?.length ? navigator.languages : [navigator.language]
}

function explicitChoice(): Locale | null {
  return matchLocale(SUPPORTED_LOCALES, readStoredLocale()) ?? null
}

function initialLocale(): Locale {
  return detectLocale(SUPPORTED_LOCALES, readStoredLocale(), machineLanguages(), DEFAULT_LOCALE)
}

export interface I18nValue {
  locale: Locale
  setLocale: (locale: Locale) => void

  /** Translate a dot-path key, interpolating any `{placeholders}` it contains. */
  t: (key: MessageKey, vars?: Vars) => string

  /** Locale-aware formatting. Prefer these over importing `lib/format` directly. */
  formatCurrency: (value: number, currency: string) => string
  formatSignedCurrency: (value: number, currency: string) => string
  formatDate: (iso: string | null) => string
  formatNumber: (value: number) => string
}

const I18nContext = createContext<I18nValue | null>(null)

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale)
  // The desktop webview reports the bundle language, which stays English
  // until the app is localized. Ask the operating system before the first paint.
  const [ready, setReady] = useState(() => !isTauri() || explicitChoice() !== null)

  useEffect(() => {
    if (!isTauri() || explicitChoice()) return
    let cancelled = false
    const locales = invoke<string[]>('system_locales')
    const timeout = new Promise<null>((resolve) => {
      setTimeout(() => resolve(null), 400)
    })
    const apply = (tags: string[]) => {
      if (cancelled || explicitChoice()) return
      const preferred = tags.length > 0 ? tags : machineLanguages()
      setLocaleState(detectLocale(SUPPORTED_LOCALES, null, preferred, DEFAULT_LOCALE))
    }
    void Promise.race([locales.catch(() => null), timeout]).then((tags) => {
      if (cancelled) return
      if (tags) apply(tags)
      setReady(true)
      if (!tags) {
        void locales.then(apply).catch(() => undefined)
      }
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    // Keeps screen readers, hyphenation and CJK font selection honest.
    document.documentElement.lang = locale
  }, [locale])

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next)
    try {
      window.localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // Persisting is best-effort; the in-memory choice still applies.
    }
  }, [])

  const value = useMemo<I18nValue>(() => {
    const catalog = LOCALES[locale].catalog
    return {
      locale,
      setLocale,
      t: (key, vars) => translate(catalog, locale, key, vars),
      formatCurrency: (amount, currency) => formatCurrencyRaw(amount, currency, locale),
      formatSignedCurrency: (amount, currency) =>
        formatSignedCurrencyRaw(amount, currency, locale),
      formatDate: (iso) => formatDateRaw(iso, locale),
      formatNumber: (count) => formatNumberRaw(count, locale),
    }
  }, [locale, setLocale])

  if (!ready) return null
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext)
  if (!value) throw new Error('useI18n must be used inside <I18nProvider>')
  return value
}
