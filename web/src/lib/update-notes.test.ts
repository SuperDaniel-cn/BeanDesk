import { describe, expect, test } from 'bun:test'

import { updateNotes } from './update-notes'

describe('updateNotes', () => {
  test('returns trimmed notes', () => {
    expect(updateNotes('  Policy rules after bean-check.\n')).toBe('Policy rules after bean-check.')
  })

  test('omits empty bodies', () => {
    expect(updateNotes(undefined)).toBeNull()
    expect(updateNotes(null)).toBeNull()
    expect(updateNotes('')).toBeNull()
    expect(updateNotes('   \n')).toBeNull()
  })
})
