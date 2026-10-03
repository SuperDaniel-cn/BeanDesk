import type { Vars } from '@/i18n/catalog'
import type { MessageKey } from '@/i18n/locales/en'

import { periodParts } from './ledger-model'

export function formatPeriodLabel(
  time: string,
  t: (key: MessageKey, vars?: Vars) => string,
): string {
  if (!time) return t('time.allTime')
  const parts = periodParts(time)
  if (!parts) return time
  if (parts.kind === 'year') return t('time.periodYear', { year: parts.year })
  if (parts.kind === 'quarter') {
    return t('time.periodQuarter', { year: parts.year, quarter: parts.quarter })
  }
  return t('time.periodMonth', { year: parts.year, month: parts.month })
}
