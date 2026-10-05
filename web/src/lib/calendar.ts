import { invoke, isTauri } from '@tauri-apps/api/core'

import type { Vars } from '@/i18n/catalog'
import type { MessageKey } from '@/i18n/locales/en'
import {
  bundledCatalogEvents,
  calendarToday,
  catalogWindow,
  emptyCalendarFile,
  generateIcs,
  normalizeCalendarUrl,
  noticesDue,
  parseIcs,
  presentCalendarSummary,
  readCalendarFile,
  rememberNotices,
  type CalendarEvent,
  type CalendarFile,
} from '@/lib/compliance-calendar'

const STORE_FILE = 'calendar.json'
const STORE_KEY = 'calendar'

export async function loadCalendar(): Promise<CalendarFile> {
  if (!isTauri()) return emptyCalendarFile()
  const { load } = await import('@tauri-apps/plugin-store')
  const store = await load(STORE_FILE, { autoSave: false })
  return readCalendarFile(await store.get<unknown>(STORE_KEY)) ?? emptyCalendarFile()
}

export async function saveCalendar(file: CalendarFile): Promise<void> {
  if (!isTauri()) return
  const { load } = await import('@tauri-apps/plugin-store')
  const store = await load(STORE_FILE, { autoSave: false })
  await store.set(STORE_KEY, file)
  await store.save()
}

export async function resolveCalendar(
  file: CalendarFile,
  today = calendarToday(),
): Promise<{ catalog: CalendarEvent[]; ics: string }> {
  if (file.active === 'bundled' || !isTauri()) {
    const catalog = bundledCatalogEvents(today)
    return { catalog, ics: generateIcs(catalog) }
  }
  const ics = await loadActiveIcs(file)
  const { start, end } = catalogWindow(today)
  return { catalog: parseIcs(ics, start, end), ics }
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
  if (code === 'calendar-file') return t('calendar.missingFile')
  if (code === 'file' || code === 'path' || code === 'too-large') return t('calendar.errorFile')
  if (code === 'calendar-url') return t('calendar.invalidUrl')
  if (code === 'calendar-http') return t('calendar.errorUrl')
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
  const { catalog } = await resolveCalendar(file, today)
  const due = noticesDue(catalog, today, file.seenUids)
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
