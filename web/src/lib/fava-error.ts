import type { Vars } from '@/i18n/catalog'
import type { MessageKey } from '@/i18n/locales/en'

/** Stable codes. Pages translate them; the client does not own display copy. */
export const FAVA_UNREACHABLE = 'fava-unreachable'
export const FAVA_SLUG = 'fava-slug'
export const FAVA_SLUG_INVALID = 'fava-slug-invalid'

export function explainFavaError(
  error: unknown,
  t: (key: MessageKey, vars?: Vars) => string,
  fallback: MessageKey = 'common.errorFallback',
): string {
  const code = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  if (code === FAVA_UNREACHABLE) return t('fava.unreachable')
  if (code === FAVA_SLUG) return t('fava.slug')
  if (code === FAVA_SLUG_INVALID) return t('fava.slugInvalid')
  if (error instanceof Error && error.message) return error.message
  return t(fallback)
}
