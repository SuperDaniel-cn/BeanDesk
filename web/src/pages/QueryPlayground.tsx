import { useQuery } from '@tanstack/react-query'
import { ChevronDown, ChevronUp, DownloadIcon, PlayIcon, RotateCcwIcon, TriangleAlertIcon } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Hint } from '@/components/ui/tooltip'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { useI18n } from '@/i18n'
import type { MessageKey } from '@/i18n/locales/en'
import { runBQLQuery, type BQLQueryResult } from '@/lib/api'
import { downloadCsv, formatCsv } from '@/lib/csv'
import { explainFavaError } from '@/lib/fava-error'
import { presentQueryCell, querySortValue } from '@/lib/format'
import { useTimeFilter } from '@/lib/time-context'
import { cn } from '@/lib/utils'

const PRESET_QUERIES = [
  {
    titleKey: 'query.presets.monthly.title',
    descriptionKey: 'query.presets.monthly.description',
    sql: `SELECT year, month, root(account, 1) as type, sum(cost(position)) as total
WHERE account ~ "^Income" OR account ~ "^Expenses"
GROUP BY year, month, type
ORDER BY year, month`,
  },
  {
    titleKey: 'query.presets.largeExpenses.title',
    descriptionKey: 'query.presets.largeExpenses.description',
    sql: `SELECT date, payee, narration, account, cost(position) as amount
WHERE account ~ "^Expenses"
ORDER BY cost(position) DESC
LIMIT 50`,
  },
  {
    titleKey: 'query.presets.cashAccounts.title',
    descriptionKey: 'query.presets.cashAccounts.description',
    sql: `SELECT account, sum(cost(position)) as balance
WHERE account ~ "^Assets:(Bank|Cash)"
GROUP BY account`,
  },
  {
    titleKey: 'query.presets.payees.title',
    descriptionKey: 'query.presets.payees.description',
    sql: `SELECT payee, count(position) as count, sum(cost(position)) as total
WHERE account ~ "^Expenses"
GROUP BY payee
ORDER BY sum(cost(position)) DESC`,
  },
  {
    titleKey: 'query.presets.tags.title',
    descriptionKey: 'query.presets.tags.description',
    sql: `SELECT date, payee, narration, tags, account, cost(position) as amount
WHERE tags
ORDER BY date DESC
LIMIT 50`,
  },
  {
    titleKey: 'query.presets.recent.title',
    descriptionKey: 'query.presets.recent.description',
    sql: `SELECT date, flag, payee, narration, account, units(position) as amount
ORDER BY date DESC
LIMIT 50`,
  },
] as const satisfies ReadonlyArray<{
  titleKey: MessageKey
  descriptionKey: MessageKey
  sql: string
}>

function numericColumn(dtype: string): boolean {
  return /int|float|decimal|amount|inventory/i.test(dtype)
}

function compareCells(left: unknown, right: unknown, ascending: boolean): number {
  const a = querySortValue(left)
  const b = querySortValue(right)
  if (a == null && b == null) return 0
  if (a == null) return 1
  if (b == null) return -1
  const cmp =
    typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b))
  return ascending ? cmp : -cmp
}

export function QueryPlayground() {
  const { t, locale } = useI18n()
  const { timeFilter } = useTimeFilter()
  const [draft, setDraft] = useState<string>(PRESET_QUERIES[0].sql)
  const [submitted, setSubmitted] = useState<string | null>(null)
  const [sortCol, setSortCol] = useState<number | null>(null)
  const [sortAsc, setSortAsc] = useState(true)

  const result = useQuery({
    queryKey: ['bql', submitted, timeFilter],
    enabled: submitted != null,
    queryFn: ({ signal }) => runBQLQuery(submitted as string, timeFilter, signal),
  })

  useEffect(() => {
    setSortCol(null)
  }, [submitted, timeFilter])

  function run(sql = draft) {
    const next = sql.trim()
    if (!next) return
    if (next === submitted) {
      void result.refetch()
      return
    }
    setSubmitted(next)
  }

  function exportCsv(table: BQLQueryResult, rowsInOrder: BQLQueryResult['rows']) {
    const headers = table.types.map((column) => column.name)
    const rows = rowsInOrder.map((row) =>
      row.map((cell) => {
        const formatted = presentQueryCell(cell, locale)
        return formatted === '—' ? '' : formatted
      }),
    )
    downloadCsv(
      `bql-${new Date().toISOString().slice(0, 10)}.csv`,
      formatCsv([], headers, rows),
    )
  }

  const data = result.data
  const numeric = data?.types.map((column) => numericColumn(column.dtype)) ?? []
  const sortedRows = useMemo(() => {
    if (!data) return []
    if (sortCol == null) return data.rows
    return [...data.rows].sort((a, b) => compareCells(a[sortCol], b[sortCol], sortAsc))
  }, [data, sortCol, sortAsc])

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {data && data.rows.length > 0 ? (
          <Button variant="outline" onClick={() => exportCsv(data, sortedRows)}>
            <DownloadIcon data-icon="inline-start" />
            {t('common.exportCsv')}
          </Button>
        ) : null}
        <Button onClick={() => run()} disabled={result.isFetching}>
          <PlayIcon data-icon="inline-start" />
          {result.isFetching ? t('query.running') : t('query.run')}
        </Button>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {PRESET_QUERIES.map((preset) => (
          <Hint key={preset.titleKey} label={t(preset.descriptionKey)}>
            <Button
              variant={draft === preset.sql ? 'secondary' : 'outline'}
              onClick={() => {
                setDraft(preset.sql)
                run(preset.sql)
              }}
            >
              {t(preset.titleKey)}
            </Button>
          </Hint>
        ))}
      </div>

      <div className="flex flex-col gap-2">
        <Textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
              event.preventDefault()
              run()
            }
          }}
          rows={5}
          aria-label={t('query.title')}
          placeholder={t('query.placeholder')}
          className="font-mono text-[0.8rem]"
        />
        <p className="text-[0.8rem] text-muted-foreground">{t('query.shortcut')}</p>
      </div>

      {result.isError ? (
        <Alert variant="destructive">
          <TriangleAlertIcon />
          <AlertTitle>{t('query.errorTitle')}</AlertTitle>
          <AlertDescription>
            {explainFavaError(result.error, t, 'query.errorFallback')}
          </AlertDescription>
          <AlertAction>
            <Button variant="outline" onClick={() => void result.refetch()}>
              {t('common.retry')}
            </Button>
          </AlertAction>
        </Alert>
      ) : null}

      {submitted != null && result.isPending ? <Skeleton className="h-40 w-full rounded-lg" /> : null}

      {data ? (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-[0.8rem] font-medium">{t('query.resultsTitle')}</h2>
            {sortCol != null ? (
              <Button variant="ghost" onClick={() => setSortCol(null)}>
                <RotateCcwIcon data-icon="inline-start" />
                {t('query.resetSort')}
              </Button>
            ) : null}
          </div>
          {data.rows.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>{t('query.emptyTitle')}</EmptyTitle>
                <EmptyDescription>{t('query.emptyDescription')}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
          <div className="overflow-hidden rounded-lg border bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    {data.types.map((column, index) => {
                      const active = sortCol === index
                      return (
                        <TableHead
                          key={index}
                          aria-sort={active ? (sortAsc ? 'ascending' : 'descending') : 'none'}
                          className={cn(numeric[index] && 'text-right')}
                        >
                          <button
                            type="button"
                            className={cn(
                              'inline-flex items-center gap-1',
                              numeric[index] && 'w-full justify-end',
                            )}
                            onClick={() => {
                              if (active) setSortAsc((current) => !current)
                              else {
                                setSortCol(index)
                                setSortAsc(true)
                              }
                            }}
                          >
                            {column.name}
                            {active ? (
                              sortAsc ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />
                            ) : null}
                          </button>
                        </TableHead>
                      )
                    })}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedRows.map((row, rowIndex) => (
                    <TableRow key={rowIndex}>
                      {row.map((cell, cellIndex) => (
                          <TableCell
                            key={cellIndex}
                            className={cn(
                              numeric[cellIndex]
                                ? 'text-right tabular-nums'
                                : 'max-w-xs whitespace-normal',
                            )}
                          >
                            {presentQueryCell(cell, locale)}
                          </TableCell>
                        ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
          </div>
          )}
          <p className="text-right text-[0.8rem] text-muted-foreground">
            {t('query.resultsSummary', { columns: data.types.length, rows: data.rows.length })}
          </p>
        </div>
      ) : null}
    </div>
  )
}
