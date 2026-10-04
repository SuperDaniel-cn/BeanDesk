import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, test } from 'bun:test'

import type { MessageKey } from '@/i18n/locales/en'

import {
  bundledCatalogEvents,
  eventsFromIcs,
  generateIcs,
  noticeKey,
  noticesDue,
  normalizeCalendarUrl,
  presentCalendarSummary,
  publicCatalogEvents,
  readCalendarFile,
  rememberNotices,
  upcomingEvents,
  withCalendarSource,
} from './compliance-calendar'

const PUBLIC_ICS = join(import.meta.dir, '../../../calendars/cn-small-quarterly.ics')

const GOOGLE_STYLE = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:-//Google Inc//Google Calendar 70.9054//EN',
  'BEGIN:VEVENT',
  'DTSTART;TZID=Asia/Shanghai:20260315T090000',
  'DTEND;TZID=Asia/Shanghai:20260315T100000',
  'RRULE:FREQ=YEARLY',
  'DTSTAMP:20260101T000000Z',
  'UID:annual-filing@example.com',
  'SUMMARY:Annual filing',
  '  reminder',
  'END:VEVENT',
  'END:VCALENDAR',
  '',
].join('\r\n')

const OUTLOOK_STYLE = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'BEGIN:VEVENT',
  'UID:outlook-monthly@example.com',
  'DTSTART;TZID=China Standard Time:20261008T140000',
  'RRULE:FREQ=MONTHLY;INTERVAL=1;COUNT=3;UNTIL=20261231T235959Z',
  'SUMMARY:Board pack',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:no-date@example.com',
  'SUMMARY:Ignore this',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\n')

describe('bundled China small-scale quarterly catalog', () => {
  test('lists statutory quarter and annual days without a network', () => {
    const events = bundledCatalogEvents('2026-10-05')
    expect(events.some((event) => event.date === '2026-10-15' && event.kind === 'vat')).toBe(true)
    expect(events.some((event) => event.date === '2026-10-15' && event.kind === 'cit-prepay')).toBe(true)
    expect(events.some((event) => event.date === '2026-05-31' && event.kind === 'cit-annual')).toBe(true)
    expect(events.some((event) => event.date === '2027-01-15' && event.kind === 'vat')).toBe(true)
    expect(events.every((event) => event.date >= '2026-01-01' && event.date <= '2028-12-31')).toBe(true)
  })

  test('upcoming rows stay inside twelve months and mix catalog with parsed ICS', () => {
    const today = '2026-10-05'
    const catalog = upcomingEvents(bundledCatalogEvents(today), today)
    expect(catalog.map((event) => event.date)).toContain('2026-10-15')
    expect(catalog.map((event) => event.date)).toContain('2027-05-31')
    expect(catalog.every((event) => event.date >= today && event.date <= '2027-10-05')).toBe(true)

    const parsed = eventsFromIcs(GOOGLE_STYLE, today)
    expect(parsed).toEqual([
      {
        uid: 'annual-filing@example.com',
        date: '2027-03-15',
        summary: 'Annual filing reminder',
      },
    ])
    const merged = upcomingEvents([...catalog, ...parsed], today)
    expect(merged.some((event) => event.uid === 'annual-filing@example.com')).toBe(true)
    expect(merged.some((event) => event.kind === 'vat' && event.date === '2026-10-15')).toBe(true)
  })
})

describe('ICS generate and parse', () => {
  test('locks the public 2026-2030 feed bytes', () => {
    const generated = generateIcs(publicCatalogEvents())
    expect(generated).toBe(readFileSync(PUBLIC_ICS, 'utf8'))
    expect(generated).toContain('DTSTART;VALUE=DATE:20260415')
    expect(generated).toContain('UID:beandesk-cn-small-vat-2026Q1@beandesk')
    expect(generated).toContain('SUMMARY:VAT and surcharges · 2026 Q1')
    expect(publicCatalogEvents().at(0)?.date).toBe('2026-01-15')
    expect(publicCatalogEvents().every((event) => event.date <= '2030-12-31')).toBe(true)
    expect(publicCatalogEvents().some((event) => event.date === '2031-01-15')).toBe(false)
  })

  test('expands TZID, YEARLY/MONTHLY/WEEKLY rules, and drops dateless events', () => {
    expect(eventsFromIcs(OUTLOOK_STYLE, '2026-10-05').map((event) => event.date)).toEqual([
      '2026-10-08',
      '2026-11-08',
      '2026-12-08',
    ])
    const weekly = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'UID:weekly@example.com',
      'DTSTART;VALUE=DATE:20261006',
      'RRULE:FREQ=WEEKLY;INTERVAL=2;COUNT=4;BYDAY=TU',
      'SUMMARY:Check-in',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\n')
    expect(eventsFromIcs(weekly, '2026-10-05').map((event) => event.date)).toEqual([
      '2026-10-06',
      '2026-10-20',
      '2026-11-03',
      '2026-11-17',
    ])
  })
})

describe('one active source and notice keys', () => {
  test('switching the source keeps one active record', () => {
    const file = withCalendarSource('file', { file: '/tmp/custom.ics' }, null)
    const url = withCalendarSource(
      'url',
      { url: 'https://calendar.google.com/calendar/ical/demo/basic.ics' },
      file,
    )
    expect(url.active).toBe('url')
    expect(url.file).toBe('/tmp/custom.ics')
    expect(url.url).toBe('https://calendar.google.com/calendar/ical/demo/basic.ics')
    expect(readCalendarFile({ active: 'both' })).toBeNull()
    expect(readCalendarFile(url)?.active).toBe('url')
  })

  test('the same occurrence does not notify twice; a later RRULE day can', () => {
    const first = { uid: 'annual-filing@example.com', date: '2026-03-15', summary: 'Annual filing reminder' }
    const nextYear = { ...first, date: '2027-03-15' }
    const today = '2026-03-10'
    const due = noticesDue([first, nextYear], today, [])
    expect(due).toEqual([first])
    const seen = rememberNotices([], due)
    expect(seen).toEqual([noticeKey(first)])
    expect(noticesDue([first, nextYear], today, seen)).toEqual([])
    expect(noticesDue([nextYear], '2027-03-12', seen)).toEqual([nextYear])
  })

  test('rewrites webcal and presents catalog copy through i18n', () => {
    expect(normalizeCalendarUrl('webcal://example.com/cal.ics')).toBe('https://example.com/cal.ics')
    expect(normalizeCalendarUrl('http://example.com/cal.ics')).toBeNull()
    const t = (key: MessageKey) => key
    expect(
      presentCalendarSummary(
        {
          uid: 'beandesk-cn-small-vat-2026Q3@beandesk',
          date: '2026-10-15',
          summary: 'VAT and surcharges · 2026 Q3',
          kind: 'vat',
          period: '2026 Q3',
        },
        t,
      ),
    ).toBe('settings.calendarEventVat')
  })
})
