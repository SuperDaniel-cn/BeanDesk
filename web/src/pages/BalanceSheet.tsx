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
import type { MessageKey } from '@/i18n/locales/en'
import { useTimeFilter } from '@/lib/time-context'
import {
  fetchBalanceSheet,
  type AccountNode,
  type BalanceSheet as BalanceSheetData,
  type BalanceSheetSection,
  type StatementSection,
} from '@/lib/api'
import { explainFavaError } from '@/lib/fava-error'
import { displayAccountName, toDisplay } from '@/lib/format'
import { cn } from '@/lib/utils'

/**
 * Beancount stores liabilities and equity as credits, so those figures are
 * negative. Flip them for the statement: assets = liabilities + equity, all positive.
 */
function present(section: StatementSection, raw: number): number {
  return section === 'assets' ? raw : toDisplay(raw)
}

/** Currency-conversion plugs are not equity of the company. */
function isCurrencyPlug(account: string): boolean {
  return /:(?:Conversions|Unrealized)(?::|$)/.test(account)
}

function includeNode(section: StatementSection, node: AccountNode): boolean {
  if (isCurrencyPlug(node.account)) return false
  return present(section, node.total) !== 0
}

interface AccountLine {
  node: AccountNode
  depth: number
  open: boolean
  hasChildren: boolean
}

const NO_ACCOUNTS: AccountNode[] = []

function sectionChildren(sections: BalanceSheetSection[], name: StatementSection): AccountNode[] {
  return sections.find((section) => section.section === name)?.children ?? NO_ACCOUNTS
}

function flatten(
  nodes: AccountNode[],
  expanded: Set<string>,
  section: StatementSection,
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

/** Open every account that still has a balance underneath it. */
function defaultExpanded(sections: BalanceSheetSection[]): Set<string> {
  const open = new Set<string>()
  const walk = (nodes: AccountNode[], section: StatementSection): boolean => {
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

function accountTitle(
  node: AccountNode,
  t: (key: MessageKey, vars?: Record<string, string | number>) => string,
): string {
  if (node.label_key) return t('balanceSheet.unclosedEarnings')
  if (node.name === 'Earnings') return t('balanceSheet.earnings')
  return displayAccountName(node.name)
}

function LineRow({
  line,
  section,
  currency,
  onToggle,
}: {
  line: AccountLine
  section: StatementSection
  currency: string
  onToggle: (account: string) => void
}) {
  const { t, formatCurrency } = useI18n()
  const value = present(section, line.node.total)
  const title = accountTitle(line.node, t)

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
            {!line.node.label_key && (
              <Button variant="ghost" size="icon-xs" asChild>
                <Link
                  to={`/journal?account=${encodeURIComponent(line.node.account)}`}
                  aria-label={t('balanceSheet.journalLink', { account: title })}
                >
                  <ExternalLinkIcon />
                </Link>
              </Button>
            )}
          </span>
        </span>
      </TableCell>
      <TableCell className="w-32 text-right tabular-nums">
        {formatCurrency(value, currency)}
      </TableCell>
    </TableRow>
  )
}

function TotalLine({ label, amount }: { label: string; amount: string }) {
  return (
    <div className="flex items-center justify-between gap-3 pe-4 text-[0.8rem]">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium tabular-nums">{amount}</span>
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
  section: StatementSection
  lines: AccountLine[]
  currency: string
  onToggle: (account: string) => void
  totalLabel?: string
  total?: string
}) {
  const { t } = useI18n()

  return (
    <section className="flex min-w-0 flex-col gap-2">
      <h2 className="text-[0.8rem] font-medium">{title}</h2>
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
      {totalLabel && total ? <TotalLine label={totalLabel} amount={total} /> : null}
    </section>
  )
}

function AccountForm({ data }: { data: BalanceSheetData }) {
  const { t, formatCurrency } = useI18n()
  const currency = data.operating_currency
  const [expanded, setExpanded] = useState<Set<string>>(() => defaultExpanded(data.sections))

  const assetLines = useMemo(
    () => flatten(sectionChildren(data.sections, 'assets'), expanded, 'assets'),
    [data.sections, expanded],
  )
  const liabilityLines = useMemo(
    () => flatten(sectionChildren(data.sections, 'liabilities'), expanded, 'liabilities'),
    [data.sections, expanded],
  )
  const equityLines = useMemo(
    () => flatten(sectionChildren(data.sections, 'equity'), expanded, 'equity'),
    [data.sections, expanded],
  )

  function toggle(account: string) {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(account)) next.delete(account)
      else next.add(account)
      return next
    })
  }

  const assetAmount = present('assets', data.totals.assets)
  const liabilityAmount = present('liabilities', data.totals.liabilities)
  const equityAmount = present('equity', data.totals.equity)
  const assetTotal = formatCurrency(assetAmount, currency)
  const liabilityTotal = formatCurrency(liabilityAmount, currency)
  const equityTotal = formatCurrency(equityAmount, currency)
  const liabilitiesAndEquity = formatCurrency(liabilityAmount + equityAmount, currency)

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 items-start gap-6 md:grid-cols-2">
        <AccountSection
          title={t('balanceSheet.assets')}
          section="assets"
          lines={assetLines}
          currency={currency}
          onToggle={toggle}
        />
        <div className="flex min-w-0 flex-col gap-6">
          <AccountSection
            title={t('balanceSheet.liabilities')}
            section="liabilities"
            lines={liabilityLines}
            currency={currency}
            onToggle={toggle}
            totalLabel={t('balanceSheet.totalLiabilities')}
            total={liabilityTotal}
          />
          <AccountSection
            title={t('balanceSheet.equity')}
            section="equity"
            lines={equityLines}
            currency={currency}
            onToggle={toggle}
            totalLabel={t('balanceSheet.totalEquity')}
            total={equityTotal}
          />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-2 md:grid-cols-2 md:gap-6">
        <TotalLine label={t('balanceSheet.totalAssets')} amount={assetTotal} />
        <TotalLine label={t('balanceSheet.totalLiabilitiesAndEquity')} amount={liabilitiesAndEquity} />
      </div>
    </div>
  )
}

export function BalanceSheet() {
  const { t, formatDate } = useI18n()
  const { timeFilter } = useTimeFilter()

  const query = useQuery({
    queryKey: ['balance-sheet', timeFilter],
    queryFn: ({ signal }) => fetchBalanceSheet(timeFilter, signal),
  })

  if (query.isError) {
    return (
      <Alert variant="destructive">
        <TriangleAlertIcon />
        <AlertTitle>{t('balanceSheet.errorTitle')}</AlertTitle>
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
  const hasBalances = data.sections.some((section) =>
    section.children.some((node) => includeNode(section.section, node)),
  )

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {data.as_of ? (
          <Badge variant="outline">{t('common.asOf', { date: formatDate(data.as_of) })}</Badge>
        ) : null}
        <Badge variant="outline">{data.operating_currency}</Badge>
        <Badge variant={data.totals.balanced ? 'positive' : 'destructive'}>
          {data.totals.balanced ? t('balanceSheet.balanced') : t('balanceSheet.unbalanced')}
        </Badge>
        <Button variant="outline" onClick={() => query.refetch()} disabled={query.isFetching}>
          <RefreshCwIcon
            data-icon="inline-start"
            className={cn(query.isFetching && 'animate-spin')}
          />
          {t('common.refresh')}
        </Button>
      </div>

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

      {!hasBalances ? (
        <Empty className="border border-dashed">
          <EmptyHeader>
            <EmptyTitle>{t('balanceSheet.empty')}</EmptyTitle>
          </EmptyHeader>
        </Empty>
      ) : (
        <AccountForm key={timeFilter} data={data} />
      )}
    </div>
  )
}
