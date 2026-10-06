import { describe, expect, test } from 'bun:test'

import {
  connectionAction,
  finishBoot,
  hostFromSnapshot,
  hostProbeCopyKey,
  hostUptime,
  idleHost,
  sessionLost,
  shouldProbeOrigin,
  switchNeedsConfirm,
  switchWarning,
  type DesktopStatus,
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

describe('shouldProbeOrigin', () => {
  test('does not probe a saved origin after disconnect', () => {
    expect(shouldProbeOrigin('ready')).toBe(true)
    expect(shouldProbeOrigin('boot')).toBe(true)
    expect(shouldProbeOrigin('setup')).toBe(false)
  })
})

describe('hostProbeCopyKey', () => {
  test('names a live probe and stays silent when idle', () => {
    expect(hostProbeCopyKey({ kind: 'fava' })).toBe('settings.hostProbeFava')
    expect(hostProbeCopyKey({ kind: 'occupied', server: 'nginx' })).toBe(
      'settings.hostProbeOccupied',
    )
    expect(hostProbeCopyKey({ kind: 'closed' })).toBe('settings.hostProbeClosed')
    expect(hostProbeCopyKey({ kind: 'idle' })).toBeNull()
  })
})

describe('switchNeedsConfirm', () => {
  test('asks before leaving a live or starting session', () => {
    expect(switchNeedsConfirm('ready')).toBe(true)
    expect(switchNeedsConfirm('boot')).toBe(true)
    expect(switchNeedsConfirm('setup')).toBe(false)
  })

  test('names what the confirm step will disconnect', () => {
    expect(switchWarning('ready', true)).toBe('stop')
    expect(switchWarning('boot', true)).toBe('stop')
    expect(switchWarning('ready', false)).toBe('detach')
    expect(switchWarning('boot', false)).toBe('interrupt')
  })

  test('a finished startup does not replace a session that already left boot', () => {
    const booting: { status: DesktopStatus; file: string } = { status: 'boot', file: 'old' }
    const released: { status: DesktopStatus; file: string } = { status: 'setup', file: 'new' }
    expect(finishBoot(booting, { status: 'ready', file: 'old' })).toEqual({
      status: 'ready',
      file: 'old',
    })
    expect(finishBoot(released, { status: 'ready', file: 'old' })).toEqual(released)
  })
})

describe('hostUptime', () => {
  test('uses seconds under a minute and minutes after that', () => {
    expect(hostUptime(0, 12_000)).toEqual({ unit: 'seconds', count: 12 })
    expect(hostUptime(0, 120_000)).toEqual({ unit: 'minutes', count: 2 })
  })
})
