import { SunIcon, MoonIcon, MonitorIcon } from 'lucide-react'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { useI18n } from '@/i18n'

import { useTheme, type Theme } from './theme-provider'

export function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  const { t } = useI18n()

  return (
    <ToggleGroup
      type="single"
      variant="outline"
      spacing={0}
      value={theme}
      aria-label={t('theme.label')}
      onValueChange={(val) => {
        if (val) setTheme(val as Theme)
      }}
    >
      <ToggleGroupItem value="light" aria-label={t('theme.light')} className="gap-1.5 px-3">
        <SunIcon className="size-3.5" />
        <span>{t('theme.light')}</span>
      </ToggleGroupItem>
      <ToggleGroupItem value="system" aria-label={t('theme.system')} className="gap-1.5 px-3">
        <MonitorIcon className="size-3.5" />
        <span>{t('theme.system')}</span>
      </ToggleGroupItem>
      <ToggleGroupItem value="dark" aria-label={t('theme.dark')} className="gap-1.5 px-3">
        <MoonIcon className="size-3.5" />
        <span>{t('theme.dark')}</span>
      </ToggleGroupItem>
    </ToggleGroup>
  )
}
