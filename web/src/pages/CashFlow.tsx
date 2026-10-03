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
import { fetchCashFlow, type CashFlowStatement } from '@/lib/api'
import {
  CASH_FLOW_SECTIONS,
  linesIn,
  presentedLineAmount,
  type CashFlowLineId,
  type CashFlowSection,
} from '@/lib/cash-flow'
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

function TotalLine({ label, amount, tone }: { label: string; amount: string; tone?: string }) {
  return (
    <div className="flex items-start justify-between gap-3 pe-4 text-[0.8rem]">
      <span className="min-w-0 text-muted-foreground">{label}</span>
      <span className={cn('shrink-0 font-medium tabular-nums', tone)}>{amount}</span>
    </div>
  )
}

function AmountTable({
  rows,
}: {
  rows: { key: string; label: string; amount: string }[]
}) {
  const { t } = useI18n()
  if (rows.length === 0) return null

  return (
    <div className="overflow-hidden rounded-lg border bg-card [&_td:last-child]:pe-4 [&_th:last-child]:pe-4">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('cashFlow.item')}</TableHead>
            <TableHead className="w-28 text-right">{t('cashFlow.amount')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.key}>
              <TableCell className="whitespace-normal">{row.label}</TableCell>
              <TableCell className="text-right whitespace-nowrap tabular-nums">{row.amount}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function Statement({ data }: { data: CashFlowStatement }) {
  const { t, formatCurrency, formatSignedCurrency } = useI18n()
  const currency = data.operating_currency
  const netTone = data.net > 0 ? 'text-positive' : data.net < 0 ? 'text-destructive' : undefined

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-3">
        {CASH_FLOW_SECTIONS.map((section) => {
          const rows = linesIn(section)
            .filter((line) => data.lines[line.id] !== 0)
            .map((line) => ({
              key: line.id,
              label: t(LINE_LABEL[line.id]),
              amount: formatCurrency(presentedLineAmount(line.id, data.lines[line.id]), currency),
            }))
          return (
            <section key={section} className="flex min-w-0 flex-col gap-2">
              <h2 className="text-[0.8rem] font-medium">{t(SECTION_TITLE[section])}</h2>
              <AmountTable rows={rows} />
              <TotalLine
                label={t(SECTION_NET[section])}
                amount={formatSignedCurrency(data.sections[section], currency)}
              />
            </section>
          )
        })}
      </div>

      {data.unassigned.length > 0 ? (
        <section className="flex min-w-0 flex-col gap-2">
          <h2 className="text-[0.8rem] font-medium">{t('cashFlow.unassigned')}</h2>
          <AmountTable
            rows={data.unassigned.map((row) => ({
              key: row.account,
              label: displayAccountName(row.account),
              amount: formatSignedCurrency(row.amount, currency),
            }))}
          />
          <TotalLine
            label={t('cashFlow.unassigned')}
            amount={formatSignedCurrency(data.unassignedTotal, currency)}
          />
        </section>
      ) : null}

      <div className="grid grid-cols-1 lg:grid-cols-3 lg:gap-6">
        <div className="lg:col-start-3">
          <TotalLine
            label={t('cashFlow.netIncrease')}
            amount={formatSignedCurrency(data.net, currency)}
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

  const query = useQuery({
    queryKey: ['cash-flow', timeFilter],
    queryFn: ({ signal }) => fetchCashFlow(timeFilter, signal),
  })

  if (query.isError) {
    return (
      <Alert variant="destructive">
        <TriangleAlertIcon />
        <AlertTitle>{t('cashFlow.errorTitle')}</AlertTitle>
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
        <Button variant="outline" onClick={() => query.refetch()} disabled={query.isFetching}>
          <RefreshCwIcon
            data-icon="inline-start"
            className={cn(query.isFetching && 'animate-spin')}
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

      <Statement data={data} />
    </div>
  )
}
