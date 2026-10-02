import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Navigate, useLocation } from 'react-router'
import { invoke, isTauri } from '@tauri-apps/api/core'

import { Skeleton } from '@/components/ui/skeleton'
import { useI18n } from '@/i18n'
import { loadConnection, loadSuspended, openConnection } from '@/lib/desktop'
import {
  activeConnection,
  connectionStepKey,
  explainConnectionError,
  type ConnectionFile,
  type LedgerConnection,
} from '@/lib/connection'

type DesktopStatus = 'boot' | 'setup' | 'ready'

type DesktopState = {
  status: DesktopStatus
  file: ConnectionFile | null
  connection: LedgerConnection | null
}

type DesktopValue = DesktopState & {
  log: string[]
  appendLog: (message: string) => void
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
  const [log, setLog] = useState<string[]>([])
  const [state, setState] = useState<DesktopState>(() =>
    isTauri()
      ? { status: 'boot', file: null, connection: null }
      : { status: 'ready', file: null, connection: null },
  )

  const appendLog = useCallback((message: string) => {
    const stamp = new Date().toLocaleTimeString(undefined, { hourCycle: 'h23' })
    setLog((lines) => [...lines, `${stamp}  ${message}`])
    if (isTauri()) {
      void invoke('plugin:log|log', { level: 3, message }).catch(() => undefined)
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
    void queryClient.removeQueries()
  }, [queryClient])

  useEffect(() => {
    if (!isTauri()) return
    let cancelled = false
    const say = (message: string) => {
      if (!cancelled) appendLog(message)
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
        say(tRef.current('settings.logBoot'))
        try {
          const opened = await openConnection(connection, (step) => {
            say(tRef.current(connectionStepKey(step)))
          })
          if (!cancelled && opened) setState({ status: 'ready', file, connection })
        } catch (error) {
          say(explainConnectionError(error, tRef.current))
          if (!cancelled) setState({ status: 'setup', file, connection })
        }
      })
      .catch((error: unknown) => {
        say(explainConnectionError(error, tRef.current))
        if (!cancelled) setState({ status: 'setup', file: null, connection: null })
      })
    return () => {
      cancelled = true
    }
  }, [appendLog])

  return (
    <DesktopContext.Provider value={{ ...state, log, appendLog, clearLog, remember, markConnected, release }}>
      {children}
    </DesktopContext.Provider>
  )
}

export function DesktopGuard({ children }: { children: ReactNode }) {
  const desktop = useDesktop()
  const { pathname } = useLocation()

  if (desktop.status === 'boot' && pathname !== '/settings') {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }
  if (desktop.status === 'setup' && pathname !== '/settings') {
    return <Navigate to="/settings" replace />
  }
  return children
}
