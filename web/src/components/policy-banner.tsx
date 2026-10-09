import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { ShieldAlert } from 'lucide-react'

import { useDesktop } from '@/components/desktop-gate'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Spinner } from '@/components/ui/spinner'
import { useI18n } from '@/i18n'
import type { MessageKey } from '@/i18n/locales/en'
import { lineDiff } from '@/lib/policy-diff'
import { POLICY_STATUS_QUERY, type PolicyIntegrity, type PolicyStatus } from '@/lib/policy'
import { cn } from '@/lib/utils'

const BANNER_COPY: Record<Exclude<PolicyIntegrity, 'ok'>, MessageKey> = {
  unseeded: 'policy.bannerUnseeded',
  unapproved: 'policy.bannerUnapproved',
  'locale-mismatch': 'policy.bannerLocaleMismatch',
  'store-corrupt': 'policy.bannerStoreCorrupt',
}

export function PolicyBanner({ className }: { className?: string }) {
  const { t } = useI18n()
  const desktop = useDesktop()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<'approve' | 'revert' | null>(null)
  const [error, setError] = useState('')
  const enabled = isTauri() && desktop.status === 'ready'
  const query = useQuery({
    queryKey: POLICY_STATUS_QUERY,
    queryFn: () => invoke<PolicyStatus>('policy_status'),
    enabled,
  })
  const status = query.data
  if (!enabled || !status || status.integrity === 'ok') return null

  const bannerKey =
    status.reviewReason === 'restore' && status.integrity === 'unapproved'
      ? 'policy.bannerRestore'
      : BANNER_COPY[status.integrity]
  const canApprove = status.integrity !== 'unseeded'
  const canRevert = status.integrity !== 'unseeded' && status.integrity !== 'store-corrupt'

  async function run(action: 'approve' | 'revert') {
    setBusy(action)
    setError('')
    try {
      const next = await invoke<PolicyStatus>(action === 'approve' ? 'policy_approve' : 'policy_revert')
      queryClient.setQueryData(POLICY_STATUS_QUERY, next)
      if (next.integrity === 'ok') setOpen(false)
    } catch {
      setError(t(action === 'approve' ? 'policy.approveFailed' : 'policy.revertFailed'))
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <aside
        role="status"
        aria-live="polite"
        className={cn(
          'pointer-events-none fixed inset-x-0 bottom-4 z-40 mx-auto w-full max-w-7xl px-3 sm:px-6 lg:px-8',
          className,
        )}
      >
        <div className="pointer-events-auto flex items-center justify-between gap-3 rounded-xl border border-warning/35 bg-background/95 p-3 shadow-xl backdrop-blur-md dark:bg-card/95 sm:px-4 sm:py-2.5">
          <div className="flex min-w-0 flex-1 items-center gap-2.5">
            <ShieldAlert className="size-4 shrink-0 text-warning" />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5 sm:flex-row sm:items-center sm:gap-2">
              <span className="shrink-0 text-xs font-medium text-foreground sm:text-sm">
                {t('policy.bannerTitle')}
              </span>
              <span className="hidden text-muted-foreground/40 sm:inline" aria-hidden>
                ·
              </span>
              <span className="min-w-0 truncate text-xs text-muted-foreground">
                {t(bannerKey)}
              </span>
            </div>
          </div>
          <Button
            type="button"
            size="xs"
            variant="outline"
            className="h-6 shrink-0 bg-background/50 hover:bg-background"
            onClick={() => setOpen(true)}
          >
            {t('policy.review')}
          </Button>
        </div>
      </aside>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="min-w-0 overflow-hidden sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t('policy.dialogTitle')}</DialogTitle>
            <DialogDescription>{t(bannerKey)}</DialogDescription>
          </DialogHeader>
          <div className="flex max-h-[min(28rem,60vh)] flex-col gap-3 overflow-auto">
            {status.files.length === 0 ? (
              <p className="text-muted-foreground">{t('policy.emptyDiff')}</p>
            ) : (
              status.files.map((file) => {
                const lines = lineDiff(file.trusted, file.disk)
                return (
                  <section key={file.path} className="flex flex-col gap-1">
                    <h3 className="font-mono text-xs font-medium">{file.path}</h3>
                    <pre className="overflow-auto rounded-md border bg-muted/40 p-2 font-mono text-[0.7rem] leading-5">
                      {lines.map((line, index) => (
                        <span
                          key={`${file.path}:${index}:${line.tag}`}
                          className={cn(
                            'block whitespace-pre-wrap',
                            line.tag === 'del' && 'bg-destructive/10 text-destructive',
                            line.tag === 'add' && 'bg-positive/10 text-positive',
                            line.tag === 'eq' && 'text-muted-foreground',
                          )}
                        >
                          {line.tag === 'del' ? '-' : line.tag === 'add' ? '+' : ' '}
                          {line.text || ' '}
                        </span>
                      ))}
                    </pre>
                  </section>
                )
              })
            )}
          </div>
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy !== null} onClick={() => setOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={busy !== null || !canRevert}
              onClick={() => void run('revert')}
            >
              {busy === 'revert' ? <Spinner data-icon="inline-start" /> : null}
              {t('policy.revert')}
            </Button>
            <Button type="button" disabled={busy !== null || !canApprove} onClick={() => void run('approve')}>
              {busy === 'approve' ? <Spinner data-icon="inline-start" /> : null}
              {t('policy.approve')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
