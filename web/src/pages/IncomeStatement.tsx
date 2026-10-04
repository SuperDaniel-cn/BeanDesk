import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronRightIcon, DownloadIcon, ExternalLinkIcon, RefreshCwIcon, TriangleAlertIcon } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router'

import {
  ComparePanel,
  PeriodAmountCells,
  PeriodColumnHeads,
  PeriodTotals,
  PriorUnavailableAlert,
  StatementTable,
  amountTone,
} from '@/components/period-compare'
import { ReportBar, ReportDay, ReportWhen } from '@/components/report-bar'
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
} from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'
import {
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useI18n } from '@/i18n'
import { useTimeFilter } from '@/lib/time-context'
import {
  fetchIncomeStatement,
  type IncomeStatement as IncomeStatementData,
  type IncomeStatementSection,
} from '@/lib/api'
import { compareAccounts, priorPeriod, visibleCompared, type ComparedAccount } from '@/lib/ledger-model'
import { exportStatementCsv } from '@/lib/csv'
import { explainFavaError } from '@/lib/fava-error'
import { displayAccountName, presentIncome } from '@/lib/format'
import { formatPeriodLabel } from '@/lib/period-label'
import { useShownTime, shownPrior } from '@/lib/shown-time'
import { incomeCsvTable } from '@/lib/statement-csv'
import { cn } from '@/lib/utils'

type FlowSection = IncomeStatementSection['section']

interface AccountLine {
  node: ComparedAccount
  depth: number
  open: boolean
  hasChildren: boolean
}

function findSection(sections: IncomeStatementSection[], name: FlowSection) {
  return sections.find((section) => section.section === name)
}

function flatten(nodes: ComparedAccount[], expanded: Set<string>, depth = 0): AccountLine[] {
  const rows: AccountLine[] = []
  for (const node of nodes) {
    if (!visibleCompared(node)) continue
    const expandedNode = expanded.has(node.account)
    const childRows = expandedNode ? flatten(node.children, expanded, depth + 1) : []
    const hasChildren = expandedNode
      ? childRows.length > 0
      : node.children.some((child) => visibleCompared(child))
    rows.push({ node, depth, open: hasChildren && expandedNode, hasChildren })
    if (hasChildren && expandedNode) rows.push(...childRows)
  }
  return rows
}

function defaultExpanded(nodes: ComparedAccount[]): Set<string> {
  const open = new Set<string>()
  const walk = (children: ComparedAccount[]): boolean => {
    let shown = false
    for (const node of children) {
      if (!visibleCompared(node)) continue
      shown = true
      if (walk(node.children)) open.add(node.account)
    }
    return shown
  }
  walk(nodes)
  return open
}

function LineRow({
  line,
  section,
  currency,
  comparing,
  onToggle,
}: {
  line: AccountLine
  section: FlowSection
  currency: string
  comparing: boolean
  onToggle: (account: string) => void
}) {
  const { t, formatCurrency, formatSignedCurrency } = useI18n()
  const title = displayAccountName(line.node.name)
  const current = presentIncome(section, line.node.current)
  const prior = presentIncome(section, line.node.prior)

  return (
    <TableRow>
      <TableCell>
        <span
          className="flex items-center gap-1"
          style={{ paddingInlineStart: `${line.depth * 1.25}rem` }}
        >
          {line.hasChildren ? (
            <Button
              variant="ghost"
              size="icon-xs"
              aria-expanded={line.open}
              aria-label={t('balanceSheet.toggle', {
                action: line.open ? t('balanceSheet.collapse') : t('balanceSheet.expand'),
                account: title,
              })}
              onClick={() => onToggle(line.node.account)}
            >
              <ChevronRightIcon className={cn('transition-transform', line.open && 'rotate-90')} />
            </Button>
          ) : (
            <span className="size-6 shrink-0" aria-hidden />
          )}
          <span className={cn('flex items-center gap-1.5', line.hasChildren && 'font-medium')}>
            <span>{title}</span>
            <Button variant="ghost" size="icon-xs" asChild>
              <Link
                to={`/journal?account=${encodeURIComponent(line.node.account)}`}
                aria-label={t('balanceSheet.journalLink', { account: title })}
              >
                <ExternalLinkIcon />
              </Link>
            </Button>
          </span>
        </span>
      </TableCell>
      <PeriodAmountCells
        current={formatCurrency(current, currency)}
        prior={comparing ? formatCurrency(prior, currency) : undefined}
        delta={comparing ? formatSignedCurrency(current - prior, currency) : undefined}
        comparing={comparing}
      />
    </TableRow>
  )
}

function AccountSection({
  title,
  section,
  lines,
  currency,
  comparing,
  currentLabel,
  priorLabel,
  onToggle,
  totalLabel,
  total,
  priorTotal,
  delta,
  children,
}: {
  title: string
  section: FlowSection
  lines: AccountLine[]
  currency: string
  comparing: boolean
  currentLabel: string
  priorLabel: string
  onToggle: (account: string) => void
  totalLabel: string
  total: string
  priorTotal?: string
  delta?: string
  children?: ReactNode
}) {
  const { t } = useI18n()

  return (
    <section className="flex min-w-0 flex-col gap-2">
      <h2 className="text-[0.8rem] font-medium">{title}</h2>
      <ComparePanel>
        {lines.length > 0 ? (
          <StatementTable comparing={comparing}>
            <TableHeader>
              <PeriodColumnHeads
                first={t('balanceSheet.account')}
                amountLabel={t('balanceSheet.amount')}
                currentLabel={currentLabel}
                priorLabel={priorLabel}
                comparing={comparing}
              />
            </TableHeader>
            <TableBody>
              {lines.map((line) => (
                <LineRow
                  key={line.node.account}
                  line={line}
                  section={section}
                  currency={currency}
                  comparing={comparing}
                  onToggle={onToggle}
                />
              ))}
            </TableBody>
          </StatementTable>
        ) : null}
        <PeriodTotals
          label={totalLabel}
          current={total}
          prior={priorTotal}
          delta={delta}
        />
        {children}
      </ComparePanel>
    </section>
  )
}

interface FlowView {
  nodes: ComparedAccount[]
  current: number
  prior: number
}

function flowView(data: IncomeStatementData, prior: IncomeStatementData | null, name: FlowSection): FlowView {
  const current = findSection(data.sections, name)
  const previous = prior ? findSection(prior.sections, name) : undefined
  return {
    nodes: compareAccounts(current?.children ?? [], previous?.children ?? []),
    current: current?.total ?? 0,
    prior: previous?.total ?? 0,
  }
}

function Statement({
  currency,
  comparing,
  currentLabel,
  priorLabel,
  income,
  expenses,
}: {
  currency: string
  comparing: boolean
  currentLabel: string
  priorLabel: string
  income: FlowView
  expenses: FlowView
}) {
  const { t, formatCurrency, formatSignedCurrency } = useI18n()
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    const open = defaultExpanded(income.nodes)
    for (const account of defaultExpanded(expenses.nodes)) open.add(account)
    return open
  })
  const revenue = presentIncome('income', income.current)
  const priorRevenue = presentIncome('income', income.prior)
  const expenseTotal = presentIncome('expenses', expenses.current)
  const priorExpenseTotal = presentIncome('expenses', expenses.prior)
  const profit = revenue - expenseTotal
  const priorProfit = priorRevenue - priorExpenseTotal

  const incomeLines = useMemo(
    () => flatten(income.nodes, expanded),
    [income.nodes, expanded],
  )
  const expenseLines = useMemo(
    () => flatten(expenses.nodes, expanded),
    [expenses.nodes, expanded],
  )

  function toggle(account: string) {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(account)) next.delete(account)
      else next.add(account)
      return next
    })
  }

  return (
    <div className={cn('grid grid-cols-1 items-start gap-6', !comparing && 'md:grid-cols-2')}>
      <AccountSection
        title={t('income.revenueTitle')}
        section="income"
        lines={incomeLines}
        currency={currency}
        comparing={comparing}
        currentLabel={currentLabel}
        priorLabel={priorLabel}
        onToggle={toggle}
        totalLabel={t('income.totalRevenue')}
        total={formatCurrency(revenue, currency)}
        priorTotal={comparing ? formatCurrency(priorRevenue, currency) : undefined}
        delta={comparing ? formatSignedCurrency(revenue - priorRevenue, currency) : undefined}
      />
      <AccountSection
        title={t('income.expensesTitle')}
        section="expenses"
        lines={expenseLines}
        currency={currency}
        comparing={comparing}
        currentLabel={currentLabel}
        priorLabel={priorLabel}
        onToggle={toggle}
        totalLabel={t('income.totalExpenses')}
        total={formatCurrency(expenseTotal, currency)}
        priorTotal={comparing ? formatCurrency(priorExpenseTotal, currency) : undefined}
        delta={comparing ? formatSignedCurrency(expenseTotal - priorExpenseTotal, currency) : undefined}
      >
        <PeriodTotals
          label={t('income.profitTitle')}
          current={formatSignedCurrency(profit, currency)}
          prior={comparing ? formatSignedCurrency(priorProfit, currency) : undefined}
          delta={comparing ? formatSignedCurrency(profit - priorProfit, currency) : undefined}
          tone={amountTone(profit)}
        />
      </AccountSection>
    </div>
  )
}

export function IncomeStatement() {
  const { t, formatDate, formatCurrency, formatSignedCurrency } = useI18n()
  const { timeFilter } = useTimeFilter()
  const queryClient = useQueryClient()
  const priorKey = priorPeriod(timeFilter)

  const query = useQuery({
    queryKey: ['income-statement', timeFilter],
    queryFn: ({ signal }) => fetchIncomeStatement(timeFilter, signal),
    placeholderData: (previous) => previous,
  })
  const shownTime = useShownTime(timeFilter, query.isPlaceholderData)
  const shownPriorKey = priorPeriod(shownTime)
  const priorQuery = useQuery({
    queryKey: ['income-statement', priorKey],
    queryFn: ({ signal }) => fetchIncomeStatement(priorKey as string, signal),
    enabled: priorKey != null,
  })

  if (query.isError) {
    return (
      <Alert variant="destructive">
        <TriangleAlertIcon />
        <AlertTitle>{t('income.errorTitle')}</AlertTitle>
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
  const priorFailed = !query.isPlaceholderData && priorKey != null && priorQuery.isError
  const prior = shownPrior(
    shownPriorKey,
    priorKey,
    priorQuery.data,
    queryClient.getQueryData<IncomeStatementData>(['income-statement', shownPriorKey]),
  )
  const income = flowView(data, prior, 'income')
  const expenses = flowView(data, prior, 'expenses')
  const comparing = prior != null
  const active =
    income.nodes.some((node) => visibleCompared(node)) ||
    expenses.nodes.some((node) => visibleCompared(node))
  const fetching = query.isFetching || priorQuery.isFetching
  const currentLabel = formatPeriodLabel(shownTime, t)
  const priorLabel = shownPriorKey ? formatPeriodLabel(shownPriorKey, t) : ''
  const canExport = !query.isPlaceholderData

  return (
    <div className="flex flex-col gap-6">
      <ReportBar
        status={
          <ReportWhen currency={data.operating_currency}>
            {data.period ? (
              <>
                <ReportDay iso={data.period.from}>{formatDate(data.period.from)}</ReportDay>
                {` ${t('common.rangeJoiner')} `}
                <ReportDay iso={data.period.to}>{formatDate(data.period.to)}</ReportDay>
              </>
            ) : null}
          </ReportWhen>
        }
        actions={
          <>
            <Button
              variant="outline"
              disabled={!canExport}
              onClick={() => {
                const table = incomeCsvTable(
                  income,
                  expenses,
                  data.operating_currency,
                  comparing,
                  t,
                  formatCurrency,
                  formatSignedCurrency,
                  currentLabel,
                  priorLabel,
                )
                exportStatementCsv({
                  title: data.title,
                  currency: data.operating_currency,
                  periodLabel: currentLabel,
                  periodToken: shownTime,
                  report: t('income.title'),
                  headers: table.headers,
                  rows: table.rows,
                })
              }}
            >
              <DownloadIcon data-icon="inline-start" />
              {t('common.exportCsv')}
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                void query.refetch()
                if (priorKey) void priorQuery.refetch()
              }}
              disabled={fetching}
            >
              <RefreshCwIcon
                data-icon="inline-start"
                className={cn(fetching && 'animate-spin')}
              />
              {t('common.refresh')}
            </Button>
          </>
        }
      />

      {priorFailed ? (
        <PriorUnavailableAlert onRetry={() => void priorQuery.refetch()} />
      ) : null}

      {!data.unconverted_currencies.length ? null : (
        <Alert variant="warning">
          <TriangleAlertIcon />
          <AlertTitle>{t('balanceSheet.unconvertedTitle')}</AlertTitle>
          <AlertDescription>
            {t('balanceSheet.unconvertedBody', {
              currency: data.operating_currency,
              currencies: data.unconverted_currencies.join(', '),
            })}
          </AlertDescription>
        </Alert>
      )}

      {active ? (
        <Statement
          currency={data.operating_currency}
          comparing={comparing}
          currentLabel={currentLabel}
          priorLabel={priorLabel}
          income={income}
          expenses={expenses}
        />
      ) : (
        <Empty className="border border-dashed">
          <EmptyHeader>
            <EmptyTitle>{t('income.empty')}</EmptyTitle>
          </EmptyHeader>
        </Empty>
      )}
    </div>
  )
}
