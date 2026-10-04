import { describe, expect, test } from 'bun:test'

import type { MessageKey } from '@/i18n/locales/en'

import {
  activeConnection,
  emptyConnectionForm,
  explainConnectionError,
  formFromConnectionFile,
  isLedgerConnection,
  isLoopbackOrigin,
  isPristineConnectionForm,
  localDraft,
  localWorkdir,
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
  test('allows an empty start command on a saved local project', () => {
    expect(
      isLedgerConnection({
        kind: 'local',
        directory: '/tmp/ledger',
        command: '',
        origin: 'http://127.0.0.1:5000',
      }),
    ).toBe(true)
    expect(localDraft('/tmp/ledger', '  ', 'http://127.0.0.1:5000/')).toBeNull()
    expect(localWorkdir('/tmp/ledger', 'http://127.0.0.1:5000/')).toEqual({
      directory: '/tmp/ledger',
      command: '',
      origin: 'http://127.0.0.1:5000',
    })
  })

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

  test('fills the settings form from a file that arrives after the first paint', () => {
    const file = readConnectionFile({
      active: 'local',
      local: {
        directory: '/tmp/ledger',
        command: 'make run',
        origin: 'http://127.0.0.1:5000',
      },
      remote: { origin: 'https://books.example' },
    })
    if (file == null) throw new Error('expected a saved connection')
    expect(isPristineConnectionForm(emptyConnectionForm())).toBe(true)
    expect(formFromConnectionFile(file)).toEqual({
      kind: 'local',
      directory: '/tmp/ledger',
      command: 'make run',
      localOrigin: 'http://127.0.0.1:5000',
      remoteOrigin: 'https://books.example',
    })
    expect(
      isPristineConnectionForm({
        ...emptyConnectionForm(),
        command: 'fava main.bean',
      }),
    ).toBe(false)
  })

  test('keeps an empty command when reading a saved local draft', () => {
    expect(
      readConnectionFile({
        active: 'local',
        local: {
          directory: '/tmp/ledger',
          command: '',
          origin: 'http://127.0.0.1:5000',
        },
        remote: null,
      }),
    ).toEqual({
      active: 'local',
      local: {
        directory: '/tmp/ledger',
        command: '',
        origin: 'http://127.0.0.1:5000',
      },
      remote: null,
    })
  })

  test('explains a missing bundled engine', () => {
    const t = (key: MessageKey) => key
    expect(explainConnectionError('missing-engine', t)).toBe('settings.missingEngine')
    expect(explainConnectionError('ledger-exists', t)).toBe('settings.createFirstLedgerExists')
    expect(explainConnectionError('not-empty', t)).toBe('settings.createFirstLedgerNotEmpty')
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
