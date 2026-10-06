import { useState, useMemo, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useLocation, useSearchParams } from 'react-router'
import {
  FileTextIcon,
  SearchIcon,
  RefreshCwIcon,
  TriangleAlertIcon,
  XIcon,
} from 'lucide-react'

import { LinkedDocument } from '@/components/linked-document'

import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { OneLine } from '@/components/one-line'
import { Hint } from '@/components/ui/tooltip'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { Separator } from '@/components/ui/separator'
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Empty, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import {
  fetchTransactions,
  fetchDocuments,
  type PostingItem,
  type TransactionEntry,
} from '@/lib/api'
import { explainFavaError } from '@/lib/fava-error'
import { favaClient } from '@/lib/fava-client'
import {
  JOURNAL_ROOT_FIELDS,
  accountInRoot,
  journalRootValue,
} from '@/lib/journal'
import { rootNames } from '@/lib/ledger-model'
import { useTimeFilter } from '@/lib/time-context'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'

export function Journal() {
  const { t } = useI18n()
  const { pathname } = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()

  const urlAccount = searchParams.get('account') || ''
  const urlTag = searchParams.get('tag') || ''

  const [search, setSearch] = useState('')
  const [selectedRoot, setSelectedRoot] = useState<string>('')
  const [selectedTag, setSelectedTag] = useState<string | null>(urlTag || null)
  const [selectedAccountFilter, setSelectedAccountFilter] = useState<string>(urlAccount)
  const [selectedTx, setSelectedTx] = useState<TransactionEntry | null>(null)

  // Sync state if URL search params change
  useEffect(() => {
    setSelectedAccountFilter(urlAccount)
    setSelectedTag(urlTag || null)
  }, [urlAccount, urlTag])

  useEffect(() => {
    if (pathname !== '/journal') setSelectedTx(null)
  }, [pathname])

  const { timeFilter } = useTimeFilter()
  const ledger = useQuery({
    queryKey: ['ledger-data'],
    queryFn: ({ signal }) => favaClient.getLedgerData(signal),
  })
  const rootFilters = JOURNAL_ROOT_FIELDS.map(({ key, field }) => ({
    key,
    value: journalRootValue(rootNames(ledger.data?.options), field),
  }))
  const activeRoot = rootFilters.some((filter) => filter.value === selectedRoot) ? selectedRoot : ''
  const { data: journal, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['transactions', timeFilter],
    queryFn: () => fetchTransactions(timeFilter),
  })
  const transactions = journal?.entries

  const allAccounts = ledger.data?.accounts ?? []

  const { data: allDocuments = [] } = useQuery({
    queryKey: ['documents'],
    queryFn: ({ signal }) => fetchDocuments(signal),
  })

  // Extract all unique tags
  const allTags = useMemo(() => {
    if (!transactions) return []
    const tagSet = new Set<string>()
    for (const tx of transactions) {
      for (const tag of tx.tags) {
        tagSet.add(tag)
      }
    }
    return Array.from(tagSet)
  }, [transactions])

  // Filtered transactions
  const filtered = useMemo(() => {
    if (!transactions) return []
    const needle = search.toLowerCase()
    return transactions.filter((tx) => {
      const matchSearch =
        needle === '' ||
        tx.payee.toLowerCase().includes(needle) ||
        tx.narration.toLowerCase().includes(needle) ||
        tx.postings.some((p) => p.account.toLowerCase().includes(needle))
      const matchTag = !selectedTag || tx.tags.includes(selectedTag)
      const matchRoot =
        !activeRoot || tx.postings.some((posting) => accountInRoot(posting.account, activeRoot))
      const matchAccount =
        !selectedAccountFilter ||
        tx.postings.some((posting) => accountInRoot(posting.account, selectedAccountFilter))
      return matchSearch && matchTag && matchRoot && matchAccount
    })
  }, [transactions, search, selectedTag, activeRoot, selectedAccountFilter])

  const clearDrillFilter = () => {
    setSelectedAccountFilter('')
    setSelectedTag(null)
    setSearchParams({})
  }

  const currentTxDoc = useMemo(() => {
    if (!selectedTx || allDocuments.length === 0) return null
    const matched = allDocuments.find(
      (doc) =>
        selectedTx.links.some((link) => doc.filename.includes(link)) ||
        (doc.date === selectedTx.date &&
          selectedTx.postings.some((posting) => posting.account === doc.account)),
    )
    return matched?.filename ?? null
  }, [selectedTx, allDocuments])

  return (
    <div className="flex flex-col gap-6">
      {/* Drill-through banner if active */}
      {selectedAccountFilter && (
        <Alert>
          <AlertTitle>{t('journal.drillTitle')}</AlertTitle>
          <AlertDescription>
            <code className="font-mono">{selectedAccountFilter}</code>
          </AlertDescription>
          <AlertAction>
            <Button variant="outline" onClick={clearDrillFilter}>
              <XIcon data-icon="inline-start" />
              {t('journal.clearFilter')}
            </Button>
          </AlertAction>
        </Alert>
      )}

      <Tabs
        value={activeRoot || 'all'}
        onValueChange={(value) => setSelectedRoot(value === 'all' ? '' : value)}
        className="gap-4"
      >
        <TabsList variant="line" aria-label={t('journal.rootLabel')} className="max-sm:w-full">
          {rootFilters.map(({ key, value }) => (
            <TabsTrigger key={key} value={value || 'all'}>
              {t(key)}
            </TabsTrigger>
          ))}
        </TabsList>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-[0.8rem] text-muted-foreground">
          {t('journal.listTitle', { count: filtered.length })}
        </p>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
            <InputGroup className="w-full sm:w-64">
              <InputGroupAddon>
                <SearchIcon />
              </InputGroupAddon>
              <InputGroupInput
                type="search"
                list="accounts-datalist"
                placeholder={t('journal.searchPlaceholder')}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <datalist id="accounts-datalist">
                {allAccounts.map((acc) => (
                  <option key={acc} value={acc} />
                ))}
              </datalist>
            </InputGroup>
            {allTags.length > 0 ? (
              <Select
                value={selectedTag ?? 'all'}
                onValueChange={(value) => setSelectedTag(value === 'all' ? null : value)}
              >
                <SelectTrigger aria-label={t('journal.tagsLabel')} className="w-full sm:w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="all">{t('journal.allTags')}</SelectItem>
                    {allTags.map((tag) => (
                      <SelectItem key={tag} value={tag}>
                        {tag}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            ) : null}
            <Button variant="outline" onClick={() => refetch()} disabled={isFetching}>
              {isFetching ? <Spinner data-icon="inline-start" /> : <RefreshCwIcon data-icon="inline-start" />}
              {t('common.refresh')}
            </Button>
        </div>
      </div>
      {journal?.truncated ? (
        <p className="text-[0.8rem] text-muted-foreground">{t('journal.truncated')}</p>
      ) : null}
      {!isError && !isLoading && filtered.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>{t('journal.emptyTitle')}</EmptyTitle>
          </EmptyHeader>
        </Empty>
      ) : (
      <div className="overflow-hidden rounded-lg border bg-card">
          {isError ? (
            <Alert variant="destructive" className="m-3">
              <TriangleAlertIcon />
              <AlertTitle>{t('journal.errorTitle')}</AlertTitle>
              <AlertDescription>{explainFavaError(error, t)}</AlertDescription>
              <AlertAction>
                <Button variant="outline" onClick={() => void refetch()}>
                  {t('common.retry')}
                </Button>
              </AlertAction>
            </Alert>
          ) : isLoading ? (
            <div className="flex flex-col gap-2 p-3">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : (
            <>
              <div className="flex flex-col gap-2.5 p-3 sm:hidden">
                {filtered.map((tx) => (
                  <Card key={`mob-${tx.id}`}>
                    <CardHeader>
                      <CardTitle>{tx.payee}</CardTitle>
                      <CardDescription className="font-mono">{tx.date}</CardDescription>
                      <CardAction>
                        <Hint label={t('journal.viewDocument')}>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => setSelectedTx(tx)}
                            aria-label={t('journal.viewDocument')}
                          >
                            <FileTextIcon />
                          </Button>
                        </Hint>
                      </CardAction>
                    </CardHeader>
                    <CardContent className="flex flex-col gap-2">
                      <p className="text-xs text-muted-foreground">{tx.narration}</p>
                      <TagList tags={tx.tags} />
                      <TAccount postings={tx.postings} />
                    </CardContent>
                  </Card>
                ))}
              </div>

              <div className="hidden sm:block">
                <Table className="table-fixed">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-28">{t('journal.date')}</TableHead>
                      <TableHead className="w-40">{t('journal.payee')}</TableHead>
                      <TableHead>{t('journal.narration')}</TableHead>
                      <TableHead className="w-[26%]">{t('journal.debit')}</TableHead>
                      <TableHead className="w-[26%] border-l">{t('journal.credit')}</TableHead>
                      <TableHead className="w-16 text-center">{t('journal.document')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((tx) => {
                      const { debit, credit } = splitPostings(tx.postings)
                      return (
                      <TableRow key={tx.id}>
                        <TableCell className="align-top font-mono text-xs text-muted-foreground">
                          {tx.date}
                        </TableCell>
                        <TableCell className="max-w-40 overflow-hidden align-top font-medium">
                          <OneLine text={tx.payee} />
                        </TableCell>
                        <TableCell className="overflow-hidden align-top">
                          <div className="flex min-w-0 flex-col gap-1">
                            {tx.narration ? <OneLine text={tx.narration} /> : null}
                            <TagList tags={tx.tags} />
                          </div>
                        </TableCell>
                        <TableCell className="w-[26%] overflow-hidden align-top">
                          <PostingStack postings={debit} />
                        </TableCell>
                        <TableCell className="w-[26%] overflow-hidden align-top border-l">
                          {debit.length > 0 ? <PostingOffset /> : null}
                          <PostingStack postings={credit} />
                        </TableCell>
                        <TableCell className="align-top p-1 text-center">
                          <Hint label={t('journal.viewDocument')}>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              onClick={() => setSelectedTx(tx)}
                              aria-label={t('journal.viewDocument')}
                            >
                              <FileTextIcon />
                            </Button>
                          </Hint>
                        </TableCell>
                      </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>
          </>
        )}
      </div>
      )}
      </Tabs>

      {/* Centered Modal / Dialog for Selected Transaction & Documents */}
      <Dialog open={!!selectedTx} onOpenChange={(open) => !open && setSelectedTx(null)}>
        <DialogContent className="w-full max-w-[calc(100%-1.5rem)] min-w-0 sm:max-w-3xl max-h-[90vh] overflow-y-auto p-4 sm:p-6 rounded-2xl">
          {selectedTx && (
            <>
              <DialogHeader>
                <DialogTitle>{t('journal.dialogTitle')}</DialogTitle>
                <DialogDescription>
                  {t('journal.dialogMeta', { date: selectedTx.date })}
                </DialogDescription>
              </DialogHeader>

              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-1">
                  <span className="text-xs text-muted-foreground">{t('journal.payee')}</span>
                  <span className="text-base font-semibold">{selectedTx.payee}</span>
                </div>
                <Separator />
                <div className="flex flex-col gap-1">
                  <span className="text-xs text-muted-foreground">{t('journal.narration')}</span>
                  <p className="font-medium">{selectedTx.narration}</p>
                </div>
                <Separator />
                <TAccount postings={selectedTx.postings} />
                <Separator />

                <LinkedDocument filename={currentTxDoc} />
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

function postingTone(account: string) {
  if (account.startsWith('Income')) return 'positive'
  if (account.startsWith('Expenses')) return 'destructive'
  return null
}

function splitPostings(postings: PostingItem[]) {
  const debit: PostingItem[] = []
  const credit: PostingItem[] = []
  for (const posting of postings) {
    const line = { ...posting, amount: Math.abs(posting.amount) }
    if (posting.amount < 0) credit.push(line)
    else debit.push(line)
  }
  return { debit, credit }
}

function TagList({ tags }: { tags: string[] }) {
  if (tags.length === 0) return null
  return (
    <div className="flex flex-wrap gap-1">
      {tags.map((tag) => (
        <Badge key={tag} variant="outline">
          #{tag}
        </Badge>
      ))}
    </div>
  )
}

function PostingStack({ postings }: { postings: PostingItem[] }) {
  const { formatCurrency } = useI18n()
  return (
    <div className="flex min-w-0 flex-col gap-1">
      {postings.map((posting, index) => {
        const tone = postingTone(posting.account)
        return (
          <div
            key={index}
            className={cn(
              'flex min-w-0 items-baseline justify-between gap-3 rounded-md px-1.5 py-0.5',
              tone === 'positive' && 'bg-positive/10',
              tone === 'destructive' && 'bg-destructive/10',
            )}
          >
            <OneLine text={posting.account} className="font-mono text-xs text-muted-foreground" />
            <span
              className={cn(
                'shrink-0 font-mono text-xs tabular-nums',
                tone === 'positive' && 'text-positive',
                tone === 'destructive' && 'text-destructive',
              )}
            >
              {formatCurrency(posting.amount, posting.currency)}
            </span>
          </div>
        )
      })}
    </div>
  )
}

function PostingOffset() {
  return <div className="h-6" aria-hidden="true" />
}

function TAccount({ postings }: { postings: PostingItem[] }) {
  const { t } = useI18n()
  const { debit, credit } = splitPostings(postings)
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t('journal.debit')}</TableHead>
          <TableHead className="border-l">{t('journal.credit')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow>
          <TableCell className="w-1/2 max-w-0 align-top">
            <PostingStack postings={debit} />
          </TableCell>
          <TableCell className="w-1/2 max-w-0 align-top border-l">
            {debit.length > 0 ? <PostingOffset /> : null}
            <PostingStack postings={credit} />
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>
  )
}
