import { describe, expect, test } from 'bun:test'

import { csvCell, csvFilename, formatCsv } from './csv'

describe('csv', () => {
  test('quotes a comma and doubles an embedded quote', () => {
    expect(csvCell('a,b')).toBe('"a,b"')
    expect(csvCell('say "hi"')).toBe('"say ""hi"""')
  })

  test('writes metadata lines above the header and the data', () => {
    expect(
      formatCsv(
        ['Studio', 'CNY', '2026 Q1', 'Trial balance'],
        ['Account', 'Debit', 'Credit'],
        [['Cash', '10', ''], ['Bank', '1,200', '0']],
      ),
    ).toBe(
      [
        '# Studio',
        '# CNY',
        '# 2026 Q1',
        '# Trial balance',
        '"Account","Debit","Credit"',
        '"Cash","10",""',
        '"Bank","1,200","0"',
      ].join('\n'),
    )
  })

  test('joins a file name from the ledger, the report, and the period token', () => {
    expect(csvFilename(['Acme / Books', 'Income statement', '2026-Q1'])).toBe(
      'Acme - Books-Income statement-2026-Q1.csv',
    )
    expect(csvFilename(['', '', ''])).toBe('export.csv')
  })
})
