import { describe, expect, test } from 'bun:test'

import { capQueryRows } from './bql-bound'

describe('capQueryRows', () => {
  test('keeps a short result and records how many rows came back', () => {
    const short = capQueryRows({ types: [], rows: [[1]] }, 2)
    expect(short.truncated).toBe(false)
    expect(short.total).toBe(1)
    expect(short.rows).toEqual([[1]])
  })

  test('cuts a longer result without dropping the original count', () => {
    const cut = capQueryRows({ types: [], rows: [[1], [2], [3]] }, 2)
    expect(cut.truncated).toBe(true)
    expect(cut.total).toBe(3)
    expect(cut.rows).toEqual([[1], [2]])
  })
})
