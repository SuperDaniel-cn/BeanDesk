import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Navigate, useLocation } from 'react-router'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { toast } from 'sonner'

import { useI18n } from '@/i18n'
import { bootCalendarNotices } from '@/lib/calendar'
import { loadConnection, loadHostSnapshot, loadSuspended, openConnection } from '@/lib/desktop'
import { favaClient } from '@/lib/fava-client'
import {
  activeConnection,
  connectionStepKey,
  explainConnectionError,
  type ConnectionFile,
  type LedgerConnection,
} from '@/lib/connection'
import {
  finishBoot,
  hostFromSnapshot,
  idleHost,
  sessionLost,
  shouldProbeOrigin,
  type DesktopStatus,
  type HostView,
} from '@/lib/host'

type DesktopState = {
  status: DesktopStatus
  file: ConnectionFile | null
  connection: LedgerConnection | null
}

export type ConnectionLogTone = 'info' | 'error'

export type ConnectionLogLine = {
  time: string
  message: string
  tone: ConnectionLogTone
}

export function formatConnectionLogLine(line: ConnectionLogLine): string {
  return `${line.time}  ${line.message}`
}

export function formatConnectionLog(lines: ConnectionLogLine[]): string {
  return lines.map(formatConnectionLogLine).join('\n')
}

type DesktopValue = DesktopState & {
  host: HostView
  log: ConnectionLogLine[]
  appendLog: (message: string, tone?: ConnectionLogTone) => void
  clearLog: () => void
  remember: (file: ConnectionFile) => void
  markConnected: (file: ConnectionFile) => void
  release: () => void
}

const DesktopContext = createContext<DesktopValue | null>(null)

export function useDesktop(): DesktopValue {
  const value = useContext(DesktopContext)
  if (!value) throw new Error('DesktopGate is missing')
  return value
}

export function DesktopProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const { t } = useI18n()
  const tRef = useRef(t)
  tRef.current = t
  const [log, setLog] = useState<ConnectionLogLine[]>([])
  const [host, setHost] = useState<HostView>(idleHost)
  const [state, setState] = useState<DesktopState>(() =>
    isTauri()
      ? { status: 'boot', file: null, connection: null }
      : { status: 'ready', file: null, connection: null },
  )
  const stateRef = useRef(state)
  const hostRef = useRef(host)
  const attachedMisses = useRef(0)
  stateRef.current = state
  hostRef.current = host

  const appendLog = useCallback((message: string, tone: ConnectionLogTone = 'info') => {
    const time = new Date().toLocaleTimeString(undefined, { hourCycle: 'h23' })
    setLog((lines) => [...lines, { time, message, tone }])
    if (isTauri()) {
      void invoke('plugin:log|log', { level: tone === 'error' ? 1 : 3, message }).catch(() => undefined)
    }
  }, [])

  const clearLog = useCallback(() => {
    setLog([])
  }, [])

  const remember = useCallback((file: ConnectionFile) => {
    setState((current) => ({ ...current, file }))
  }, [])

  const markConnected = useCallback(
    (file: ConnectionFile) => {
      setState({ status: 'ready', file, connection: activeConnection(file) })
      void queryClient.invalidateQueries()
    },
    [queryClient],
  )

  const release = useCallback(() => {
    setState((current) => ({ status: 'setup', file: current.file, connection: null }))
    const cleared = idleHost()
    hostRef.current = cleared
    setHost(cleared)
    void queryClient.removeQueries()
  }, [queryClient])

  useEffect(() => {
    if (!isTauri()) return
    void bootCalendarNotices({
      t: (key, vars) => tRef.current(key, vars),
      toast: (title, extras) => toast(title, extras),
    }).catch(() => undefined)
  }, [])

  useEffect(() => {
    if (!isTauri()) return
    let cancelled = false
    const say = (message: string, tone: ConnectionLogTone = 'info') => {
      if (!cancelled) appendLog(message, tone)
    }
    Promise.all([loadConnection(), loadSuspended()])
      .then(async ([file, suspended]) => {
        if (cancelled) return
        if (!file) {
          say(tRef.current('settings.logNone'))
          setState({ status: 'setup', file: null, connection: null })
          return
        }
        if (suspended) {
          say(tRef.current('settings.logHeld'))
          setState({ status: 'setup', file, connection: null })
          return
        }
        const connection = activeConnection(file)
        if (!connection) {
          say(tRef.current('settings.logNone'))
          setState({ status: 'setup', file, connection: null })
          return
        }
        say(tRef.current('settings.connecting'))
        try {
          const opened = await openConnection(connection, (step) => {
            say(tRef.current(connectionStepKey(step)))
          })
          if (cancelled) return
          setState((current) =>
            finishBoot(
              current,
              opened
                ? { status: 'ready', file, connection }
                : { status: 'setup', file, connection: null },
            ),
          )
        } catch (error) {
          say(explainConnectionError(error, tRef.current), 'error')
          if (!cancelled) {
            setState((current) => finishBoot(current, { status: 'setup', file, connection }))
          }
        }
      })
      .catch((error: unknown) => {
        say(explainConnectionError(error, tRef.current), 'error')
        if (!cancelled) setState({ status: 'setup', file: null, connection: null })
      })
    return () => {
      cancelled = true
    }
  }, [appendLog])

  useEffect(() => {
    if (state.status !== 'ready') return
    let cancelled = false
    const tick = async () => {
      if (cancelled || document.hidden) return
      const changed = await favaClient.ledgerChanged().catch(() => false)
      if (!cancelled && changed) void queryClient.invalidateQueries()
    }
    void tick()
    const id = window.setInterval(() => void tick(), 4_000)
    const onVisibility = () => void tick()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      cancelled = true
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [queryClient, state.status])

  useEffect(() => {
    if (!isTauri()) return
    let cancelled = false
    const refresh = async () => {
      const snap = await loadHostSnapshot()
      const current = stateRef.current
      // Disconnected sessions only refresh whether this window still owns a
      // process. Probe the saved origin after Connect, not a leftover address.
      let probe: HostView['probe'] = { kind: 'idle' }
      let origin: string | null = null
      if (shouldProbeOrigin(current.status)) {
        origin = current.connection?.origin ?? activeConnection(current.file)?.origin ?? null
        if (origin) {
          if (favaClient.origin() !== origin) favaClient.useOrigin(origin)
          probe = await favaClient.probe().catch(() => ({ kind: 'closed' as const }))
        }
      }
      if (cancelled) return
      const next = hostFromSnapshot(snap, probe, origin, Date.now())
      const previous = hostRef.current
      if (next.owned || next.probe.kind === 'fava' || next.probe.kind === 'idle') {
        attachedMisses.current = 0
      } else if (previous.probe.kind === 'fava' || attachedMisses.current > 0) {
        attachedMisses.current += 1
      }
      hostRef.current = next
      setHost(next)
      if (sessionLost(previous, next, current.status, attachedMisses.current)) {
        appendLog(tRef.current('settings.hostDown'), 'error')
        release()
      }
    }
    void refresh()
    const id = window.setInterval(() => void refresh(), 2_000)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [appendLog, release])

  return (
    <DesktopContext.Provider value={{ ...state, host, log, appendLog, clearLog, remember, markConnected, release }}>
      {children}
    </DesktopContext.Provider>
  )
}

export function DesktopGuard({ children }: { children: ReactNode }) {
  const desktop = useDesktop()
  const { pathname } = useLocation()

  if (desktop.status === 'setup' && pathname !== '/settings' && pathname !== '/calendar') {
    return <Navigate to="/settings" replace />
  }
  return children
}
