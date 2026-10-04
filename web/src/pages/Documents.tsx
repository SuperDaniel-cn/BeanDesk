import { useQuery } from '@tanstack/react-query'
import { FileTextIcon, SearchIcon, TriangleAlertIcon } from 'lucide-react'
import { useMemo, useState } from 'react'

import { LinkedDocument } from '@/components/linked-document'
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Empty, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
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
import { fetchDocuments, type LedgerDocument } from '@/lib/api'
import { dateInPeriod } from '@/lib/ledger-model'
import { explainFavaError } from '@/lib/fava-error'
import { displayAccountName } from '@/lib/format'
import { useTimeFilter } from '@/lib/time-context'

function fileLeaf(filename: string): string {
  const parts = filename.split('/')
  return parts[parts.length - 1] || filename
}

export function Documents() {
  const { t, formatDate } = useI18n()
  const { timeFilter } = useTimeFilter()
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<LedgerDocument | null>(null)

  const query = useQuery({
    queryKey: ['documents'],
    queryFn: ({ signal }) => fetchDocuments(signal),
  })

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return (query.data ?? [])
      .filter((doc) => dateInPeriod(doc.date, timeFilter))
      .filter((doc) => {
        if (!needle) return true
        return `${doc.filename} ${doc.account}`.toLowerCase().includes(needle)
      })
      .sort((a, b) => b.date.localeCompare(a.date) || a.filename.localeCompare(b.filename))
  }, [query.data, timeFilter, search])

  if (query.isError) {
    return (
      <Alert variant="destructive">
        <TriangleAlertIcon />
        <AlertTitle>{t('documents.errorTitle')}</AlertTitle>
        <AlertDescription>{explainFavaError(query.error, t)}</AlertDescription>
        <AlertAction>
          <Button variant="outline" onClick={() => void query.refetch()}>
            {t('common.retry')}
          </Button>
        </AlertAction>
      </Alert>
    )
  }

  if (query.isPending) {
    return <Skeleton className="h-96 w-full rounded-lg" />
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-2">
        <InputGroup className="w-full max-w-sm">
          <InputGroupAddon>
            <SearchIcon />
          </InputGroupAddon>
          <InputGroupInput
            type="search"
            placeholder={t('documents.searchPlaceholder')}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </InputGroup>
      </div>

      {rows.length === 0 ? (
        <Empty className="border border-dashed">
          <EmptyHeader>
            <EmptyTitle>{t('documents.empty')}</EmptyTitle>
          </EmptyHeader>
        </Empty>
      ) : (
        <>
          <div className="flex flex-col gap-2.5 sm:hidden">
            {rows.map((doc) => (
              <Card key={doc.filename}>
                <CardHeader>
                  <CardTitle>{fileLeaf(doc.filename)}</CardTitle>
                  <CardDescription className="font-mono">{formatDate(doc.date)}</CardDescription>
                  <CardAction>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => setSelected(doc)}
                      title={t('documents.preview')}
                    >
                      <FileTextIcon />
                    </Button>
                  </CardAction>
                </CardHeader>
                <CardContent>
                  <p className="text-xs text-muted-foreground">{displayAccountName(doc.account)}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="hidden overflow-hidden rounded-lg border bg-card sm:block">
            <Table className="table-fixed">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-28">{t('documents.date')}</TableHead>
                  <TableHead>{t('documents.account')}</TableHead>
                  <TableHead>{t('documents.file')}</TableHead>
                  <TableHead className="w-16" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((doc) => (
                  <TableRow
                    key={doc.filename}
                    className="cursor-pointer"
                    onClick={() => setSelected(doc)}
                  >
                    <TableCell className="font-mono">{formatDate(doc.date)}</TableCell>
                    <TableCell>{displayAccountName(doc.account)}</TableCell>
                    <TableCell className="truncate">{fileLeaf(doc.filename)}</TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={(event) => {
                          event.stopPropagation()
                          setSelected(doc)
                        }}
                        title={t('documents.preview')}
                      >
                        <FileTextIcon />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}

      <Dialog open={selected != null} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="w-full max-w-[calc(100%-1.5rem)] max-h-[90vh] overflow-y-auto rounded-2xl p-4 sm:max-w-3xl sm:p-6">
          {selected ? (
            <>
              <DialogHeader>
                <DialogTitle>{fileLeaf(selected.filename)}</DialogTitle>
                <DialogDescription>
                  {formatDate(selected.date)} · {displayAccountName(selected.account)}
                </DialogDescription>
              </DialogHeader>
              <LinkedDocument filename={selected.filename} />
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  )
}
