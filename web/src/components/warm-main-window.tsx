import { useEffect } from 'react'

import { useTheme } from '@/components/theme-provider'
import { useI18n } from '@/i18n'
import { warmAndRevealMainWindow } from '@/lib/desktop-shell'
import { setHandbookWindowTitle } from '@/lib/handbook-window'

/** Hide main until the themed shell and handbook window are in memory. */
export function WarmMainWindow() {
  const { t, locale } = useI18n()
  const { isDark } = useTheme()
  useEffect(() => {
    const title = t('brand.window')
    let cancelled = false
    void (async () => {
      await warmAndRevealMainWindow(title, locale, isDark ? 'dark' : 'light')
      if (cancelled) return
      await setHandbookWindowTitle(title)
    })().catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [locale, isDark, t])
  return null
}
