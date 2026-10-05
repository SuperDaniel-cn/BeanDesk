import type { Vars } from '@/i18n/catalog'
import type { MessageKey } from '@/i18n/locales/en'

export type CalendarKind = 'vat' | 'cit-prepay' | 'cit-annual'

export type CalendarEvent = {
  uid: string
  date: string
  summary: string
  kind?: CalendarKind
  period?: string
}

export type CalendarSource = 'bundled' | 'file' | 'url'

export type CalendarFile = {
  active: CalendarSource
  file: string
  url: string
  seenUids: string[]
}

export const PUBLIC_ICS_START = '2026-01-01'
export const PUBLIC_ICS_END = '2030-12-31'
export const PUBLIC_FEED_URL =
  'https://raw.githubusercontent.com/SuperDaniel-cn/BeanDesk/main/calendars/cn-small-quarterly.ics'
export const UPCOMING_MONTHS = 12
export const NOTICE_DAYS = 7

export function emptyCalendarFile(): CalendarFile {
  return { active: 'bundled', file: '', url: '', seenUids: [] }
}

export function readCalendarFile(value: unknown): CalendarFile | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  if (record.active !== 'bundled' && record.active !== 'file' && record.active !== 'url') {
    return null
  }
  const seen = Array.isArray(record.seenUids)
    ? record.seenUids.filter((item): item is string => typeof item === 'string')
    : []
  return {
    active: record.active,
    file: typeof record.file === 'string' ? record.file : '',
    url: typeof record.url === 'string' ? record.url : '',
    seenUids: seen,
  }
}

export function withCalendarSource(
  active: CalendarSource,
  next: Partial<Pick<CalendarFile, 'file' | 'url'>>,
  previous: CalendarFile | null,
): CalendarFile {
  const base = previous ?? emptyCalendarFile()
  return {
    active,
    file: next.file ?? base.file,
    url: next.url ?? base.url,
    seenUids: base.seenUids,
  }
}

export function sourceReady(file: CalendarFile): boolean {
  if (file.active === 'bundled') return true
  if (file.active === 'file') return file.file.trim().length > 0
  return normalizeCalendarUrl(file.url) !== null
}

export function calendarSourceDetail(file: CalendarFile): string {
  if (file.active === 'file') return file.file.trim().split(/[/\\]/).pop() ?? ''
  if (file.active === 'url') {
    const href = normalizeCalendarUrl(file.url)
    return href ? new URL(href).host : ''
  }
  return ''
}

export function noticeKey(event: CalendarEvent): string {
  return `${event.uid}:${event.date}`
}

export function publicCatalogEvents(): CalendarEvent[] {
  return catalogDueInRange(PUBLIC_ICS_START, PUBLIC_ICS_END)
}

export function bundledCatalogEvents(today: string, yearCount = 3): CalendarEvent[] {
  const year = Number(today.slice(0, 4))
  if (!Number.isFinite(year)) return []
  return catalogDueInRange(`${year}-01-01`, `${year + yearCount - 1}-12-31`)
}

export function eventsInRange(events: CalendarEvent[], start: string, end: string): CalendarEvent[] {
  return events
    .filter((event) => event.date >= start && event.date <= end)
    .sort((left, right) => left.date.localeCompare(right.date) || left.uid.localeCompare(right.uid))
}

export function upcomingEvents(
  events: CalendarEvent[],
  today: string,
  months = UPCOMING_MONTHS,
): CalendarEvent[] {
  return eventsInRange(events, today, addMonths(today, months))
}

export function catalogWindow(today: string): { start: string; end: string } {
  const year = Number(today.slice(0, 4))
  if (!Number.isFinite(year)) return { start: today, end: today }
  return { start: `${year - 1}-01-01`, end: `${year + 2}-12-31` }
}

export function monthGridRange(yearMonth: string): { start: string; end: string } {
  const start = `${yearMonth}-01`
  const parsed = parseDate(start)
  if (!parsed) return { start, end: start }
  const last = `${yearMonth}-${pad(daysInMonth(parsed.y, parsed.m))}`
  return { start: addDays(start, -6), end: addDays(last, 6) }
}

export function noticesDue(events: CalendarEvent[], today: string, seenUids: string[]): CalendarEvent[] {
  const seen = new Set(seenUids)
  const latest = addDays(today, NOTICE_DAYS)
  return events.filter((event) => event.date >= today && event.date <= latest && !seen.has(noticeKey(event)))
}

export function rememberNotices(seenUids: string[], events: CalendarEvent[]): string[] {
  const next = new Set(seenUids)
  for (const event of events) next.add(noticeKey(event))
  return [...next]
}

export function eventsFromIcs(text: string, today: string, months = UPCOMING_MONTHS): CalendarEvent[] {
  return parseIcs(text, today, addMonths(today, months))
}

export function calendarDateKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function calendarToday(now = new Date()): string {
  return calendarDateKey(now)
}

export function presentCalendarSummary(
  event: CalendarEvent,
  t: (key: MessageKey, vars?: Vars) => string,
): string {
  if (event.kind === 'vat' && event.period) return t('settings.calendarEventVat', { period: event.period })
  if (event.kind === 'cit-prepay' && event.period) {
    return t('settings.calendarEventCitPrepay', { period: event.period })
  }
  if (event.kind === 'cit-annual' && event.period) {
    return t('settings.calendarEventCitAnnual', { year: event.period })
  }
  return event.summary
}

export function normalizeCalendarUrl(input: string): string | null {
  let next = input.trim()
  if (/^webcals?:\/\//i.test(next)) next = next.replace(/^webcals?:/i, 'https:')
  try {
    const url = new URL(next)
    if (url.protocol !== 'https:') return null
    return url.href
  } catch {
    return null
  }
}

export function generateIcs(events: CalendarEvent[]): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//BeanDesk//compliance-calendar//EN',
    'CALSCALE:GREGORIAN',
  ]
  const sorted = [...events].sort(
    (left, right) => left.date.localeCompare(right.date) || left.uid.localeCompare(right.uid),
  )
  for (const event of sorted) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${event.uid}`,
      'DTSTAMP:20260101T000000Z',
      `DTSTART;VALUE=DATE:${compactDate(event.date)}`,
      `SUMMARY:${escapeIcs(event.summary)}`,
      'END:VEVENT',
    )
  }
  lines.push('END:VCALENDAR', '')
  return lines.join('\r\n')
}

export function parseIcs(text: string, windowStart: string, windowEnd: string): CalendarEvent[] {
  const events: CalendarEvent[] = []
  let current: Record<string, { params: Record<string, string>; value: string }> | null = null
  for (const line of unfoldIcs(text)) {
    if (line === 'BEGIN:VEVENT') {
      current = {}
      continue
    }
    if (line === 'END:VEVENT') {
      if (current) events.push(...expandEvent(current, windowStart, windowEnd))
      current = null
      continue
    }
    if (!current) continue
    const parsed = parseIcsLine(line)
    if (parsed) current[parsed.name] = { params: parsed.params, value: parsed.value }
  }
  return events.sort(
    (left, right) => left.date.localeCompare(right.date) || left.uid.localeCompare(right.uid),
  )
}

function catalogDueInRange(start: string, end: string): CalendarEvent[] {
  const firstYear = Number(start.slice(0, 4)) - 1
  const lastYear = Number(end.slice(0, 4))
  const events: CalendarEvent[] = []
  for (let year = firstYear; year <= lastYear; year += 1) {
    for (const quarter of [1, 2, 3, 4] as const) {
      const date = quarterDue(year, quarter)
      const period = `${year} Q${quarter}`
      events.push(
        catalogEvent('vat', date, period, `beandesk-cn-small-vat-${year}Q${quarter}@beandesk`, `VAT and surcharges · ${period}`),
        catalogEvent(
          'cit-prepay',
          date,
          period,
          `beandesk-cn-small-cit-prepay-${year}Q${quarter}@beandesk`,
          `CIT prepayment · ${period}`,
        ),
      )
    }
    events.push(
      catalogEvent(
        'cit-annual',
        `${year}-05-31`,
        String(year),
        `beandesk-cn-small-cit-annual-${year}@beandesk`,
        `CIT annual settlement · ${year}`,
      ),
    )
  }
  return events
    .filter((event) => event.date >= start && event.date <= end)
    .sort((left, right) => left.date.localeCompare(right.date) || left.uid.localeCompare(right.uid))
}

function catalogEvent(
  kind: CalendarKind,
  date: string,
  period: string,
  uid: string,
  summary: string,
): CalendarEvent {
  return { uid, date, summary, kind, period }
}

function quarterDue(year: number, quarter: 1 | 2 | 3 | 4): string {
  if (quarter === 1) return `${year}-04-15`
  if (quarter === 2) return `${year}-07-15`
  if (quarter === 3) return `${year}-10-15`
  return `${year + 1}-01-15`
}

function expandEvent(
  props: Record<string, { params: Record<string, string>; value: string }>,
  windowStart: string,
  windowEnd: string,
): CalendarEvent[] {
  const start = props.DTSTART ? icsDateValue(props.DTSTART.value) : null
  if (!start) return []
  const uid = props.UID?.value.trim() || `${start}-${props.SUMMARY?.value ?? 'event'}`
  const summary = unescapeIcs(props.SUMMARY?.value ?? '').trim() || uid
  const dates = props.RRULE
    ? expandRrule(start, props.RRULE.value, windowStart, windowEnd)
    : start >= windowStart && start <= windowEnd
      ? [start]
      : []
  return dates.map((date) => ({ uid, date, summary }))
}

function expandRrule(start: string, rule: string, windowStart: string, windowEnd: string): string[] {
  const parts = Object.fromEntries(
    rule
      .split(';')
      .map((item) => item.split('='))
      .filter((item): item is [string, string] => item.length === 2),
  )
  const freq = parts.FREQ
  const interval = Math.max(1, Number(parts.INTERVAL) || 1)
  const count = parts.COUNT ? Number(parts.COUNT) : null
  const until = parts.UNTIL ? icsDateValue(parts.UNTIL) : null
  const bydays = (parts.BYDAY ?? '')
    .split(',')
    .map((item) => WEEKDAY[item.slice(-2)])
    .filter((item): item is number => item !== undefined)
  if (freq !== 'YEARLY' && freq !== 'MONTHLY' && freq !== 'WEEKLY') {
    return start >= windowStart && start <= windowEnd ? [start] : []
  }
  const dates: string[] = []
  let seen = 0
  const take = (date: string): boolean => {
    if (until && date > until) return true
    seen += 1
    if (date >= windowStart && date <= windowEnd) dates.push(date)
    return count !== null && seen >= count
  }
  if (freq === 'YEARLY') {
    const parsed = parseDate(start)
    if (!parsed) return []
    for (let year = parsed.y, step = 0; step < 200; year += interval, step += 1) {
      const date = `${year}-${pad(parsed.m)}-${pad(parsed.d)}`
      if (!parseDate(date)) continue
      if (until && date > until) break
      if (take(date)) break
      if (date > windowEnd && count === null) break
    }
    return dates
  }
  if (freq === 'MONTHLY') {
    const parsed = parseDate(start)
    if (!parsed) return []
    let year = parsed.y
    let month = parsed.m
    for (let step = 0; step < 400; step += 1) {
      if (parsed.d <= daysInMonth(year, month)) {
        const date = `${year}-${pad(month)}-${pad(parsed.d)}`
        if (until && date > until) break
        if (take(date)) break
        if (date > windowEnd && count === null) break
      }
      month += interval
      while (month > 12) {
        year += 1
        month -= 12
      }
    }
    return dates
  }
  const days = bydays.length > 0 ? bydays : [weekday(start)]
  for (let week = 0; week < 800; week += interval) {
    let pastWindow = false
    for (let offset = 0; offset < 7; offset += 1) {
      const date = addDays(start, week * 7 + offset)
      if (date < start || !days.includes(weekday(date))) continue
      if (until && date > until) return dates
      if (take(date)) return dates
      if (date > windowEnd) pastWindow = true
    }
    if (pastWindow && count === null) break
  }
  return dates
}

function unfoldIcs(text: string): string[] {
  const lines: string[] = []
  for (const line of text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')) {
    if ((line.startsWith(' ') || line.startsWith('\t')) && lines.length > 0) {
      lines[lines.length - 1] += line.slice(1)
    } else if (line) {
      lines.push(line)
    }
  }
  return lines
}

function parseIcsLine(line: string): { name: string; params: Record<string, string>; value: string } | null {
  const split = line.indexOf(':')
  if (split < 0) return null
  const [head, ...rest] = [line.slice(0, split), line.slice(split + 1)]
  const [name, ...paramParts] = head.split(';')
  const params: Record<string, string> = {}
  for (const part of paramParts) {
    const eq = part.indexOf('=')
    if (eq > 0) params[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1)
  }
  return { name: name.toUpperCase(), params, value: rest.join(':') }
}

function icsDateValue(value: string): string | null {
  const digits = value.replace(/[^0-9]/g, '')
  if (digits.length < 8) return null
  const year = digits.slice(0, 4)
  const month = digits.slice(4, 6)
  const day = digits.slice(6, 8)
  const date = `${year}-${month}-${day}`
  return parseDate(date) ? date : null
}

function parseDate(value: string): { y: number; m: number; d: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return null
  const y = Number(match[1])
  const m = Number(match[2])
  const d = Number(match[3])
  if (m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m)) return null
  return { y, m, d }
}

function compactDate(value: string): string {
  return value.replace(/-/g, '')
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

function weekday(date: string): number {
  const parsed = parseDate(date)
  if (!parsed) return 0
  return new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d)).getUTCDay()
}

function addDays(date: string, days: number): string {
  const parsed = parseDate(date)
  if (!parsed) return date
  const next = new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d + days))
  return `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`
}

function addMonths(date: string, months: number): string {
  const parsed = parseDate(date)
  if (!parsed) return date
  const total = parsed.y * 12 + (parsed.m - 1) + months
  const year = Math.floor(total / 12)
  const month = (total % 12) + 1
  return `${year}-${pad(month)}-${pad(Math.min(parsed.d, daysInMonth(year, month)))}`
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

function escapeIcs(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n')
}

function unescapeIcs(value: string): string {
  return value.replace(/\\n/gi, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\')
}

const WEEKDAY: Record<string, number> = {
  SU: 0,
  MO: 1,
  TU: 2,
  WE: 3,
  TH: 4,
  FR: 5,
  SA: 6,
}
