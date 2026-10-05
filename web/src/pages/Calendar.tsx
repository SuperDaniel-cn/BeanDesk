import { useEffect, useMemo, useRef, useState } from 'react'
import { isTauri } from '@tauri-apps/api/core'
import { CalendarDays, Copy, Download, FolderOpen } from 'lucide-react'
import { enUS, zhCN } from 'react-day-picker/locale'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Calendar as MonthCalendar, CalendarDayButton } from '@/components/ui/calendar'
import { Empty, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
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
  calendarDateKey,
  calendarSourceDetail,
  calendarToday,
  emptyCalendarFile,
  eventsInRange,
  monthGridRange,
  presentCalendarSummary,
  sourceReady,
  upcomingEvents,
  withCalendarSource,
  type CalendarEvent,
  type CalendarFile,
  type CalendarSource,
} from '@/lib/compliance-calendar'

export function Calendar() {
  const { t, locale } = useI18n()
  const desktop = isTauri()
  const [file, setFile] = useState(emptyCalendarFile)
  const [draft, setDraft] = useState(emptyCalendarFile)
  const [catalog, setCatalog] = useState<CalendarEvent[]>([])
  const [ics, setIcs] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(true)
  const [applying, setApplying] = useState(false)
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [month, setMonth] = useState(() => new Date())
  const [selected, setSelected] = useState<Date | undefined>()
  const token = useRef(0)
  const fileRef = useRef(file)

  async function apply(next: CalendarFile) {
    if (!sourceReady(next)) return
    if (sameCalendar(fileRef.current, next) && ics && !error) return
    const id = ++token.current
    setApplying(true)
    try {
      const resolved = await resolveCalendar(next)
      if (id !== token.current) return
      fileRef.current = next
      setFile(next)
      setDraft(next)
      setIcs(resolved.ics)
      setCatalog(resolved.catalog)
      setError('')
      await saveCalendar(next)
    } catch (caught) {
      if (id !== token.current) return
      setError(explainCalendarError(caught, t))
    } finally {
      if (id === token.current) setApplying(false)
    }
  }

  useEffect(() => {
    void loadCalendar()
      .then(async (next) => {
        fileRef.current = next
        setFile(next)
        setDraft(next)
        const id = ++token.current
        setBusy(true)
        try {
          const resolved = await resolveCalendar(next)
          if (id !== token.current) return
          setIcs(resolved.ics)
          setCatalog(resolved.catalog)
        } catch (caught) {
          if (id !== token.current) return
          setError(explainCalendarError(caught, t))
        } finally {
          if (id === token.current) setBusy(false)
        }
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

  const selectedKey = selected ? calendarDateKey(selected) : ''
  const upcoming = useMemo(() => upcomingEvents(catalog, calendarToday()), [catalog])
  const markedKeys = useMemo(() => {
    const grid = monthGridRange(calendarDateKey(month).slice(0, 7))
    return new Set(eventsInRange(catalog, grid.start, grid.end).map((event) => event.date))
  }, [catalog, month])
  const rows = selectedKey ? eventsInRange(catalog, selectedKey, selectedKey) : upcoming
  const sourceName = sourceCaption(file, t)

  function openSubscribe(next: boolean) {
    setOpen(next)
    if (next) setDraft(file)
    else if (ics) setError('')
  }

  function selectSource(active: CalendarSource) {
    if (!desktop) return
    const next = withCalendarSource(active, {}, draft)
    setDraft(next)
    void apply(next)
  }

  async function browseIcs() {
    const { open: pick } = await import('@tauri-apps/plugin-dialog')
    const picked = await pick({
      multiple: false,
      filters: [{ name: 'ICS', extensions: ['ics', 'ical'] }],
      title: t('calendar.browseIcs'),
      defaultPath: draft.file || undefined,
    })
    if (typeof picked !== 'string') return
    const next = withCalendarSource('file', { file: picked }, fileRef.current)
    setDraft(next)
    await apply(next)
  }

  async function fillPublicFeed() {
    const next = withCalendarSource('url', { url: PUBLIC_FEED_URL }, fileRef.current)
    setDraft(next)
    await apply(next)
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

  function goThisMonth() {
    const today = new Date()
    setMonth(today)
    setSelected(undefined)
  }

  const draftSource = desktop ? draft.active : 'bundled'
  const hint =
    draftSource === 'file'
      ? t('calendar.fileHint')
      : draftSource === 'url'
        ? t('calendar.urlHint')
        : t('calendar.bundledHint')

  return (
    <section className="flex flex-col gap-6">
      <div className="grid gap-x-6 gap-y-2 lg:grid-cols-[minmax(0,1fr)_auto] lg:grid-rows-[auto_1fr]">
        <div className="order-3 flex h-7 items-center lg:order-none lg:col-start-1 lg:row-start-1">
          <span className="text-xs text-muted-foreground">
            {selectedKey || t('calendar.upcoming')}
          </span>
        </div>
        <div className="order-1 flex h-7 flex-wrap items-center justify-end gap-2 lg:order-none lg:col-start-2 lg:row-start-1">
          <Button type="button" variant="outline" onClick={goThisMonth}>
            {t('calendar.thisMonth')}
          </Button>
          <Button type="button" variant="outline" onClick={() => openSubscribe(true)}>
            {t('calendar.subscribe')}
          </Button>
        </div>
        <div className="order-4 flex min-h-0 min-w-0 flex-col lg:order-none lg:col-start-1 lg:row-start-2">
          <div className="flex min-h-0 w-full flex-1 flex-col overflow-hidden rounded-lg border bg-card">
            {busy ? (
              <div className="flex flex-1 items-center gap-2 p-3 text-xs text-muted-foreground">
                <Spinner />
              </div>
            ) : rows.length === 0 ? (
              <Empty className="flex-1 border-0">
                <EmptyHeader>
                  <CalendarDays />
                  <EmptyTitle>{selectedKey ? t('calendar.emptyDay') : t('calendar.emptyUpcoming')}</EmptyTitle>
                </EmptyHeader>
              </Empty>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('calendar.date')}</TableHead>
                    <TableHead>{t('calendar.summary')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((event) => (
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
        <MonthCalendar
          mode="single"
          locale={locale === 'zh-CN' ? zhCN : enUS}
          month={month}
          onMonthChange={setMonth}
          selected={selected}
          onSelect={setSelected}
          captionLayout="dropdown"
          className="order-2 rounded-lg border [--cell-size:2.75rem] md:[--cell-size:3rem] lg:order-none lg:col-start-2 lg:row-start-2"
          components={{
            DayButton: (props) => (
              <CalendarDayButton {...props}>
                {props.children}
                {markedKeys.has(calendarDateKey(props.day.date)) ? (
                  <span className="size-1.5 rounded-full bg-current" />
                ) : null}
              </CalendarDayButton>
            ),
          }}
        />
      </div>

      <Sheet open={open} onOpenChange={openSubscribe}>
        <SheetContent className="sm:max-w-md">
          <SheetHeader>
            <SheetTitle>{t('calendar.subscribe')}</SheetTitle>
            <SheetDescription>{t('calendar.using', { source: sourceName })}</SheetDescription>
          </SheetHeader>
          <FieldGroup className="overflow-y-auto px-4">
            <Field>
              <FieldLabel>{t('calendar.source')}</FieldLabel>
              <Tabs
                value={draftSource}
                onValueChange={(value) => {
                  selectSource(value as CalendarSource)
                }}
              >
                <TabsList>
                  <TabsTrigger value="bundled">{t('calendar.bundled')}</TabsTrigger>
                  {desktop ? <TabsTrigger value="file">{t('calendar.file')}</TabsTrigger> : null}
                  {desktop ? <TabsTrigger value="url">{t('calendar.url')}</TabsTrigger> : null}
                </TabsList>
              </Tabs>
              <FieldDescription>{hint}</FieldDescription>
            </Field>

            {draftSource === 'file' ? (
              <Field>
                <FieldLabel htmlFor="calendar-file">{t('calendar.file')}</FieldLabel>
                <div className="flex w-full flex-wrap gap-2">
                  <Input
                    id="calendar-file"
                    value={draft.file}
                    readOnly
                    className="min-w-0 flex-1 font-mono"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void browseIcs()}
                    disabled={applying}
                    className="shrink-0"
                  >
                    <FolderOpen data-icon="inline-start" />
                    {t('calendar.browseIcs')}
                  </Button>
                </div>
              </Field>
            ) : null}

            {draftSource === 'url' ? (
              <Field data-invalid={error ? true : undefined}>
                <FieldLabel htmlFor="calendar-url">{t('calendar.url')}</FieldLabel>
                <div className="flex w-full flex-wrap gap-2">
                  <Input
                    id="calendar-url"
                    value={draft.url}
                    aria-invalid={error ? true : undefined}
                    onChange={(event) => {
                      setDraft({ ...draft, active: 'url', url: event.target.value })
                    }}
                    onBlur={(event) => {
                      const next = withCalendarSource('url', { url: event.currentTarget.value }, fileRef.current)
                      setDraft(next)
                      void apply(next)
                    }}
                    placeholder={t('calendar.urlPlaceholder')}
                    spellCheck={false}
                    inputMode="url"
                    className="min-w-0 flex-1 font-mono"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void fillPublicFeed()}
                    disabled={applying}
                    className="shrink-0"
                  >
                    {t('calendar.usePublic')}
                  </Button>
                </div>
              </Field>
            ) : null}

            {error ? (
              <Alert>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
          </FieldGroup>
          <SheetFooter>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={() => void copyIcs()} disabled={applying || !ics}>
                <Copy data-icon="inline-start" />
                {copied ? t('settings.copied') : t('calendar.copy')}
              </Button>
              <Button type="button" variant="outline" onClick={downloadIcs} disabled={applying || !ics}>
                <Download data-icon="inline-start" />
                {t('calendar.download')}
              </Button>
            </div>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </section>
  )
}

function sourceCaption(
  file: CalendarFile,
  t: (key: 'calendar.bundled' | 'calendar.file' | 'calendar.url') => string,
): string {
  if (file.active === 'bundled') return t('calendar.bundled')
  return calendarSourceDetail(file) || (file.active === 'file' ? t('calendar.file') : t('calendar.url'))
}

function sameCalendar(left: CalendarFile, right: CalendarFile): boolean {
  return left.active === right.active && left.file === right.file && left.url === right.url
}
