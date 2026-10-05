import type { Vars } from '@/i18n/catalog'
import type { MessageKey } from '@/i18n/locales/en'

export type BackupDestKind = 'local' | 's3'

export type BackupDestView = {
  id: string
  kind: BackupDestKind
  directory: string
  accessKeyId: string
  bucketName: string
  region: string
  endpoint: string
  pathStyleAccess: boolean
  prefix: string
  secretConfigured: boolean
  location: string
  ready: boolean
  missing: boolean
  checkFailed: boolean
}

export type BackupDestDraft = {
  id: string
  kind: BackupDestKind
  directory: string
  accessKeyId: string
  secretAccessKey: string
  bucketName: string
  region: string
  endpoint: string
  pathStyleAccess: boolean
  prefix: string
  secretConfigured: boolean
}

export type BackupDestSave = {
  id: string
  kind: BackupDestKind
  directory: string
  accessKeyId: string
  secretAccessKey: string
  bucketName: string
  region: string
  endpoint: string
  pathStyleAccess: boolean
  prefix: string
}

export type BackupSettings = {
  watch: boolean
  debounceSecs: number
  archiveAuto: boolean
  dests: BackupDestView[]
}

export type BackupSnapshot = {
  id: string
  time: string
}

export type RepoSnapshots = {
  location: string
  snapshots: BackupSnapshot[]
}

export type DestPulse = {
  id: string
  lastSnapshot: string | null
  lastSnapshotAt: string | null
}

export type BackupStatus = {
  lastGitAt: string | null
  lastGitHash: string | null
  lastSnapshot: string | null
  lastSnapshotAt: string | null
  lastError: string | null
  watching: boolean
  hasKey: boolean
  resticReady: boolean
  appLedger: boolean
  hasLedgerFile: boolean
  dests: DestPulse[]
}

export function emptyBackupSettings(): BackupSettings {
  return {
    watch: true,
    debounceSecs: 5,
    archiveAuto: false,
    dests: [],
  }
}

export function emptyDestDraft(kind: BackupDestKind = 'local'): BackupDestDraft {
  return {
    id: '',
    kind,
    directory: '',
    accessKeyId: '',
    secretAccessKey: '',
    bucketName: '',
    region: '',
    endpoint: '',
    pathStyleAccess: true,
    prefix: '',
    secretConfigured: false,
  }
}

export function destToDraft(dest: BackupDestView): BackupDestDraft {
  return {
    id: dest.id,
    kind: dest.kind,
    directory: dest.directory,
    accessKeyId: dest.accessKeyId,
    secretAccessKey: '',
    bucketName: dest.bucketName,
    region: dest.region,
    endpoint: dest.endpoint,
    pathStyleAccess: dest.pathStyleAccess,
    prefix: dest.prefix,
    secretConfigured: dest.secretConfigured,
  }
}

export function destDraftReady(draft: BackupDestDraft): boolean {
  if (draft.kind === 'local') return Boolean(draft.directory.trim())
  return Boolean(
    validateS3Endpoint(draft.endpoint) &&
      draft.accessKeyId.trim() &&
      (draft.secretAccessKey.trim() || draft.secretConfigured) &&
      draft.bucketName.trim(),
  )
}

export function destsForSave(
  dests: BackupDestView[],
  extra: BackupDestSave[] = [],
): BackupDestSave[] {
  const rows = dests.map((dest) => ({
    id: dest.id,
    kind: dest.kind,
    directory: dest.directory,
    accessKeyId: dest.accessKeyId,
    secretAccessKey: '',
    bucketName: dest.bucketName,
    region: dest.region,
    endpoint: dest.endpoint,
    pathStyleAccess: dest.pathStyleAccess,
    prefix: dest.prefix,
  }))
  for (const item of extra) {
    const index = item.id ? rows.findIndex((row) => row.id === item.id) : -1
    if (index >= 0) {
      rows[index] = item
    } else {
      rows.push(item)
    }
  }
  return rows
}

export function draftToSave(draft: BackupDestDraft): BackupDestSave {
  return {
    id: draft.id,
    kind: draft.kind,
    directory: draft.directory,
    accessKeyId: draft.accessKeyId,
    secretAccessKey: draft.secretAccessKey,
    bucketName: draft.bucketName,
    region: draft.region,
    endpoint: draft.endpoint,
    pathStyleAccess: draft.pathStyleAccess,
    prefix: draft.prefix,
  }
}

export function emptyBackupStatus(): BackupStatus {
  return {
    lastGitAt: null,
    lastGitHash: null,
    lastSnapshot: null,
    lastSnapshotAt: null,
    lastError: null,
    watching: false,
    hasKey: false,
    resticReady: false,
    appLedger: false,
    hasLedgerFile: false,
    dests: [],
  }
}

export function archiveBlockReason(
  settings: BackupSettings,
  status: Pick<BackupStatus, 'hasKey' | 'resticReady'>,
):
  | 'backup-key-missing'
  | 'missing-restic'
  | 'archive-dir'
  | 'archive-dir-gone'
  | 'archive-dest'
  | null {
  if (!status.hasKey) return 'backup-key-missing'
  if (!status.resticReady) return 'missing-restic'
  if (settings.dests.length === 0) return 'archive-dest'
  if (settings.dests.some((dest) => dest.ready)) return null
  if (settings.dests.some((dest) => dest.kind === 'local' && dest.missing)) {
    return 'archive-dir-gone'
  }
  if (settings.dests.some((dest) => dest.kind === 'local' && !dest.directory.trim())) {
    return 'archive-dir'
  }
  return 'archive-dest'
}

export function canWriteArchive(
  settings: BackupSettings,
  status: Pick<BackupStatus, 'hasKey' | 'resticReady'>,
): boolean {
  return archiveBlockReason(settings, status) === null
}

/** Short label for a restic dest. Cloud URLs stay off the restore picker. */
export function presentBackupRepo(
  location: string,
  t: (key: MessageKey, vars?: Vars) => string,
): string {
  const cloud = presentCloudRepo(location)
  if (cloud !== null) {
    return cloud ? `${t('settings.backupArchiveCloud')} · ${cloud}` : t('settings.backupArchiveCloud')
  }
  const leaf = location.split(/[/\\]/).filter(Boolean).at(-1)
  return leaf ? `${t('settings.backupArchiveLocal')} · ${leaf}` : t('settings.backupArchiveLocal')
}

export function destTitle(dest: BackupDestView): string {
  if (dest.kind === 's3') {
    return destBucketPrefix(dest) || presentCloudRepo(dest.location) || dest.location
  }
  return dest.directory.split(/[/\\]/).filter(Boolean).at(-1) || dest.directory
}

export function destPath(dest: BackupDestView): string {
  if (dest.kind === 'local') return dest.directory
  const rest = destBucketPrefix(dest)
  let host = ''
  try {
    if (dest.endpoint.trim()) host = new URL(dest.endpoint).host
  } catch {
    host = dest.endpoint.trim()
  }
  if (host && rest) return `${host}/${rest}`
  return host || rest || dest.location
}

export function destPulseOf(status: BackupStatus, id: string): DestPulse | undefined {
  return status.dests.find((item) => item.id === id)
}

export function destStatus(dest: BackupDestView): 'missing' | 'check-pending' | 'ready' | 'incomplete' {
  if (dest.missing) return 'missing'
  if (dest.checkFailed) return 'check-pending'
  if (dest.ready) return 'ready'
  return 'incomplete'
}

function destBucketPrefix(dest: BackupDestView): string {
  const bucket = dest.bucketName.trim()
  const prefix = dest.prefix.trim().replace(/^\/+|\/+$/g, '')
  if (bucket && prefix) return `${bucket}/${prefix}`
  return bucket
}

function presentCloudRepo(location: string): string | null {
  if (!location.startsWith('s3:')) return null
  try {
    return new URL(location.slice(3)).pathname.replace(/^\/+|\/+$/g, '')
  } catch {
    return ''
  }
}

export function presentBackupSnapshot(id: string, time = ''): string {
  const short = id.slice(0, 8)
  const when = presentBackupTime(time)
  return when ? `${short} · ${when}` : short
}

export function presentBackupTime(value: string): string {
  const match = value.trim().match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/)
  return match ? `${match[1]} ${match[2]}` : ''
}

export function archiveNestsLedger(workdir: string, dest: string): boolean {
  const ledger = workdir.trim().replace(/[/\\]+$/, '')
  const target = dest.trim().replace(/[/\\]+$/, '')
  if (!ledger || !target) return false
  if (target === ledger) return true
  return target.startsWith(`${ledger}/`) || target.startsWith(`${ledger}\\`)
}

/** HTTPS S3 API host. No path, query, user, or fragment. */
export function validateS3Endpoint(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return null
  }
  if (url.protocol !== 'https:') return null
  if (url.username || url.password) return null
  if (url.pathname !== '/' || url.search || url.hash) return null
  if (!url.hostname) return null
  return url.origin
}

/** A leftover `directory` / `missing` code after the book is on disk is not a missing folder. */
export function backupBannerError(
  lastError: string | null,
  appLedger: boolean,
): string | null {
  if (appLedger && (lastError === 'directory' || lastError === 'missing')) return null
  return lastError
}

export function backupErrorCode(error: unknown): string {
  if (typeof error === 'string') return error
  if (error instanceof Error) return error.message
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message: unknown }).message
    if (typeof message === 'string') return message
  }
  return ''
}

export function explainBackupError(
  error: unknown,
  t: (key: MessageKey, vars?: Vars) => string,
): string {
  const code = backupErrorCode(error)
  if (code === 'directory' || code === 'missing') return t('settings.backupNeedFolder')
  if (code === 'git') return t('settings.backupErrorGit')
  if (code === 'backup-key-missing') return t('settings.backupErrorKey')
  if (code === 'missing-restic') return t('settings.backupErrorRestic')
  if (code === 'encrypt') return t('settings.backupErrorEncrypt')
  if (code === 'archive-dest') return t('settings.backupErrorArchiveDest')
  if (code === 'archive-dir') return t('settings.backupErrorArchiveDir')
  if (code === 'archive-dir-gone') return t('settings.backupErrorArchiveDirGone')
  if (code === 'archive-nested') return t('settings.backupErrorArchiveNested')
  if (code === 's3-endpoint') return t('settings.backupErrorS3Endpoint')
  if (code === 's3-config') return t('settings.backupErrorS3Config')
  if (code === 's3' || code === 'restic') return t('settings.backupErrorS3')
  if (code === 'backup-partial') return t('settings.backupErrorPartial')
  if (code === 'snapshot') return t('settings.backupErrorSnapshot')
  if (code === 'foreign-ledger') return t('settings.backupForeign')
  if (code === 'check') return t('settings.backupErrorCheck')
  if (code === 'check-pending') return t('settings.backupErrorCheckPending')
  return code || t('common.errorFallback')
}
