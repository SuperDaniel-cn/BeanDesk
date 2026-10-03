import { describe, expect, test } from 'bun:test'

import {
  activeConnection,
  isLedgerConnection,
  isLoopbackOrigin,
  normalizeOrigin,
  readConnectionFile,
  withDrafts,
} from './connection'

describe('normalizeOrigin', () => {
  test('keeps an http origin and drops a trailing slash', () => {
    expect(normalizeOrigin('http://127.0.0.1:5000/')).toBe('http://127.0.0.1:5000')
    expect(normalizeOrigin(' https://books.example ')).toBe('https://books.example')
  })

  test('rejects paths, queries, and missing schemes', () => {
    expect(normalizeOrigin('http://127.0.0.1:5000/beancount')).toBeNull()
    expect(normalizeOrigin('http://127.0.0.1:5000?x=1')).toBeNull()
    expect(normalizeOrigin('127.0.0.1:5000')).toBeNull()
    expect(normalizeOrigin('file:///tmp')).toBeNull()
  })
})

describe('isLoopbackOrigin', () => {
  test('accepts localhost and loopback addresses', () => {
    expect(isLoopbackOrigin('http://127.0.0.1:5000')).toBe(true)
    expect(isLoopbackOrigin('http://localhost:5000')).toBe(true)
    expect(isLoopbackOrigin('http://[::1]:5000')).toBe(true)
    expect(isLoopbackOrigin('http://192.168.1.8:5000')).toBe(false)
  })
})

describe('isLedgerConnection', () => {
  test('requires a loopback origin for a local project', () => {
    expect(
      isLedgerConnection({
        kind: 'local',
        directory: '/tmp/ledger',
        command: 'make run',
        origin: 'http://192.168.1.8:5000',
      }),
    ).toBe(false)
    expect(
      isLedgerConnection({
        kind: 'remote',
        origin: 'https://books.example',
      }),
    ).toBe(true)
  })
})

describe('readConnectionFile', () => {
  test('keeps the local project when connect-only is the active mode', () => {
    const file = readConnectionFile({
      active: 'remote',
      local: {
        directory: '/tmp/ledger',
        command: 'make run',
        origin: 'http://127.0.0.1:5000/',
      },
      remote: { origin: 'https://books.example' },
    })
    expect(file?.active).toBe('remote')
    expect(file?.local).toEqual({
      directory: '/tmp/ledger',
      command: 'make run',
      origin: 'http://127.0.0.1:5000',
    })
    expect(activeConnection(file!)?.kind).toBe('remote')
  })

  test('reads a single record from before the two drafts existed', () => {
    expect(
      readConnectionFile({
        kind: 'local',
        directory: '/tmp/ledger',
        command: ' make run ',
        origin: 'http://127.0.0.1:5000',
      }),
    ).toEqual({
      active: 'local',
      local: {
        directory: '/tmp/ledger',
        command: 'make run',
        origin: 'http://127.0.0.1:5000',
      },
      remote: null,
    })
  })

  test('an incomplete edit does not erase the saved local project', () => {
    const previous = readConnectionFile({
      active: 'remote',
      local: {
        directory: '/tmp/ledger',
        command: 'make run',
        origin: 'http://127.0.0.1:5000',
      },
      remote: { origin: 'https://books.example' },
    })
    if (previous == null) throw new Error('expected a saved connection')
    expect(withDrafts('remote', null, { origin: 'https://books.example' }, previous)).toEqual(
      previous,
    )
  })
})
