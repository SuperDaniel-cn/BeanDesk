import { describe, expect, test } from 'bun:test'

import {
  connectionAction,
  hostFromSnapshot,
  hostUptime,
  idleHost,
  sessionLost,
} from './host'

const owned = hostFromSnapshot(
  { running: true, pid: 42, startedMs: 1_000 },
  { kind: 'fava' },
  'http://127.0.0.1:5000',
  1_000,
)

const attached = hostFromSnapshot(
  { running: false, pid: null, startedMs: null },
  { kind: 'fava' },
  'http://127.0.0.1:5000',
)

const down = hostFromSnapshot(
  { running: false, pid: null, startedMs: null },
  { kind: 'closed' },
  'http://127.0.0.1:5000',
)

describe('connectionAction', () => {
  test('stops only when this window owns the process', () => {
    expect(connectionAction({ status: 'ready', owned: true, busy: false })).toBe('stop')
    expect(connectionAction({ status: 'ready', owned: false, busy: false })).toBe('disconnect')
    expect(connectionAction({ status: 'setup', owned: false, busy: false })).toBe('connect')
    expect(connectionAction({ status: 'boot', owned: false, busy: false })).toBe('auto')
    expect(connectionAction({ status: 'boot', owned: true, busy: false })).toBe('stop')
    expect(connectionAction({ status: 'setup', owned: false, busy: true })).toBe('busy')
  })
})

describe('sessionLost', () => {
  test('drops a ready session when the owned child dies or attached Fava stops', () => {
    expect(sessionLost(owned, down, 'ready')).toBe(true)
    expect(sessionLost(attached, down, 'ready')).toBe(false)
    expect(sessionLost(attached, down, 'ready', 2)).toBe(true)
    expect(sessionLost(idleHost(), attached, 'ready')).toBe(false)
    expect(sessionLost(attached, down, 'setup')).toBe(false)
    expect(sessionLost(idleHost(), down, 'ready')).toBe(false)
  })
})

describe('hostUptime', () => {
  test('uses seconds under a minute and minutes after that', () => {
    expect(hostUptime(0, 12_000)).toEqual({ unit: 'seconds', count: 12 })
    expect(hostUptime(0, 120_000)).toEqual({ unit: 'minutes', count: 2 })
  })
})
