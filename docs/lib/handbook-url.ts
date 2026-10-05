import { i18n } from '@/lib/i18n'

/** Paths are relative to Next `basePath: '/docs'`. Trailing slash, no index.html — Next client routing needs that. */
export function handbookPageUrl(slugs: string[], locale?: string): string {
  const parts: string[] = []
  if (locale && locale !== i18n.defaultLanguage) parts.push(locale)
  parts.push(...slugs)
  return parts.length > 0 ? `/${parts.join('/')}/` : '/'
}
