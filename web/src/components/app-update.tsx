import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { isTauri } from '@tauri-apps/api/core'
import type { Update } from '@tauri-apps/plugin-updater'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useI18n } from '@/i18n'
import { updateNotes } from '@/lib/update-notes'

type Phase = 'idle' | 'checking' | 'installing' | 'none' | 'failed'

type UpdateValue = {
  phase: Phase
  check: (announce: boolean) => Promise<void>
}

const UpdateContext = createContext<UpdateValue | null>(null)

export function useAppUpdate(): UpdateValue {
  const value = useContext(UpdateContext)
  if (!value) throw new Error('AppUpdate is missing')
  return value
}

export function AppUpdate({ children }: { children: ReactNode }) {
  const { t } = useI18n()
  const [phase, setPhase] = useState<Phase>('idle')
  const [pending, setPending] = useState<Update | null>(null)
  const pendingRef = useRef<Update | null>(null)
  const desktop = isTauri()

  const replacePending = useCallback((next: Update | null) => {
    const previous = pendingRef.current
    pendingRef.current = next
    setPending(next)
    if (previous && previous !== next) void previous.close().catch(() => undefined)
  }, [])

  const check = useCallback(
    async (announce: boolean) => {
      if (!desktop) return
      setPhase('checking')
      try {
        const { check: checkUpdate } = await import('@tauri-apps/plugin-updater')
        const update = await checkUpdate()
        replacePending(update)
        setPhase(!update && announce ? 'none' : 'idle')
      } catch {
        replacePending(null)
        setPhase(announce ? 'failed' : 'idle')
      }
    },
    [desktop, replacePending],
  )

  useEffect(() => {
    void check(false)
  }, [check])

  const notes = updateNotes(pending?.body)

  const install = useCallback(async () => {
    const update = pendingRef.current
    if (!update) return
    setPhase('installing')
    try {
      await update.downloadAndInstall()
      const { relaunch } = await import('@tauri-apps/plugin-process')
      await relaunch()
    } catch {
      setPhase('failed')
      replacePending(null)
    }
  }, [replacePending])

  return (
    <UpdateContext.Provider value={{ phase, check }}>
      {children}
      {desktop ? (
        <Dialog
          open={pending != null}
          onOpenChange={(open) => {
            if (!open && phase !== 'installing') replacePending(null)
          }}
        >
          <DialogContent showCloseButton={false} className={notes ? 'sm:max-w-lg' : undefined}>
            <DialogHeader>
              <DialogTitle>{t('update.title')}</DialogTitle>
              <DialogDescription>
                {pending ? t('update.available', { version: pending.version }) : null}
              </DialogDescription>
            </DialogHeader>
            {notes ? (
              <div className="max-h-56 overflow-y-auto whitespace-pre-wrap rounded-lg border bg-muted/40 px-3 py-2 text-muted-foreground">
                {notes}
              </div>
            ) : null}
            <DialogFooter>
              <Button
                variant="outline"
                disabled={phase === 'installing'}
                onClick={() => replacePending(null)}
              >
                {t('update.later')}
              </Button>
              <Button disabled={phase === 'installing'} onClick={() => void install()}>
                {phase === 'installing' ? t('update.installing') : t('update.install')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </UpdateContext.Provider>
  )
}
