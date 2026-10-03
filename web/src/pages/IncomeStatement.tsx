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
  type AccountNode,
  type IncomeStatement as IncomeStatementData,
  type IncomeStatementSection,
} from '@/lib/api'
import { explainFavaError } from '@/lib/fava-error'
import { displayAccountName, toDisplay } from '@/lib/format'
import { cn } from '@/lib/utils'

type FlowSection = IncomeStatementSection['section']

/** Income is a credit in Beancount. Expenses already read as positive debits. */
function present(section: FlowSection, raw: number): number {
  return section === 'income' ? toDisplay(raw) : raw
}

function includeNode(section: FlowSection, node: AccountNode): boolean {
  return present(section, node.total) !== 0
}

interface AccountLine {
  node: AccountNode
  depth: number
  open: boolean
  hasChildren: boolean
}

const NO_ACCOUNTS: AccountNode[] = []

function findSection(sections: IncomeStatementSection[], name: FlowSection) {
  return sections.find((section) => section.section === name)
}

function flatten(
  nodes: AccountNode[],
  expanded: Set<string>,
  section: FlowSection,
  depth = 0,
): AccountLine[] {
  const rows: AccountLine[] = []
  for (const node of nodes) {
    if (!includeNode(section, node)) continue
    const expandedNode = expanded.has(node.account)
    const childRows = expandedNode ? flatten(node.children, expanded, section, depth + 1) : []
    const hasChildren = expandedNode
      ? childRows.length > 0
      : node.children.some((child) => includeNode(section, child))
    rows.push({ node, depth, open: hasChildren && expandedNode, hasChildren })
    if (hasChildren && expandedNode) rows.push(...childRows)
  }
  return rows
}

function defaultExpanded(sections: IncomeStatementSection[]): Set<string> {
  const open = new Set<string>()
  const walk = (nodes: AccountNode[], section: FlowSection): boolean => {
    let shown = false
    for (const node of nodes) {
      if (!includeNode(section, node)) continue
      shown = true
      if (walk(node.children, section)) open.add(node.account)
    }
    return shown
  }
  for (const section of sections) walk(section.children, section.section)
  return open
}

function LineRow({
  line,
  section,
  currency,
  onToggle,
}: {
  line: AccountLine
  section: FlowSection
  currency: string
  onToggle: (account: string) => void
}) {
  const { t, formatCurrency } = useI18n()
  const title = displayAccountName(line.node.name)

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
      <TableCell className="w-32 text-right tabular-nums">
        {formatCurrency(present(section, line.node.total), currency)}
      </TableCell>
    </TableRow>
  )
}

function TotalLine({ label, amount, tone }: { label: string; amount: string; tone?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 pe-4 text-[0.8rem]">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn('font-medium tabular-nums', tone)}>{amount}</span>
    </div>
  )
}

function AccountSection({
  title,
  section,
  lines,
  currency,
  onToggle,
  totalLabel,
  total,
}: {
  title: string
  section: FlowSection
  lines: AccountLine[]
  currency: string
  onToggle: (account: string) => void
  totalLabel: string
  total: string
}) {
  const { t } = useI18n()

  return (
    <section className="flex min-w-0 flex-col gap-2">
      <h2 className="text-[0.8rem] font-medium">{title}</h2>
      {lines.length > 0 ? (
        <div className="overflow-hidden rounded-lg border bg-card [&_td:last-child]:pe-4 [&_th:last-child]:pe-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('balanceSheet.account')}</TableHead>
                <TableHead className="w-32 text-right">{t('balanceSheet.amount')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((line) => (
                <LineRow
                  key={line.node.account}
                  line={line}
                  section={section}
                  currency={currency}
                  onToggle={onToggle}
                />
              ))}
            </TableBody>
          </Table>
        </div>
      ) : null}
      <TotalLine label={totalLabel} amount={total} />
    </section>
  )
}

function Statement({ data }: { data: IncomeStatementData }) {
  const { t, formatCurrency, formatSignedCurrency } = useI18n()
  const currency = data.operating_currency
  const [expanded, setExpanded] = useState<Set<string>>(() => defaultExpanded(data.sections))
  const income = findSection(data.sections, 'income')
  const expenses = findSection(data.sections, 'expenses')
  const revenue = present('income', income?.total ?? 0)
  const expenseTotal = present('expenses', expenses?.total ?? 0)
  const profit = revenue - expenseTotal

  const incomeLines = useMemo(
    () => flatten(income?.children ?? NO_ACCOUNTS, expanded, 'income'),
    [income, expanded],
  )
  const expenseLines = useMemo(
    () => flatten(expenses?.children ?? NO_ACCOUNTS, expanded, 'expenses'),
    [expenses, expanded],
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
        onToggle={toggle}
        totalLabel={t('income.totalRevenue')}
        total={formatCurrency(revenue, currency)}
      />
      <div className="flex min-w-0 flex-col gap-2">
        <AccountSection
          title={t('income.expensesTitle')}
          section="expenses"
          lines={expenseLines}
          currency={currency}
          onToggle={toggle}
          totalLabel={t('income.totalExpenses')}
          total={formatCurrency(expenseTotal, currency)}
        />
        <TotalLine
          label={t('income.profitTitle')}
          amount={formatSignedCurrency(profit, currency)}
          tone={profitTone}
        />
      </div>
    </div>
  )
}

export function IncomeStatement() {
  const { t, formatDate } = useI18n()
  const { timeFilter } = useTimeFilter()

  const query = useQuery({
    queryKey: ['income-statement', timeFilter],
    queryFn: ({ signal }) => fetchIncomeStatement(timeFilter, signal),
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

  if (query.isPending || !query.data) {
    return <Skeleton className="h-96 w-full rounded-lg" />
  }

  const data = query.data
  const hasActivity = data.sections.some((section) =>
    section.children.some((node) => includeNode(section.section, node)),
  )

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
          onClick={() => query.refetch()}
          disabled={query.isFetching}
        >
          <RefreshCwIcon
            data-icon="inline-start"
            className={cn(query.isFetching && 'animate-spin')}
          />
          {t('common.refresh')}
        </Button>
      </div>

      {hasActivity ? (
        <Statement key={timeFilter} data={data} />
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
