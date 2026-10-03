import { useQuery } from '@tanstack/react-query'
import { ChevronRightIcon, ExternalLinkIcon, RefreshCwIcon, TriangleAlertIcon } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router'

import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Empty,
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
import { useI18n } from '@/i18n'
import { useTimeFilter } from '@/lib/time-context'
import {
  fetchIncomeStatement,
  type IncomeStatement as IncomeStatementData,
  type IncomeStatementSection,
} from '@/lib/api'
import { compareAccounts, priorPeriod, type ComparedAccount } from '@/lib/ledger-model'
import { explainFavaError } from '@/lib/fava-error'
import { displayAccountName, toDisplay } from '@/lib/format'
import { cn } from '@/lib/utils'

type FlowSection = IncomeStatementSection['section']

/** Income is a credit in Beancount. Expenses already read as positive debits. */
function present(section: FlowSection, raw: number): number {
  return section === 'income' ? toDisplay(raw) : raw
}

function includeNode(section: FlowSection, node: ComparedAccount, comparing: boolean): boolean {
  if (present(section, node.current) !== 0) return true
  return comparing && present(section, node.prior) !== 0
}

interface AccountLine {
  node: ComparedAccount
  depth: number
  open: boolean
  hasChildren: boolean
}

function findSection(sections: IncomeStatementSection[], name: FlowSection) {
  return sections.find((section) => section.section === name)
}

function flatten(
  nodes: ComparedAccount[],
  expanded: Set<string>,
  section: FlowSection,
  comparing: boolean,
  depth = 0,
): AccountLine[] {
  const rows: AccountLine[] = []
  for (const node of nodes) {
    if (!includeNode(section, node, comparing)) continue
    const expandedNode = expanded.has(node.account)
    const childRows = expandedNode ? flatten(node.children, expanded, section, comparing, depth + 1) : []
    const hasChildren = expandedNode
      ? childRows.length > 0
      : node.children.some((child) => includeNode(section, child, comparing))
    rows.push({ node, depth, open: hasChildren && expandedNode, hasChildren })
    if (hasChildren && expandedNode) rows.push(...childRows)
  }
  return rows
}

function defaultExpanded(nodes: ComparedAccount[], section: FlowSection, comparing: boolean): Set<string> {
  const open = new Set<string>()
  const walk = (children: ComparedAccount[]): boolean => {
    let shown = false
    for (const node of children) {
      if (!includeNode(section, node, comparing)) continue
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
  const current = present(section, line.node.current)
  const prior = present(section, line.node.prior)

  return (
    <TableRow>
      <TableCell className="whitespace-normal">
        <span
          className="flex min-w-0 items-center gap-1"
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
          <span className={cn('flex min-w-0 items-center gap-1.5', line.hasChildren && 'font-medium')}>
            <span className="min-w-0 break-words">{title}</span>
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
      <TableCell className="w-28 text-right tabular-nums whitespace-nowrap">
        {formatCurrency(current, currency)}
      </TableCell>
      {comparing ? (
        <>
          <TableCell className="w-28 text-right tabular-nums whitespace-nowrap">
            {formatCurrency(prior, currency)}
          </TableCell>
          <TableCell className="w-28 text-right tabular-nums whitespace-nowrap">
            {formatSignedCurrency(current - prior, currency)}
          </TableCell>
        </>
      ) : null}
    </TableRow>
  )
}

function TotalLine({
  label,
  amount,
  prior,
  delta,
  tone,
}: {
  label: string
  amount: string
  prior?: string
  delta?: string
  tone?: string
}) {
  return (
    <div className="flex items-center justify-between gap-3 pe-4 text-[0.8rem]">
      <span className="text-muted-foreground">{label}</span>
      <span className="flex shrink-0 gap-4">
        <span className={cn('font-medium tabular-nums', tone)}>{amount}</span>
        {prior != null ? <span className="w-28 text-right font-medium tabular-nums">{prior}</span> : null}
        {delta != null ? <span className={cn('w-28 text-right font-medium tabular-nums', tone)}>{delta}</span> : null}
      </span>
    </div>
  )
}

function AccountSection({
  title,
  section,
  lines,
  currency,
  comparing,
  onToggle,
  totalLabel,
  total,
  priorTotal,
  delta,
}: {
  title: string
  section: FlowSection
  lines: AccountLine[]
  currency: string
  comparing: boolean
  onToggle: (account: string) => void
  totalLabel: string
  total: string
  priorTotal?: string
  delta?: string
}) {
  const { t } = useI18n()

  return (
    <section className="flex min-w-0 flex-col gap-2">
      <h2 className="text-[0.8rem] font-medium">{title}</h2>
      {lines.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border bg-card [&_td:last-child]:pe-4 [&_th:last-child]:pe-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('balanceSheet.account')}</TableHead>
                <TableHead className="w-28 text-right">
                  {comparing ? t('compare.current') : t('balanceSheet.amount')}
                </TableHead>
                {comparing ? (
                  <>
                    <TableHead className="w-28 text-right">{t('compare.prior')}</TableHead>
                    <TableHead className="w-28 text-right">{t('compare.delta')}</TableHead>
                  </>
                ) : null}
              </TableRow>
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
          </Table>
        </div>
      ) : null}
      <TotalLine label={totalLabel} amount={total} prior={priorTotal} delta={delta} />
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
  income,
  expenses,
}: {
  currency: string
  comparing: boolean
  income: FlowView
  expenses: FlowView
}) {
  const { t, formatCurrency, formatSignedCurrency } = useI18n()
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    const open = defaultExpanded(income.nodes, 'income', comparing)
    for (const account of defaultExpanded(expenses.nodes, 'expenses', comparing)) open.add(account)
    return open
  })
  const revenue = present('income', income.current)
  const priorRevenue = present('income', income.prior)
  const expenseTotal = present('expenses', expenses.current)
  const priorExpenseTotal = present('expenses', expenses.prior)
  const profit = revenue - expenseTotal
  const priorProfit = priorRevenue - priorExpenseTotal

  const incomeLines = useMemo(
    () => flatten(income.nodes, expanded, 'income', comparing),
    [income.nodes, expanded, comparing],
  )
  const expenseLines = useMemo(
    () => flatten(expenses.nodes, expanded, 'expenses', comparing),
    [expenses.nodes, expanded, comparing],
  )

  function toggle(account: string) {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(account)) next.delete(account)
      else next.add(account)
      return next
    })
  }

  const profitTone =
    profit > 0 ? 'text-positive' : profit < 0 ? 'text-destructive' : undefined

  return (
    <div className="grid grid-cols-1 items-start gap-6 md:grid-cols-2">
      <AccountSection
        title={t('income.revenueTitle')}
        section="income"
        lines={incomeLines}
        currency={currency}
        comparing={comparing}
        onToggle={toggle}
        totalLabel={t('income.totalRevenue')}
        total={formatCurrency(revenue, currency)}
        priorTotal={comparing ? formatCurrency(priorRevenue, currency) : undefined}
        delta={comparing ? formatSignedCurrency(revenue - priorRevenue, currency) : undefined}
      />
      <div className="flex min-w-0 flex-col gap-2">
        <AccountSection
          title={t('income.expensesTitle')}
          section="expenses"
          lines={expenseLines}
          currency={currency}
          comparing={comparing}
          onToggle={toggle}
          totalLabel={t('income.totalExpenses')}
          total={formatCurrency(expenseTotal, currency)}
          priorTotal={comparing ? formatCurrency(priorExpenseTotal, currency) : undefined}
          delta={comparing ? formatSignedCurrency(expenseTotal - priorExpenseTotal, currency) : undefined}
        />
        <TotalLine
          label={t('income.profitTitle')}
          amount={formatSignedCurrency(profit, currency)}
          prior={comparing ? formatSignedCurrency(priorProfit, currency) : undefined}
          delta={comparing ? formatSignedCurrency(profit - priorProfit, currency) : undefined}
          tone={profitTone}
        />
      </div>
    </div>
  )
}

export function IncomeStatement() {
  const { t, formatDate } = useI18n()
  const { timeFilter } = useTimeFilter()
  const priorKey = priorPeriod(timeFilter)

  const query = useQuery({
    queryKey: ['income-statement', timeFilter],
    queryFn: ({ signal }) => fetchIncomeStatement(timeFilter, signal),
  })
  const priorQuery = useQuery({
    queryKey: ['income-statement', priorKey],
    queryFn: ({ signal }) => fetchIncomeStatement(priorKey as string, signal),
    enabled: priorKey != null,
  })

  if (query.isError || (priorKey != null && priorQuery.isError)) {
    const error = query.isError ? query.error : priorQuery.error
    return (
      <Alert variant="destructive">
        <TriangleAlertIcon />
        <AlertTitle>{t('income.errorTitle')}</AlertTitle>
        <AlertDescription>
          {explainFavaError(error, t)}
        </AlertDescription>
        <AlertAction>
          <Button
            variant="outline"
            onClick={() => {
              void query.refetch()
              if (priorKey) void priorQuery.refetch()
            }}
          >
            {t('common.retry')}
          </Button>
        </AlertAction>
      </Alert>
    )
  }

  if (query.isPending || !query.data || (priorKey != null && priorQuery.isPending)) {
    return <Skeleton className="h-96 w-full rounded-lg" />
  }

  const data = query.data
  const prior = priorKey != null ? (priorQuery.data ?? null) : null
  const income = flowView(data, prior, 'income')
  const expenses = flowView(data, prior, 'expenses')
  const comparing = prior != null
  const active =
    income.nodes.some((node) => includeNode('income', node, comparing)) ||
    expenses.nodes.some((node) => includeNode('expenses', node, comparing))
  const fetching = query.isFetching || priorQuery.isFetching

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {data.period ? (
          <Badge variant="outline">
            {t('income.period', {
              from: formatDate(data.period.from),
              to: formatDate(data.period.to),
            })}
          </Badge>
        ) : null}
        <Badge variant="outline">{data.operating_currency}</Badge>
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
      </div>

      {active ? (
        <Statement
          key={`${timeFilter}:${priorKey ?? ''}`}
          currency={data.operating_currency}
          comparing={comparing}
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
