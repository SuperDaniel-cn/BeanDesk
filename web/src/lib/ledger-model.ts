/**
 * Pure adaptation of Fava JSON into the figures the UI renders.
 *
 * Fava remains the authority for clamping a period (`clamp_opt`) and for
 * closing income and expenses into `Equity:Earnings:Current` on the balance
 * sheet. This module only reads those payloads and keeps one sign convention:
 * Beancount's raw numbers (income, liabilities and equity are negative).
 */

export interface AccountNode {
  name: string
  account: string
  total: number
  children: AccountNode[]
  /** Set on Fava's current-earnings account so the UI can name it. */
  label_key: string | null
}

export type StatementSection = 'assets' | 'liabilities' | 'equity'

export interface BalanceSheetSection {
  section: StatementSection
  children: AccountNode[]
}

export interface BalanceSheet {
  title: string
  as_of: string
  operating_currency: string
  unconverted_currencies: string[]
  sections: BalanceSheetSection[]
  totals: {
    assets: number
    liabilities: number
    equity: number
    balanced: boolean
  }
}

export interface IncomeStatementSection {
  section: 'income' | 'expenses'
  total: number
  children: AccountNode[]
}

export interface StatementPeriod {
  from: string
  to: string
}

export interface IncomeStatement {
  title: string
  operating_currency: string
  unconverted_currencies: string[]
  /**
   * Inclusive dates.
   * A period filter comes from Fava's `date_range`.
   * An all-time report has no range; `fetchIncomeStatement` fills the first and last income or expense posting.
   * Null when both are missing.
   */
  period: StatementPeriod | null
  sections: IncomeStatementSection[]
}

export type TrialBalanceRoot = 'assets' | 'liabilities' | 'equity' | 'income' | 'expenses'

export interface TrialBalanceSection {
  rootAccount: string
  /** Which element this root is. Null when the ledger renamed it. */
  root: TrialBalanceRoot | null
  debit: number
  credit: number
  children: AccountNode[]
}

export interface TrialBalance {
  title: string
  as_of: string
  operating_currency: string
  unconverted_currencies: string[]
  sections: TrialBalanceSection[]
  totals: {
    totalDebits: number
    totalCredits: number
    netImbalance: number
    balanced: boolean
  }
}

export interface RootNames {
  assets: string
  liabilities: string
  equity: string
  income: string
  expenses: string
}

export interface FavaTreeNode {
  account?: string
  balance?: Record<string, number> | null
  balance_children?: Record<string, number> | null
  children?: FavaTreeNode[]
}

export interface FavaTreeReport {
  date_range?: { begin: string; end: string } | null
  trees?: FavaTreeNode[]
}

export interface InventoryRead {
  amount: number
  unconverted: string[]
}

const BALANCE_TOLERANCE = 0.005

export function rootNames(options: {
  name_assets?: string
  name_liabilities?: string
  name_equity?: string
  name_income?: string
  name_expenses?: string
} | null | undefined): RootNames {
  return {
    assets: options?.name_assets || 'Assets',
    liabilities: options?.name_liabilities || 'Liabilities',
    equity: options?.name_equity || 'Equity',
    income: options?.name_income || 'Income',
    expenses: options?.name_expenses || 'Expenses',
  }
}

export function operatingCurrency(currencies: string[] | undefined): string {
  return currencies?.[0] || 'CNY'
}

/** Commodity codes are interpolated into BQL; reject anything else. */
export function quoteCommodity(code: string): string {
  if (!/^[A-Z][A-Z0-9._-]{0,15}$/.test(code)) {
    throw new Error(`Unsupported operating currency: ${code}`)
  }
  return code
}

function isCurrentEarningsAccount(account: string, equityRoot: string): boolean {
  return account === `${equityRoot}:Earnings:Current`
}

/**
 * Fava sends an inventory as `{ CNY: number }` and an Amount as
 * `{ number, currency }`. Anything else is not a balance.
 */
export function readInventory(inv: unknown, currency: string): InventoryRead {
  if (inv == null || typeof inv !== 'object' || Array.isArray(inv)) {
    return { amount: 0, unconverted: [] }
  }
  const record = inv as Record<string, unknown>
  if (typeof record.number === 'number' && typeof record.currency === 'string') {
    if (record.currency === currency) return { amount: record.number, unconverted: [] }
    if (record.number === 0) return { amount: 0, unconverted: [] }
    return { amount: 0, unconverted: [record.currency] }
  }
  const unconverted: string[] = []
  let amount = 0
  for (const [code, value] of Object.entries(record)) {
    if (typeof value !== 'number' || value === 0) continue
    if (code === currency) amount += value
    else unconverted.push(code)
  }
  return { amount, unconverted }
}

/** Fava's `date_range.end` is exclusive. The statement date is the day before. */
export function asOfFromDateRange(
  range: { begin?: string; end?: string } | null | undefined,
): string | null {
  const end = range?.end
  if (!end || !/^\d{4}-\d{2}-\d{2}$/.test(end)) return null
  const date = new Date(`${end}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() - 1)
  return date.toISOString().slice(0, 10)
}

/** Inclusive period for a flow statement. `end` is exclusive, same as `asOfFromDateRange`. */
export function periodFromDateRange(
  range: { begin?: string; end?: string } | null | undefined,
): StatementPeriod | null {
  const to = asOfFromDateRange(range)
  const from = range?.begin
  if (!to || !from || !/^\d{4}-\d{2}-\d{2}$/.test(from)) return null
  return { from, to }
}

/**
 * Slug embedded in a URL Fava (or the dev proxy) redirected to.
 * Returns null when the path is only the proxy prefix.
 */
export function slugFromRedirectUrl(url: string): string | null {
  let pathname = url
  try {
    pathname = new URL(url, 'http://localhost').pathname
  } catch {
    return null
  }
  const parts = pathname.split('/').filter(Boolean)
  const favaAt = parts.indexOf('fava')
  if (parts[0] === 'api' && favaAt === 1) {
    const slug = parts[2]
    if (slug && slug !== 'api' && slug !== 'document') return slug
    return null
  }
  const first = parts[0]
  if (!first || first === 'api' || first === 'document') return null
  return first
}

/**
 * A Fava root redirects to `/<slug>/...`, or the followed response already
 * sits on that path. Any other status, including another program on the same
 * port, is not a ledger.
 */
export function responseLooksLikeFava(status: number, url: string, location: string | null): boolean {
  if (status >= 300 && status < 400 && location) {
    try {
      return slugFromRedirectUrl(new URL(location, url).href) != null
    } catch {
      return false
    }
  }
  return status >= 200 && status < 300 && slugFromRedirectUrl(url) != null
}

export function booksBalance(assets: number, liabilities: number, equity: number): boolean {
  return Math.abs(assets + liabilities + equity) < BALANCE_TOLERANCE
}

function accountLeaf(account: string): string {
  const parts = account.split(':')
  return parts[parts.length - 1] || account
}

function convertNode(
  node: FavaTreeNode,
  currency: string,
  equityRoot: string,
  unconverted?: Set<string>,
): AccountNode {
  const account = node.account || ''
  const own = readInventory(node.balance, currency)
  const rolled = readInventory(node.balance_children, currency)
  // Child balances are visited on their own nodes. The rollup repeats them.
  if (unconverted) {
    for (const code of own.unconverted) unconverted.add(code)
  }

  const children: AccountNode[] = []
  for (const child of node.children ?? []) {
    children.push(convertNode(child, currency, equityRoot, unconverted))
  }

  const hasRollup = node.balance_children != null && Object.keys(node.balance_children).length > 0
  const total = hasRollup ? rolled.amount : own.amount

  return {
    name: accountLeaf(account),
    account,
    total,
    children,
    label_key: isCurrentEarningsAccount(account, equityRoot) ? 'balanceSheet.unclosedEarnings' : null,
  }
}

function forestRoots(trees: FavaTreeNode[] | undefined): FavaTreeNode[] {
  const roots: FavaTreeNode[] = []
  for (const tree of trees ?? []) {
    if ((!tree.account || tree.account === '') && Array.isArray(tree.children)) {
      roots.push(...tree.children)
    } else {
      roots.push(tree)
    }
  }
  return roots
}

export function buildBalanceSheet(input: {
  report: FavaTreeReport
  currency: string
  names: RootNames
  title?: string
  latestDate?: string | null
}): BalanceSheet {
  const unconverted = new Set<string>()
  const sections: BalanceSheetSection[] = []
  let totalAssets = 0
  let totalLiab = 0
  let totalEquity = 0

  for (const tree of input.report.trees ?? []) {
    const account = tree.account || ''
    const node = convertNode(tree, input.currency, input.names.equity, unconverted)
    if (account === input.names.assets) {
      totalAssets = node.total
      sections.push({
        section: 'assets',
        children: node.children,
      })
    } else if (account === input.names.liabilities) {
      totalLiab = node.total
      sections.push({
        section: 'liabilities',
        children: node.children,
      })
    } else if (account === input.names.equity) {
      totalEquity = node.total
      sections.push({
        section: 'equity',
        children: node.children,
      })
    }
  }

  return {
    title: input.title ?? '',
    as_of: asOfFromDateRange(input.report.date_range) ?? input.latestDate ?? '',
    operating_currency: input.currency,
    unconverted_currencies: [...unconverted].sort(),
    sections,
    totals: {
      assets: totalAssets,
      liabilities: totalLiab,
      equity: totalEquity,
      balanced: booksBalance(totalAssets, totalLiab, totalEquity),
    },
  }
}

export function buildIncomeStatement(input: {
  report: FavaTreeReport
  currency: string
  names: RootNames
  title?: string
}): IncomeStatement {
  const unconverted = new Set<string>()
  const sections: IncomeStatementSection[] = []

  for (const tree of input.report.trees ?? []) {
    const account = tree.account || ''
    const section =
      account === input.names.income
        ? 'income'
        : account === input.names.expenses
          ? 'expenses'
          : null
    if (!section) continue
    const node = convertNode(tree, input.currency, input.names.equity, unconverted)
    sections.push({
      section,
      total: node.total,
      children: node.children,
    })
  }

  return {
    title: input.title ?? '',
    operating_currency: input.currency,
    unconverted_currencies: [...unconverted].sort(),
    period: periodFromDateRange(input.report.date_range),
    sections,
  }
}

export function trialRootOf(account: string, names: RootNames): TrialBalanceRoot | null {
  if (account === names.assets) return 'assets'
  if (account === names.liabilities) return 'liabilities'
  if (account === names.equity) return 'equity'
  if (account === names.income) return 'income'
  if (account === names.expenses) return 'expenses'
  return null
}

/** Assets and expenses sit on the debit side. Every other element sits on the credit side. */
export function isDebitNormal(root: TrialBalanceRoot | null): boolean {
  return root === 'assets' || root === 'expenses'
}

export function splitSignedBalance(
  debitNormal: boolean,
  total: number,
): { debit: number; credit: number } {
  if (debitNormal) {
    return total >= 0 ? { debit: total, credit: 0 } : { debit: 0, credit: Math.abs(total) }
  }
  return total <= 0 ? { debit: 0, credit: Math.abs(total) } : { debit: total, credit: 0 }
}

export function buildTrialBalance(input: {
  report: FavaTreeReport
  currency: string
  names: RootNames
  title?: string
  latestDate?: string | null
}): TrialBalance {
  const unconverted = new Set<string>()
  const sections: TrialBalanceSection[] = []

  for (const tree of forestRoots(input.report.trees)) {
    const account = tree.account || ''
    const node = convertNode(tree, input.currency, input.names.equity, unconverted)
    const root = trialRootOf(account, input.names)
    const { debit, credit } = splitSignedBalance(isDebitNormal(root), node.total)
    sections.push({
      rootAccount: account,
      root,
      debit,
      credit,
      children: node.children,
    })
  }

  const totalDebits = sections.reduce((sum, section) => sum + section.debit, 0)
  const totalCredits = sections.reduce((sum, section) => sum + section.credit, 0)
  const netImbalance = totalDebits - totalCredits

  return {
    title: input.title ?? '',
    as_of: asOfFromDateRange(input.report.date_range) ?? input.latestDate ?? '',
    operating_currency: input.currency,
    unconverted_currencies: [...unconverted].sort(),
    sections,
    totals: {
      totalDebits,
      totalCredits,
      netImbalance,
      balanced: Math.abs(netImbalance) < BALANCE_TOLERANCE,
    },
  }
}

export type PeriodParts =
  | { kind: 'year'; year: string }
  | { kind: 'quarter'; year: string; quarter: string }
  | { kind: 'month'; year: string; month: string }

/** Year, quarter, or month token. All-time and anything else are `null`. */
export function periodParts(time: string): PeriodParts | null {
  const year = /^(\d{4})$/.exec(time)
  if (year) return { kind: 'year', year: year[1] }
  const quarter = /^(\d{4})-Q([1-4])$/.exec(time)
  if (quarter) return { kind: 'quarter', year: quarter[1], quarter: quarter[2] }
  const month = /^(\d{4})-(\d{2})$/.exec(time)
  if (month) {
    const value = Number(month[2])
    if (value < 1 || value > 12) return null
    return { kind: 'month', year: month[1], month: month[2] }
  }
  return null
}

/**
 * Same period last year. `2026` → `2025`, `2026-Q2` → `2025-Q2`, `2026-03` → `2025-03`.
 * All-time and anything else have no prior column.
 */
export function priorPeriod(time: string): string | null {
  const parts = periodParts(time)
  if (!parts) return null
  const year = String(Number(parts.year) - 1)
  if (parts.kind === 'year') return year
  if (parts.kind === 'quarter') return `${year}-Q${parts.quarter}`
  return `${year}-${parts.month}`
}

/** Inclusive filter for a Fava document date (`YYYY-MM-DD`). All-time keeps every date. */
export function dateInPeriod(date: string, time: string): boolean {
  const parts = periodParts(time)
  if (!parts) return true
  if (date.length < 7) return false
  if (parts.kind === 'year') return date.startsWith(parts.year)
  if (parts.kind === 'month') return date.startsWith(`${parts.year}-${parts.month}`)
  const month = Number(date.slice(5, 7))
  if (!date.startsWith(parts.year) || Number.isNaN(month)) return false
  const start = (Number(parts.quarter) - 1) * 3 + 1
  return month >= start && month <= start + 2
}

/** A parent that nets to zero stays visible when a descendant still has a balance. */
export function visibleAccount(total: number, children: AccountNode[]): boolean {
  if (total !== 0) return true
  return children.some((child) => visibleAccount(child.total, child.children))
}

export function visibleCompared(node: ComparedAccount): boolean {
  if (node.current !== 0 || node.prior !== 0) return true
  return node.children.some((child) => visibleCompared(child))
}

/** All-time income range covers only the profit-and-loss roots, not opening balances. */
export function incomeActivityQuery(income: string, expenses: string): string {
  const pattern = [income, expenses].map(escapeRegex).join('|')
  return `SELECT min(date), max(date) WHERE account ~ "^(${pattern})(:|$)"`
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export interface ComparedAccount {
  account: string
  name: string
  label_key: string | null
  current: number
  prior: number
  children: ComparedAccount[]
}

/** Align two account trees by path. A side that lacks the account contributes zero. */
export function compareAccounts(current: AccountNode[], prior: AccountNode[]): ComparedAccount[] {
  const priorByAccount = new Map(prior.map((node) => [node.account, node]))
  const seen = new Set<string>()
  const merged: ComparedAccount[] = []

  for (const node of current) {
    seen.add(node.account)
    const other = priorByAccount.get(node.account)
    merged.push({
      account: node.account,
      name: node.name,
      label_key: node.label_key,
      current: node.total,
      prior: other?.total ?? 0,
      children: compareAccounts(node.children, other?.children ?? []),
    })
  }

  for (const node of prior) {
    if (seen.has(node.account)) continue
    merged.push({
      account: node.account,
      name: node.name,
      label_key: node.label_key,
      current: 0,
      prior: node.total,
      children: compareAccounts([], node.children),
    })
  }

  return merged
}
