import { useEffect } from 'react'

import { useTheme } from '@/components/theme-provider'
import { useI18n } from '@/i18n'
import { warmAndRevealMainWindow } from '@/lib/desktop-shell'

/** Hide main until the themed shell and handbook window are in memory. */
export function WarmMainWindow() {
  const { t, locale } = useI18n()
  const { isDark } = useTheme()
  useEffect(() => {
    void warmAndRevealMainWindow(
      `${t('handbook.title')} - ${t('brand.short')}`,
      locale,
      isDark ? 'dark' : 'light',
    ).catch(() => undefined)
  }, [locale, isDark, t])
  return null
}
