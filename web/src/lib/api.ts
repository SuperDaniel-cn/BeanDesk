/**
 * Typed client adapting native Fava APIs and BQL queries into UI models.
 * Zero custom backend: runs purely over the local Fava core.
 */

import { classifyCashFlow, readAccountCashMeta, type CashPosting } from './cash-flow'
import { favaClient, type FavaAccountDetail, type LedgerDocument } from './fava-client'
import {
  asOfFromDateRange,
  buildBalanceSheet,
  buildIncomeStatement,
  buildTrialBalance,
  incomeActivityQuery,
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
    title: ledger.options.title,
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
async function activityPeriod(
  income: string,
  expenses: string,
  signal?: AbortSignal,
): Promise<StatementPeriod | null> {
  try {
    const result = await favaClient.query(incomeActivityQuery(income, expenses), undefined, signal)
    const from = result.rows?.[0]?.[0]
    const to = result.rows?.[0]?.[1]
    if (!from || !to) return null
    return { from: String(from), to: String(to) }
  } catch {
    return null
  }
}

export async function fetchBalanceSheet(time?: string, signal?: AbortSignal) {
  const { title, currency, names } = await ledgerContext(signal)
  const report = (await favaClient.getBalanceSheet(time, currency, signal)) as FavaTreeReport
  return buildBalanceSheet({
    report,
    currency,
    names,
    title,
    latestDate: await asOfFallback(report, signal),
  })
}

export async function fetchIncomeStatement(time?: string, signal?: AbortSignal) {
  const { title, currency, names } = await ledgerContext(signal)
  const report = await favaClient.getIncomeStatement(time, currency, signal)
  const statement = buildIncomeStatement({
    report: report as FavaTreeReport,
    currency,
    names,
    title,
  })
  if (statement.period) return statement
  const period = await activityPeriod(names.income, names.expenses, signal)
  return period ? { ...statement, period } : statement
}

export async function fetchTrialBalance(time?: string, signal?: AbortSignal) {
  const { title, currency, names } = await ledgerContext(signal)
  const report = (await favaClient.getTrialBalance(time, currency, signal)) as FavaTreeReport
  return buildTrialBalance({
    report,
    currency,
    names,
    title,
    latestDate: await asOfFallback(report, signal),
  })
}

export async function fetchCashFlow(time?: string, signal?: AbortSignal) {
  const { ledger, title, currency } = await ledgerContext(signal)
  const code = quoteCommodity(currency)
  const result = await favaClient.query(
    `SELECT id, flag, account, convert(position, "${code}")`,
    time,
    signal,
  )
  const postings: CashPosting[] = []
  for (const row of result.rows ?? []) {
    const posting = postingFromRow(row, currency)
    if (posting) postings.push(posting)
  }
  return classifyCashFlow({
    title,
    currency,
    postings,
    accounts: accountMetaList(ledger.account_details),
  })
}

function postingFromRow(row: unknown[], currency: string): CashPosting | null {
  const [id, flag, account, amount] = row
  if (typeof account !== 'string' || !account) return null
  const read = readInventory(amount, currency)
  return {
    id: String(id ?? ''),
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

export async function fetchTransactions(time?: string) {
  return favaClient.getTransactions(time)
}

export async function fetchDocuments(signal?: AbortSignal): Promise<LedgerDocument[]> {
  return favaClient.getDocuments(signal)
}

export async function runBQLQuery(bql: string, time?: string, signal?: AbortSignal) {
  return favaClient.query(bql, time, signal)
}

export { favaClient }
export type { LedgerDocument, TransactionEntry, PostingItem } from './fava-client'
export type { BQLQueryResult } from './fava-client'
