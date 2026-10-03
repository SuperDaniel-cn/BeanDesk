import { useQuery } from '@tanstack/react-query'
import { RefreshCwIcon, TriangleAlertIcon } from 'lucide-react'

import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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
import { fetchCashFlow } from '@/lib/api'
import {
  CASH_FLOW_SECTIONS,
  compareCashFlow,
  linesIn,
  presentedLineAmount,
  type CashFlowComparison,
  type CashFlowLineId,
  type CashFlowSection,
  type CashFlowStatement,
} from '@/lib/cash-flow'
import { priorPeriod } from '@/lib/ledger-model'
import { explainFavaError } from '@/lib/fava-error'
import { displayAccountName } from '@/lib/format'
import { useTimeFilter } from '@/lib/time-context'
import { cn } from '@/lib/utils'

const SECTION_TITLE: Record<CashFlowSection, MessageKey> = {
  operating: 'cashFlow.operating',
  investing: 'cashFlow.investing',
  financing: 'cashFlow.financing',
}

const SECTION_NET: Record<CashFlowSection, MessageKey> = {
  operating: 'cashFlow.operatingNet',
  investing: 'cashFlow.investingNet',
  financing: 'cashFlow.financingNet',
}

const LINE_LABEL: Record<CashFlowLineId, MessageKey> = {
  sales: 'cashFlow.lines.sales',
  'operating-other-in': 'cashFlow.lines.operating-other-in',
  purchases: 'cashFlow.lines.purchases',
  wages: 'cashFlow.lines.wages',
  taxes: 'cashFlow.lines.taxes',
  'operating-other-out': 'cashFlow.lines.operating-other-out',
  'investment-proceeds': 'cashFlow.lines.investment-proceeds',
  'investment-income': 'cashFlow.lines.investment-income',
  'asset-disposal': 'cashFlow.lines.asset-disposal',
  'investment-acquire': 'cashFlow.lines.investment-acquire',
  capex: 'cashFlow.lines.capex',
  borrowings: 'cashFlow.lines.borrowings',
  capital: 'cashFlow.lines.capital',
  'debt-principal': 'cashFlow.lines.debt-principal',
  'debt-interest': 'cashFlow.lines.debt-interest',
  dividends: 'cashFlow.lines.dividends',
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
    <div className="flex items-start justify-between gap-3 pe-4 text-[0.8rem]">
      <span className="min-w-0 text-muted-foreground">{label}</span>
      <span className="flex shrink-0 gap-3">
        <span className={cn('font-medium tabular-nums', tone)}>{amount}</span>
        {prior != null ? <span className="w-24 text-right font-medium tabular-nums">{prior}</span> : null}
        {delta != null ? <span className={cn('w-24 text-right font-medium tabular-nums', tone)}>{delta}</span> : null}
      </span>
    </div>
  )
}

function AmountTable({
  rows,
  comparing,
}: {
  rows: { key: string; label: string; amount: string; prior?: string; delta?: string }[]
  comparing: boolean
}) {
  const { t } = useI18n()
  if (rows.length === 0) return null

  return (
    <div className="overflow-x-auto rounded-lg border bg-card [&_td:last-child]:pe-4 [&_th:last-child]:pe-4">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('cashFlow.item')}</TableHead>
            <TableHead className="w-28 text-right">
              {comparing ? t('compare.current') : t('cashFlow.amount')}
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
          {rows.map((row) => (
            <TableRow key={row.key}>
              <TableCell className="whitespace-normal">{row.label}</TableCell>
              <TableCell className="text-right whitespace-nowrap tabular-nums">{row.amount}</TableCell>
              {comparing ? (
                <>
                  <TableCell className="text-right whitespace-nowrap tabular-nums">{row.prior}</TableCell>
                  <TableCell className="text-right whitespace-nowrap tabular-nums">{row.delta}</TableCell>
                </>
              ) : null}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function Statement({
  data,
  comparison,
}: {
  data: CashFlowStatement
  comparison: CashFlowComparison | null
}) {
  const { t, formatCurrency, formatSignedCurrency } = useI18n()
  const currency = data.operating_currency
  const net = comparison ? comparison.net : { current: data.net, prior: 0 }
  const netTone = net.current > 0 ? 'text-positive' : net.current < 0 ? 'text-destructive' : undefined
  const unassigned = comparison
    ? comparison.unassigned
    : data.unassigned.map((row) => ({ account: row.account, current: row.amount, prior: 0 }))
  const unassignedTotal = comparison
    ? comparison.unassignedTotal
    : { current: data.unassignedTotal, prior: 0 }

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-3">
        {CASH_FLOW_SECTIONS.map((section) => {
          const sectionAmounts = comparison
            ? comparison.sections[section]
            : { current: data.sections[section], prior: 0 }
          const rows = linesIn(section).flatMap((line) => {
            const amounts = comparison
              ? comparison.lines[line.id]
              : { current: data.lines[line.id], prior: 0 }
            if (amounts.current === 0 && amounts.prior === 0) return []
            const current = presentedLineAmount(line.id, amounts.current)
            const prior = presentedLineAmount(line.id, amounts.prior)
            return [{
              key: line.id,
              label: t(LINE_LABEL[line.id]),
              amount: formatCurrency(current, currency),
              prior: formatCurrency(prior, currency),
              delta: formatSignedCurrency(current - prior, currency),
            }]
          })
          return (
            <section key={section} className="flex min-w-0 flex-col gap-2">
              <h2 className="text-[0.8rem] font-medium">{t(SECTION_TITLE[section])}</h2>
              <AmountTable rows={rows} comparing={comparison != null} />
              <TotalLine
                label={t(SECTION_NET[section])}
                amount={formatSignedCurrency(sectionAmounts.current, currency)}
                prior={comparison ? formatSignedCurrency(sectionAmounts.prior, currency) : undefined}
                delta={comparison ? formatSignedCurrency(sectionAmounts.current - sectionAmounts.prior, currency) : undefined}
              />
            </section>
          )
        })}
      </div>

      {unassigned.length > 0 ? (
        <section className="flex min-w-0 flex-col gap-2">
          <h2 className="text-[0.8rem] font-medium">{t('cashFlow.unassigned')}</h2>
          <AmountTable
            comparing={comparison != null}
            rows={unassigned.map((row) => ({
              key: row.account,
              label: displayAccountName(row.account),
              amount: formatSignedCurrency(row.current, currency),
              prior: formatSignedCurrency(row.prior, currency),
              delta: formatSignedCurrency(row.current - row.prior, currency),
            }))}
          />
          <TotalLine
            label={t('cashFlow.unassigned')}
            amount={formatSignedCurrency(unassignedTotal.current, currency)}
            prior={comparison ? formatSignedCurrency(unassignedTotal.prior, currency) : undefined}
            delta={comparison ? formatSignedCurrency(unassignedTotal.current - unassignedTotal.prior, currency) : undefined}
          />
        </section>
      ) : null}

      <div className="grid grid-cols-1 lg:grid-cols-3 lg:gap-6">
        <div className="lg:col-start-3">
          <TotalLine
            label={t('cashFlow.netIncrease')}
            amount={formatSignedCurrency(net.current, currency)}
            prior={comparison ? formatSignedCurrency(net.prior, currency) : undefined}
            delta={comparison ? formatSignedCurrency(net.current - net.prior, currency) : undefined}
            tone={netTone}
          />
        </div>
      </div>
    </div>
  )
}

export function CashFlow() {
  const { t, formatDate } = useI18n()
  const { timeFilter } = useTimeFilter()
  const priorKey = priorPeriod(timeFilter)

  const query = useQuery({
    queryKey: ['cash-flow', timeFilter],
    queryFn: ({ signal }) => fetchCashFlow(timeFilter, signal),
  })
  const priorQuery = useQuery({
    queryKey: ['cash-flow', priorKey],
    queryFn: ({ signal }) => fetchCashFlow(priorKey as string, signal),
    enabled: priorKey != null,
  })

  if (query.isError || (priorKey != null && priorQuery.isError)) {
    const error = query.isError ? query.error : priorQuery.error
    return (
      <Alert variant="destructive">
        <TriangleAlertIcon />
        <AlertTitle>{t('cashFlow.errorTitle')}</AlertTitle>
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
  const comparison = priorKey != null && priorQuery.data ? compareCashFlow(data, priorQuery.data) : null
  const fetching = query.isFetching || priorQuery.isFetching

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {data.period ? (
          <Badge variant="outline">
            {t('cashFlow.period', {
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

      {data.unconverted_currencies.length > 0 ? (
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
      ) : null}

      <Statement data={data} comparison={comparison} />
    </div>
  )
}
