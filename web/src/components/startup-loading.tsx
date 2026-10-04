import { useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useLocation } from 'react-router'

import { BrandMark } from '@/components/brand-mark'
import { useDesktop } from '@/components/desktop-gate'
import { Spinner } from '@/components/ui/spinner'
import { useI18n } from '@/i18n'
import { fetchTrialBalance } from '@/lib/api'
import { useTimeFilter } from '@/lib/time-context'

export function useStartupScreen(): boolean {
  const desktop = useDesktop()
  const { pathname } = useLocation()
  const { timeFilter } = useTimeFilter()
  const opened = useRef(false)

  const firstPage = useQuery({
    queryKey: ['trial-balance', timeFilter],
    queryFn: ({ signal }) => fetchTrialBalance(timeFilter, signal),
    enabled: desktop.status === 'ready' && pathname === '/',
  })

  if (desktop.status !== 'ready') opened.current = false
  else if (!firstPage.isPending) opened.current = true

  if (desktop.status === 'boot') return true
  return desktop.status === 'ready' && pathname === '/' && !opened.current && firstPage.isPending
}

export function StartupLoading() {
  const { t } = useI18n()
  const label = t('boot.connecting')

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-3 bg-background">
      <div className="flex items-center gap-2">
        <BrandMark />
        <span className="font-heading text-sm font-semibold">{t('brand.short')}</span>
      </div>
      <div className="flex items-center gap-2 text-muted-foreground">
        <Spinner aria-label={label} />
        <span className="text-sm">{label}</span>
      </div>
    </div>
  )
}
