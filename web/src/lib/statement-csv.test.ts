import { describe, expect, test } from 'bun:test'

import { formatCsv } from './csv'
import { incomeCsvTable } from './statement-csv'

const t = (key: string) => key

describe('incomeCsvTable', () => {
  test('adds last year and the change when comparing', () => {
    const table = incomeCsvTable(
      {
        nodes: [
          {
            account: 'Income:A',
            name: 'Income:A-咨询',
            label_key: null,
            current: -100,
            prior: -40,
            children: [],
          },
        ],
        current: -100,
        prior: -40,
      },
      { nodes: [], current: 30, prior: 10 },
      'CNY',
      true,
      t as never,
      (value) => String(value),
      (value) => String(value),
      '2026',
      '2025',
    )
    expect(table.headers).toEqual([
      'common.section',
      'balanceSheet.account',
      '2026',
      '2025',
      'compare.delta',
    ])
    expect(table.rows[0]).toEqual(['income.revenueTitle', '咨询', '100', '40', '60'])
    const csv = formatCsv(['Studio', 'CNY', '2026', 'Income'], table.headers, table.rows)
    expect(csv.startsWith('# Studio\n# CNY\n# 2026\n# Income\n')).toBe(true)
    expect(csv).toContain('"2026","2025","compare.delta"')
  })
})
