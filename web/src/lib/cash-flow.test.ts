import { describe, expect, test } from 'bun:test'
import {
  classifyCashFlow,
  presentedLineAmount,
  readAccountCashMeta,
  type AccountCashMeta,
  type CashPosting,
} from './cash-flow'

const accounts: AccountCashMeta[] = [
  { account: 'Assets:Bank', cash: true, cashflow: null, cashflowIn: null, cashflowOut: null },
  { account: 'Assets:Alipay', cash: true, cashflow: null, cashflowIn: null, cashflowOut: null },
  { account: 'Income:Service', cash: false, cashflow: 'sales', cashflowIn: null, cashflowOut: null },
  { account: 'Expenses:Fee', cash: false, cashflow: 'operating-other-out', cashflowIn: null, cashflowOut: null },
  { account: 'Liabilities:Loan', cash: false, cashflow: null, cashflowIn: 'borrowings', cashflowOut: 'debt-principal' },
  { account: 'Liabilities:VAT', cash: false, cashflow: null, cashflowIn: 'sales', cashflowOut: 'taxes' },
  { account: 'Expenses:Payroll', cash: false, cashflow: 'wages', cashflowIn: null, cashflowOut: null },
  { account: 'Liabilities:Payroll', cash: false, cashflow: 'wages', cashflowIn: null, cashflowOut: null },
  { account: 'Assets:Equipment', cash: false, cashflow: 'capex', cashflowIn: null, cashflowOut: null },
  { account: 'Equity:Capital', cash: false, cashflow: 'capital', cashflowIn: null, cashflowOut: null },
]

function posting(id: string, date: string, account: string, amount: number, currency = 'CNY'): CashPosting {
  return { id, date, account, amount, currency }
}

function statement(postings: CashPosting[], extra: AccountCashMeta[] = []) {
  return classifyCashFlow({ currency: 'CNY', postings, accounts: [...accounts, ...extra] })
}

describe('classifyCashFlow', () => {
  test('a receipt and its contra account are one inflow', () => {
    const result = statement([
      posting('sale', '2026-01-31', 'Assets:Bank', 29715.47),
      posting('sale', '2026-01-31', 'Income:Service', -29715.47),
    ])

    expect(result.lines.sales).toBeCloseTo(29715.47)
    expect(result.sections.operating).toBeCloseTo(29715.47)
    expect(result.net).toBeCloseTo(result.cashChange)
    expect(result.period).toEqual({ from: '2026-01-31', to: '2026-01-31' })
  })

  test('several contra accounts in one entry add back to the bank', () => {
    const result = statement([
      posting('mix', '2026-02-01', 'Assets:Bank', 99950),
      posting('mix', '2026-02-01', 'Income:Service', -60000),
      posting('mix', '2026-02-01', 'Liabilities:Loan', -30000),
      posting('mix', '2026-02-01', 'Expenses:Fee', 50),
      posting('mix', '2026-02-01', 'Equity:Opening', -10000),
    ])

    expect(result.lines.sales).toBe(60000)
    expect(result.lines.borrowings).toBe(30000)
    expect(presentedLineAmount('operating-other-out', result.lines['operating-other-out'])).toBe(50)
    expect(result.unassigned).toEqual([{ account: 'Equity:Opening', amount: 10000 }])
    expect(result.net).toBe(result.cashChange)
    expect(result.cashChange).toBe(99950)
  })

  test('moving cash between cash accounts drops out of the statement', () => {
    const result = statement([
      posting('move', '2026-03-01', 'Assets:Bank', -500),
      posting('move', '2026-03-01', 'Assets:Alipay', 500),
    ])

    expect(result.net).toBe(0)
    expect(result.cashChange).toBe(0)
    expect(result.unassigned).toEqual([])
    expect(result.period).toEqual({ from: '2026-03-01', to: '2026-03-01' })
  })

  test('an accrual with no cash is skipped', () => {
    const result = statement([
      posting('accrual', '2026-01-31', 'Expenses:Payroll', 8000),
      posting('accrual', '2026-01-31', 'Liabilities:Payroll', -8000),
      posting('pay', '2026-02-05', 'Liabilities:Payroll', 8000),
      posting('pay', '2026-02-05', 'Assets:Bank', -8000),
    ])

    expect(presentedLineAmount('wages', result.lines.wages)).toBe(8000)
    expect(result.cashChange).toBe(-8000)
    expect(result.net).toBe(result.cashChange)
    expect(result.period).toEqual({ from: '2026-02-05', to: '2026-02-05' })
  })

  test('cashflow-in and cashflow-out send the same account to different lines', () => {
    const result = statement([
      posting('collect', '2026-04-01', 'Assets:Bank', 113),
      posting('collect', '2026-04-01', 'Liabilities:VAT', -113),
      posting('remit', '2026-04-15', 'Liabilities:VAT', 113),
      posting('remit', '2026-04-15', 'Assets:Bank', -113),
    ])

    expect(result.lines.sales).toBe(113)
    expect(presentedLineAmount('taxes', result.lines.taxes)).toBe(113)
    expect(result.net).toBe(0)
    expect(result.net).toBe(result.cashChange)
  })

  test('an unknown line id stays with the account instead of joining another line', () => {
    const result = statement(
      [
        posting('odd', '2026-05-01', 'Assets:Bank', -20),
        posting('odd', '2026-05-01', 'Expenses:Mystery', 20),
      ],
      [{ account: 'Expenses:Mystery', cash: false, cashflow: 'not-a-line', cashflowIn: null, cashflowOut: null }],
    )

    expect(result.lines['operating-other-out']).toBe(0)
    expect(result.unassigned).toEqual([{ account: 'Expenses:Mystery', amount: -20 }])
    expect(result.net).toBe(result.cashChange)
  })

  test('a period-opening summarization is not a cash flow', () => {
    const opening = (account: string, amount: number): CashPosting => ({
      ...posting('open', '2026-01-31', account, amount),
      flag: 'S',
    })
    const result = statement([
      opening('Assets:Bank', 100),
      opening('Equity:Opening-Balances', -100),
      posting('pay', '2026-02-02', 'Expenses:Fee', 40),
      posting('pay', '2026-02-02', 'Assets:Bank', -40),
    ])

    expect(presentedLineAmount('operating-other-out', result.lines['operating-other-out'])).toBe(40)
    expect(result.unassigned).toEqual([])
    expect(result.cashChange).toBe(-40)
    expect(result.net).toBe(result.cashChange)
    expect(result.period).toEqual({ from: '2026-02-02', to: '2026-02-02' })
  })

  test('a foreign-currency posting is left out and named', () => {
    const result = statement([
      posting('fx', '2026-06-01', 'Assets:Bank', 10, 'USD'),
      posting('fx', '2026-06-01', 'Income:Service', -70),
    ])

    expect(result.unconverted_currencies).toEqual(['USD'])
    expect(result.lines.sales).toBe(0)
    expect(result.period).toBeNull()
  })
})

describe('readAccountCashMeta', () => {
  test('reads cash and the two direction overrides from open metadata', () => {
    expect(
      readAccountCashMeta('Liabilities:VAT', {
        filename: '/tmp/accounts.bean',
        lineno: 4,
        cash: true,
        cashflow: 'sales',
        'cashflow-in': 'sales',
        'cashflow-out': 'taxes',
      }),
    ).toEqual({
      account: 'Liabilities:VAT',
      cash: true,
      cashflow: 'sales',
      cashflowIn: 'sales',
      cashflowOut: 'taxes',
    })
  })
})
