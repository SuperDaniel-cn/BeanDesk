import type { RootNames } from './ledger-model'
import type { PostingItem, TransactionEntry } from './fava-client'
import type { MessageKey } from '@/i18n/locales/en'

/** Postings fetched for one period. The period is the bound; this only stops a runaway query. */
export const JOURNAL_POSTING_CAP = 5000

export interface JournalPage {
  entries: TransactionEntry[]
  truncated: boolean
}

export function journalQuery(cap = JOURNAL_POSTING_CAP): string {
  return `
      SELECT id, date, flag, payee, narration, account, units(position) as units, tags, links
      ORDER BY date DESC
      LIMIT ${cap + 1}
    `
}

/**
 * Group posting rows into transactions. A result longer than `cap` is truncated:
 * the last transaction id inside the cap is dropped because its postings may have
 * been cut in half. The caller asked for `cap + 1` rows so equality with the cap
 * is not treated as a full book.
 */
export function assembleJournalRows(
  rows: unknown[][],
  currency: string,
  cap = JOURNAL_POSTING_CAP,
): JournalPage {
  const truncated = rows.length > cap
  let source = truncated ? rows.slice(0, cap) : rows
  if (truncated && source.length > 0) {
    const tailId = String(source[source.length - 1]?.[0] ?? '')
    const withoutTail = source.filter((row) => String(row[0] ?? '') !== tailId)
    if (withoutTail.length > 0) source = withoutTail
  }

  const map = new Map<string, TransactionEntry>()
  for (const row of source) {
    const [id, date, flag, payee, narration, account, units, tags, links] = row
    const amount = units as { number?: number; currency?: string } | null
    const posting: PostingItem = {
      account: String(account),
      amount: amount?.number ?? 0,
      currency: amount?.currency ?? currency,
    }
    const entryId = String(id)
    let tx = map.get(entryId)
    if (!tx) {
      tx = {
        id: entryId,
        date: String(date),
        flag: String(flag || '*'),
        payee: String(payee || '—'),
        narration: String(narration || ''),
        postings: [],
        tags: Array.isArray(tags) ? tags.map(String) : [],
        links: Array.isArray(links) ? links.map(String) : [],
      }
      map.set(entryId, tx)
    }
    tx.postings.push(posting)
  }

  return { entries: Array.from(map.values()), truncated }
}

type RootField = keyof RootNames

export const JOURNAL_ROOT_FIELDS: Array<{ key: MessageKey; field: RootField | null }> = [
  { key: 'journal.roots.all', field: null },
  { key: 'journal.roots.assets', field: 'assets' },
  { key: 'journal.roots.liabilities', field: 'liabilities' },
  { key: 'journal.roots.income', field: 'income' },
  { key: 'journal.roots.expenses', field: 'expenses' },
  { key: 'journal.roots.equity', field: 'equity' },
]

export function journalRootValue(names: RootNames, field: RootField | null): string {
  return field == null ? '' : names[field]
}

export function accountInRoot(account: string, root: string): boolean {
  return account === root || account.startsWith(`${root}:`)
}
