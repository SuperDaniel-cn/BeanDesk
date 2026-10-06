import { describe, expect, test } from 'bun:test'

import type { MessageKey } from '@/i18n/locales/en'

import {
  activeConnection,
  emptyConnectionForm,
  explainConnectionError,
  fileForLinkMode,
  formFromConnectionFile,
  isLedgerConnection,
  isLoopbackOrigin,
  isPristineConnectionForm,
  linkModeOf,
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
      launch: 'engine',
    })
    expect(localWorkdir('/tmp/ledger', 'http://127.0.0.1:5000', 'make run', 'engine')).toEqual({
      directory: '/tmp/ledger',
      command: 'make run',
      origin: 'http://127.0.0.1:5000',
      launch: 'engine',
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
      launch: 'shell',
    })
    expect(activeConnection(file!)?.kind).toBe('remote')
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
        launch: 'engine',
      },
      remote: null,
    })
  })

  test('keeps a shell command when the simple page selects the bundled engine', () => {
    const previous = readConnectionFile({
      active: 'local',
      local: {
        directory: '/tmp/ledger',
        command: 'make run',
        origin: 'http://127.0.0.1:5000',
      },
      remote: null,
    })
    const next = withDrafts(
      'local',
      localWorkdir('/tmp/ledger', 'http://127.0.0.1:5000', 'make run', 'engine'),
      null,
      previous,
    )
    expect(next.local).toEqual({
      directory: '/tmp/ledger',
      command: 'make run',
      origin: 'http://127.0.0.1:5000',
      launch: 'engine',
    })
    expect(
      readConnectionFile({
        active: 'local',
        local: next.local,
        remote: null,
      })?.local?.launch,
    ).toBe('engine')
  })

  test('explains a missing bundled engine', () => {
    const t = (key: MessageKey) => key
    expect(explainConnectionError('missing-engine', t)).toBe('settings.missingEngine')
    expect(explainConnectionError('ledger-exists', t)).toBe('settings.createFirstLedgerExists')
    expect(explainConnectionError('not-empty', t)).toBe('settings.createFirstLedgerNotEmpty')
    expect(explainConnectionError('airplay', t)).toBe('settings.airplayPort')
  })

  test('reads the three exclusive link modes', () => {
    const engine = readConnectionFile({
      active: 'local',
      local: {
        directory: '/tmp/ledger',
        command: 'make run',
        origin: 'http://127.0.0.1:5000',
        launch: 'engine',
      },
      remote: { origin: 'https://books.example' },
    })
    const shell = readConnectionFile({
      active: 'local',
      local: {
        directory: '/tmp/ledger',
        command: 'make run',
        origin: 'http://127.0.0.1:5000',
        launch: 'shell',
      },
      remote: null,
    })
    if (shell == null) throw new Error('expected a shell connection')
    const direct = readConnectionFile({
      active: 'remote',
      local: shell.local,
      remote: { origin: 'https://books.example' },
    })
    expect(linkModeOf(null)).toBe('engine')
    expect(linkModeOf(engine)).toBe('engine')
    expect(linkModeOf(shell)).toBe('shell')
    expect(linkModeOf(direct)).toBe('direct')
  })

  test('switching link mode keeps the other draft', () => {
    const previous = readConnectionFile({
      active: 'local',
      local: {
        directory: '/tmp/ledger',
        command: 'make run',
        origin: 'http://127.0.0.1:5000',
        launch: 'shell',
      },
      remote: { origin: 'https://books.example' },
    })
    const engine = fileForLinkMode(
      'engine',
      '/tmp/ledger',
      'make run',
      'http://127.0.0.1:5000',
      'https://books.example',
      previous,
    )
    expect(engine.active).toBe('local')
    expect(engine.local).toEqual({
      directory: '/tmp/ledger',
      command: 'make run',
      origin: 'http://127.0.0.1:5000',
      launch: 'engine',
    })
    expect(engine.remote).toEqual({ origin: 'https://books.example' })

    const enginePort = fileForLinkMode(
      'engine',
      '/tmp/ledger',
      'make run',
      'http://127.0.0.1:5001',
      'https://books.example',
      engine,
    )
    expect(enginePort.local?.launch).toBe('engine')
    expect(enginePort.local?.origin).toBe('http://127.0.0.1:5001')
    expect(enginePort.local?.command).toBe('make run')

    const direct = fileForLinkMode(
      'direct',
      '/tmp/ledger',
      'make run',
      'http://127.0.0.1:5000',
      'https://books.example',
      engine,
    )
    expect(direct.active).toBe('remote')
    expect(direct.local?.launch).toBe('engine')
    expect(direct.local?.command).toBe('make run')
    expect(linkModeOf(direct)).toBe('direct')

    const shell = fileForLinkMode(
      'shell',
      '/tmp/ledger',
      'make run',
      'http://127.0.0.1:5000',
      'https://books.example',
      direct,
    )
    expect(shell.active).toBe('local')
    expect(shell.local?.launch).toBe('shell')
    expect(shell.remote?.origin).toBe('https://books.example')
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
