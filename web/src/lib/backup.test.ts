import { describe, expect, test } from 'bun:test'

import type { MessageKey } from '@/i18n/locales/en'

import {
  ARCHIVE_PREFIX,
  ARCHIVE_SUFFIX,
  archiveNestsLedger,
  archiveBlockReason,
  backupErrorCode,
  canWriteArchive,
  defaultArchiveName,
  emptyBackupSettings,
  explainBackupError,
  needsDebounce,
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
  test('debounce is shared by either auto path', () => {
    const settings = emptyBackupSettings()
    expect(needsDebounce(settings)).toBe(true)
    expect(needsDebounce({ ...settings, watch: false })).toBe(false)
    expect(needsDebounce({ ...settings, watch: false, archiveAuto: true })).toBe(true)
  })

  test('manual backup needs a key; auto backup also needs a live dest', () => {
    const settings = emptyBackupSettings()
    expect(archiveBlockReason(settings, { hasKey: false, archiveDirReady: true })).toBe(
      'backup-key-missing',
    )
    expect(canWriteArchive(settings, { hasKey: true, archiveDirReady: false })).toBe(true)
    expect(
      archiveBlockReason(
        { ...settings, archiveAuto: true, archiveLocal: true },
        { hasKey: true, archiveDirReady: false },
      ),
    ).toBe('archive-dir')
    expect(
      canWriteArchive(
        { ...settings, archiveAuto: true, archiveLocal: true },
        { hasKey: true, archiveDirReady: true },
      ),
    ).toBe(true)
    expect(
      archiveBlockReason({ ...settings, archiveAuto: true }, { hasKey: true, archiveDirReady: false }),
    ).toBe('archive-dest')
    expect(
      canWriteArchive(
        { ...settings, archiveAuto: true, s3Enabled: true },
        { hasKey: true, archiveDirReady: false },
      ),
    ).toBe(true)
  })

  test('backup dest cannot sit in the ledger tree', () => {
    expect(archiveNestsLedger('/ledger', '/ledger')).toBe(true)
    expect(archiveNestsLedger('/ledger', '/ledger/documents')).toBe(true)
    expect(archiveNestsLedger('/ledger/', '/ledger/backups/')).toBe(true)
    expect(archiveNestsLedger('/ledger', '/ledger-copy')).toBe(false)
    expect(archiveNestsLedger('/ledger', '/elsewhere')).toBe(false)
  })

  test('default archive name uses the OpenSSL-compatible suffix', () => {
    const name = defaultArchiveName(new Date(Date.UTC(2026, 9, 4, 9, 53, 0)))
    expect(name.startsWith(ARCHIVE_PREFIX)).toBe(true)
    expect(name.endsWith(ARCHIVE_SUFFIX)).toBe(true)
    expect(name).toBe('beandesk-backup-20261004_095300.tar.gz.enc')
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
    expect(explainBackupError(new Error('backup-key-missing'), t)).toBe('settings.backupErrorKey')
    expect(explainBackupError({ message: 'encrypt' }, t)).toBe('settings.backupErrorEncrypt')
    expect(explainBackupError('git', t)).toBe('settings.backupErrorGit')
    expect(explainBackupError('archive-dest', t)).toBe('settings.backupErrorArchiveDest')
    expect(explainBackupError('archive-dir', t)).toBe('settings.backupErrorArchiveDir')
    expect(explainBackupError('archive-nested', t)).toBe('settings.backupErrorArchiveNested')
    expect(explainBackupError('check', t)).toBe('settings.backupErrorCheck')
  })
})
