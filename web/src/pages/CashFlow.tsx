import { useQuery, useQueryClient } from '@tanstack/react-query'
import { DownloadIcon, RefreshCwIcon, TriangleAlertIcon } from 'lucide-react'

import { OneLine } from '@/components/one-line'
import {
  ComparePanel,
  PeriodAmountCells,
  PeriodColumnHeads,
  PeriodTotals,
  PriorUnavailableAlert,
  StatementTable,
  amountTone,
} from '@/components/period-compare'
import { ReportBar, ReportWhen } from '@/components/report-bar'
import { Empty, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useI18n } from '@/i18n'
import { fetchCashFlow } from '@/lib/api'
import {
  CASH_FLOW_SECTIONS,
  CASH_FLOW_SECTION_NET,
  CASH_FLOW_SECTION_TITLE,
  compareCashFlow,
  linesIn,
  presentedLineAmount,
  type CashFlowComparison,
  type CashFlowStatement,
} from '@/lib/cash-flow'
import { priorPeriod } from '@/lib/ledger-model'
import { exportStatementCsv } from '@/lib/csv'
import { explainFavaError } from '@/lib/fava-error'
import { displayAccountName } from '@/lib/format'
import { formatPeriodLabel } from '@/lib/period-label'
import { shownPrior, useShownTime } from '@/lib/shown-time'
import { cashFlowCsvTable } from '@/lib/statement-csv'
import { useTimeFilter } from '@/lib/time-context'
import { cn } from '@/lib/utils'

function AmountTable({
  rows,
  comparing,
  currentLabel,
  priorLabel,
}: {
  rows: { key: string; label: string; amount: string; prior?: string; delta?: string }[]
  comparing: boolean
  currentLabel: string
  priorLabel: string
}) {
  const { t } = useI18n()
  if (rows.length === 0) return null

  return (
    <StatementTable comparing={comparing}>
      <TableHeader>
        <PeriodColumnHeads
          first={t('cashFlow.item')}
          amountLabel={t('cashFlow.amount')}
          currentLabel={currentLabel}
          priorLabel={priorLabel}
          comparing={comparing}
        />
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.key}>
            <TableCell className="min-w-0 overflow-hidden">
              <OneLine text={row.label} />
            </TableCell>
            <PeriodAmountCells
              current={row.amount}
              prior={row.prior}
              delta={row.delta}
              comparing={comparing}
            />
          </TableRow>
        ))}
      </TableBody>
    </StatementTable>
  )
}

function Statement({
  data,
  comparison,
  currentLabel,
  priorLabel,
}: {
  data: CashFlowStatement
  comparison: CashFlowComparison | null
  currentLabel: string
  priorLabel: string
}) {
  const { t, formatCurrency, formatSignedCurrency } = useI18n()
  const currency = data.operating_currency
  const comparing = comparison != null
  const unassignedRows = comparison
    ? comparison.unassigned.map((row) => ({
        key: row.account,
        label: displayAccountName(row.account),
        amount: formatSignedCurrency(row.current, currency),
        prior: formatSignedCurrency(row.prior, currency),
        delta: formatSignedCurrency(row.current - row.prior, currency),
      }))
    : data.unassigned.map((row) => ({
        key: row.account,
        label: displayAccountName(row.account),
        amount: formatSignedCurrency(row.amount, currency),
      }))
  const netCurrent = comparison ? comparison.net.current : data.net
  const unassignedCurrent = comparison ? comparison.unassignedTotal.current : data.unassignedTotal
  const netTotals = (
    <ComparePanel>
      <PeriodTotals
        label={t('cashFlow.netIncrease')}
        current={formatSignedCurrency(netCurrent, currency)}
        prior={comparison ? formatSignedCurrency(comparison.net.prior, currency) : undefined}
        delta={comparison
          ? formatSignedCurrency(netCurrent - comparison.net.prior, currency)
          : undefined}
        tone={amountTone(netCurrent)}
      />
    </ComparePanel>
  )

  return (
    <div className="flex flex-col gap-6">
      <div className={cn('grid grid-cols-1 items-start gap-6', !comparing && 'lg:grid-cols-3')}>
        {CASH_FLOW_SECTIONS.map((section) => {
          const rows = linesIn(section).flatMap((line) => {
            if (!comparison) {
              const current = presentedLineAmount(line.id, data.lines[line.id])
              if (current === 0) return []
              return [{
                key: line.id,
                label: t(line.label),
                amount: formatCurrency(current, currency),
              }]
            }
            const amounts = comparison.lines[line.id]
            if (amounts.current === 0 && amounts.prior === 0) return []
            const current = presentedLineAmount(line.id, amounts.current)
            const prior = presentedLineAmount(line.id, amounts.prior)
            return [{
              key: line.id,
              label: t(line.label),
              amount: formatCurrency(current, currency),
              prior: formatCurrency(prior, currency),
              delta: formatSignedCurrency(current - prior, currency),
            }]
          })
          const compared = comparison?.sections[section]
          const currentNet = compared ? compared.current : data.sections[section]
          return (
            <section key={section} className="flex min-w-0 flex-col gap-2">
              <h2 className="text-[0.8rem] font-medium">{t(CASH_FLOW_SECTION_TITLE[section])}</h2>
              <ComparePanel>
                <AmountTable
                  rows={rows}
                  comparing={comparing}
                  currentLabel={currentLabel}
                  priorLabel={priorLabel}
                />
                <PeriodTotals
                  label={t(CASH_FLOW_SECTION_NET[section])}
                  current={formatSignedCurrency(currentNet, currency)}
                  prior={compared ? formatSignedCurrency(compared.prior, currency) : undefined}
                  delta={compared
                    ? formatSignedCurrency(currentNet - compared.prior, currency)
                    : undefined}
                />
              </ComparePanel>
            </section>
          )
        })}
      </div>

      {unassignedRows.length > 0 ? (
        <section className="flex min-w-0 flex-col gap-2">
          <h2 className="text-[0.8rem] font-medium">{t('cashFlow.unassigned')}</h2>
          <p className="text-[0.8rem] text-muted-foreground">{t('cashFlow.unassignedHint')}</p>
          <ComparePanel>
            <AmountTable
              comparing={comparing}
              currentLabel={currentLabel}
              priorLabel={priorLabel}
              rows={unassignedRows}
            />
            <PeriodTotals
              label={t('cashFlow.unassigned')}
              current={formatSignedCurrency(unassignedCurrent, currency)}
              prior={comparison ? formatSignedCurrency(comparison.unassignedTotal.prior, currency) : undefined}
              delta={comparison
                ? formatSignedCurrency(unassignedCurrent - comparison.unassignedTotal.prior, currency)
                : undefined}
            />
          </ComparePanel>
        </section>
      ) : null}

      {comparing ? netTotals : (
        <div className="grid grid-cols-1 lg:grid-cols-3 lg:gap-6">
          <div className="lg:col-start-3">{netTotals}</div>
        </div>
      )}
    </div>
  )
}

export function CashFlow() {
  const { t, formatCurrency, formatSignedCurrency } = useI18n()
  const { timeFilter } = useTimeFilter()
  const queryClient = useQueryClient()
  const priorKey = priorPeriod(timeFilter)

  const query = useQuery({
    queryKey: ['cash-flow', timeFilter],
    queryFn: ({ signal }) => fetchCashFlow(timeFilter, signal),
    placeholderData: (previous) => previous,
  })
  const shownTime = useShownTime(timeFilter, query.isPlaceholderData)
  const shownPriorKey = priorPeriod(shownTime)
  const priorQuery = useQuery({
    queryKey: ['cash-flow', priorKey],
    queryFn: ({ signal }) => fetchCashFlow(priorKey as string, signal),
    enabled: priorKey != null,
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

  if (!query.data) {
    return <Skeleton className="h-96 w-full rounded-lg" />
  }

  const data = query.data
  const priorFailed = !query.isPlaceholderData && priorKey != null && priorQuery.isError
  const prior = shownPrior(
    shownPriorKey,
    priorKey,
    priorQuery.data,
    queryClient.getQueryData<CashFlowStatement>(['cash-flow', shownPriorKey]),
  )
  const comparison = prior ? compareCashFlow(data, prior) : null
  const fetching = query.isFetching || priorQuery.isFetching
  const currentLabel = formatPeriodLabel(shownTime, t)
  const priorLabel = shownPriorKey ? formatPeriodLabel(shownPriorKey, t) : ''
  const canExport = !query.isPlaceholderData

  return (
    <div className="flex flex-col gap-6">
      <ReportBar
        status={
          <ReportWhen currency={data.operating_currency}>{currentLabel}</ReportWhen>
        }
        actions={
          <>
            <Button
              variant="outline"
              disabled={!canExport}
              onClick={() => {
                const table = cashFlowCsvTable(
                  data,
                  comparison,
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
                  report: t('cashFlow.title'),
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

      {data.hasCashAccounts ? (
        <Statement
          data={data}
          comparison={comparison}
          currentLabel={currentLabel}
          priorLabel={priorLabel}
        />
      ) : (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>{t('cashFlow.unwiredTitle')}</EmptyTitle>
          </EmptyHeader>
        </Empty>
      )}
    </div>
  )
}
