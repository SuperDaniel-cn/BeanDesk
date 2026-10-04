import { useEffect, useRef, useState } from 'react'

import { CalendarDays, Copy, Download, FolderOpen } from 'lucide-react'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Empty, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { Spinner } from '@/components/ui/spinner'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useI18n } from '@/i18n'
import { explainCalendarError, loadCalendar, resolveCalendar, saveCalendar } from '@/lib/calendar'
import {
  PUBLIC_FEED_URL,
  emptyCalendarFile,
  presentCalendarSummary,
  withCalendarSource,
  type CalendarEvent,
  type CalendarFile,
  type CalendarSource,
} from '@/lib/compliance-calendar'

export function CalendarSettingsPanel() {
  const { t } = useI18n()
  const [file, setFile] = useState(emptyCalendarFile)
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [ics, setIcs] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(true)
  const [copied, setCopied] = useState(false)
  const token = useRef(0)
  const fileRef = useRef(file)

  async function refresh(next: CalendarFile) {
    const id = ++token.current
    setBusy(true)
    setError('')
    try {
      const resolved = await resolveCalendar(next)
      if (id !== token.current) return
      setIcs(resolved.ics)
      setEvents(resolved.events)
    } catch (caught) {
      if (id !== token.current) return
      setIcs('')
      setEvents([])
      setError(explainCalendarError(caught, t))
    } finally {
      if (id === token.current) setBusy(false)
    }
  }

  async function persist(next: CalendarFile) {
    if (sameCalendar(fileRef.current, next) && events.length + ics.length > 0 && !error) return
    fileRef.current = next
    setFile(next)
    await saveCalendar(next)
    await refresh(next)
  }

  useEffect(() => {
    void loadCalendar()
      .then((next) => {
        fileRef.current = next
        setFile(next)
        return refresh(next)
      })
      .catch((caught: unknown) => {
        setBusy(false)
        setError(explainCalendarError(caught, t))
      })
  }, [])

  useEffect(() => {
    if (!copied) return
    const id = window.setTimeout(() => setCopied(false), 2000)
    return () => window.clearTimeout(id)
  }, [copied])

  async function selectSource(active: CalendarSource) {
    if (active === file.active) return
    await persist(withCalendarSource(active, {}, fileRef.current))
  }

  async function browseIcs() {
    const { open } = await import('@tauri-apps/plugin-dialog')
    const picked = await open({
      multiple: false,
      filters: [{ name: 'ICS', extensions: ['ics', 'ical'] }],
      title: t('settings.calendarBrowseIcs'),
      defaultPath: file.file || undefined,
    })
    if (typeof picked !== 'string') return
    await persist(withCalendarSource('file', { file: picked }, fileRef.current))
  }

  async function fillPublicFeed() {
    await persist(withCalendarSource('url', { url: PUBLIC_FEED_URL }, fileRef.current))
  }

  async function copyIcs() {
    if (!ics) return
    await navigator.clipboard.writeText(ics)
    setCopied(true)
  }

  function downloadIcs() {
    if (!ics) return
    const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' })
    const href = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = href
    link.download = 'calendar.ics'
    link.click()
    URL.revokeObjectURL(href)
  }

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <span className="text-xs text-muted-foreground">{t('settings.calendarSource')}</span>
        <Tabs
          value={file.active}
          onValueChange={(value) => {
            void selectSource(value as CalendarSource)
          }}
        >
          <TabsList>
            <TabsTrigger value="bundled">{t('settings.calendarBundled')}</TabsTrigger>
            <TabsTrigger value="file">{t('settings.calendarFile')}</TabsTrigger>
            <TabsTrigger value="url">{t('settings.calendarUrl')}</TabsTrigger>
          </TabsList>
        </Tabs>
        <p className="text-xs text-muted-foreground">
          {file.active === 'bundled'
            ? t('settings.calendarBundledHint')
            : file.active === 'file'
              ? t('settings.calendarFileHint')
              : t('settings.calendarUrlHint')}
        </p>
      </div>

      {file.active === 'file' ? (
        <label className="flex w-full flex-col items-start gap-1.5">
          <span className="text-xs text-muted-foreground">{t('settings.calendarFile')}</span>
          <span className="flex w-full flex-wrap gap-2">
            <Input value={file.file} readOnly className="min-w-0 flex-1 font-mono" />
            <Button type="button" variant="outline" onClick={() => void browseIcs()} disabled={busy} className="shrink-0">
              <FolderOpen data-icon="inline-start" />
              {t('settings.calendarBrowseIcs')}
            </Button>
          </span>
        </label>
      ) : null}

      {file.active === 'url' ? (
        <label className="flex w-full flex-col items-start gap-1.5">
          <span className="text-xs text-muted-foreground">{t('settings.calendarUrl')}</span>
          <span className="flex w-full flex-wrap gap-2">
            <Input
              value={file.url}
              onChange={(event) => {
                const next = { ...fileRef.current, url: event.target.value }
                fileRef.current = next
                setFile(next)
              }}
              onBlur={() => {
                void persist(withCalendarSource('url', { url: fileRef.current.url }, fileRef.current))
              }}
              placeholder={t('settings.calendarUrlPlaceholder')}
              spellCheck={false}
              inputMode="url"
              className="min-w-0 flex-1 font-mono"
            />
            <Button type="button" variant="outline" onClick={() => void fillPublicFeed()} disabled={busy} className="shrink-0">
              {t('settings.calendarUsePublic')}
            </Button>
          </span>
        </label>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={() => void copyIcs()} disabled={busy || !ics}>
          <Copy data-icon="inline-start" />
          {copied ? t('settings.copied') : t('settings.calendarCopy')}
        </Button>
        <Button type="button" variant="outline" onClick={downloadIcs} disabled={busy || !ics}>
          <Download data-icon="inline-start" />
          {t('settings.calendarDownload')}
        </Button>
      </div>

      <Separator />

      <div className="flex w-full flex-col items-start gap-1.5">
        <span className="text-xs text-muted-foreground">{t('settings.calendarUpcoming')}</span>
        {error ? (
          <Alert>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <div className="w-full overflow-hidden rounded-lg border bg-card">
          {busy ? (
            <div className="flex items-center gap-2 p-3 text-xs text-muted-foreground">
              <Spinner />
            </div>
          ) : events.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <CalendarDays />
                <EmptyTitle>{t('settings.calendarEmpty')}</EmptyTitle>
              </EmptyHeader>
            </Empty>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('settings.calendarDate')}</TableHead>
                  <TableHead>{t('settings.calendarSummary')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {events.map((event) => (
                  <TableRow key={`${event.uid}:${event.date}`}>
                    <TableCell className="font-mono">{event.date}</TableCell>
                    <TableCell className="whitespace-normal">{presentCalendarSummary(event, t)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </div>
    </section>
  )
}

function sameCalendar(left: CalendarFile, right: CalendarFile): boolean {
  return left.active === right.active && left.file === right.file && left.url === right.url
}
