import { describe, expect, test } from 'bun:test'

import type { MessageKey } from '@/i18n/locales/en'

import { emptyCalendarFile, withCalendarSource } from './compliance-calendar'
import { explainCalendarError, resolveCalendar } from './calendar'

describe('calendar store shape', () => {
  test('explains file and HTTPS failures', () => {
    const t = (key: MessageKey) => key
    expect(explainCalendarError('calendar-file', t)).toBe('calendar.missingFile')
    expect(explainCalendarError('file', t)).toBe('calendar.errorFile')
    expect(explainCalendarError('calendar-url', t)).toBe('calendar.invalidUrl')
    expect(explainCalendarError('calendar-http', t)).toBe('calendar.errorUrl')
  })

  test('the browser resolve path does not load a calendar', async () => {
    const resolved = await resolveCalendar(
      withCalendarSource('url', { url: 'https://example.com/cal.ics' }, emptyCalendarFile()),
      '2026-10-05',
    )
    expect(resolved.catalog).toEqual([])
    expect(resolved.ics).toBe('')
  })
})
