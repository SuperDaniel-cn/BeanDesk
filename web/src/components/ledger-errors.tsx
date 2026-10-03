import { useQuery } from '@tanstack/react-query'
import { TriangleAlertIcon } from 'lucide-react'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { useI18n } from '@/i18n'
import { favaClient } from '@/lib/fava-client'

function sourceLabel(filename: string | undefined, lineno: number | undefined): string | null {
  if (!filename) return null
  return typeof lineno === 'number' ? `${filename}:${lineno}` : filename
}

/** Fava's own error text, shown only when the loaded ledger has some. */
export function LedgerErrors() {
  const { t } = useI18n()
  const query = useQuery({
    queryKey: ['ledger-data'],
    queryFn: ({ signal }) => favaClient.getLedgerData(signal),
  })
  const errors = query.data?.errors ?? []
  if (errors.length === 0) return null

  return (
    <Alert variant="warning">
      <TriangleAlertIcon />
      <AlertTitle>{t('ledger.errorsTitle', { count: errors.length })}</AlertTitle>
      <AlertDescription>
        <ul className="flex flex-col gap-1">
          {errors.map((error, index) => {
            const source = sourceLabel(error.source?.filename, error.source?.lineno)
            return (
              <li key={`${error.message}:${source ?? index}`} className="break-words">
                {error.message}
                {source ? <span className="ms-1 font-mono text-xs">{source}</span> : null}
              </li>
            )
          })}
        </ul>
      </AlertDescription>
    </Alert>
  )
}
