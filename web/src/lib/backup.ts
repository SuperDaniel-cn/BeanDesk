import type { Vars } from '@/i18n/catalog'
import type { MessageKey } from '@/i18n/locales/en'

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
}

export type BackupSnapshot = {
  id: string
  time: string
}

export type BackupStatus = {
  lastGitAt: string | null
  lastGitHash: string | null
  lastSnapshot: string | null
  lastSnapshotAt: string | null
  lastUpload: string | null
  lastError: string | null
  watching: boolean
  hasKey: boolean
  resticReady: boolean
  archiveDirReady: boolean
  archiveDirectory: string
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
  }
}

export function emptyBackupStatus(): BackupStatus {
  return {
    lastGitAt: null,
    lastGitHash: null,
    lastSnapshot: null,
    lastSnapshotAt: null,
    lastUpload: null,
    lastError: null,
    watching: false,
    hasKey: false,
    resticReady: false,
    archiveDirReady: false,
    archiveDirectory: '',
  }
}

export function destFolderMissing(
  settings: BackupSettings,
  status: Pick<BackupStatus, 'archiveDirReady' | 'archiveDirectory'>,
): boolean {
  const dest = settings.archiveDirectory.trim()
  if (!settings.archiveLocal || !dest) return false
  if (status.archiveDirectory !== dest) return false
  return !status.archiveDirReady
}

export function archiveBlockReason(
  settings: BackupSettings,
  status: Pick<BackupStatus, 'hasKey' | 'resticReady' | 'archiveDirReady' | 'archiveDirectory'>,
):
  | 'backup-key-missing'
  | 'missing-restic'
  | 'archive-dir'
  | 'archive-dir-gone'
  | 'archive-dest'
  | null {
  if (!status.hasKey) return 'backup-key-missing'
  if (!status.resticReady) return 'missing-restic'
  if (!settings.archiveLocal && !settings.s3Enabled) return 'archive-dest'
  if (settings.archiveLocal) {
    if (!settings.archiveDirectory.trim()) return 'archive-dir'
    if (destFolderMissing(settings, status)) return 'archive-dir-gone'
  }
  return null
}

export function canWriteArchive(
  settings: BackupSettings,
  status: Pick<BackupStatus, 'hasKey' | 'resticReady' | 'archiveDirReady' | 'archiveDirectory'>,
): boolean {
  return archiveBlockReason(settings, status) === null
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
  if (code === 'check') return t('settings.backupErrorCheck')
  return code || t('common.errorFallback')
}
