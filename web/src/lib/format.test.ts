import { describe, expect, test } from 'bun:test'

import {
  displayAccountName,
  formatCurrency,
  formatQueryValue,
  formatSignedCurrency,
  presentBalance,
  presentIncome,
  presentQueryCell,
  querySortValue,
  toDisplay,
} from './format'

describe('displayAccountName', () => {
  test('uses the Chinese segment after the last hyphen', () => {
    expect(displayAccountName('Delivery-交付')).toBe('交付')
    expect(displayAccountName('Opening-Balances-期初平衡')).toBe('期初平衡')
    expect(displayAccountName('Earnings')).toBe('Earnings')
  })
})

describe('toDisplay', () => {
  // AGENTS.md §3.4 — Beancount stores income and liabilities as negatives.
  test('flips a raw income figure so revenue reads positive', () => {
    expect(toDisplay(-71640)).toBe(71640)
  })

  test('is its own inverse', () => {
    expect(toDisplay(toDisplay(-123.45))).toBe(-123.45)
  })

  test('keeps zero unsigned', () => {
    expect(Object.is(toDisplay(0), 0)).toBe(true)
  })
})

describe('presentIncome', () => {
  test('flips income and leaves expenses as debits', () => {
    expect(presentIncome('income', -100)).toBe(100)
    expect(presentIncome('expenses', 40)).toBe(40)
  })
})

describe('presentBalance', () => {
  test('flips liabilities and equity and leaves assets as debits', () => {
    expect(presentBalance('assets', 100)).toBe(100)
    expect(presentBalance('liabilities', -30)).toBe(30)
    expect(presentBalance('equity', -70)).toBe(70)
  })
})

describe('formatCurrency', () => {
  test('formats a known ISO code', () => {
    expect(formatCurrency(52375.5, 'USD', 'en-US')).toBe('$52,375.50')
  })

  test('uses the locale of the reader, not of the currency', () => {
    // Same amount, same currency, two audiences.
    expect(formatCurrency(52375.5, 'USD', 'zh-CN')).toBe('US$52,375.50')
    expect(formatCurrency(52375.5, 'CNY', 'zh-CN')).toBe('¥52,375.50')
  })

  test('falls back to a plain number for an unknown code', () => {
    // Intl throws a RangeError on a malformed code; the fallback must not.
    expect(formatCurrency(10, 'NOT-A-CODE', 'en-US')).toContain('NOT-A-CODE')
  })
})

describe('formatSignedCurrency', () => {
  test('marks a profit with a plus', () => {
    expect(formatSignedCurrency(51375.5, 'USD', 'en-US')).toBe('+$51,375.50')
  })

  test('marks a loss with a minus', () => {
    expect(formatSignedCurrency(-42, 'USD', 'en-US')).toBe('−$42.00')
  })

  test('leaves zero unsigned', () => {
    expect(formatSignedCurrency(0, 'USD', 'en-US')).toBe('$0.00')
  })
})

describe('formatQueryValue', () => {
  test('prints an inventory as currency, not JSON', () => {
    expect(formatQueryValue({ CNY: 10650 }, 'zh-CN')).toBe('¥10,650.00')
    expect(formatQueryValue({ CNY: -29715.47 }, 'zh-CN')).toBe('-¥29,715.47')
  })

  test('prints an amount object as currency', () => {
    expect(formatQueryValue({ number: 12.5, currency: 'CNY' }, 'zh-CN')).toBe('¥12.50')
  })

  test('keeps years and months as plain integers', () => {
    expect(formatQueryValue(2026, 'en-US')).toBe('2026')
    expect(formatQueryValue(1, 'en-US')).toBe('1')
  })

  test('joins more than one commodity', () => {
    expect(formatQueryValue({ CNY: 10, USD: 2 }, 'en-US')).toBe('CN¥10.00, $2.00')
  })

  test('reads the units inside a position', () => {
    expect(formatQueryValue({ units: { number: 1, currency: 'CNY' } }, 'zh-CN')).toBe('¥1.00')
  })

  test('does not dump an unrecognised object', () => {
    expect(formatQueryValue({ meta: { filename: 'main.bean' } }, 'en-US')).toBe('—')
  })

  test('shows the Chinese leaf of an account path', () => {
    expect(presentQueryCell('Assets:Bank:Operating-经营户', 'zh-CN')).toBe('经营户')
    expect(presentQueryCell('2026-01-31', 'zh-CN')).toBe('2026-01-31')
  })

  test('sorts an amount and a one-currency inventory by their number', () => {
    expect(querySortValue({ number: 12.5, currency: 'CNY' })).toBe(12.5)
    expect(querySortValue({ CNY: 8000 })).toBe(8000)
    expect(querySortValue(null)).toBe(null)
    expect(querySortValue(['payroll'])).toBe('payroll')
  })
})

describe('formatDate', () => {
  test('renders per locale', async () => {
    const { formatDate } = await import('./format')
    expect(formatDate('2026-10-01', 'en-GB')).toBe('1 Oct 2026')
    expect(formatDate('2026-10-01', 'zh-CN')).toBe('2026年10月1日')
  })

  test('handles an absent date', async () => {
    const { formatDate } = await import('./format')
    expect(formatDate(null, 'en-US')).toBe('—')
  })
})
