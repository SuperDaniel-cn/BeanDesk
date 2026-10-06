import { invoke, isTauri } from '@tauri-apps/api/core'

import type { Vars } from '@/i18n/catalog'
import type { MessageKey } from '@/i18n/locales/en'
import {
  calendarToday,
  catalogWindow,
  copyStale,
  emptyCalendarFile,
  isIcs,
  normalizeCalendarUrl,
  noticesDue,
  parseIcs,
  readCalendarCopy,
  readCalendarFile,
  rememberNotices,
  sameCalendarSource,
  sourceReady,
  type CalendarCopy,
  type CalendarEvent,
  type CalendarFile,
} from '@/lib/compliance-calendar'

const STORE_FILE = 'calendar.json'
const STORE_KEY = 'calendar'
const COPY_FILE = 'calendar-copy.json'
const COPY_KEY = 'copy'
const CONNECT_TIMEOUT_MS = 10_000
const FETCH_TIMEOUT_MS = 60_000

/**
 * What the page and the startup notices both work from: the saved source, the
 * local copy of it (if any), the events parsed from that copy, and the code of
 * the last refresh that failed while the copy stayed on screen.
 */
export type CalendarFeed = {
  file: CalendarFile
  copy: CalendarCopy | null
  catalog: CalendarEvent[]
  error: string
}

export function emptyCalendarFeed(file = emptyCalendarFile()): CalendarFeed {
  return { file, copy: null, catalog: [], error: '' }
}

async function openStore(file: string) {
  const { load } = await import('@tauri-apps/plugin-store')
  return load(file, { autoSave: false })
}

export async function loadCalendar(): Promise<CalendarFile> {
  if (!isTauri()) return emptyCalendarFile()
  const store = await openStore(STORE_FILE)
  return readCalendarFile(await store.get<unknown>(STORE_KEY)) ?? emptyCalendarFile()
}

export async function saveCalendar(file: CalendarFile): Promise<void> {
  if (!isTauri()) return
  const store = await openStore(STORE_FILE)
  await store.set(STORE_KEY, file)
  await store.save()
}

/**
 * Save a new source. The notice history is taken from the stored record, not
 * the caller's copy of it: startup notices may have added to it since the page
 * loaded.
 */
export async function saveCalendarSource(next: CalendarFile): Promise<CalendarFile> {
  const latest = await loadCalendar()
  const file = { ...next, seenUids: latest.seenUids }
  await saveCalendar(file)
  return file
}

/** Drop the source and the copy made from it. Desktop only, like the button that calls it. */
export async function clearCalendar(): Promise<CalendarFile> {
  const next = emptyCalendarFile()
  await saveCalendar(next)
  const store = await openStore(COPY_FILE)
  await store.delete(COPY_KEY)
  await store.save()
  return next
}

/** The saved source and its local copy. No network, no disk read of the source. */
export async function loadCalendarFeed(today = calendarToday()): Promise<CalendarFeed> {
  const file = await loadCalendar()
  if (!sourceReady(file)) return emptyCalendarFeed(file)
  const copy = await loadCopy()
  if (!copy || !sameCalendarSource(copy, file)) return emptyCalendarFeed(file)
  return { file, copy, catalog: catalogOf(copy.ics, today), error: '' }
}

/** The source should be read again: on the desktop, with a usable source, and no fresh copy. */
export function shouldRefresh(feed: CalendarFeed, now = Date.now()): boolean {
  return isTauri() && sourceReady(feed.file) && (!feed.copy || copyStale(feed.copy, now))
}

let inflight: { file: CalendarFile; promise: Promise<CalendarFeed> } | null = null

/**
 * Read the source again. A subscription sends the validators from the copy so
 * an unchanged feed costs a 304. When the read fails and there is a copy, the
 * copy stays and the failure is reported on the feed; without a copy it throws.
 * Concurrent calls for the same source share one request.
 */
export function refreshCalendarFeed(feed: CalendarFeed, today = calendarToday()): Promise<CalendarFeed> {
  if (inflight && sameCalendarSource(inflight.file, feed.file)) return inflight.promise
  const promise = fetchFeed(feed, today).finally(() => {
    if (inflight?.promise === promise) inflight = null
  })
  inflight = { file: feed.file, promise }
  return promise
}

/** The copy first; the source only when the copy is missing or has aged out. */
export async function openCalendarFeed(today = calendarToday()): Promise<CalendarFeed> {
  const feed = await loadCalendarFeed(today)
  return shouldRefresh(feed) ? refreshCalendarFeed(feed, today) : feed
}

async function fetchFeed(feed: CalendarFeed, today: string): Promise<CalendarFeed> {
  try {
    const copy = await fetchIcs(feed.file, feed.copy)
    await saveCopy(copy)
    const catalog = feed.copy?.ics === copy.ics ? feed.catalog : catalogOf(copy.ics, today)
    return { file: feed.file, copy, catalog, error: '' }
  } catch (caught) {
    if (!feed.copy) throw caught
    return { ...feed, error: errorCode(caught) }
  }
}

/** Read the source into a copy stamped with the time of this read. A 304 keeps the old text. */
async function fetchIcs(file: CalendarFile, copy: CalendarCopy | null): Promise<CalendarCopy> {
  const syncedAt = new Date().toISOString()
  const stamp = (ics: string, etag = '', lastModified = ''): CalendarCopy => {
    if (!isIcs(ics)) throw new Error('calendar-not-ics')
    return { active: file.active, file: file.file, url: file.url, ics, etag, lastModified, syncedAt }
  }
  if (file.active === 'file') {
    if (!file.file.trim()) throw new Error('calendar-file')
    return stamp(await invoke<string>('read_user_text_file', { path: file.file }))
  }
  const href = normalizeCalendarUrl(file.url)
  if (!href) throw new Error('calendar-url')
  const headers: Record<string, string> = { Accept: 'text/calendar, */*;q=0.1' }
  if (copy?.etag) headers['If-None-Match'] = copy.etag
  if (copy?.lastModified) headers['If-Modified-Since'] = copy.lastModified
  const { fetch: pluginFetch } = await import('@tauri-apps/plugin-http')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const response = await pluginFetch(href, {
      headers,
      signal: controller.signal,
      connectTimeout: CONNECT_TIMEOUT_MS,
    })
    if (response.status === 304 && copy) return { ...copy, syncedAt }
    if (!response.ok) throw new Error('calendar-http')
    return stamp(
      await response.text(),
      response.headers.get('etag') ?? '',
      response.headers.get('last-modified') ?? '',
    )
  } catch (caught) {
    if (controller.signal.aborted) throw new Error('calendar-timeout')
    if (caught instanceof Error && caught.message.startsWith('calendar-')) throw caught
    throw new Error('calendar-http')
  } finally {
    clearTimeout(timer)
  }
}

async function loadCopy(): Promise<CalendarCopy | null> {
  const store = await openStore(COPY_FILE)
  return readCalendarCopy(await store.get<unknown>(COPY_KEY))
}

async function saveCopy(copy: CalendarCopy): Promise<void> {
  const store = await openStore(COPY_FILE)
  await store.set(COPY_KEY, copy)
  await store.save()
}

function catalogOf(ics: string, today: string): CalendarEvent[] {
  const { start, end } = catalogWindow(today)
  return parseIcs(ics, start, end)
}

function errorCode(error: unknown): string {
  return error instanceof Error ? error.message : typeof error === 'string' ? error : ''
}

export function explainCalendarError(
  error: unknown,
  t: (key: MessageKey, vars?: Vars) => string,
): string {
  const code = errorCode(error)
  if (code === 'calendar-file') return t('calendar.missingFile')
  if (code === 'file' || code === 'path' || code === 'too-large') return t('calendar.errorFile')
  if (code === 'calendar-url') return t('calendar.invalidUrl')
  if (code === 'calendar-http') return t('calendar.errorUrl')
  if (code === 'calendar-not-ics') return t('calendar.notIcs')
  if (code === 'calendar-timeout') return t('calendar.timeout')
  return code || t('common.errorFallback')
}

let bootNotices: Promise<void> | null = null

export function bootCalendarNotices(options: {
  today?: string
  t: (key: MessageKey, vars?: Vars) => string
  toast: (title: string, extras?: { description: string }) => void
}): Promise<void> {
  bootNotices ??= notifyDueCalendars(options)
  return bootNotices
}

export async function notifyDueCalendars(options: {
  today?: string
  t: (key: MessageKey, vars?: Vars) => string
  toast: (title: string, extras?: { description: string }) => void
}): Promise<void> {
  const today = options.today ?? calendarToday()
  const feed = await openCalendarFeed(today)
  const due = noticesDue(feed.catalog, today, feed.file.seenUids)
  if (due.length === 0) return
  for (const event of due) {
    const title = options.t('settings.calendarNoticeTitle')
    const body = options.t('settings.calendarNoticeBody', {
      summary: event.summary,
      date: event.date,
    })
    options.toast(title, { description: body })
    await sendBanner(title, body)
  }
  const latest = await loadCalendar()
  await saveCalendar({ ...latest, seenUids: rememberNotices(latest.seenUids, due) })
}

async function sendBanner(title: string, body: string): Promise<void> {
  const notification = await import('@tauri-apps/plugin-notification')
  let granted = await notification.isPermissionGranted()
  if (!granted) granted = (await notification.requestPermission()) === 'granted'
  if (!granted) return
  notification.sendNotification({ title, body })
}
