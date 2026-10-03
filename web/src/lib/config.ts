/**
 * Runtime configuration.
 *
 * The frontend is a static bundle. Host-specific values come from
 * `public/config.js` at boot rather than from the build.
 *
 * Falls back to same-origin (`/api/fava/...`) when the file is missing, which
 * is what `bun run dev` relies on via the Vite proxy.
 */

import { FAVA_SLUG_INVALID } from './fava-error'

declare global {
  interface Window {
    __APP_CONFIG__?: {
      apiBaseUrl?: string
      /** Fava ledger slug. Empty means probe, then follow Fava's redirect. */
      slug?: string
    }
  }
}

function readApiBaseUrl(): string {
  if (typeof window === 'undefined') return ''
  const configured = window.__APP_CONFIG__?.apiBaseUrl
  if (typeof configured !== 'string') return ''
  return configured.trim().replace(/\/+$/, '')
}

/** Absolute or same-origin URL for an `/api/...` path. */
export function apiUrl(path: string): string {
  const base = typeof window === 'undefined' ? '' : readApiBaseUrl()
  return `${base}${path}`
}

/**
 * Slug from `config.js`. Empty when the file leaves discovery to the client.
 * A non-empty value that is not a slug is an error, so a typo is not ignored.
 */
export function readLedgerSlug(): string {
  if (typeof window === 'undefined') return ''
  const configured = window.__APP_CONFIG__?.slug
  if (typeof configured !== 'string') return ''
  const slug = configured.trim()
  if (!slug) return ''
  if (!/^[A-Za-z0-9_-]+$/.test(slug)) {
    throw new Error(FAVA_SLUG_INVALID)
  }
  return slug
}
