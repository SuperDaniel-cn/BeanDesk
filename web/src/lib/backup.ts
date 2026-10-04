import type { Vars } from '@/i18n/catalog'
import type { MessageKey } from '@/i18n/locales/en'

export const ARCHIVE_PREFIX = 'beandesk-backup-'
export const ARCHIVE_SUFFIX = '.tar.gz.enc'

export type BackupSettings = {
  watch: boolean
  debounceSecs: number
  archiveAuto: boolean
  archiveLocal: boolean
  archiveDirectory: string
  s3Enabled: boolean
  accessKeyId: string
  bucketName: string
  region: string
  endpoint: string
  pathStyleAccess: boolean
  prefix: string
  secretConfigured: boolean
  keep: number
}

export type BackupStatus = {
  lastGitAt: string | null
  lastGitHash: string | null
  lastArchive: string | null
  lastUpload: string | null
  lastError: string | null
  watching: boolean
  hasKey: boolean
  archiveDirReady: boolean
}

export function emptyBackupSettings(): BackupSettings {
  return {
    watch: true,
    debounceSecs: 5,
    archiveAuto: false,
    archiveLocal: false,
    archiveDirectory: '',
    s3Enabled: false,
    accessKeyId: '',
    bucketName: '',
    region: '',
    endpoint: '',
    pathStyleAccess: true,
    prefix: '',
    secretConfigured: false,
    keep: 30,
  }
}

export function emptyBackupStatus(): BackupStatus {
  return {
    lastGitAt: null,
    lastGitHash: null,
    lastArchive: null,
    lastUpload: null,
    lastError: null,
    watching: false,
    hasKey: false,
    archiveDirReady: false,
  }
}

export function archiveBlockReason(
  settings: BackupSettings,
  status: Pick<BackupStatus, 'hasKey' | 'archiveDirReady'>,
): 'backup-key-missing' | 'archive-dir' | 'archive-dest' | null {
  if (!status.hasKey) return 'backup-key-missing'
  if (!settings.archiveAuto) return null
  if (settings.archiveLocal && !status.archiveDirReady) return 'archive-dir'
  if (!settings.archiveLocal && !settings.s3Enabled) return 'archive-dest'
  return null
}

export function canWriteArchive(
  settings: BackupSettings,
  status: Pick<BackupStatus, 'hasKey' | 'archiveDirReady'>,
): boolean {
  return archiveBlockReason(settings, status) === null
}

export function needsDebounce(settings: BackupSettings): boolean {
  return settings.watch || settings.archiveAuto
}

export function archiveNestsLedger(workdir: string, dest: string): boolean {
  const ledger = workdir.trim().replace(/[/\\]+$/, '')
  const target = dest.trim().replace(/[/\\]+$/, '')
  if (!ledger || !target) return false
  if (target === ledger) return true
  return target.startsWith(`${ledger}/`) || target.startsWith(`${ledger}\\`)
}

export function defaultArchiveName(now = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  const stamp = [
    now.getUTCFullYear(),
    pad(now.getUTCMonth() + 1),
    pad(now.getUTCDate()),
    '_',
    pad(now.getUTCHours()),
    pad(now.getUTCMinutes()),
    pad(now.getUTCSeconds()),
  ].join('')
  return `${ARCHIVE_PREFIX}${stamp}${ARCHIVE_SUFFIX}`
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
  if (code === 'encrypt') return t('settings.backupErrorEncrypt')
  if (code === 'archive-dest') return t('settings.backupErrorArchiveDest')
  if (code === 'archive-dir') return t('settings.backupErrorArchiveDir')
  if (code === 'archive-nested') return t('settings.backupErrorArchiveNested')
  if (code === 's3-endpoint') return t('settings.backupErrorS3Endpoint')
  if (code === 's3-config') return t('settings.backupErrorS3Config')
  if (code === 's3') return t('settings.backupErrorS3')
  if (code === 'check') return t('settings.backupErrorCheck')
  return code || t('common.errorFallback')
}
