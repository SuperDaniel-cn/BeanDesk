import { describe, expect, test } from 'bun:test'

import type { Catalog } from './catalog'
import { en } from './locales/en'
import { zhCN } from './locales/zh-CN'
import { detectLocale, interpolate, resolveMessage, selectMessage, translate } from './translate'

/** Flatten a catalogue to its leaf dot-paths. */
function leafPaths(catalog: Catalog, prefix = ''): string[] {
  return Object.entries(catalog).flatMap(([key, value]) => {
    const path = `${prefix}${key}`
    if (typeof value === 'string') return [path]
    if ('other' in value && typeof value.other === 'string') return [`${path}#plural`]
    return leafPaths(value as Catalog, `${path}.`)
  })
}

describe('catalogue parity', () => {
  // The compile-time guard in zh-CN.ts is the real enforcement; this is the
  // readable failure message when someone bypasses it with a cast.
  test('Chinese covers exactly the same keys as English', () => {
    const english = leafPaths(en as Catalog).sort()
    const chinese = leafPaths(zhCN as Catalog).sort()
    expect(chinese).toEqual(english)
  })

  test('the modern language is actually translated, not copied', () => {
    expect(zhCN.balanceSheet.title).not.toBe(en.balanceSheet.title)
    expect(zhCN.balanceSheet.title).toBe('资产负债表')
    expect(en.brand.short).toBe('BeanDesk')
    expect(en.brand.window).toBe('BeanDesk')
    expect(zhCN.brand.short).toBe('经营账本')
    expect(zhCN.brand.window).toBe('经营账本')
    expect(en.brand.tagline).toContain('one-person companies')
    expect(zhCN.brand.tagline).toBe('一人公司对公财税与合规工作台')
  })
})

describe('resolveMessage', () => {
  test('walks a nested path', () => {
    expect(resolveMessage(en as Catalog, 'balanceSheet.account')).toBe('Account')
  })

  test('returns undefined for an unknown path', () => {
    expect(resolveMessage(en as Catalog, 'balanceSheet.nope')).toBeUndefined()
    expect(resolveMessage(en as Catalog, 'nope.nope.nope')).toBeUndefined()
  })

  test('does not descend into plural forms', () => {
    const plural = resolveMessage(en as Catalog, 'ledger.errorsTitle')
    expect(typeof plural).toBe('object')
    expect(resolveMessage(en as Catalog, 'ledger.errorsTitle.other')).toBeUndefined()
  })
})

describe('interpolate', () => {
  test('substitutes string placeholders verbatim', () => {
    expect(interpolate('Hello {name}', { name: '世界' }, 'en-US')).toBe('Hello 世界')
  })

  test('formats numeric placeholders per locale', () => {
    expect(interpolate('{count} months', { count: 12345 }, 'en-US')).toBe('12,345 months')
  })

  test('leaves unknown placeholders untouched', () => {
    expect(interpolate('a {missing} b', { other: 1 }, 'en-US')).toBe('a {missing} b')
  })
})

describe('plural selection', () => {
  const message = { one: '{count} month', other: '{count} months' }

  test('picks the singular form for one', () => {
    expect(selectMessage(message, 'en-US', { count: 1 })).toBe('1 month')
  })

  test('picks the plural form otherwise', () => {
    expect(selectMessage(message, 'en-US', { count: 9 })).toBe('9 months')
    expect(selectMessage(message, 'en-US', { count: 0 })).toBe('0 months')
  })

  test('falls back to `other` for a language without that category', () => {
    // Chinese has only `other`; the same count must still resolve.
    const chinese = { other: '{count} 个月' }
    expect(selectMessage(chinese, 'zh-CN', { count: 1 })).toBe('1 个月')
  })
})

describe('translate', () => {
  test('renders a pluralised key through the active locale', () => {
    expect(
      translate(en as Catalog, 'en', 'ledger.errorsTitle', { count: 1 }),
    ).toBe('1 ledger error')
  })

  test('returns the key for a missing message instead of throwing', () => {
    expect(translate(en as Catalog, 'en', 'does.not.exist')).toBe('does.not.exist')
  })

  test('leaves string placeholders unchanged', () => {
    expect(translate(en as Catalog, 'en', 'common.asOf', { date: '2026-01-31' })).toBe(
      'As of 2026-01-31',
    )
    expect(translate(zhCN as Catalog, 'zh-CN', 'common.asOf', { date: '2026-01-31' })).toBe(
      '截至 2026-01-31',
    )
  })
})

describe('detectLocale', () => {
  const supported = ['en', 'zh-CN'] as const

  test('prefers an explicit stored choice', () => {
    expect(detectLocale(supported, 'zh-CN', ['en-US'], 'en')).toBe('zh-CN')
  })

  test('ignores an unsupported stored choice', () => {
    expect(detectLocale(supported, 'fr-FR', ['en-US'], 'en')).toBe('en')
  })

  test('matches a browser tag exactly', () => {
    expect(detectLocale(supported, null, ['zh-CN'], 'en')).toBe('zh-CN')
  })

  test('falls back to the base language of a regional tag', () => {
    expect(detectLocale(supported, null, ['zh-Hans-CN'], 'en')).toBe('zh-CN')
    expect(detectLocale(supported, null, ['zh-Hans'], 'en')).toBe('zh-CN')
  })

  test('walks the preference list in order', () => {
    expect(detectLocale(supported, null, ['de-DE', 'zh-TW', 'en-US'], 'en')).toBe('zh-CN')
  })

  test('uses the fallback when nothing matches', () => {
    expect(detectLocale(supported, null, ['de-DE', 'fr'], 'en')).toBe('en')
    expect(detectLocale(supported, null, [], 'en')).toBe('en')
  })
})
