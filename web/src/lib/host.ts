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
  probe: HostProbe
  origin: string | null
}

export type ConnectionAction = 'connect' | 'stop' | 'disconnect' | 'auto' | 'busy'

export function idleHost(): HostView {
  return {
    owned: false,
    pid: null,
    startedAt: null,
    probe: { kind: 'idle' },
    origin: null,
  }
}

export function hostFromSnapshot(
  snap: HostSnapshot,
  probe: HostProbe,
  origin: string | null,
): HostView {
  return {
    owned: snap.running,
    pid: snap.pid,
    startedAt: snap.startedMs,
    probe,
    origin,
  }
}

export function emptyHostSnapshot(): HostSnapshot {
  return { running: false, pid: null, startedMs: null }
}

function probeEqual(left: HostProbe, right: HostProbe): boolean {
  if (left.kind !== right.kind) return false
  if (left.kind === 'occupied' && right.kind === 'occupied') return left.server === right.server
  return true
}

export function hostSnapshotEqual(left: HostView, right: HostView): boolean {
  return (
    left.owned === right.owned &&
    left.pid === right.pid &&
    left.startedAt === right.startedAt &&
    left.origin === right.origin &&
    probeEqual(left.probe, right.probe)
  )
}

/** Drop a live session when this window's child died, or an attached Fava missed twice. */
export function sessionLost(
  previous: HostView,
  next: HostView,
  status: DesktopStatus,
  attachedMisses = 0,
): boolean {
  if (status !== 'ready') return false
  if (previous.owned && !next.owned) return true
  if (next.owned || next.probe.kind === 'fava' || next.probe.kind === 'idle') return false
  return attachedMisses >= 2
}

export type SwitchWarning = 'stop' | 'detach' | 'interrupt'

function liveSession(status: DesktopStatus): boolean {
  return status === 'ready' || status === 'boot'
}

/** Probe the saved origin only while connected or still starting. */
export function shouldProbeOrigin(status: DesktopStatus): boolean {
  return liveSession(status)
}

/** Copy key for a live probe. Idle (including disconnected) stays silent. */
export function hostProbeCopyKey(
  probe: HostProbe,
): 'settings.hostProbeFava' | 'settings.hostProbeOccupied' | 'settings.hostProbeClosed' | null {
  if (probe.kind === 'fava') return 'settings.hostProbeFava'
  if (probe.kind === 'occupied') return 'settings.hostProbeOccupied'
  if (probe.kind === 'closed') return 'settings.hostProbeClosed'
  return null
}

/** A live or starting session has to be confirmed before the link mode changes. */
export function switchNeedsConfirm(status: DesktopStatus): boolean {
  return liveSession(status)
}

/** Owned processes stop. A start still in flight is interrupted. An attached service only detaches. */
export function switchWarning(status: DesktopStatus, owned: boolean): SwitchWarning {
  if (owned) return 'stop'
  if (status === 'boot') return 'interrupt'
  return 'detach'
}

/**
 * A finished startup attempt must not replace a session that already left boot,
 * such as a confirmed mode switch that disconnected while startup was still running.
 */
export function finishBoot<T extends { status: DesktopStatus }>(current: T, next: T): T {
  return current.status === 'boot' ? next : current
}

export function connectionAction(input: {
  status: DesktopStatus
  owned: boolean
  busy: boolean
}): ConnectionAction {
  if (input.status === 'boot') return input.owned ? 'stop' : 'auto'
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
