import { describe, expect, test } from 'bun:test'

import type { MessageKey } from '@/i18n/locales/en'

import {
  archiveNestsLedger,
  archiveBlockReason,
  backupErrorCode,
  canWriteArchive,
  destFolderMissing,
  emptyBackupSettings,
  explainBackupError,
  presentBackupRepo,
  presentBackupSnapshot,
  validateS3Endpoint,
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
  const ready = { hasKey: true, resticReady: true, archiveDirReady: false, archiveDirectory: '' }

  test('an empty dest is incomplete, not a vanished folder', () => {
    const settings = emptyBackupSettings()
    expect(destFolderMissing(settings, { archiveDirReady: false, archiveDirectory: '' })).toBe(false)
    expect(
      destFolderMissing(
        { ...settings, archiveLocal: true },
        { archiveDirReady: false, archiveDirectory: '' },
      ),
    ).toBe(false)
    expect(
      destFolderMissing(
        { ...settings, archiveLocal: true, archiveDirectory: '/backups' },
        { archiveDirReady: false, archiveDirectory: '' },
      ),
    ).toBe(false)
    expect(
      destFolderMissing(
        { ...settings, archiveLocal: true, archiveDirectory: '/backups' },
        { archiveDirReady: false, archiveDirectory: '/backups' },
      ),
    ).toBe(true)
    expect(
      destFolderMissing(
        { ...settings, archiveLocal: true, archiveDirectory: '/backups' },
        { archiveDirReady: true, archiveDirectory: '/backups' },
      ),
    ).toBe(false)
  })

  test('a backup needs a key, restic, and at least one dest', () => {
    const settings = emptyBackupSettings()
    expect(archiveBlockReason(settings, { ...ready, hasKey: false })).toBe('backup-key-missing')
    expect(archiveBlockReason(settings, { ...ready, resticReady: false })).toBe('missing-restic')
    expect(archiveBlockReason(settings, ready)).toBe('archive-dest')
    expect(
      canWriteArchive(
        { ...settings, archiveLocal: true, archiveDirectory: '/backups' },
        { ...ready, archiveDirReady: true, archiveDirectory: '/backups' },
      ),
    ).toBe(true)
    expect(
      archiveBlockReason(
        { ...settings, archiveAuto: true, archiveLocal: true },
        ready,
      ),
    ).toBe('archive-dir')
    expect(
      canWriteArchive(
        { ...settings, archiveAuto: true, archiveLocal: true, archiveDirectory: '/backups' },
        { ...ready, archiveDirReady: false, archiveDirectory: '' },
      ),
    ).toBe(true)
    expect(
      archiveBlockReason(
        { ...settings, archiveAuto: true, archiveLocal: true, archiveDirectory: '/backups' },
        { ...ready, archiveDirReady: false, archiveDirectory: '/backups' },
      ),
    ).toBe('archive-dir-gone')
    expect(archiveBlockReason({ ...settings, archiveAuto: true }, ready)).toBe('archive-dest')
    expect(canWriteArchive({ ...settings, archiveAuto: true, s3Enabled: true }, ready)).toBe(true)
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
})
