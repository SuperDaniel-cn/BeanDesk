import type { ReactNode } from 'react'
import { TriangleAlertIcon } from 'lucide-react'

import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { TableCell, TableHead, TableRow } from '@/components/ui/table'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'

const AMOUNT = 'text-right tabular-nums whitespace-nowrap'

export function amountTone(value: number): string | undefined {
  if (value > 0) return 'text-positive'
  if (value < 0) return 'text-destructive'
  return undefined
}

export function ComparePanel({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <div className="flex min-w-full flex-col gap-2">{children}</div>
    </div>
  )
}

export function StatementTable({
  comparing,
  children,
}: {
  comparing: boolean
  children: ReactNode
}) {
  return (
    <div className="rounded-lg border bg-card [&_td:last-child]:pe-4 [&_th:last-child]:pe-4">
      <table className="w-full table-fixed caption-bottom text-[0.8rem]">
        <colgroup>
          <col />
          <col className="w-32" />
          {comparing ? (
            <>
              <col className="w-32" />
              <col className="w-32" />
            </>
          ) : null}
        </colgroup>
        {children}
      </table>
    </div>
  )
}

export function PeriodColumnHeads({
  first,
  amountLabel,
  currentLabel,
  priorLabel,
  comparing,
}: {
  first: string
  amountLabel: string
  currentLabel: string
  priorLabel: string
  comparing: boolean
}) {
  const { t } = useI18n()
  return (
    <TableRow>
      <TableHead>{first}</TableHead>
      <TableHead className="text-right">
        {comparing ? currentLabel : amountLabel}
      </TableHead>
      {comparing ? (
        <>
          <TableHead className="text-right">{priorLabel}</TableHead>
          <TableHead className="text-right">{t('compare.delta')}</TableHead>
        </>
      ) : null}
    </TableRow>
  )
}

export function PeriodAmountCells({
  current,
  prior,
  delta,
  comparing,
}: {
  current: string
  prior?: string
  delta?: string
  comparing: boolean
}) {
  return (
    <>
      <TableCell className={AMOUNT}>{current}</TableCell>
      {comparing ? (
        <>
          <TableCell className={AMOUNT}>{prior}</TableCell>
          <TableCell className={AMOUNT}>{delta}</TableCell>
        </>
      ) : null}
    </>
  )
}

/** Same columns as the table above. Not a table row. */
export function PeriodTotals({
  label,
  current,
  prior,
  delta,
  tone,
}: {
  label: string
  current: string
  prior?: string
  delta?: string
  tone?: string
}) {
  const comparing = prior !== undefined
  return (
    <div
      className={cn(
        'grid w-full items-start text-[0.8rem]',
        comparing
          ? 'grid-cols-[minmax(0,1fr)_8rem_8rem_8rem]'
          : 'grid-cols-[minmax(0,1fr)_8rem]',
      )}
    >
      <span className="min-w-0 px-2 text-muted-foreground">{label}</span>
      <span className={cn(AMOUNT, 'px-2 font-medium', comparing ? undefined : 'pe-4', tone)}>
        {current}
      </span>
      {comparing ? (
        <>
          <span className={cn(AMOUNT, 'px-2 font-medium', tone)}>{prior}</span>
          <span className={cn(AMOUNT, 'ps-2 pe-4 font-medium', tone)}>{delta}</span>
        </>
      ) : null}
    </div>
  )
}

export function PriorUnavailableAlert({ onRetry }: { onRetry: () => void }) {
  const { t } = useI18n()
  return (
    <Alert variant="warning">
      <TriangleAlertIcon />
      <AlertTitle>{t('compare.priorUnavailableTitle')}</AlertTitle>
      <AlertDescription>{t('compare.priorUnavailable')}</AlertDescription>
      <AlertAction>
        <Button variant="outline" onClick={onRetry}>
          {t('common.retry')}
        </Button>
      </AlertAction>
    </Alert>
  )
}
