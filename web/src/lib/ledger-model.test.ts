import { describe, expect, test } from 'bun:test'

import {
  asOfFromDateRange,
  periodFromDateRange,
  buildBalanceSheet,
  buildIncomeStatement,
  buildTrialBalance,
  readInventory,
  rootNames,
  responseLooksLikeFava,
  slugFromRedirectUrl,
  type FavaTreeReport,
  type RootNames,
} from './ledger-model'

const NAMES: RootNames = rootNames({
  name_assets: 'Assets',
  name_liabilities: 'Liabilities',
  name_equity: 'Equity',
  name_income: 'Income',
  name_expenses: 'Expenses',
})

const CLOSED_SHEET: FavaTreeReport = {
  date_range: { begin: '2026-01-01', end: '2027-01-01' },
  trees: [
    {
      account: 'Assets',
      balance: {},
      balance_children: { CNY: 100 },
      children: [
        {
          account: 'Assets:Bank',
          balance: { CNY: 80 },
          balance_children: { CNY: 80 },
          children: [],
        },
      ],
    },
    {
      account: 'Liabilities',
      balance: {},
      balance_children: { CNY: -30 },
      children: [],
    },
    {
      account: 'Equity',
      balance: {},
      balance_children: { CNY: -70 },
      children: [
        {
          account: 'Equity:Capital',
          balance: { CNY: -50 },
          balance_children: { CNY: -50 },
          children: [],
        },
        {
          account: 'Equity:Earnings:Current',
          balance: { CNY: -20 },
          balance_children: { CNY: -20 },
          children: [],
        },
      ],
    },
  ],
}

describe('readInventory', () => {
  test('keeps only the operating currency and names the rest', () => {
    expect(readInventory({ CNY: 5, USD: 10 }, 'CNY')).toEqual({
      amount: 5,
      unconverted: ['USD'],
    })
  })

  test('reads an Amount object from a posting query', () => {
    expect(readInventory({ number: 8, currency: 'CNY' }, 'CNY')).toEqual({
      amount: 8,
      unconverted: [],
    })
  })

  test('does not treat a missing currency as the operating currency', () => {
    expect(readInventory({ USD: 4 }, 'CNY').amount).toBe(0)
  })
})

describe('asOfFromDateRange', () => {
  test('steps back from Fava’s exclusive end date', () => {
    expect(asOfFromDateRange({ begin: '2026-01-01', end: '2027-01-01' })).toBe('2026-12-31')
    expect(asOfFromDateRange({ begin: '2026-01-01', end: '2026-02-01' })).toBe('2026-01-31')
  })
})

describe('periodFromDateRange', () => {
  test('keeps the inclusive start and steps the exclusive end back one day', () => {
    expect(periodFromDateRange({ begin: '2026-01-01', end: '2026-02-01' })).toEqual({
      from: '2026-01-01',
      to: '2026-01-31',
    })
    expect(periodFromDateRange({ end: '2026-02-01' })).toBeNull()
  })
})

describe('slugFromRedirectUrl', () => {
  test('reads the slug from a Fava redirect and from the dev proxy', () => {
    expect(slugFromRedirectUrl('http://127.0.0.1:5000/beancount/income_statement/')).toBe(
      'beancount',
    )
    expect(slugFromRedirectUrl('http://localhost:5188/api/fava/opc/api/ledger_data')).toBe('opc')
    expect(slugFromRedirectUrl('http://127.0.0.1:5000/')).toBeNull()
  })
})

describe('responseLooksLikeFava', () => {
  test('accepts Fava’s redirect and a followed ledger URL', () => {
    expect(
      responseLooksLikeFava(302, 'http://127.0.0.1:5000/', '/opc/income_statement/'),
    ).toBe(true)
    expect(
      responseLooksLikeFava(200, 'http://127.0.0.1:5000/opc/income_statement/', null),
    ).toBe(true)
  })

  test('rejects another program listening on the Fava port', () => {
    expect(responseLooksLikeFava(403, 'http://127.0.0.1:5000/', null)).toBe(false)
    expect(responseLooksLikeFava(200, 'http://127.0.0.1:5000/', null)).toBe(false)
  })
})

describe('buildBalanceSheet', () => {
  test('uses the closed equity tree and does not add earnings a second time', () => {
    const sheet = buildBalanceSheet({
      report: CLOSED_SHEET,
      currency: 'CNY',
      names: NAMES,
    })
    expect(sheet.as_of).toBe('2026-12-31')
    expect(sheet.totals.equity).toBe(-70)
    expect(sheet.totals.balanced).toBe(true)
    const earnings = sheet.sections
      .find((section) => section.section === 'equity')
      ?.children.find((node) => node.account === 'Equity:Earnings:Current')
    expect(earnings?.total).toBe(-20)
    expect(earnings?.label_key).toBe('balanceSheet.unclosedEarnings')
  })

  test('reports a currency that Fava could not convert', () => {
    const sheet = buildBalanceSheet({
      report: {
        trees: [
          {
            account: 'Assets',
            balance: {},
            balance_children: { CNY: 10, USD: 3 },
            children: [
              {
                account: 'Assets:Broker',
                balance: { USD: 3 },
                balance_children: { CNY: 10, USD: 3 },
                children: [],
              },
            ],
          },
        ],
      },
      currency: 'CNY',
      names: NAMES,
    })
    expect(sheet.unconverted_currencies).toEqual(['USD'])
    expect(sheet.totals.assets).toBe(10)
  })

  test('honours renamed root accounts', () => {
    const names = rootNames({ name_assets: 'Activos', name_equity: 'Capital' })
    const sheet = buildBalanceSheet({
      report: {
        trees: [
          { account: 'Activos', balance_children: { EUR: 5 }, children: [] },
          {
            account: 'Capital',
            balance_children: { EUR: -5 },
            children: [
              {
                account: 'Capital:Earnings:Current',
                balance_children: { EUR: -5 },
                children: [],
              },
            ],
          },
        ],
      },
      currency: 'EUR',
      names,
    })
    expect(sheet.sections.map((section) => section.section)).toEqual(['assets', 'equity'])
    const earnings = sheet.sections
      .find((section) => section.section === 'equity')
      ?.children.find((node) => node.account === 'Capital:Earnings:Current')
    expect(earnings?.total).toBe(-5)
  })
})

describe('buildIncomeStatement', () => {
  test('ignores the localized net-profit node and keeps root totals raw', () => {
    const statement = buildIncomeStatement({
      report: {
        trees: [
          { account: 'Income', balance_children: { CNY: -40 }, children: [] },
          { account: '净利润', balance_children: { CNY: -25 }, children: [] },
          { account: 'Expenses', balance_children: { CNY: 15 }, children: [] },
        ],
      },
      currency: 'CNY',
      names: NAMES,
    })
    expect(statement.sections.map((section) => [section.section, section.total])).toEqual([
      ['income', -40],
      ['expenses', 15],
    ])
    expect(statement.period).toBeNull()
  })

  test('a debit on income stays a debit on the section', () => {
    const statement = buildIncomeStatement({
      report: {
        date_range: { begin: '2026-01-01', end: '2026-02-01' },
        trees: [{ account: 'Income', balance_children: { CNY: 5 }, children: [] }],
      },
      currency: 'CNY',
      names: NAMES,
    })
    expect(statement.sections.find((section) => section.section === 'income')?.total).toBe(5)
    expect(statement.period).toEqual({ from: '2026-01-01', to: '2026-01-31' })
  })
})

describe('buildTrialBalance', () => {
  test('footer totals are the root accounts, not the expanded children', () => {
    const trial = buildTrialBalance({
      report: {
        date_range: { begin: '2026-01-01', end: '2027-01-01' },
        trees: [
          {
            account: '',
            children: [
              {
                account: 'Assets',
                balance_children: { CNY: 100 },
                children: [
                  {
                    account: 'Assets:Bank',
                    balance_children: { CNY: 100 },
                    children: [],
                  },
                ],
              },
              {
                account: 'Liabilities',
                balance_children: { CNY: -40 },
                children: [],
              },
              {
                account: 'Equity',
                balance_children: { CNY: -50 },
                children: [],
              },
              {
                account: 'Income',
                balance_children: { CNY: -20 },
                children: [],
              },
              {
                account: 'Expenses',
                balance_children: { CNY: 10 },
                children: [],
              },
            ],
          },
        ],
      },
      currency: 'CNY',
      names: NAMES,
    })

    expect(trial.as_of).toBe('2026-12-31')
    expect(trial.totals.totalDebits).toBe(110)
    expect(trial.totals.totalCredits).toBe(110)
    expect(trial.totals.balanced).toBe(true)

    const assets = trial.sections.find((section) => section.rootAccount === 'Assets')
    expect(assets?.root).toBe('assets')
    expect(assets?.children[0]?.total).toBe(100)
    expect(trial.sections.find((section) => section.rootAccount === 'Income')?.root).toBe('income')
    expect(trial.sections.find((section) => section.rootAccount === 'Expenses')?.root).toBe('expenses')
  })
})
