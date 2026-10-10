import { describe, expect, test } from 'bun:test'

import type { Catalog, Vars } from '../i18n/catalog'
import { en, type MessageKey } from '../i18n/locales/en'
import { zhCN } from '../i18n/locales/zh-CN'
import { translate } from '../i18n/translate'
import { formatPeriodLabel } from './period-label'

function tFor(catalog: Catalog, locale: string) {
  return (key: MessageKey, vars?: Vars) => translate(catalog, locale, key, vars)
}

describe('formatPeriodLabel', () => {
  test('spells a year, quarter, and month in English', () => {
    const t = tFor(en as Catalog, 'en')
    expect(formatPeriodLabel('2026', t)).toBe('2026')
    expect(formatPeriodLabel('2026-Q2', t)).toBe('2026 Q2')
    expect(formatPeriodLabel('2026-03', t)).toBe('2026-03')
  })

  test('spells the same tokens in Chinese without an English Q', () => {
    const t = tFor(zhCN as Catalog, 'zh-CN')
    expect(formatPeriodLabel('2026', t)).toBe('2026年')
    expect(formatPeriodLabel('2026-Q2', t)).toBe('2026年2季')
    expect(formatPeriodLabel('2026-03', t)).toBe('2026年03月')
  })

  test('uses the all-time label for an empty filter', () => {
    expect(formatPeriodLabel('', tFor(en as Catalog, 'en'))).toBe('All time')
    expect(formatPeriodLabel('', tFor(zhCN as Catalog, 'zh-CN'))).toBe('全部期间')
  })
})
