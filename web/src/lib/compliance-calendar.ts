export type CalendarEvent = {
  uid: string
  date: string
  summary: string
}

export type CalendarSource = 'file' | 'url'

export type CalendarFile = {
  active: CalendarSource
  file: string
  url: string
  seenUids: string[]
}

/** The local copy of the active source: its text plus the validators the server gave us. */
export type CalendarCopy = Pick<CalendarFile, 'active' | 'file' | 'url'> & {
  ics: string
  etag: string
  lastModified: string
  syncedAt: string
}

export const UPCOMING_MONTHS = 12
export const NOTICE_DAYS = 7
export const DEFAULT_REFRESH_MS = 24 * 60 * 60 * 1000
export const MIN_REFRESH_MS = 60 * 60 * 1000

export function emptyCalendarFile(): CalendarFile {
  return { active: 'file', file: '', url: '', seenUids: [] }
}

export function readCalendarCopy(value: unknown): CalendarCopy | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  if (record.active !== 'file' && record.active !== 'url') return null
  if (typeof record.ics !== 'string' || !record.ics) return null
  const text = (key: string) => (typeof record[key] === 'string' ? (record[key] as string) : '')
  return {
    active: record.active,
    file: text('file'),
    url: text('url'),
    ics: record.ics,
    etag: text('etag'),
    lastModified: text('lastModified'),
    syncedAt: text('syncedAt'),
  }
}

export function isIcs(text: string): boolean {
  return text.includes('BEGIN:VCALENDAR')
}

/** A local file is read again on every open. A subscription waits out its interval. */
export function copyStale(copy: CalendarCopy, now: number): boolean {
  if (copy.active === 'file') return true
  const synced = Date.parse(copy.syncedAt)
  if (!Number.isFinite(synced)) return true
  return now - synced >= refreshIntervalMs(copy.ics)
}

/** RFC 7986 REFRESH-INTERVAL or the older X-PUBLISHED-TTL, clamped to at least an hour. */
export function refreshIntervalMs(ics: string): number {
  const firstEvent = ics.indexOf('BEGIN:VEVENT')
  for (const line of unfoldIcs(firstEvent < 0 ? ics : ics.slice(0, firstEvent))) {
    const parsed = parseIcsLine(line)
    if (!parsed || (parsed.name !== 'REFRESH-INTERVAL' && parsed.name !== 'X-PUBLISHED-TTL')) continue
    const ms = durationMs(parsed.value)
    if (ms !== null) return Math.max(ms, MIN_REFRESH_MS)
  }
  return DEFAULT_REFRESH_MS
}

function durationMs(value: string): number | null {
  const match = /^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i.exec(value.trim())
  if (!match) return null
  const [, weeks, days, hours, minutes, seconds] = match
  const total =
    (Number(weeks ?? 0) * 7 + Number(days ?? 0)) * 86_400 +
    Number(hours ?? 0) * 3_600 +
    Number(minutes ?? 0) * 60 +
    Number(seconds ?? 0)
  return total > 0 ? total * 1000 : null
}

export function readCalendarFile(value: unknown): CalendarFile | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  if (record.active !== 'file' && record.active !== 'url') return null
  const seen = Array.isArray(record.seenUids)
    ? record.seenUids.filter((item): item is string => typeof item === 'string')
    : []
  return {
    active: record.active,
    file: typeof record.file === 'string' ? record.file : '',
    url: persistCalendarUrl(typeof record.url === 'string' ? record.url : ''),
    seenUids: seen,
  }
}

export function withCalendarSource(
  active: CalendarSource,
  next: Partial<Pick<CalendarFile, 'file' | 'url'>>,
  previous: CalendarFile,
): CalendarFile {
  return {
    active,
    file: next.file ?? previous.file,
    url: next.url !== undefined ? persistCalendarUrl(next.url) : previous.url,
    seenUids: previous.seenUids,
  }
}

export function sameCalendarSource(
  left: CalendarFile | CalendarCopy,
  right: CalendarFile | CalendarCopy,
): boolean {
  return left.active === right.active && left.file === right.file && left.url === right.url
}

export function sourceReady(file: CalendarFile): boolean {
  if (file.active === 'file') return file.file.trim().length > 0
  return normalizeCalendarUrl(file.url) !== null
}

export function noticeKey(event: CalendarEvent): string {
  return `${event.uid}:${event.date}`
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

function persistCalendarUrl(input: string): string {
  return normalizeCalendarUrl(input) ?? input.trim()
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
