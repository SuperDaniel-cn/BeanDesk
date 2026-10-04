import type { Vars } from '@/i18n/catalog'
import type { MessageKey } from '@/i18n/locales/en'

/**
 * A saved Fava source. Local projects stay on a loopback address and can be
 * started from this window. Remote entries are an address only.
 *
 * The file keeps both drafts and one `active` mode. Connecting with one mode
 * leaves the other draft on disk and does not start it.
 */

/** `engine` starts the bundled runtime. `shell` runs `command` as written. */
export type Launch = 'engine' | 'shell'

export type LocalDraft = {
  directory: string
  command: string
  origin: string
  launch: Launch
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

export type ConnectionForm = {
  kind: ConnectionFile['active']
  directory: string
  command: string
  localOrigin: string
  remoteOrigin: string
}

const DEFAULT_ORIGIN = 'http://127.0.0.1:5000'

export function emptyConnectionForm(): ConnectionForm {
  return {
    kind: 'local',
    directory: '',
    command: '',
    localOrigin: DEFAULT_ORIGIN,
    remoteOrigin: DEFAULT_ORIGIN,
  }
}

export function isPristineConnectionForm(form: ConnectionForm): boolean {
  const empty = emptyConnectionForm()
  return (
    form.kind === empty.kind &&
    form.directory === empty.directory &&
    form.command === empty.command &&
    form.localOrigin === empty.localOrigin &&
    form.remoteOrigin === empty.remoteOrigin
  )
}

export function formFromConnectionFile(file: ConnectionFile): ConnectionForm {
  return {
    kind: file.active,
    directory: file.local?.directory ?? '',
    command: file.local?.command ?? '',
    localOrigin: file.local?.origin ?? DEFAULT_ORIGIN,
    remoteOrigin: file.remote?.origin ?? DEFAULT_ORIGIN,
  }
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

/**
 * Work folder plus a loopback origin. An empty command is the bundled engine.
 * A saved shell command stays on the draft when `launch` is `engine`, so the
 * simple page can start the runtime without erasing the advanced command.
 */
export function localWorkdir(
  directory: string,
  origin: string,
  command = '',
  launch?: Launch,
): LocalDraft | null {
  const next = normalizeOrigin(origin)
  if (!directory || !next || !isLoopbackOrigin(next)) return null
  const trimmed = command.trim()
  return {
    directory,
    command: trimmed,
    origin: next,
    launch: launch ?? (trimmed ? 'shell' : 'engine'),
  }
}

export function localDraft(
  directory: string,
  command: string,
  origin: string,
  launch?: Launch,
): LocalDraft | null {
  const draft = localWorkdir(directory, origin, command, launch ?? 'shell')
  return draft?.command ? draft : null
}

export function isLedgerConnection(value: unknown): value is LedgerConnection {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  if (record.kind === 'remote') {
    return typeof record.origin === 'string' && normalizeOrigin(record.origin) != null
  }
  return (
    record.kind === 'local' &&
    typeof record.directory === 'string' &&
    typeof record.command === 'string' &&
    typeof record.origin === 'string' &&
    localWorkdir(record.directory, record.origin, record.command) != null
  )
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

export function activeConnection(file: ConnectionFile | null | undefined): LedgerConnection | null {
  if (!file) return null
  if (file.active === 'local' && file.local) return { kind: 'local', ...file.local }
  if (file.active === 'remote' && file.remote) return { kind: 'remote', ...file.remote }
  return null
}

export function readConnectionFile(value: unknown): ConnectionFile | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  if (record.active !== 'local' && record.active !== 'remote') return null
  return {
    active: record.active,
    local: readLocalDraft(record.local),
    remote: readRemoteDraft(record.remote),
  }
}

export function connectionStepKey(step: ConnectionStep): MessageKey {
  switch (step) {
    case 'attach':
      return 'settings.logAttach'
    case 'start':
      return 'settings.logStart'
    case 'ready':
      return 'settings.hostSessionReady'
  }
}

export function explainConnectionError(
  error: unknown,
  t: (key: MessageKey, vars?: Vars) => string,
): string {
  const code = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  if (code === 'directory') return t('settings.missingDirectory')
  if (code === 'empty-command') return t('settings.missingCommand')
  if (code === 'missing-engine') return t('settings.missingEngine')
  if (code === 'ledger-exists') return t('settings.createFirstLedgerExists')
  if (code === 'not-empty') return t('settings.createFirstLedgerNotEmpty')
  if (code === 'loopback') return t('settings.loopback')
  if (code === 'not-local' || code === 'missing') return t('settings.notLocal')
  if (code.startsWith('spawn:')) {
    return t('settings.startFailed', { detail: code.slice('spawn:'.length).trim() })
  }
  if (code === 'start-exited') return t('settings.startExited')
  if (code === 'occupied') return t('settings.hostPortOccupied')
  if (code === 'airplay') return t('settings.airplayPort')
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
  const launch = record.launch === 'engine' || record.launch === 'shell' ? record.launch : undefined
  return localWorkdir(record.directory, record.origin, record.command, launch)
}

function readRemoteDraft(value: unknown): RemoteDraft | null {
  if (!value || typeof value !== 'object') return null
  const origin = (value as { origin?: unknown }).origin
  if (typeof origin !== 'string') return null
  return remoteDraft(origin)
}
