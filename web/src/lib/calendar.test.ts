import { describe, expect, test } from 'bun:test'

import type { MessageKey } from '@/i18n/locales/en'

import { explainCalendarError } from './calendar'

describe('calendar store shape', () => {
  test('explains file and HTTPS failures', () => {
    const t = (key: MessageKey) => key
    expect(explainCalendarError('calendar-file', t)).toBe('settings.calendarMissingFile')
    expect(explainCalendarError('file', t)).toBe('settings.calendarErrorFile')
    expect(explainCalendarError('calendar-url', t)).toBe('settings.calendarInvalidUrl')
    expect(explainCalendarError('calendar-http', t)).toBe('settings.calendarErrorUrl')
  })
})
