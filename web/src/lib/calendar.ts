import { invoke } from '@tauri-apps/api/core'

import type { Vars } from '@/i18n/catalog'
import type { MessageKey } from '@/i18n/locales/en'
import {
  bundledCatalogEvents,
  calendarToday,
  emptyCalendarFile,
  eventsFromIcs,
  generateIcs,
  normalizeCalendarUrl,
  noticesDue,
  presentCalendarSummary,
  readCalendarFile,
  rememberNotices,
  upcomingEvents,
  type CalendarEvent,
  type CalendarFile,
} from '@/lib/compliance-calendar'

const STORE_FILE = 'calendar.json'
const STORE_KEY = 'calendar'

export async function loadCalendar(): Promise<CalendarFile> {
  const { load } = await import('@tauri-apps/plugin-store')
  const store = await load(STORE_FILE, { autoSave: false })
  return readCalendarFile(await store.get<unknown>(STORE_KEY)) ?? emptyCalendarFile()
}

export async function saveCalendar(file: CalendarFile): Promise<void> {
  const { load } = await import('@tauri-apps/plugin-store')
  const store = await load(STORE_FILE, { autoSave: false })
  await store.set(STORE_KEY, file)
  await store.save()
}

export async function resolveCalendar(
  file: CalendarFile,
  today = calendarToday(),
): Promise<{ events: CalendarEvent[]; ics: string }> {
  if (file.active === 'bundled') {
    const catalog = bundledCatalogEvents(today)
    return { events: upcomingEvents(catalog, today), ics: generateIcs(catalog) }
  }
  const ics = await loadActiveIcs(file)
  return { events: eventsFromIcs(ics, today), ics }
}

export async function loadActiveEvents(
  file: CalendarFile,
  today = calendarToday(),
): Promise<CalendarEvent[]> {
  if (file.active === 'bundled') return upcomingEvents(bundledCatalogEvents(today), today)
  return eventsFromIcs(await loadActiveIcs(file), today)
}

async function loadActiveIcs(file: CalendarFile): Promise<string> {
  if (file.active === 'file') {
    if (!file.file.trim()) throw new Error('calendar-file')
    return invoke<string>('read_user_text_file', { path: file.file })
  }
  const href = normalizeCalendarUrl(file.url)
  if (!href) throw new Error('calendar-url')
  const { fetch: pluginFetch } = await import('@tauri-apps/plugin-http')
  const response = await pluginFetch(href)
  if (!response.ok) throw new Error('calendar-http')
  return response.text()
}

export function explainCalendarError(
  error: unknown,
  t: (key: MessageKey, vars?: Vars) => string,
): string {
  const code = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  if (code === 'calendar-file') return t('settings.calendarMissingFile')
  if (code === 'file' || code === 'path' || code === 'too-large') return t('settings.calendarErrorFile')
  if (code === 'calendar-url') return t('settings.calendarInvalidUrl')
  if (code === 'calendar-http') return t('settings.calendarErrorUrl')
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
  const file = await loadCalendar()
  const today = options.today ?? calendarToday()
  const due = noticesDue(await loadActiveEvents(file, today), today, file.seenUids)
  if (due.length === 0) return
  for (const event of due) {
    const title = options.t('settings.calendarNoticeTitle')
    const body = options.t('settings.calendarNoticeBody', {
      summary: presentCalendarSummary(event, options.t),
      date: event.date,
    })
    options.toast(title, { description: body })
    await sendBanner(title, body)
  }
  await saveCalendar({ ...file, seenUids: rememberNotices(file.seenUids, due) })
}

async function sendBanner(title: string, body: string): Promise<void> {
  const notification = await import('@tauri-apps/plugin-notification')
  let granted = await notification.isPermissionGranted()
  if (!granted) granted = (await notification.requestPermission()) === 'granted'
  if (!granted) return
  notification.sendNotification({ title, body })
}
