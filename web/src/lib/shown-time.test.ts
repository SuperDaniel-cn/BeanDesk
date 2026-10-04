import { describe, expect, test } from 'bun:test'

import { shownPrior } from './shown-time'

describe('shownPrior', () => {
  test('uses the live query when the shown period is the one being fetched', () => {
    expect(shownPrior('2025', '2025', { n: 1 }, { n: 2 })).toEqual({ n: 1 })
  })

  test('uses the cached prior while a newer period is still loading', () => {
    expect(shownPrior('2025', '2026', { n: 1 }, { n: 2 })).toEqual({ n: 2 })
  })

  test('has no prior column for all-time', () => {
    expect(shownPrior(null, null, { n: 1 }, { n: 2 })).toBeNull()
  })
})
