import type { Vars } from '@/i18n/catalog'
import type { MessageKey } from '@/i18n/locales/en'

import {
  CASH_FLOW_SECTIONS,
  CASH_FLOW_SECTION_NET,
  CASH_FLOW_SECTION_TITLE,
  linesIn,
  presentedLineAmount,
  type CashFlowComparison,
  type CashFlowStatement,
} from './cash-flow'
import { displayAccountName, presentBalance, presentIncome } from './format'
import {
  isCurrencyPlug,
  isDebitNormal,
  splitSignedBalance,
  type AccountNode,
  type BalanceSheet,
  type ComparedAccount,
  type IncomeStatementSection,
  type TrialBalance,
  type TrialBalanceRoot,
} from './ledger-model'

type Translate = (key: MessageKey, vars?: Vars) => string
type Money = (value: number, currency: string) => string

export const TRIAL_ROOT_TITLE: Record<TrialBalanceRoot, MessageKey> = {
  assets: 'trialBalance.roots.assets',
  liabilities: 'trialBalance.roots.liabilities',
  equity: 'trialBalance.roots.equity',
  income: 'trialBalance.roots.income',
  expenses: 'trialBalance.roots.expenses',
}

const BALANCE_SECTION: Record<'assets' | 'liabilities' | 'equity', MessageKey> = {
  assets: 'balanceSheet.assets',
  liabilities: 'balanceSheet.liabilities',
  equity: 'balanceSheet.equity',
}

function indent(depth: number, name: string): string {
  return `${'  '.repeat(depth)}${name}`
}

function amountColumns(
  current: string,
  comparing: boolean,
  prior?: string,
  delta?: string,
): string[] {
  return comparing ? [current, prior ?? '', delta ?? ''] : [current]
}

function periodHeaders(
  t: Translate,
  comparing: boolean,
  currentLabel: string,
  priorLabel: string,
): string[] {
  if (!comparing) return [t('balanceSheet.amount')]
  return [currentLabel, priorLabel, t('compare.delta')]
}

function walkTrial(
  nodes: AccountNode[],
  debitNormal: boolean,
  depth: number,
  money: Money,
  currency: string,
): string[][] {
  const rows: string[][] = []
  for (const node of nodes) {
    if (node.total === 0) continue
    const sides = splitSignedBalance(debitNormal, node.total)
    rows.push([
      indent(depth, displayAccountName(node.name)),
      sides.debit === 0 ? '' : money(sides.debit, currency),
      sides.credit === 0 ? '' : money(sides.credit, currency),
    ])
    rows.push(...walkTrial(node.children, debitNormal, depth + 1, money, currency))
  }
  return rows
}

export function trialCsvTable(
  data: TrialBalance,
  t: Translate,
  money: Money,
): { headers: string[]; rows: string[][] } {
  const currency = data.operating_currency
  const rows: string[][] = []
  for (const section of data.sections) {
    if (section.debit === 0 && section.credit === 0) continue
    const name = section.root ? t(TRIAL_ROOT_TITLE[section.root]) : displayAccountName(section.rootAccount)
    rows.push(
      ...walkTrial(section.children, isDebitNormal(section.root), 0, money, currency),
    )
    rows.push([
      t('trialBalance.sectionTotal', { name }),
      section.debit === 0 ? '' : money(section.debit, currency),
      section.credit === 0 ? '' : money(section.credit, currency),
    ])
  }
  rows.push([t('trialBalance.debitTotal'), money(data.totals.totalDebits, currency), ''])
  rows.push([t('trialBalance.creditTotal'), '', money(data.totals.totalCredits, currency)])
  if (!data.totals.balanced) {
    rows.push([t('trialBalance.netImbalance'), money(data.totals.netImbalance, currency), ''])
  }
  return {
    headers: [t('balanceSheet.account'), t('trialBalance.debitColumn'), t('trialBalance.creditColumn')],
    rows,
  }
}

function walkBalance(
  nodes: AccountNode[],
  section: 'assets' | 'liabilities' | 'equity',
  depth: number,
  money: Money,
  currency: string,
  t: Translate,
): string[][] {
  const rows: string[][] = []
  for (const node of nodes) {
    if (isCurrencyPlug(node.account)) continue
    const value = presentBalance(section, node.total)
    if (value === 0) continue
    const title = node.label_key
      ? t('balanceSheet.unclosedEarnings')
      : node.name === 'Earnings'
        ? t('balanceSheet.earnings')
        : displayAccountName(node.name)
    rows.push([t(BALANCE_SECTION[section]), indent(depth, title), money(value, currency)])
    rows.push(...walkBalance(node.children, section, depth + 1, money, currency, t))
  }
  return rows
}

export function balanceCsvTable(
  data: BalanceSheet,
  t: Translate,
  money: Money,
): { headers: string[]; rows: string[][] } {
  const currency = data.operating_currency
  const rows: string[][] = []
  for (const section of data.sections) {
    rows.push(...walkBalance(section.children, section.section, 0, money, currency, t))
  }
  const assets = presentBalance('assets', data.totals.assets)
  const liabilities = presentBalance('liabilities', data.totals.liabilities)
  const equity = presentBalance('equity', data.totals.equity)
  rows.push([t('balanceSheet.totalAssets'), '', money(assets, currency)])
  rows.push([t('balanceSheet.totalLiabilities'), '', money(liabilities, currency)])
  rows.push([t('balanceSheet.totalEquity'), '', money(equity, currency)])
  rows.push([
    t('balanceSheet.totalLiabilitiesAndEquity'),
    '',
    money(liabilities + equity, currency),
  ])
  return {
    headers: [t('common.section'), t('balanceSheet.account'), t('balanceSheet.amount')],
    rows,
  }
}

function walkIncome(
  nodes: ComparedAccount[],
  section: IncomeStatementSection['section'],
  depth: number,
  comparing: boolean,
  money: Money,
  signed: Money,
  currency: string,
): string[][] {
  const rows: string[][] = []
  for (const node of nodes) {
    const current = presentIncome(section, node.current)
    const prior = presentIncome(section, node.prior)
    if (current === 0 && prior === 0) continue
    rows.push([
      indent(depth, displayAccountName(node.name)),
      ...amountColumns(
        money(current, currency),
        comparing,
        comparing ? money(prior, currency) : undefined,
        comparing ? signed(current - prior, currency) : undefined,
      ),
    ])
    rows.push(...walkIncome(node.children, section, depth + 1, comparing, money, signed, currency))
  }
  return rows
}

export function incomeCsvTable(
  income: { nodes: ComparedAccount[]; current: number; prior: number },
  expenses: { nodes: ComparedAccount[]; current: number; prior: number },
  currency: string,
  comparing: boolean,
  t: Translate,
  money: Money,
  signed: Money,
  currentLabel: string,
  priorLabel: string,
): { headers: string[]; rows: string[][] } {
  const revenue = presentIncome('income', income.current)
  const priorRevenue = presentIncome('income', income.prior)
  const expenseTotal = presentIncome('expenses', expenses.current)
  const priorExpense = presentIncome('expenses', expenses.prior)
  const profit = revenue - expenseTotal
  const priorProfit = priorRevenue - priorExpense
  const rows: string[][] = [
    ...walkIncome(income.nodes, 'income', 0, comparing, money, signed, currency).map((row) => [
      t('income.revenueTitle'),
      ...row,
    ]),
    [
      t('income.revenueTitle'),
      t('income.totalRevenue'),
      ...amountColumns(
        money(revenue, currency),
        comparing,
        comparing ? money(priorRevenue, currency) : undefined,
        comparing ? signed(revenue - priorRevenue, currency) : undefined,
      ),
    ],
    ...walkIncome(expenses.nodes, 'expenses', 0, comparing, money, signed, currency).map((row) => [
      t('income.expensesTitle'),
      ...row,
    ]),
    [
      t('income.expensesTitle'),
      t('income.totalExpenses'),
      ...amountColumns(
        money(expenseTotal, currency),
        comparing,
        comparing ? money(priorExpense, currency) : undefined,
        comparing ? signed(expenseTotal - priorExpense, currency) : undefined,
      ),
    ],
    [
      t('income.expensesTitle'),
      t('income.profitTitle'),
      ...amountColumns(
        signed(profit, currency),
        comparing,
        comparing ? signed(priorProfit, currency) : undefined,
        comparing ? signed(profit - priorProfit, currency) : undefined,
      ),
    ],
  ]
  return {
    headers: [
      t('common.section'),
      t('balanceSheet.account'),
      ...periodHeaders(t, comparing, currentLabel, priorLabel),
    ],
    rows,
  }
}

export function cashFlowCsvTable(
  data: CashFlowStatement,
  comparison: CashFlowComparison | null,
  t: Translate,
  money: Money,
  signed: Money,
  currentLabel: string,
  priorLabel: string,
): { headers: string[]; rows: string[][] } {
  const comparing = comparison != null
  const currency = data.operating_currency
  const rows: string[][] = []

  for (const section of CASH_FLOW_SECTIONS) {
    const sectionLabel = t(CASH_FLOW_SECTION_TITLE[section])
    for (const line of linesIn(section)) {
      if (!comparison) {
        const current = presentedLineAmount(line.id, data.lines[line.id])
        if (current === 0) continue
        rows.push([sectionLabel, t(line.label), money(current, currency)])
        continue
      }
      const amounts = comparison.lines[line.id]
      if (amounts.current === 0 && amounts.prior === 0) continue
      const current = presentedLineAmount(line.id, amounts.current)
      const prior = presentedLineAmount(line.id, amounts.prior)
      rows.push([
        sectionLabel,
        t(line.label),
        money(current, currency),
        money(prior, currency),
        signed(current - prior, currency),
      ])
    }
    const currentNet = comparison ? comparison.sections[section].current : data.sections[section]
    rows.push([
      sectionLabel,
      t(CASH_FLOW_SECTION_NET[section]),
      ...amountColumns(
        signed(currentNet, currency),
        comparing,
        comparison ? signed(comparison.sections[section].prior, currency) : undefined,
        comparison ? signed(currentNet - comparison.sections[section].prior, currency) : undefined,
      ),
    ])
  }

  const unassigned = comparison?.unassigned ?? data.unassigned.map((row) => ({
    account: row.account,
    current: row.amount,
    prior: 0,
  }))
  for (const row of unassigned) {
    if (!comparing && row.current === 0) continue
    if (comparing && row.current === 0 && row.prior === 0) continue
    rows.push([
      t('cashFlow.unassigned'),
      displayAccountName(row.account),
      ...amountColumns(
        signed(row.current, currency),
        comparing,
        comparing ? signed(row.prior, currency) : undefined,
        comparing ? signed(row.current - row.prior, currency) : undefined,
      ),
    ])
  }
  const unassignedCurrent = comparison ? comparison.unassignedTotal.current : data.unassignedTotal
  if (unassigned.length > 0) {
    rows.push([
      t('cashFlow.unassigned'),
      t('cashFlow.unassigned'),
      ...amountColumns(
        signed(unassignedCurrent, currency),
        comparing,
        comparison ? signed(comparison.unassignedTotal.prior, currency) : undefined,
        comparison ? signed(unassignedCurrent - comparison.unassignedTotal.prior, currency) : undefined,
      ),
    ])
  }

  const netCurrent = comparison ? comparison.net.current : data.net
  rows.push([
    t('cashFlow.netIncrease'),
    t('cashFlow.netIncrease'),
    ...amountColumns(
      signed(netCurrent, currency),
      comparing,
      comparison ? signed(comparison.net.prior, currency) : undefined,
      comparison ? signed(netCurrent - comparison.net.prior, currency) : undefined,
    ),
  ])

  return {
    headers: [
      t('common.section'),
      t('cashFlow.item'),
      ...periodHeaders(t, comparing, currentLabel, priorLabel),
    ],
    rows,
  }
}
