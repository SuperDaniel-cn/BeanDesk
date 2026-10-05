import { describe, expect, test } from 'bun:test'

import { firstSettled, HANDBOOK_WARM_MS } from './desktop-shell'

describe('desktop shell warm-up', () => {
  test('shows after the handbook ready signal or the warm budget', async () => {
    expect(HANDBOOK_WARM_MS).toBe(1500)
    const started = Date.now()
    await firstSettled(new Promise<void>(() => undefined), 20)
    expect(Date.now() - started).toBeLessThan(200)
    let released = false
    await firstSettled(
      new Promise<void>((resolve) => {
        released = true
        resolve()
      }),
      500,
    )
    expect(released).toBe(true)
  })
})
