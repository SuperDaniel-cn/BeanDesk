import { describe, expect, test } from 'bun:test'

import type { MessageKey } from '@/i18n/locales/en'

import { emptyCalendarFile, withCalendarSource } from './compliance-calendar'
import { emptyCalendarFeed, explainCalendarError, loadCalendarFeed, shouldRefresh } from './calendar'

describe('calendar feed', () => {
  test('explains file, HTTPS, content and timeout failures', () => {
    const t = (key: MessageKey) => key
    expect(explainCalendarError('calendar-file', t)).toBe('calendar.missingFile')
    expect(explainCalendarError('file', t)).toBe('calendar.errorFile')
    expect(explainCalendarError('calendar-url', t)).toBe('calendar.invalidUrl')
    expect(explainCalendarError('calendar-http', t)).toBe('calendar.errorUrl')
    expect(explainCalendarError(new Error('calendar-not-ics'), t)).toBe('calendar.notIcs')
    expect(explainCalendarError(new Error('calendar-timeout'), t)).toBe('calendar.timeout')
  })

  test('the browser has no copy and never asks for the source', async () => {
    const url = withCalendarSource('url', { url: 'https://example.com/cal.ics' }, emptyCalendarFile())
    const loaded = await loadCalendarFeed('2026-10-05')
    expect(loaded.copy).toBeNull()
    expect(loaded.catalog).toEqual([])
    expect(shouldRefresh(emptyCalendarFeed(url))).toBe(false)
  })
})
