import { describe, expect, test } from 'bun:test'

import { REPORT_PAGES, navLabelKey } from '@/app-pages'
import { en } from '@/i18n/locales/en'
import { zhCN } from '@/i18n/locales/zh-CN'

describe('nav labels', () => {
  test('Documents uses the same nav label and page title', () => {
    const documents = REPORT_PAGES.find((page) => page.path === '/documents')
    expect(documents?.navKey).toBe('documents.nav')
    expect(navLabelKey(documents!)).toBe('documents.nav')
    expect(en.documents.nav).toBe('Documents')
    expect(en.documents.title).toBe('Documents')
    expect(zhCN.documents.nav).toBe('凭证')
    expect(zhCN.documents.title).toBe('凭证')
  })

  test('other report pages keep a single label', () => {
    for (const page of REPORT_PAGES.filter((page) => page.path !== '/documents')) {
      expect(page.navKey).toBeUndefined()
      expect(navLabelKey(page)).toBe(page.key)
    }
  })
})
