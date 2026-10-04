import type { MessageKey } from '@/i18n/locales/en'

import type { StatementPeriod } from './ledger-model'

/**
 * Direct-method cash flow statement for a small enterprise.
 *
 * The line catalogue lives here. Which account is cash, and which line a
 * contra account belongs to, comes from open-directive metadata on the ledger.
 * In one transaction the cash postings sum to the negative of the other
 * postings, so each other posting is classified on its own.
 */

export const CASH_FLOW_SECTIONS = ['operating', 'investing', 'financing'] as const

export type CashFlowSection = (typeof CASH_FLOW_SECTIONS)[number]

export const CASH_FLOW_LINES = [
  { id: 'sales', section: 'operating', direction: 'in', label: 'cashFlow.lines.sales' },
  { id: 'operating-other-in', section: 'operating', direction: 'in', label: 'cashFlow.lines.operating-other-in' },
  { id: 'purchases', section: 'operating', direction: 'out', label: 'cashFlow.lines.purchases' },
  { id: 'wages', section: 'operating', direction: 'out', label: 'cashFlow.lines.wages' },
  { id: 'taxes', section: 'operating', direction: 'out', label: 'cashFlow.lines.taxes' },
  { id: 'operating-other-out', section: 'operating', direction: 'out', label: 'cashFlow.lines.operating-other-out' },
  { id: 'investment-proceeds', section: 'investing', direction: 'in', label: 'cashFlow.lines.investment-proceeds' },
  { id: 'investment-income', section: 'investing', direction: 'in', label: 'cashFlow.lines.investment-income' },
  { id: 'asset-disposal', section: 'investing', direction: 'in', label: 'cashFlow.lines.asset-disposal' },
  { id: 'investment-acquire', section: 'investing', direction: 'out', label: 'cashFlow.lines.investment-acquire' },
  { id: 'capex', section: 'investing', direction: 'out', label: 'cashFlow.lines.capex' },
  { id: 'borrowings', section: 'financing', direction: 'in', label: 'cashFlow.lines.borrowings' },
  { id: 'capital', section: 'financing', direction: 'in', label: 'cashFlow.lines.capital' },
  { id: 'debt-principal', section: 'financing', direction: 'out', label: 'cashFlow.lines.debt-principal' },
  { id: 'debt-interest', section: 'financing', direction: 'out', label: 'cashFlow.lines.debt-interest' },
  { id: 'dividends', section: 'financing', direction: 'out', label: 'cashFlow.lines.dividends' },
] as const satisfies ReadonlyArray<{
  id: string
  section: CashFlowSection
  direction: 'in' | 'out'
  label: MessageKey
}>

export const CASH_FLOW_SECTION_TITLE: Record<CashFlowSection, MessageKey> = {
  operating: 'cashFlow.operating',
  investing: 'cashFlow.investing',
  financing: 'cashFlow.financing',
}

export const CASH_FLOW_SECTION_NET: Record<CashFlowSection, MessageKey> = {
  operating: 'cashFlow.operatingNet',
  investing: 'cashFlow.investingNet',
  financing: 'cashFlow.financingNet',
}

export type CashFlowLineId = (typeof CASH_FLOW_LINES)[number]['id']

export interface CashPosting {
  id: string
  date: string
  account: string
  /** Beancount sign: a debit is positive. */
  amount: number
  currency: string
  /**
   * `S` is the opening Beancount inserts when a query is cut to a later period.
   * That entry restates the balance brought forward. It is not a cash flow.
   */
  flag?: string
}

export interface AccountCashMeta {
  account: string
  cash: boolean
  cashflow: string | null
  cashflowIn: string | null
  cashflowOut: string | null
}

export interface UnassignedCashFlow {
  account: string
  /** Signed cash effect. Positive is cash received. */
  amount: number
}

export interface CashFlowStatement {
  title: string
  operating_currency: string
  /** First and last day a cash account actually moved. */
  period: StatementPeriod | null
  /** Signed cash effect per catalogue line. Positive is an inflow. */
  lines: Record<CashFlowLineId, number>
  unassigned: UnassignedCashFlow[]
  sections: Record<CashFlowSection, number>
  unassignedTotal: number
  /** Sum of the statement. Equals the change in cash when every amount converted. */
  net: number
  /** Sum of cash postings kept in the operating currency. */
  cashChange: number
  unconverted_currencies: string[]
}

export function readAccountCashMeta(
  account: string,
  meta: Record<string, unknown> | null | undefined,
): AccountCashMeta {
  return {
    account,
    cash: isTrue(meta?.cash),
    cashflow: textMeta(meta?.cashflow),
    cashflowIn: textMeta(meta?.['cashflow-in']),
    cashflowOut: textMeta(meta?.['cashflow-out']),
  }
}

export function classifyCashFlow(input: {
  title?: string
  currency: string
  postings: CashPosting[]
  accounts: AccountCashMeta[]
}): CashFlowStatement {
  const accounts = new Map(input.accounts.map((account) => [account.account, account]))
  const lines = emptyLines()
  const unassigned = new Map<string, number>()
  const unconverted = new Set<string>()
  const groups = new Map<string, CashPosting[]>()

  for (const posting of input.postings) {
    const group = groups.get(posting.id) ?? []
    group.push(posting)
    groups.set(posting.id, group)
  }

  const dates: string[] = []
  let cashChange = 0

  for (const postings of groups.values()) {
    if (postings.some((posting) => posting.flag === 'S')) continue

    const kept: CashPosting[] = []
    for (const posting of postings) {
      if (posting.currency === input.currency) {
        kept.push(posting)
        continue
      }
      if (posting.currency) unconverted.add(posting.currency)
    }

    const cash: CashPosting[] = []
    const other: { posting: CashPosting; meta: AccountCashMeta | undefined }[] = []
    for (const posting of kept) {
      const meta = accounts.get(posting.account)
      if (meta?.cash) cash.push(posting)
      else other.push({ posting, meta })
    }
    if (cash.length === 0) continue

    for (const posting of cash) {
      cashChange += posting.amount
      if (posting.date) dates.push(posting.date)
    }

    for (const entry of other) {
      addEffect(lines, unassigned, entry.meta, entry.posting.account, -entry.posting.amount)
    }
  }

  const sections = emptySections()
  for (const line of CASH_FLOW_LINES) {
    sections[line.section] += lines[line.id]
  }
  const unassignedRows = [...unassigned.entries()]
    .filter(([, amount]) => amount !== 0)
    .map(([account, amount]) => ({ account, amount }))
    .sort((a, b) => a.account.localeCompare(b.account))
  const unassignedTotal = unassignedRows.reduce((sum, row) => sum + row.amount, 0)

  return {
    title: input.title ?? '',
    operating_currency: input.currency,
    period: periodFrom(dates),
    lines,
    unassigned: unassignedRows,
    sections,
    unassignedTotal,
    net: sections.operating + sections.investing + sections.financing + unassignedTotal,
    cashChange,
    unconverted_currencies: [...unconverted].sort(),
  }
}

export function linesIn(section: CashFlowSection) {
  return CASH_FLOW_LINES.filter((line) => line.section === section)
}

export interface ComparedAmount {
  current: number
  prior: number
}

export interface CashFlowComparison {
  lines: Record<CashFlowLineId, ComparedAmount>
  unassigned: Array<{ account: string } & ComparedAmount>
  unassignedTotal: ComparedAmount
  sections: Record<CashFlowSection, ComparedAmount>
  net: ComparedAmount
}

/** Pair two statements. Unassigned accounts are the union, with a missing side as zero. */
export function compareCashFlow(current: CashFlowStatement, prior: CashFlowStatement): CashFlowComparison {
  const lines = Object.fromEntries(
    CASH_FLOW_LINES.map((line) => [
      line.id,
      { current: current.lines[line.id], prior: prior.lines[line.id] },
    ]),
  ) as Record<CashFlowLineId, ComparedAmount>

  const unassigned = new Map<string, ComparedAmount>()
  for (const row of current.unassigned) {
    unassigned.set(row.account, { current: row.amount, prior: 0 })
  }
  for (const row of prior.unassigned) {
    const existing = unassigned.get(row.account) ?? { current: 0, prior: 0 }
    existing.prior = row.amount
    unassigned.set(row.account, existing)
  }

  const sections = Object.fromEntries(
    CASH_FLOW_SECTIONS.map((section) => [
      section,
      { current: current.sections[section], prior: prior.sections[section] },
    ]),
  ) as Record<CashFlowSection, ComparedAmount>

  return {
    lines,
    unassigned: [...unassigned.entries()].map(([account, amounts]) => ({ account, ...amounts })),
    unassignedTotal: { current: current.unassignedTotal, prior: prior.unassignedTotal },
    sections,
    net: { current: current.net, prior: prior.net },
  }
}

/** Outflow lines are stored as negative cash. The statement prints the payment as a positive amount. */
export function presentedLineAmount(id: CashFlowLineId, signed: number): number {
  const line = CASH_FLOW_LINES.find((item) => item.id === id)
  return line?.direction === 'out' ? -signed : signed
}

function addEffect(
  lines: Record<CashFlowLineId, number>,
  unassigned: Map<string, number>,
  meta: AccountCashMeta | undefined,
  account: string,
  effect: number,
) {
  if (effect === 0) return
  const id = lineId(meta, effect)
  if (id && isLineId(id)) {
    lines[id] += effect
    return
  }
  unassigned.set(account, (unassigned.get(account) ?? 0) + effect)
}

function lineId(meta: AccountCashMeta | undefined, effect: number): string | null {
  if (!meta) return null
  if (effect > 0 && meta.cashflowIn) return meta.cashflowIn
  if (effect < 0 && meta.cashflowOut) return meta.cashflowOut
  return meta.cashflow
}

function isLineId(id: string): id is CashFlowLineId {
  return CASH_FLOW_LINES.some((line) => line.id === id)
}

function emptyLines(): Record<CashFlowLineId, number> {
  return Object.fromEntries(CASH_FLOW_LINES.map((line) => [line.id, 0])) as Record<CashFlowLineId, number>
}

function emptySections(): Record<CashFlowSection, number> {
  return { operating: 0, investing: 0, financing: 0 }
}

function periodFrom(dates: string[]): StatementPeriod | null {
  if (dates.length === 0) return null
  let from = dates[0]
  let to = dates[0]
  for (const date of dates) {
    if (date < from) from = date
    if (date > to) to = date
  }
  return { from, to }
}

function isTrue(value: unknown): boolean {
  return value === true
}

function textMeta(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const text = value.trim()
  return text || null
}
