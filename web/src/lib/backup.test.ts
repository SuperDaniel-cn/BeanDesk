import { describe, expect, test } from 'bun:test'

import type { MessageKey } from '@/i18n/locales/en'

import {
  archiveNestsLedger,
  archiveBlockReason,
  backupBannerError,
  backupErrorCode,
  canWriteArchive,
  destDraftReady,
  destPath,
  destsForSave,
  destStatus,
  destTitle,
  destToDraft,
  emptyBackupSettings,
  emptyDestDraft,
  explainBackupError,
  presentBackupRepo,
  presentBackupSnapshot,
  presentBackupTime,
  validateS3Endpoint,
  type BackupDestView,
} from './backup'

describe('validateS3Endpoint', () => {
  test('keeps an https origin', () => {
    expect(validateS3Endpoint('https://example.r2.cloudflarestorage.com/')).toBe(
      'https://example.r2.cloudflarestorage.com',
    )
  })

  test('rejects http, a path, and a query', () => {
    expect(validateS3Endpoint('http://minio.example:9000')).toBeNull()
    expect(validateS3Endpoint('https://example.r2.cloudflarestorage.com/my-bucket')).toBeNull()
    expect(validateS3Endpoint('https://example.r2.cloudflarestorage.com/?x=1')).toBeNull()
  })
})

describe('backup dests', () => {
  const ready = { hasKey: true, resticReady: true }

  function dest(patch: Partial<BackupDestView>): BackupDestView {
    return {
      id: 'one',
      kind: 'local',
      directory: '/backups',
      accessKeyId: '',
      bucketName: '',
      region: '',
      endpoint: '',
      pathStyleAccess: true,
      prefix: '',
      secretConfigured: false,
      location: '/backups',
      ready: true,
      missing: false,
      checkFailed: false,
      ...patch,
    }
  }

  test('a draft stays off disk until local path or S3 fields are complete', () => {
    expect(destDraftReady(emptyDestDraft('local'))).toBe(false)
    expect(destDraftReady({ ...emptyDestDraft('local'), directory: '/backups' })).toBe(true)
    expect(destDraftReady(emptyDestDraft('s3'))).toBe(false)
    expect(
      destDraftReady({
        ...emptyDestDraft('s3'),
        endpoint: 'https://example.r2.cloudflarestorage.com',
        accessKeyId: 'ak',
        secretAccessKey: 'sk',
        bucketName: 'books',
      }),
    ).toBe(true)
  })

  test('an edit draft can keep the stored secret', () => {
    expect(
      destDraftReady({
        ...destToDraft(
          dest({
            id: 'cloud',
            kind: 's3',
            accessKeyId: 'ak',
            bucketName: 'books',
            endpoint: 'https://example.r2.cloudflarestorage.com',
            secretConfigured: true,
          }),
        ),
        secretAccessKey: '',
      }),
    ).toBe(true)
  })

  test('saving dests omits secrets already stored on a row', () => {
    const saved = destsForSave([dest({ id: 'keep', kind: 's3', accessKeyId: 'ak' })])
    expect(saved[0]?.secretAccessKey).toBe('')
    expect(saved[0]?.id).toBe('keep')
  })

  test('saving dests replaces a row with the same id', () => {
    const saved = destsForSave(
      [dest({ id: 'keep', directory: '/old' })],
      [
        {
          id: 'keep',
          kind: 'local',
          directory: '/new',
          accessKeyId: '',
          secretAccessKey: '',
          bucketName: '',
          region: '',
          endpoint: '',
          pathStyleAccess: true,
          prefix: '',
        },
      ],
    )
    expect(saved).toHaveLength(1)
    expect(saved[0]?.directory).toBe('/new')
  })

  test('card copy uses a short title and path, not the restic URL', () => {
    const cloud = dest({
      kind: 's3',
      bucketName: 'opc-ledger-backup',
      prefix: 'beandesk',
      endpoint: 'https://fab90.r2.cloudflarestorage.com',
      location: 's3:https://fab90.r2.cloudflarestorage.com/opc-ledger-backup/beandesk',
    })
    expect(destTitle(cloud)).toBe('opc-ledger-backup/beandesk')
    expect(destPath(cloud)).toBe('fab90.r2.cloudflarestorage.com/opc-ledger-backup/beandesk')
    expect(destPath(cloud).startsWith('s3:')).toBe(false)
    expect(destTitle(dest({ directory: '/Users/me/Backups/ledger' }))).toBe('ledger')
    expect(destStatus(dest({ missing: true, ready: false }))).toBe('missing')
    expect(destStatus(dest({ ready: true, checkFailed: true }))).toBe('check-pending')
    expect(presentBackupTime('2026-10-05T00:37:38+08:00')).toBe('2026-10-05 00:37')
    expect(presentBackupTime('')).toBe('')
  })

  test('a backup needs a key, restic, and at least one ready dest', () => {
    const settings = emptyBackupSettings()
    expect(archiveBlockReason(settings, { ...ready, hasKey: false })).toBe('backup-key-missing')
    expect(archiveBlockReason(settings, { ...ready, resticReady: false })).toBe('missing-restic')
    expect(archiveBlockReason(settings, ready)).toBe('archive-dest')
    expect(canWriteArchive({ ...settings, dests: [dest({ ready: true })] }, ready)).toBe(true)
    expect(
      archiveBlockReason({ ...settings, dests: [dest({ ready: false, missing: true })] }, ready),
    ).toBe('archive-dir-gone')
    expect(
      archiveBlockReason(
        { ...settings, dests: [dest({ ready: false, directory: '', missing: false })] },
        ready,
      ),
    ).toBe('archive-dir')
    expect(
      canWriteArchive(
        { ...settings, dests: [dest({ kind: 's3', ready: true, directory: '', location: 's3:https://x/b' })] },
        ready,
      ),
    ).toBe(true)
  })

  test('restore labels keep the dest kind and drop the long URL', () => {
    const t = (key: MessageKey) => key
    expect(
      presentBackupRepo('s3:https://example.r2.cloudflarestorage.com/opc-ledger-backup/beandesk', t),
    ).toBe('settings.backupArchiveCloud · opc-ledger-backup/beandesk')
    expect(presentBackupRepo('s3:https://example.r2.cloudflarestorage.com', t)).toBe(
      'settings.backupArchiveCloud',
    )
    expect(presentBackupRepo('/Users/me/Backups/untitled folder 2', t)).toBe(
      'settings.backupArchiveLocal · untitled folder 2',
    )
    expect(presentBackupSnapshot('9630e77206f4c5c6a4f48d65938d5181a229953d', '2026-10-05T00:37:38+08:00')).toBe(
      '9630e772 · 2026-10-05 00:37',
    )
  })

  test('backup dest cannot sit in the ledger tree', () => {
    expect(archiveNestsLedger('/ledger', '/ledger')).toBe(true)
    expect(archiveNestsLedger('/ledger', '/ledger/documents')).toBe(true)
    expect(archiveNestsLedger('/ledger/', '/ledger/backups/')).toBe(true)
    expect(archiveNestsLedger('/ledger', '/ledger-copy')).toBe(false)
    expect(archiveNestsLedger('/ledger', '/elsewhere')).toBe(false)
  })
})

describe('explainBackupError', () => {
  test('maps backup codes from strings, errors, and invoke payloads', () => {
    const t = (key: MessageKey) => key
    expect(backupErrorCode('backup-key-missing')).toBe('backup-key-missing')
    expect(backupErrorCode(new Error('encrypt'))).toBe('encrypt')
    expect(backupErrorCode({ message: 'backup-key-missing' })).toBe('backup-key-missing')
    expect(explainBackupError('s3-endpoint', t)).toBe('settings.backupErrorS3Endpoint')
    expect(explainBackupError('backup-key-missing', t)).toBe('settings.backupErrorKey')
    expect(explainBackupError('missing-restic', t)).toBe('settings.backupErrorRestic')
    expect(explainBackupError('backup-partial', t)).toBe('settings.backupErrorPartial')
    expect(explainBackupError('snapshot', t)).toBe('settings.backupErrorSnapshot')
    expect(explainBackupError(new Error('backup-key-missing'), t)).toBe('settings.backupErrorKey')
    expect(explainBackupError({ message: 'encrypt' }, t)).toBe('settings.backupErrorEncrypt')
    expect(explainBackupError('git', t)).toBe('settings.backupErrorGit')
    expect(explainBackupError('archive-dest', t)).toBe('settings.backupErrorArchiveDest')
    expect(explainBackupError('archive-dir', t)).toBe('settings.backupErrorArchiveDir')
    expect(explainBackupError('archive-dir-gone', t)).toBe('settings.backupErrorArchiveDirGone')
    expect(explainBackupError('archive-nested', t)).toBe('settings.backupErrorArchiveNested')
    expect(explainBackupError('check', t)).toBe('settings.backupErrorCheck')
    expect(explainBackupError('check-pending', t)).toBe('settings.backupErrorCheckPending')
  })

  test('a leftover missing-folder code is dropped after the book exists', () => {
    expect(backupBannerError('directory', true)).toBeNull()
    expect(backupBannerError('missing', true)).toBeNull()
    expect(backupBannerError('directory', false)).toBe('directory')
    expect(backupBannerError('git', true)).toBe('git')
    expect(backupBannerError(null, true)).toBeNull()
  })
})
