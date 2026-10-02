/**
 * Typed client adapting native Fava APIs and BQL queries into UI models.
 * Zero custom backend: runs purely over the local Fava core.
 */

import { classifyCashFlow, readAccountCashMeta, type CashPosting } from './cash-flow'
import { favaClient, type FavaAccountDetail, type LedgerDocument, type TransactionEntry } from './fava-client'
import {
  asOfFromDateRange,
  buildBalanceSheet,
  buildIncomeStatement,
  buildTrialBalance,
  operatingCurrency,
  quoteCommodity,
  readInventory,
  rootNames,
  type FavaTreeReport,
  type StatementPeriod,
} from './ledger-model'

export type { CashFlowStatement } from './cash-flow'
export type {
  AccountNode,
  BalanceSheet,
  BalanceSheetSection,
  IncomeStatement,
  IncomeStatementSection,
  StatementSection,
  TrialBalance,
  TrialBalanceSection,
} from './ledger-model'

async function ledgerContext(signal?: AbortSignal) {
  const ledger = await favaClient.getLedgerData(signal)
  return {
    ledger,
    currency: operatingCurrency(ledger.options.operating_currency),
    names: rootNames(ledger.options),
  }
}

async function latestDate(signal?: AbortSignal): Promise<string | null> {
  try {
    const result = await favaClient.query('SELECT max(date)', undefined, signal)
    const value = result.rows?.[0]?.[0]
    return value ? String(value) : null
  } catch {
    return null
  }
}

async function asOfFallback(report: FavaTreeReport, signal?: AbortSignal): Promise<string | null> {
  if (asOfFromDateRange(report.date_range)) return null
  return latestDate(signal)
}

/** All-time income statements omit `date_range`. The activity span is the period. */
async function activityPeriod(signal?: AbortSignal): Promise<StatementPeriod | null> {
  try {
    const result = await favaClient.query('SELECT min(date), max(date)', undefined, signal)
    const from = result.rows?.[0]?.[0]
    const to = result.rows?.[0]?.[1]
    if (!from || !to) return null
    return { from: String(from), to: String(to) }
  } catch {
    return null
  }
}

export async function fetchBalanceSheet(time?: string, signal?: AbortSignal) {
  const { currency, names } = await ledgerContext(signal)
  const report = (await favaClient.getBalanceSheet(time, currency, signal)) as FavaTreeReport
  return buildBalanceSheet({
    report,
    currency,
    names,
    latestDate: await asOfFallback(report, signal),
  })
}

export async function fetchIncomeStatement(time?: string, signal?: AbortSignal) {
  const { currency, names } = await ledgerContext(signal)
  const report = await favaClient.getIncomeStatement(time, currency, signal)
  const statement = buildIncomeStatement({
    report: report as FavaTreeReport,
    currency,
    names,
  })
  if (statement.period) return statement
  const period = await activityPeriod(signal)
  return period ? { ...statement, period } : statement
}

export async function fetchTrialBalance(time?: string, signal?: AbortSignal) {
  const { currency, names } = await ledgerContext(signal)
  const report = (await favaClient.getTrialBalance(time, currency, signal)) as FavaTreeReport
  return buildTrialBalance({
    report,
    currency,
    names,
    latestDate: await asOfFallback(report, signal),
  })
}

export async function fetchCashFlow(time?: string, signal?: AbortSignal) {
  const { ledger, currency } = await ledgerContext(signal)
  const code = quoteCommodity(currency)
  const result = await favaClient.query(
    `SELECT id, date, flag, account, convert(position, "${code}")`,
    time,
    signal,
  )
  const postings: CashPosting[] = []
  for (const row of result.rows ?? []) {
    const posting = postingFromRow(row, currency)
    if (posting) postings.push(posting)
  }
  return classifyCashFlow({
    currency,
    postings,
    accounts: accountMetaList(ledger.account_details),
  })
}

function postingFromRow(row: unknown[], currency: string): CashPosting | null {
  const [id, date, flag, account, amount] = row
  if (typeof account !== 'string' || !account) return null
  const read = readInventory(amount, currency)
  return {
    id: String(id ?? ''),
    date: typeof date === 'string' ? date.slice(0, 10) : '',
    account,
    amount: read.amount,
    currency: read.amount === 0 && read.unconverted[0] ? read.unconverted[0] : currency,
    flag: typeof flag === 'string' ? flag : undefined,
  }
}

function accountMetaList(details: Record<string, FavaAccountDetail> | undefined) {
  if (!details) return []
  return Object.entries(details).map(([account, detail]) =>
    readAccountCashMeta(account, detail?.meta),
  )
}

export async function fetchTransactions(limit = 100, time?: string): Promise<TransactionEntry[]> {
  return favaClient.getTransactions(limit, time)
}

export async function fetchAccounts(): Promise<string[]> {
  return favaClient.getAccounts()
}

export async function fetchDocuments(): Promise<LedgerDocument[]> {
  return favaClient.getDocuments()
}

export async function runBQLQuery(bql: string, time?: string, signal?: AbortSignal) {
  return favaClient.query(bql, time, signal)
}

export { favaClient }
export type { LedgerDocument, TransactionEntry, PostingItem } from './fava-client'
export type { BQLQueryResult } from './fava-client'
