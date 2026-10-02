import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useI18n } from '@/i18n'
import { LOCALES, SUPPORTED_LOCALES, type Locale } from '@/i18n/registry'

/**
 * Language switcher dropdown. Labels are endonyms, so each language is always listed in
 * its own script — the one label a speaker is guaranteed to recognise.
 */
export function LocaleToggle() {
  const { locale, setLocale, t } = useI18n()

  return (
    <Select
      value={locale}
      onValueChange={(value) => {
        if (value) setLocale(value as Locale)
      }}
    >
      <SelectTrigger aria-label={t('locale.switcherLabel')} className="w-36">
        <SelectValue placeholder={LOCALES[locale]?.label} />
      </SelectTrigger>
      <SelectContent>
        {SUPPORTED_LOCALES.map((code) => (
          <SelectItem key={code} value={code}>
            {LOCALES[code].label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
