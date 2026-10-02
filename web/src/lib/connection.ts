import type { Vars } from '@/i18n/catalog'
import type { MessageKey } from '@/i18n/locales/en'

/**
 * A saved Fava source. Local projects stay on a loopback address and can be
 * started from this window. Remote entries are an address only.
 *
 * The file keeps both drafts and one `active` mode. Connecting with one mode
 * leaves the other draft on disk and does not start it.
 */

export type LocalDraft = {
  directory: string
  command: string
  origin: string
}

export type RemoteDraft = {
  origin: string
}

export type LocalProject = LocalDraft & { kind: 'local' }

export type RemoteSource = RemoteDraft & { kind: 'remote' }

export type LedgerConnection = LocalProject | RemoteSource

export type ConnectionFile = {
  active: LedgerConnection['kind']
  local: LocalDraft | null
  remote: RemoteDraft | null
}

export type ConnectionStep = 'attach' | 'start' | 'ready'

const DEFAULT_ORIGIN = 'http://127.0.0.1:5000'

export function defaultOrigin(): string {
  return DEFAULT_ORIGIN
}

/** http(s) origin with no path, query, user, or fragment. */
export function normalizeOrigin(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  if (url.username || url.password) return null
  if (url.pathname !== '/' || url.search || url.hash) return null
  if (!url.hostname) return null
  return url.origin
}

export function isLoopbackOrigin(origin: string): boolean {
  let url: URL
  try {
    url = new URL(origin)
  } catch {
    return false
  }
  const host = url.hostname.replace(/^\[|\]$/g, '')
  return host === 'localhost' || host === '127.0.0.1' || host === '::1'
}

export function isLedgerConnection(value: unknown): value is LedgerConnection {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  if (typeof record.origin !== 'string' || !normalizeOrigin(record.origin)) return false
  if (record.kind === 'remote') return true
  return (
    record.kind === 'local' &&
    typeof record.directory === 'string' &&
    record.directory.length > 0 &&
    typeof record.command === 'string' &&
    record.command.trim().length > 0 &&
    isLoopbackOrigin(record.origin)
  )
}

export function localDraft(directory: string, command: string, origin: string): LocalDraft | null {
  const next = normalizeOrigin(origin)
  const trimmed = command.trim()
  if (!directory || !trimmed || !next || !isLoopbackOrigin(next)) return null
  return { directory, command: trimmed, origin: next }
}

export function remoteDraft(origin: string): RemoteDraft | null {
  const next = normalizeOrigin(origin)
  if (!next) return null
  return { origin: next }
}

/** Keep a valid draft. An incomplete edit does not erase the saved one. */
export function withDrafts(
  active: ConnectionFile['active'],
  local: LocalDraft | null,
  remote: RemoteDraft | null,
  previous: ConnectionFile | null,
): ConnectionFile {
  return {
    active,
    local: local ?? previous?.local ?? null,
    remote: remote ?? previous?.remote ?? null,
  }
}

export function activeConnection(file: ConnectionFile): LedgerConnection | null {
  if (file.active === 'local' && file.local) return { kind: 'local', ...file.local }
  if (file.active === 'remote' && file.remote) return { kind: 'remote', ...file.remote }
  return null
}

export function readConnectionFile(value: unknown): ConnectionFile | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  if (record.active === 'local' || record.active === 'remote') {
    return {
      active: record.active,
      local: readLocalDraft(record.local),
      remote: readRemoteDraft(record.remote),
    }
  }
  if (!isLedgerConnection(value)) return null
  if (value.kind === 'local') {
    return {
      active: 'local',
      local: { directory: value.directory, command: value.command.trim(), origin: value.origin },
      remote: null,
    }
  }
  return { active: 'remote', local: null, remote: { origin: value.origin } }
}

export function connectionStepKey(step: ConnectionStep): MessageKey {
  switch (step) {
    case 'attach':
      return 'settings.logAttach'
    case 'start':
      return 'settings.logStart'
    case 'ready':
      return 'settings.logReady'
  }
}

export function explainConnectionError(
  error: unknown,
  t: (key: MessageKey, vars?: Vars) => string,
): string {
  const code = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  if (code === 'directory') return t('settings.missingDirectory')
  if (code === 'empty-command') return t('settings.missingCommand')
  if (code === 'loopback') return t('settings.loopback')
  if (code === 'not-local' || code === 'missing') return t('settings.notLocal')
  if (code.startsWith('spawn:')) {
    return t('settings.startFailed', { detail: code.slice('spawn:'.length).trim() })
  }
  if (code === 'start-exited') return t('settings.startExited')
  if (code === 'occupied' || code.startsWith('occupied:')) {
    const server = code.startsWith('occupied:') ? code.slice('occupied:'.length).trim() : ''
    return t('settings.occupied', { server: server || 'HTTP' })
  }
  return code || t('common.errorFallback')
}

function readLocalDraft(value: unknown): LocalDraft | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  if (
    typeof record.directory !== 'string' ||
    typeof record.command !== 'string' ||
    typeof record.origin !== 'string'
  ) {
    return null
  }
  return localDraft(record.directory, record.command, record.origin)
}

function readRemoteDraft(value: unknown): RemoteDraft | null {
  if (!value || typeof value !== 'object') return null
  const origin = (value as { origin?: unknown }).origin
  if (typeof origin !== 'string') return null
  return remoteDraft(origin)
}
