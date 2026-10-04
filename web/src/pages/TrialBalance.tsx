import { useQuery } from '@tanstack/react-query'
import {
  ChevronRightIcon,
  ChevronsDownUp,
  ChevronsUpDown,
  DownloadIcon,
  ExternalLinkIcon,
  RefreshCwIcon,
  Search,
  TriangleAlertIcon,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router'

import { ReportBar, ReportDay, ReportWhen } from '@/components/report-bar'
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
} from '@/components/ui/empty'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useI18n } from '@/i18n'
import { fetchTrialBalance, type AccountNode, type TrialBalanceSection } from '@/lib/api'
import { exportStatementCsv } from '@/lib/csv'
import { explainFavaError } from '@/lib/fava-error'
import { displayAccountName } from '@/lib/format'
import { isDebitNormal, splitSignedBalance, type TrialBalanceRoot } from '@/lib/ledger-model'
import { formatPeriodLabel } from '@/lib/period-label'
import { useShownTime } from '@/lib/shown-time'
import { TRIAL_ROOT_TITLE, trialCsvTable } from '@/lib/statement-csv'
import { useTimeFilter } from '@/lib/time-context'
import { cn } from '@/lib/utils'

const ROOT_ORDER: Record<TrialBalanceRoot, number> = {
  assets: 0,
  liabilities: 1,
  equity: 2,
  income: 3,
  expenses: 4,
}

interface FlatRow {
  node: AccountNode
  depth: number
  debit: number
  credit: number
  open: boolean
  hasChildren: boolean
}

function matches(node: AccountNode, term: string): boolean {
  const haystack = `${node.account} ${node.name}`.toLowerCase()
  return haystack.includes(term)
}

function flatten(
  nodes: AccountNode[],
  debitNormal: boolean,
  expanded: Set<string>,
  term: string,
  depth = 0,
): FlatRow[] {
  const rows: FlatRow[] = []
  for (const node of nodes) {
    if (node.total === 0) continue
    const collapsed = term === '' && !expanded.has(node.account)
    const childRows = collapsed
      ? []
      : flatten(node.children, debitNormal, expanded, term, depth + 1)
    if (term !== '' && !matches(node, term) && childRows.length === 0) continue
    const hasChildren = collapsed
      ? node.children.some((child) => child.total !== 0)
      : childRows.length > 0
    const sides = splitSignedBalance(debitNormal, node.total)
    rows.push({
      node,
      depth,
      debit: sides.debit,
      credit: sides.credit,
      open: hasChildren && !collapsed,
      hasChildren,
    })
    if (hasChildren && !collapsed) rows.push(...childRows)
  }
  return rows
}

function defaultExpanded(sections: TrialBalanceSection[]): Set<string> {
  const open = new Set<string>()
  const walk = (nodes: AccountNode[]): boolean => {
    let shown = false
    for (const node of nodes) {
      if (node.total === 0) continue
      shown = true
      if (walk(node.children)) open.add(node.account)
    }
    return shown
  }
  for (const section of sections) walk(section.children)
  return open
}

function amountOrDash(amount: number, formatted: string): string {
  return amount === 0 ? '—' : formatted
}

function ColumnTotals({
  label,
  debit,
  credit,
  tone,
}: {
  label: string
  debit: string
  credit: string
  tone?: string
}) {
  return (
    <div className="flex items-start justify-between gap-3 text-[0.8rem]">
      <span className="min-w-0 text-muted-foreground">{label}</span>
      <span className={cn('flex shrink-0 font-medium tabular-nums', tone)}>
        <span className="w-32 text-right">{debit}</span>
        <span className="w-32 pe-4 text-right">{credit}</span>
      </span>
    </div>
  )
}

function LineRow({
  row,
  currency,
  onToggle,
}: {
  row: FlatRow
  currency: string
  onToggle: (account: string) => void
}) {
  const { t, formatCurrency } = useI18n()
  const title = displayAccountName(row.node.name)

  return (
    <TableRow>
      <TableCell className="whitespace-normal">
        <span
          className="flex min-w-0 items-center gap-1"
          style={{ paddingInlineStart: `${row.depth * 1.25}rem` }}
        >
          {row.hasChildren ? (
            <Button
              variant="ghost"
              size="icon-xs"
              aria-expanded={row.open}
              aria-label={t('balanceSheet.toggle', {
                action: row.open ? t('balanceSheet.collapse') : t('balanceSheet.expand'),
                account: title,
              })}
              onClick={() => onToggle(row.node.account)}
            >
              <ChevronRightIcon className={cn('transition-transform', row.open && 'rotate-90')} />
            </Button>
          ) : (
            <span className="size-6 shrink-0" aria-hidden />
          )}
          <span className={cn('flex min-w-0 items-center gap-1.5', row.hasChildren && 'font-medium')}>
            <span className="min-w-0 break-words">{title}</span>
            <Button variant="ghost" size="icon-xs" asChild>
              <Link
                to={`/journal?account=${encodeURIComponent(row.node.account)}`}
                aria-label={t('balanceSheet.journalLink', { account: title })}
              >
                <ExternalLinkIcon />
              </Link>
            </Button>
          </span>
        </span>
      </TableCell>
      <TableCell className="w-32 text-right tabular-nums">
        {amountOrDash(row.debit, formatCurrency(row.debit, currency))}
      </TableCell>
      <TableCell className="w-32 text-right tabular-nums">
        {amountOrDash(row.credit, formatCurrency(row.credit, currency))}
      </TableCell>
    </TableRow>
  )
}

function Statement({ data }: { data: Awaited<ReturnType<typeof fetchTrialBalance>> }) {
  const { t, formatCurrency, formatSignedCurrency } = useI18n()
  const currency = data.operating_currency
  const [searchTerm, setSearchTerm] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(() => defaultExpanded(data.sections))
  const term = searchTerm.trim().toLowerCase()

  const columns = useMemo(() => {
    const debit: { section: TrialBalanceSection; rows: FlatRow[] }[] = []
    const credit: { section: TrialBalanceSection; rows: FlatRow[] }[] = []
    const ordered = data.sections
      .filter((section) => section.debit !== 0 || section.credit !== 0)
      .slice()
      .sort((a, b) => (a.root ? ROOT_ORDER[a.root] : 5) - (b.root ? ROOT_ORDER[b.root] : 5))
    for (const section of ordered) {
      const debitNormal = isDebitNormal(section.root)
      const rows = flatten(section.children, debitNormal, expanded, term)
      if (rows.length === 0) continue
      const item = { section, rows }
      if (debitNormal) debit.push(item)
      else credit.push(item)
    }
    return { debit, credit }
  }, [data.sections, expanded, term])

  function toggle(account: string) {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(account)) next.delete(account)
      else next.add(account)
      return next
    })
  }

  const { totalDebits, totalCredits, netImbalance, balanced } = data.totals

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <InputGroup className="w-full max-w-xs">
          <InputGroupAddon>
            <Search />
          </InputGroupAddon>
          <InputGroupInput
            placeholder={t('trialBalance.searchPlaceholder')}
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
          />
        </InputGroup>
        <div className="flex items-center gap-1.5">
          <Button variant="ghost" onClick={() => setExpanded(defaultExpanded(data.sections))}>
            <ChevronsUpDown data-icon="inline-start" />
            <span className="hidden sm:inline">{t('trialBalance.expandAll')}</span>
          </Button>
          <Button variant="ghost" onClick={() => setExpanded(new Set())}>
            <ChevronsDownUp data-icon="inline-start" />
            <span className="hidden sm:inline">{t('trialBalance.collapseAll')}</span>
          </Button>
        </div>
      </div>

      {columns.debit.length === 0 && columns.credit.length === 0 ? (
        <Empty className="border border-dashed">
          <EmptyHeader>
            <EmptyTitle>{t('trialBalance.empty')}</EmptyTitle>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
          {([columns.debit, columns.credit] as const).map((side) => (
            <div key={side === columns.debit ? 'debit' : 'credit'} className="flex min-w-0 flex-col gap-6">
              {side.map(({ section, rows }) => {
                const name = section.root
                  ? t(TRIAL_ROOT_TITLE[section.root])
                  : displayAccountName(section.rootAccount)
                return (
                  <section key={section.rootAccount} className="flex min-w-0 flex-col gap-2">
                    <h2 className="text-[0.8rem] font-medium">{name}</h2>
                    <div className="overflow-hidden rounded-lg border bg-card [&_td:last-child]:pe-4 [&_th:last-child]:pe-4">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>{t('balanceSheet.account')}</TableHead>
                            <TableHead className="w-32 text-right">
                              {t('trialBalance.debitColumn')}
                            </TableHead>
                            <TableHead className="w-32 text-right">
                              {t('trialBalance.creditColumn')}
                            </TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {rows.map((row) => (
                            <LineRow
                              key={row.node.account}
                              row={row}
                              currency={currency}
                              onToggle={toggle}
                            />
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                    <ColumnTotals
                      label={t('trialBalance.sectionTotal', { name })}
                      debit={amountOrDash(section.debit, formatCurrency(section.debit, currency))}
                      credit={amountOrDash(section.credit, formatCurrency(section.credit, currency))}
                    />
                  </section>
                )
              })}
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 gap-2 lg:grid-cols-2 lg:gap-6">
        <ColumnTotals
          label={t('trialBalance.debitTotal')}
          debit={formatCurrency(totalDebits, currency)}
          credit=""
          tone={balanced ? undefined : 'text-destructive'}
        />
        <ColumnTotals
          label={t('trialBalance.creditTotal')}
          debit=""
          credit={formatCurrency(totalCredits, currency)}
          tone={balanced ? undefined : 'text-destructive'}
        />
      </div>
      {balanced ? null : (
        <div className="flex items-center justify-between gap-3 text-[0.8rem]">
          <span className="text-muted-foreground">{t('trialBalance.netImbalance')}</span>
          <span className="font-medium text-destructive tabular-nums">
            {formatSignedCurrency(netImbalance, currency)}
          </span>
        </div>
      )}
    </div>
  )
}

export function TrialBalance() {
  const { t, formatDate, formatCurrency } = useI18n()
  const { timeFilter } = useTimeFilter()

  const query = useQuery({
    queryKey: ['trial-balance', timeFilter],
    queryFn: ({ signal }) => fetchTrialBalance(timeFilter, signal),
    placeholderData: (previous) => previous,
  })
  const shownTime = useShownTime(timeFilter, query.isPlaceholderData)

  if (query.isError) {
    return (
      <Alert variant="destructive">
        <TriangleAlertIcon />
        <AlertTitle>{t('trialBalance.errorTitle')}</AlertTitle>
        <AlertDescription>
          {explainFavaError(query.error, t)}
        </AlertDescription>
        <AlertAction>
          <Button variant="outline" onClick={() => void query.refetch()}>
            {t('common.retry')}
          </Button>
        </AlertAction>
      </Alert>
    )
  }

  if (!query.data) {
    return <Skeleton className="h-96 w-full rounded-lg" />
  }

  const data = query.data
  const periodLabel = formatPeriodLabel(shownTime, t)
  const canExport = !query.isPlaceholderData

  return (
    <div className="flex flex-col gap-6">
      <ReportBar
        status={
          <>
            <ReportWhen currency={data.operating_currency}>
              {data.as_of ? (
                <ReportDay iso={data.as_of}>
                  {t('common.asOf', { date: formatDate(data.as_of) })}
                </ReportDay>
              ) : null}
            </ReportWhen>
            <Badge variant={data.totals.balanced ? 'positive' : 'destructive'}>
              {data.totals.balanced ? t('trialBalance.balanced') : t('trialBalance.unbalanced')}
            </Badge>
          </>
        }
        actions={
          <>
            <Button
              variant="outline"
              disabled={!canExport}
              onClick={() => {
                const table = trialCsvTable(data, t, formatCurrency)
                exportStatementCsv({
                  title: data.title,
                  currency: data.operating_currency,
                  periodLabel,
                  periodToken: shownTime,
                  report: t('trialBalance.title'),
                  headers: table.headers,
                  rows: table.rows,
                })
              }}
            >
              <DownloadIcon data-icon="inline-start" />
              {t('common.exportCsv')}
            </Button>
            <Button variant="outline" onClick={() => query.refetch()} disabled={query.isFetching}>
              <RefreshCwIcon
                data-icon="inline-start"
                className={cn(query.isFetching && 'animate-spin')}
              />
              {t('common.refresh')}
            </Button>
          </>
        }
      />
      <Statement data={data} />
    </div>
  )
}
