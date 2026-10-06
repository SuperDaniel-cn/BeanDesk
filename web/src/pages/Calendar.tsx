import { useEffect, useMemo, useRef, useState } from 'react'
import { isTauri } from '@tauri-apps/api/core'
import { CalendarDays, FolderOpen, RefreshCwIcon } from 'lucide-react'
import { enUS, zhCN } from 'react-day-picker/locale'
import { toast } from 'sonner'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Calendar as MonthCalendar, CalendarDayButton } from '@/components/ui/calendar'
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Spinner } from '@/components/ui/spinner'
import {
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useI18n } from '@/i18n'
import {
  clearCalendar,
  emptyCalendarFeed,
  explainCalendarError,
  loadCalendarFeed,
  refreshCalendarFeed,
  saveCalendarSource,
  shouldRefresh,
  type CalendarFeed,
} from '@/lib/calendar'
import {
  calendarDateKey,
  calendarToday,
  emptyCalendarFile,
  eventsInRange,
  noticeKey,
  sameCalendarSource,
  sourceReady,
  upcomingEvents,
  withCalendarSource,
  type CalendarSource,
} from '@/lib/compliance-calendar'
import { cn } from '@/lib/utils'

type Pending = '' | 'refresh' | 'apply'

export function Calendar() {
  const { t, locale, formatDateTime } = useI18n()
  const desktop = isTauri()
  const [feed, setFeed] = useState<CalendarFeed>(emptyCalendarFeed)
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [pending, setPending] = useState<Pending>('')
  const [draft, setDraft] = useState(emptyCalendarFile)
  const [draftError, setDraftError] = useState('')
  const [open, setOpen] = useState(false)
  const [month, setMonth] = useState(() => new Date())
  const [selected, setSelected] = useState<Date | undefined>()
  const token = useRef(0)

  function applyFeed(next: CalendarFeed) {
    setFeed(next)
    setLoaded(true)
  }

  useEffect(() => {
    const id = ++token.current
    void (async () => {
      try {
        const local = await loadCalendarFeed()
        if (id !== token.current) return
        applyFeed(local)
        if (!shouldRefresh(local)) return
        setPending('refresh')
        const fresh = await refreshCalendarFeed(local)
        if (id !== token.current) return
        applyFeed(fresh)
      } catch (caught) {
        if (id !== token.current) return
        setLoaded(true)
        setLoadError(explainCalendarError(caught, t))
      } finally {
        if (id === token.current) setPending('')
      }
    })()
  }, [])

  const { catalog } = feed
  const selectedKey = selected ? calendarDateKey(selected) : ''
  const upcoming = useMemo(() => upcomingEvents(catalog, calendarToday()), [catalog])
  const markedKeys = useMemo(() => new Set(catalog.map((event) => event.date)), [catalog])
  const rows = selectedKey ? eventsInRange(catalog, selectedKey, selectedKey) : upcoming
  const applying = pending === 'apply'
  const refreshing = pending === 'refresh'
  // A load failure only ever happens without a copy; with a copy the copy stays and the failure rides on feed.error.
  const busy = !loadError && (!loaded || (refreshing && !feed.copy))
  const canRefresh = desktop && loaded && pending === '' && sourceReady(feed.file)
  const canClear = sourceReady(feed.file) || draft.file.trim().length > 0 || draft.url.trim().length > 0
  const draftIsSaved = sameCalendarSource(draft, feed.file) && sourceReady(feed.file)

  function closeDraft() {
    if (applying) {
      token.current += 1
      setPending('')
    }
    setOpen(false)
  }

  function openSubscribe(next: boolean) {
    if (!next) {
      closeDraft()
      return
    }
    setDraft(feed.file)
    setDraftError('')
    setOpen(true)
  }

  async function refreshNow() {
    const id = ++token.current
    setPending('refresh')
    setLoadError('')
    try {
      const fresh = await refreshCalendarFeed(feed)
      if (id !== token.current) return
      applyFeed(fresh)
      if (fresh.error) {
        toast.error(t('calendar.refreshFailed', { reason: explainCalendarError(fresh.error, t) }))
      }
    } catch (caught) {
      if (id !== token.current) return
      setLoadError(explainCalendarError(caught, t))
    } finally {
      if (id === token.current) setPending('')
    }
  }

  function selectSource(active: CalendarSource) {
    if (!desktop) return
    setDraft(withCalendarSource(active, {}, draft))
    setDraftError('')
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
    setDraft(withCalendarSource('file', { file: picked }, draft))
    setDraftError('')
  }

  async function clearSource() {
    if (!sourceReady(feed.file)) {
      setDraft(emptyCalendarFile())
      setDraftError('')
      return
    }
    const id = ++token.current
    setPending('apply')
    setDraftError('')
    try {
      const next = await clearCalendar()
      if (id !== token.current) return
      applyFeed(emptyCalendarFeed(next))
      setLoadError('')
      setOpen(false)
    } catch (caught) {
      if (id !== token.current) return
      setDraftError(explainCalendarError(caught, t))
    } finally {
      if (id === token.current) setPending('')
    }
  }

  async function confirmSource() {
    const next = draft.active === 'url' ? withCalendarSource('url', { url: draft.url }, draft) : draft
    if (!sourceReady(next)) {
      setDraftError(next.active === 'file' ? t('calendar.missingFile') : t('calendar.invalidUrl'))
      return
    }
    if (sameCalendarSource(feed.file, next) && feed.copy) {
      setOpen(false)
      return
    }
    const id = ++token.current
    setPending('apply')
    setDraftError('')
    try {
      const fresh = await refreshCalendarFeed(emptyCalendarFeed(next))
      if (id !== token.current) return
      const saved = await saveCalendarSource(next)
      if (id !== token.current) return
      applyFeed({ ...fresh, file: saved })
      setLoadError('')
      setOpen(false)
    } catch (caught) {
      if (id !== token.current) return
      setDraftError(explainCalendarError(caught, t))
    } finally {
      if (id === token.current) setPending('')
    }
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <div className="grid min-h-0 flex-1 grid-rows-[auto_auto_auto_minmax(0,1fr)] gap-x-6 gap-y-2 lg:grid-cols-[minmax(0,1fr)_auto] lg:grid-rows-[auto_minmax(0,1fr)]">
        <div className="order-3 flex h-7 items-center lg:order-none lg:col-start-1 lg:row-start-1">
          <span className="text-xs text-muted-foreground">
            {selectedKey || t('calendar.upcoming')}
          </span>
        </div>
        <div className="order-1 flex h-7 flex-wrap items-center justify-end gap-2 lg:order-none lg:col-start-2 lg:row-start-1">
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setMonth(new Date())
              setSelected(undefined)
            }}
          >
            {t('calendar.thisMonth')}
          </Button>
          <Button type="button" variant="outline" onClick={() => void refreshNow()} disabled={!canRefresh}>
            <RefreshCwIcon data-icon="inline-start" className={cn(refreshing && 'animate-spin')} />
            {t('common.refresh')}
          </Button>
          <Button type="button" variant="outline" onClick={() => openSubscribe(true)}>
            {t('calendar.subscribe')}
          </Button>
        </div>
        <div className="order-4 flex h-full min-h-0 min-w-0 flex-col overflow-hidden lg:order-none lg:col-start-1 lg:row-start-2">
          {rows.length === 0 && !busy && !loadError ? (
            <Empty className="flex-1">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <CalendarDays />
                </EmptyMedia>
                <EmptyTitle>{selectedKey ? t('calendar.emptyDay') : t('calendar.emptyUpcoming')}</EmptyTitle>
              </EmptyHeader>
            </Empty>
          ) : (
          <div className="flex min-h-0 w-full flex-1 flex-col overflow-hidden rounded-lg border bg-card">
            {busy ? (
              <div className="flex flex-1 items-center p-3">
                <Spinner />
              </div>
            ) : loadError ? (
              <Alert className="m-3">
                <AlertDescription>{loadError}</AlertDescription>
              </Alert>
            ) : (
              <div className="min-h-0 flex-1 overflow-y-auto">
              <table className="w-full caption-bottom text-[0.8rem]">
                <TableHeader className="sticky top-0 z-10 bg-card">
                  <TableRow>
                    <TableHead>{t('calendar.date')}</TableHead>
                    <TableHead>{t('calendar.summary')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((event) => (
                    <TableRow key={noticeKey(event)}>
                      <TableCell className="font-mono">{event.date}</TableCell>
                      <TableCell className="whitespace-normal">{event.summary}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </table>
              </div>
            )}
          </div>
          )}
        </div>
        <MonthCalendar
          mode="single"
          locale={locale === 'zh-CN' ? zhCN : enUS}
          month={month}
          onMonthChange={setMonth}
          selected={selected}
          onSelect={setSelected}
          captionLayout="dropdown"
          formatters={{
            formatMonthDropdown: (date) => String(date.getMonth() + 1),
          }}
          className="order-2 self-start rounded-lg border [--cell-size:2.75rem] md:[--cell-size:3rem] lg:order-none lg:col-start-2 lg:row-start-2"
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

      <Dialog open={open} onOpenChange={openSubscribe}>
        <DialogContent className="flex max-h-[min(29rem,calc(100dvh-2rem))] flex-col overflow-hidden sm:max-w-lg">
          <DialogHeader className="shrink-0">
            <DialogTitle>{t('calendar.subscribe')}</DialogTitle>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto">
          <FieldGroup>
            <Field>
              <FieldLabel>{t('calendar.source')}</FieldLabel>
              {desktop ? (
                <Tabs
                  value={draft.active}
                  onValueChange={(value) => {
                    selectSource(value as CalendarSource)
                  }}
                >
                  <TabsList>
                    <TabsTrigger value="file">{t('calendar.file')}</TabsTrigger>
                    <TabsTrigger value="url">{t('calendar.url')}</TabsTrigger>
                  </TabsList>
                </Tabs>
              ) : (
                <FieldDescription>{t('calendar.desktopOnly')}</FieldDescription>
              )}
            </Field>

            {desktop && draft.active === 'file' ? (
              <Field>
                <FieldLabel htmlFor="calendar-file">{t('calendar.file')}</FieldLabel>
                <div className="flex items-center gap-2">
                  <Input
                    id="calendar-file"
                    value={draft.file}
                    readOnly
                    className="font-mono"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    className="shrink-0"
                    disabled={applying}
                    onClick={() => void browseIcs()}
                  >
                    <FolderOpen data-icon="inline-start" />
                    {t('calendar.browseIcs')}
                  </Button>
                </div>
              </Field>
            ) : null}

            {desktop && draft.active === 'url' ? (
              <Field data-invalid={draftError ? true : undefined}>
                <FieldLabel htmlFor="calendar-url">{t('calendar.url')}</FieldLabel>
                <Input
                  id="calendar-url"
                  value={draft.url}
                  aria-invalid={draftError ? true : undefined}
                  onChange={(event) => {
                    setDraft({ ...draft, active: 'url', url: event.target.value })
                    setDraftError('')
                  }}
                  placeholder={t('calendar.urlPlaceholder')}
                  spellCheck={false}
                  inputMode="url"
                  className="font-mono"
                />
              </Field>
            ) : null}

            {desktop && draftIsSaved ? (
              <FieldDescription>
                {feed.copy
                  ? t('calendar.syncedAt', { time: formatDateTime(feed.copy.syncedAt) })
                  : t('calendar.neverSynced')}
              </FieldDescription>
            ) : null}

            {draftError ? (
              <Alert>
                <AlertDescription>{draftError}</AlertDescription>
              </Alert>
            ) : desktop && draftIsSaved && feed.error ? (
              <Alert>
                <AlertDescription>
                  {t('calendar.refreshFailed', { reason: explainCalendarError(feed.error, t) })}
                </AlertDescription>
              </Alert>
            ) : null}
          </FieldGroup>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="destructive"
              className="sm:mr-auto"
              onClick={() => void clearSource()}
              disabled={!desktop || applying || !canClear}
            >
              {t('calendar.clear')}
            </Button>
            <Button type="button" variant="outline" onClick={closeDraft} disabled={applying}>
              {t('common.cancel')}
            </Button>
            <Button type="button" onClick={() => void confirmSource()} disabled={!desktop || applying}>
              {applying ? <Spinner data-icon="inline-start" /> : null}
              {t('common.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
