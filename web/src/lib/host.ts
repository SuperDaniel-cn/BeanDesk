import type { OriginProbe } from '@/lib/fava-client'

export type DesktopStatus = 'boot' | 'setup' | 'ready'

export type HostSnapshot = {
  running: boolean
  pid: number | null
  startedMs: number | null
}

export type HostProbe = OriginProbe | { kind: 'idle' }

export type HostView = {
  owned: boolean
  pid: number | null
  startedAt: number | null
  observedAt: number | null
  probe: HostProbe
  origin: string | null
}

export type ConnectionAction = 'connect' | 'stop' | 'disconnect' | 'auto' | 'busy'

export function idleHost(): HostView {
  return {
    owned: false,
    pid: null,
    startedAt: null,
    observedAt: null,
    probe: { kind: 'idle' },
    origin: null,
  }
}

export function hostFromSnapshot(
  snap: HostSnapshot,
  probe: HostProbe,
  origin: string | null,
  now = 0,
): HostView {
  return {
    owned: snap.running,
    pid: snap.pid,
    startedAt: snap.startedMs,
    observedAt: snap.startedMs == null ? null : now,
    probe,
    origin,
  }
}

export function emptyHostSnapshot(): HostSnapshot {
  return { running: false, pid: null, startedMs: null }
}

/** Drop a live session when this window's child died, or an attached Fava stopped answering. */
export function sessionLost(previous: HostView, next: HostView, status: DesktopStatus): boolean {
  if (status !== 'ready') return false
  if (previous.owned && !next.owned) return true
  return (
    !next.owned &&
    previous.probe.kind === 'fava' &&
    next.probe.kind !== 'fava' &&
    next.probe.kind !== 'idle'
  )
}

export function connectionAction(input: {
  status: DesktopStatus
  owned: boolean
  busy: boolean
}): ConnectionAction {
  if (input.status === 'boot') return 'auto'
  if (input.busy) return 'busy'
  if (input.status === 'ready' && input.owned) return 'stop'
  if (input.status === 'ready') return 'disconnect'
  return 'connect'
}

export function hostUptime(
  startedAt: number,
  now: number,
): { unit: 'seconds' | 'minutes'; count: number } {
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1000))
  if (seconds < 60) return { unit: 'seconds', count: seconds }
  return { unit: 'minutes', count: Math.floor(seconds / 60) }
}
