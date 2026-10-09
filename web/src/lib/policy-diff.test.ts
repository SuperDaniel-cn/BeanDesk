import { describe, expect, test } from 'bun:test'

import { lineDiff } from './policy-diff'

describe('lineDiff', () => {
  test('marks only the changed line', () => {
    expect(lineDiff('a\nb\nc\n', 'a\nB\nc\n')).toEqual([
      { tag: 'eq', text: 'a' },
      { tag: 'del', text: 'b' },
      { tag: 'add', text: 'B' },
      { tag: 'eq', text: 'c' },
      { tag: 'eq', text: '' },
    ])
  })

  test('treats a missing trusted copy as additions', () => {
    expect(lineDiff(null, 'one\n')).toEqual([
      { tag: 'add', text: 'one' },
      { tag: 'add', text: '' },
    ])
  })

  test('treats a missing disk copy as deletions', () => {
    expect(lineDiff('one\n', null)).toEqual([
      { tag: 'del', text: 'one' },
      { tag: 'del', text: '' },
    ])
  })
})
