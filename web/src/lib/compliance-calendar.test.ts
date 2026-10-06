import { describe, expect, test } from 'bun:test'

import {
  DEFAULT_REFRESH_MS,
  MIN_REFRESH_MS,
  copyStale,
  emptyCalendarFile,
  eventsFromIcs,
  isIcs,
  noticeKey,
  noticesDue,
  normalizeCalendarUrl,
  readCalendarCopy,
  readCalendarFile,
  refreshIntervalMs,
  rememberNotices,
  sameCalendarSource,
  sourceReady,
  upcomingEvents,
  withCalendarSource,
  type CalendarCopy,
} from './compliance-calendar'

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

describe('ICS parse', () => {
  test('keeps a yearly Google event inside the upcoming year', () => {
    expect(eventsFromIcs(GOOGLE_STYLE, '2026-10-05')).toEqual([
      {
        uid: 'annual-filing@example.com',
        date: '2027-03-15',
        summary: 'Annual filing reminder',
      },
    ])
    expect(upcomingEvents(eventsFromIcs(GOOGLE_STYLE, '2026-10-05'), '2026-10-05')).toEqual(
      eventsFromIcs(GOOGLE_STYLE, '2026-10-05'),
    )
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
    const file = withCalendarSource('file', { file: '/tmp/custom.ics' }, emptyCalendarFile())
    const url = withCalendarSource(
      'url',
      { url: 'https://calendar.google.com/calendar/ical/demo/basic.ics' },
      file,
    )
    const webcal = withCalendarSource('url', { url: 'webcal://example.com/cal.ics' }, emptyCalendarFile())
    expect(url.active).toBe('url')
    expect(url.file).toBe('/tmp/custom.ics')
    expect(url.url).toBe('https://calendar.google.com/calendar/ical/demo/basic.ics')
    expect(webcal.url).toBe('https://example.com/cal.ics')
    expect(readCalendarFile({ active: 'both' })).toBeNull()
    expect(readCalendarFile(url)?.active).toBe('url')
    expect(readCalendarFile({ active: 'url', url: 'webcal://example.com/cal.ics' })?.url).toBe(
      'https://example.com/cal.ics',
    )
    expect(sourceReady(emptyCalendarFile())).toBe(false)
    expect(readCalendarFile({ active: 'bundled', url: 'https://example.com/old.ics' })).toBeNull()
    expect(sourceReady(withCalendarSource('file', {}, emptyCalendarFile()))).toBe(false)
    expect(sourceReady(file)).toBe(true)
    expect(sourceReady(withCalendarSource('url', {}, emptyCalendarFile()))).toBe(false)
    expect(sourceReady(withCalendarSource('url', { url: 'http://example.com/cal.ics' }, emptyCalendarFile()))).toBe(false)
    expect(sourceReady(url)).toBe(true)
    expect(sourceReady(webcal)).toBe(true)
    expect(sameCalendarSource(url, { ...url, seenUids: ['x'] })).toBe(true)
    expect(sameCalendarSource(url, file)).toBe(false)
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

  test('rewrites webcal and rejects plain http', () => {
    expect(normalizeCalendarUrl('webcal://example.com/cal.ics')).toBe('https://example.com/cal.ics')
    expect(normalizeCalendarUrl('http://example.com/cal.ics')).toBeNull()
  })
})

describe('local copy and refresh interval', () => {
  const HOUR = 60 * 60 * 1000
  const now = Date.parse('2026-10-06T10:00:00Z')
  const copy: CalendarCopy = {
    active: 'url',
    file: '',
    url: 'https://example.com/cal.ics',
    ics: GOOGLE_STYLE,
    etag: '"v1"',
    lastModified: '',
    syncedAt: new Date(now - 2 * HOUR).toISOString(),
  }

  test('a feed without a declared interval is checked again after a day', () => {
    expect(refreshIntervalMs(GOOGLE_STYLE)).toBe(DEFAULT_REFRESH_MS)
    expect(copyStale(copy, now)).toBe(false)
    expect(copyStale(copy, now + 23 * HOUR)).toBe(true)
  })

  test('REFRESH-INTERVAL and X-PUBLISHED-TTL set the interval, never below an hour', () => {
    const weekly = GOOGLE_STYLE.replace('VERSION:2.0', 'VERSION:2.0\r\nREFRESH-INTERVAL;VALUE=DURATION:P1W')
    const halfDay = GOOGLE_STYLE.replace('VERSION:2.0', 'VERSION:2.0\r\nX-PUBLISHED-TTL:PT12H')
    const tooOften = GOOGLE_STYLE.replace('VERSION:2.0', 'VERSION:2.0\r\nX-PUBLISHED-TTL:PT5M')
    const broken = GOOGLE_STYLE.replace('VERSION:2.0', 'VERSION:2.0\r\nREFRESH-INTERVAL;VALUE=DURATION:soon')
    expect(refreshIntervalMs(weekly)).toBe(7 * 24 * HOUR)
    expect(refreshIntervalMs(halfDay)).toBe(12 * HOUR)
    expect(refreshIntervalMs(tooOften)).toBe(MIN_REFRESH_MS)
    expect(refreshIntervalMs(broken)).toBe(DEFAULT_REFRESH_MS)
    expect(copyStale({ ...copy, ics: weekly }, now + 6 * 24 * HOUR)).toBe(false)
    expect(copyStale({ ...copy, ics: weekly }, now + 8 * 24 * HOUR)).toBe(true)
  })

  test('a local file is read again every time; a copy without a sync time is stale', () => {
    expect(copyStale({ ...copy, active: 'file', file: '/tmp/a.ics', syncedAt: new Date(now).toISOString() }, now)).toBe(true)
    expect(copyStale({ ...copy, syncedAt: '' }, now)).toBe(true)
  })

  test('reads a stored copy and tells it apart from the saved source', () => {
    expect(readCalendarCopy(copy)).toEqual(copy)
    expect(readCalendarCopy({ ...copy, ics: '' })).toBeNull()
    expect(readCalendarCopy({ ...copy, active: 'bundled' })).toBeNull()
    expect(readCalendarCopy(null)).toBeNull()
    const saved = withCalendarSource('url', { url: 'https://example.com/cal.ics' }, emptyCalendarFile())
    expect(sameCalendarSource(copy, saved)).toBe(true)
    expect(sameCalendarSource(copy, withCalendarSource('url', { url: 'https://example.com/other.ics' }, saved))).toBe(false)
  })

  test('only calendar text counts as a calendar', () => {
    expect(isIcs(GOOGLE_STYLE)).toBe(true)
    expect(isIcs('<!doctype html><title>Sign in</title>')).toBe(false)
  })
})
