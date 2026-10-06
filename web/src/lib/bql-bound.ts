import type { BQLQueryResult } from '@/lib/fava-client'

/**
 * Rows the query page will keep. The statement is not rewritten.
 * A longer result is cut only after it comes back, and the page says so.
 */
export const BQL_ROW_CAP = 50_000

export interface BoundedBqlResult extends BQLQueryResult {
  total: number
  truncated: boolean
}

export function capQueryRows(result: BQLQueryResult, cap = BQL_ROW_CAP): BoundedBqlResult {
  const total = result.rows.length
  if (total <= cap) return { ...result, total, truncated: false }
  return { ...result, rows: result.rows.slice(0, cap), total, truncated: true }
}
