import { describe, expect, test } from 'bun:test'

import {
  JOURNAL_POSTING_CAP,
  accountInRoot,
  assembleJournalRows,
  journalQuery,
  journalRootValue,
} from './journal'
import { rootNames } from './ledger-model'

function row(id: string, account = 'Assets:Bank') {
  return [id, '2026-01-01', '*', 'Payee', 'Narration', account, { number: 1, currency: 'CNY' }, [], []]
}

describe('journalQuery', () => {
  test('asks for the safety cap plus one row, not the old 200-transaction slice', () => {
    const query = journalQuery()
    expect(query).toContain(`LIMIT ${JOURNAL_POSTING_CAP + 1}`)
    expect(query).not.toContain('LIMIT 200')
    expect(query).not.toContain('LIMIT 600')
    expect(JOURNAL_POSTING_CAP).toBeGreaterThan(200)
  })
})

describe('assembleJournalRows', () => {
  test('keeps every transaction that fits under the cap', () => {
    const rows = Array.from({ length: 250 }, (_, index) => row(`txn-${index}`))
    const page = assembleJournalRows(rows, 'CNY', JOURNAL_POSTING_CAP)
    expect(page.truncated).toBe(false)
    expect(page.entries).toHaveLength(250)
    expect(page.entries[0]?.postings).toHaveLength(1)
  })

  test('marks a cut-off result and drops the transaction split by the cap', () => {
    const page = assembleJournalRows([row('a'), row('b'), row('c')], 'CNY', 2)
    expect(page.truncated).toBe(true)
    expect(page.entries.map((entry) => entry.id)).toEqual(['a'])
  })
})

describe('journal roots', () => {
  test('uses the ledger root name', () => {
    const names = rootNames({ name_assets: 'Activos', name_income: 'Ingresos' })
    expect(journalRootValue(names, 'assets')).toBe('Activos')
    expect(journalRootValue(names, 'income')).toBe('Ingresos')
    expect(journalRootValue(names, null)).toBe('')
  })

  test('matches an account only on that root', () => {
    expect(accountInRoot('Activos:Bank', 'Activos')).toBe(true)
    expect(accountInRoot('Activos', 'Activos')).toBe(true)
    expect(accountInRoot('ActivosExtra', 'Activos')).toBe(false)
    expect(accountInRoot('Assets:Banking', 'Assets:Bank')).toBe(false)
    expect(accountInRoot('Assets:Bank:Checking', 'Assets:Bank')).toBe(true)
  })
})
