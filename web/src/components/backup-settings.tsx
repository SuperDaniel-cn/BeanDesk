import { useEffect, useRef, useState } from 'react'

import { invoke } from '@tauri-apps/api/core'
import { FolderOpen } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSeparator,
  FieldSet,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { Switch } from '@/components/ui/switch'
import { useI18n } from '@/i18n'
import {
  archiveBlockReason,
  archiveNestsLedger,
  canWriteArchive,
  defaultArchiveName,
  emptyBackupSettings,
  emptyBackupStatus,
  explainBackupError,
  validateS3Endpoint,
  type BackupSettings,
  type BackupStatus,
} from '@/lib/backup'

export function BackupSettingsPanel({ workDirectory }: { workDirectory: string }) {
  const { t } = useI18n()
  const [settings, setSettings] = useState(emptyBackupSettings)
  const [status, setStatus] = useState(emptyBackupStatus)
  const [secret, setSecret] = useState('')
  const [passphrase, setPassphrase] = useState('')
  const [busy, setBusy] = useState(false)
  const settingsRef = useRef(settings)
  const writeLock = useRef(Promise.resolve())
  const ready = Boolean(workDirectory)
  const locked = !ready || busy
  const destMissing = settings.archiveLocal && !status.archiveDirReady
  const hasKey = ready && status.hasKey
  const canArchive = ready && !busy && canWriteArchive(settings, status)
  const endpointInvalid = Boolean(settings.endpoint.trim() && !validateS3Endpoint(settings.endpoint))
  const destNested = settings.archiveLocal && archiveNestsLedger(workDirectory, settings.archiveDirectory)

  async function refreshStatus() {
    const next = await invoke<BackupStatus>('backup_status')
    setStatus(next)
    return next
  }

  useEffect(() => {
    void invoke<BackupSettings>('load_backup_settings')
      .then((next) => {
        settingsRef.current = next
        setSettings(next)
      })
      .catch(() => undefined)
    void refreshStatus().catch(() => undefined)
    const id = window.setInterval(() => {
      void refreshStatus().catch(() => undefined)
    }, 2000)
    return () => window.clearInterval(id)
  }, [])

  function fail(caught: unknown) {
    toast.error(explainBackupError(caught, t))
  }

  function enqueue(task: () => Promise<void>) {
    const run = writeLock.current.then(task, task)
    writeLock.current = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  async function persist(next: BackupSettings, secretOverride = secret) {
    if (next.s3Enabled && next.endpoint.trim() && !validateS3Endpoint(next.endpoint)) {
      throw new Error('s3-endpoint')
    }
    const saved = await invoke<BackupSettings>('save_backup_settings', {
      input: { ...next, secretAccessKey: secretOverride },
    })
    settingsRef.current = saved
    setSettings(saved)
    setSecret('')
    return saved
  }

  function update(patch: Partial<BackupSettings>) {
    const next = { ...settingsRef.current, ...patch }
    settingsRef.current = next
    setSettings(next)
    void enqueue(async () => {
      try {
        await persist(next)
      } catch (caught) {
        fail(caught)
      }
    })
  }

  function persistCurrent() {
    void enqueue(async () => {
      try {
        await persist(settingsRef.current)
      } catch (caught) {
        fail(caught)
      }
    })
  }

  function patchString<K extends keyof BackupSettings>(key: K, value: BackupSettings[K]) {
    const next = { ...settingsRef.current, [key]: value }
    settingsRef.current = next
    setSettings(next)
  }

  async function runBackup() {
    if (!ready) {
      toast.error(t('settings.backupNeedFolder'))
      return
    }
    const latest = await refreshStatus().catch(() => status)
    const blocked = archiveBlockReason(settingsRef.current, latest)
    if (blocked) {
      fail(blocked)
      return
    }
    setBusy(true)
    try {
      await enqueue(async () => {
        await persist(settingsRef.current)
      })
      if (settingsRef.current.archiveAuto) {
        const next = await invoke<BackupStatus>('backup_now')
        setStatus(next)
      } else {
        const { save } = await import('@tauri-apps/plugin-dialog')
        const dest = await save({
          defaultPath: defaultArchiveName(),
          filters: [{ name: 'enc', extensions: ['enc'] }],
        })
        if (typeof dest !== 'string') return
        if (archiveNestsLedger(workDirectory, dest)) {
          throw new Error('archive-nested')
        }
        const next = await invoke<BackupStatus>('backup_export', { dest })
        setStatus(next)
      }
      toast.success(t('settings.backupOk'))
    } catch (caught) {
      fail(caught)
    } finally {
      setBusy(false)
    }
  }

  async function saveKey() {
    setBusy(true)
    try {
      const next = await invoke<BackupStatus>('backup_set_key', { password: passphrase })
      setStatus(next)
      setPassphrase('')
    } catch (caught) {
      fail(caught)
    } finally {
      setBusy(false)
    }
  }

  async function restore() {
    const latest = await refreshStatus().catch(() => status)
    if (!latest.hasKey) {
      toast.error(t('settings.backupErrorKey'))
      return
    }
    const { open } = await import('@tauri-apps/plugin-dialog')
    const archive = await open({
      multiple: false,
      filters: [{ name: 'enc', extensions: ['enc'] }],
    })
    if (typeof archive !== 'string') return
    const output = await open({ directory: true, multiple: false })
    if (typeof output !== 'string') return
    setBusy(true)
    try {
      await invoke('backup_restore', { archive, output })
      toast.success(t('settings.backupRestoreOk'))
    } catch (caught) {
      fail(caught)
    } finally {
      setBusy(false)
    }
  }

  async function pickArchiveDirectory() {
    const { open } = await import('@tauri-apps/plugin-dialog')
    const picked = await open({
      directory: true,
      multiple: false,
      title: t('settings.browse'),
      defaultPath: settings.archiveDirectory || undefined,
    })
    if (typeof picked !== 'string') return
    if (archiveNestsLedger(workDirectory, picked)) {
      toast.error(explainBackupError('archive-nested', t))
      return
    }
    update({ archiveDirectory: picked })
  }

  function debounceField(id: string) {
    return (
      <Field data-disabled={locked || undefined}>
        <FieldLabel htmlFor={id}>{t('settings.backupDebounce')}</FieldLabel>
        <Input
          id={id}
          type="number"
          min={1}
          value={settings.debounceSecs}
          disabled={locked}
          onChange={(event) =>
            patchString('debounceSecs', Math.max(1, Number(event.target.value) || 1))
          }
          onBlur={persistCurrent}
        />
      </Field>
    )
  }

  async function testS3() {
    if (settings.endpoint.trim() && !validateS3Endpoint(settings.endpoint)) {
      toast.error(t('settings.backupErrorS3Endpoint'))
      return
    }
    setBusy(true)
    try {
      await enqueue(async () => {
        await persist(settingsRef.current)
      })
      await invoke('backup_test_s3')
      toast.success(t('settings.backupS3TestOk'))
    } catch (caught) {
      fail(caught)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
      }}
    >
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="backup-workdir">{t('settings.directory')}</FieldLabel>
          <div className="flex w-full gap-2">
            <Input
              id="backup-workdir"
              value={workDirectory}
              readOnly
              className="min-w-0 flex-1 font-mono"
            />
            <Button
              type="button"
              variant="outline"
              disabled={locked}
              className="shrink-0"
              onClick={() => void invoke('backup_open_workdir')}
            >
              <FolderOpen data-icon="inline-start" />
              {t('settings.backupOpen')}
            </Button>
          </div>
        </Field>

        <FieldSeparator />

        <FieldSet>
          <FieldLegend>{t('settings.backupSectionLocal')}</FieldLegend>
          <FieldGroup>
            <Field orientation="horizontal" data-disabled={locked || undefined}>
              <FieldContent>
                <FieldLabel htmlFor="backup-watch">{t('settings.backupWatch')}</FieldLabel>
                <FieldDescription>{t('settings.backupWatchHint')}</FieldDescription>
                {status.lastGitHash ? (
                  <FieldDescription>
                    {t('settings.backupGitOk', { hash: status.lastGitHash })}
                  </FieldDescription>
                ) : null}
              </FieldContent>
              <Switch
                id="backup-watch"
                checked={settings.watch}
                disabled={locked}
                onCheckedChange={(watch) => update({ watch })}
              />
            </Field>
            {settings.watch ? debounceField('backup-debounce') : null}
          </FieldGroup>
        </FieldSet>

        <FieldSeparator />

        <FieldSet>
          <FieldLegend>{t('settings.backupEncrypt')}</FieldLegend>
          <FieldDescription>{t('settings.backupSectionEncrypt')}</FieldDescription>
          <FieldGroup>
            {status.hasKey ? (
              <Alert>
                <AlertDescription>{t('settings.backupKeySet')}</AlertDescription>
              </Alert>
            ) : null}
            <Field data-disabled={locked || undefined}>
              <FieldLabel htmlFor="backup-key">{t('settings.backupKey')}</FieldLabel>
              <div className="flex w-full flex-wrap gap-2">
                <Input
                  id="backup-key"
                  type="password"
                  value={passphrase}
                  disabled={locked}
                  className="min-w-0 flex-1"
                  onChange={(event) => setPassphrase(event.target.value)}
                />
                <Button
                  type="button"
                  variant="outline"
                  disabled={locked || !passphrase}
                  className="shrink-0"
                  onClick={() => void saveKey()}
                >
                  {t('settings.backupKeySave')}
                </Button>
                <Button
                  type="button"
                  disabled={!canArchive}
                  className="shrink-0"
                  onClick={() => void runBackup()}
                >
                  {busy ? <Spinner data-icon="inline-start" /> : null}
                  {t('settings.backupNow')}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={!hasKey || busy}
                  className="shrink-0"
                  onClick={() => void restore()}
                >
                  {t('settings.backupRestore')}
                </Button>
              </div>
              {status.lastArchive ? (
                <FieldDescription>
                  {t('settings.backupLastArchive')}: {status.lastArchive}
                </FieldDescription>
              ) : null}
            </Field>
            <Field orientation="horizontal" data-disabled={!hasKey || locked || undefined}>
              <FieldContent>
                <FieldLabel htmlFor="backup-auto">{t('settings.backupArchiveAuto')}</FieldLabel>
                <FieldDescription>{t('settings.backupArchiveAutoHint')}</FieldDescription>
              </FieldContent>
              <Switch
                id="backup-auto"
                checked={settings.archiveAuto && status.hasKey}
                disabled={!hasKey || locked}
                onCheckedChange={(archiveAuto) => update({ archiveAuto })}
              />
            </Field>
            {settings.archiveAuto && !settings.watch ? debounceField('backup-auto-debounce') : null}
            {settings.archiveAuto ? (
              <FieldGroup>
                <Field data-disabled={locked || undefined}>
                  <FieldLabel htmlFor="backup-keep">{t('settings.backupKeep')}</FieldLabel>
                  <Input
                    id="backup-keep"
                    type="number"
                    min={1}
                    value={settings.keep}
                    disabled={locked}
                    onChange={(event) =>
                      patchString('keep', Math.max(1, Number(event.target.value) || 1))
                    }
                    onBlur={persistCurrent}
                  />
                </Field>
                <Field orientation="horizontal" data-disabled={locked || undefined}>
                  <FieldLabel htmlFor="backup-local">{t('settings.backupArchiveLocal')}</FieldLabel>
                  <Switch
                    id="backup-local"
                    checked={settings.archiveLocal}
                    disabled={locked}
                    onCheckedChange={(archiveLocal) => update({ archiveLocal })}
                  />
                </Field>
                {settings.archiveLocal ? (
                  <Field
                    data-disabled={locked || undefined}
                    data-invalid={destNested || destMissing || undefined}
                  >
                    <FieldLabel htmlFor="backup-archive-dir">
                      {t('settings.backupArchiveDirectory')}
                    </FieldLabel>
                    <div className="flex w-full gap-2">
                      <Input
                        id="backup-archive-dir"
                        value={settings.archiveDirectory}
                        readOnly
                        placeholder={t('settings.browse')}
                        className="min-w-0 flex-1 font-mono"
                        aria-invalid={destNested || destMissing || undefined}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        disabled={locked}
                        className="shrink-0"
                        onClick={() => void pickArchiveDirectory()}
                      >
                        <FolderOpen data-icon="inline-start" />
                        {t('settings.browse')}
                      </Button>
                    </div>
                    {destNested ? (
                      <FieldError>{t('settings.backupErrorArchiveNested')}</FieldError>
                    ) : destMissing ? (
                      <FieldError>{t('settings.backupErrorArchiveDir')}</FieldError>
                    ) : null}
                  </Field>
                ) : null}
                <Field orientation="horizontal" data-disabled={locked || undefined}>
                  <FieldContent>
                    <FieldLabel htmlFor="backup-cloud">{t('settings.backupArchiveCloud')}</FieldLabel>
                    <FieldDescription>{t('settings.backupS3Hint')}</FieldDescription>
                  </FieldContent>
                  <Switch
                    id="backup-cloud"
                    checked={settings.s3Enabled}
                    disabled={locked}
                    onCheckedChange={(s3Enabled) => update({ s3Enabled })}
                  />
                </Field>
                {settings.s3Enabled ? (
                  <FieldGroup>
                    <Field
                      data-disabled={locked || undefined}
                      data-invalid={endpointInvalid || undefined}
                    >
                      <FieldLabel htmlFor="backup-s3-endpoint">
                        {t('settings.backupS3Endpoint')}
                      </FieldLabel>
                      <Input
                        id="backup-s3-endpoint"
                        value={settings.endpoint}
                        disabled={locked}
                        spellCheck={false}
                        aria-invalid={endpointInvalid || undefined}
                        onChange={(event) => patchString('endpoint', event.target.value)}
                        onBlur={persistCurrent}
                      />
                      {endpointInvalid ? (
                        <FieldError>{t('settings.backupErrorS3Endpoint')}</FieldError>
                      ) : null}
                    </Field>
                    <TextField
                      id="backup-s3-bucket"
                      label={t('settings.backupS3Bucket')}
                      value={settings.bucketName}
                      disabled={locked}
                      onChange={(bucketName) => patchString('bucketName', bucketName)}
                      onBlur={persistCurrent}
                    />
                    <TextField
                      id="backup-s3-region"
                      label={t('settings.backupS3Region')}
                      value={settings.region}
                      disabled={locked}
                      onChange={(region) => patchString('region', region)}
                      onBlur={persistCurrent}
                    />
                    <TextField
                      id="backup-s3-access"
                      label={t('settings.backupS3AccessKey')}
                      value={settings.accessKeyId}
                      disabled={locked}
                      onChange={(accessKeyId) => patchString('accessKeyId', accessKeyId)}
                      onBlur={persistCurrent}
                    />
                    <Field data-disabled={locked || undefined}>
                      <FieldLabel htmlFor="backup-s3-secret">{t('settings.backupS3Secret')}</FieldLabel>
                      <Input
                        id="backup-s3-secret"
                        type="password"
                        value={secret}
                        placeholder={settings.secretConfigured ? '••••••••' : undefined}
                        disabled={locked}
                        onChange={(event) => setSecret(event.target.value)}
                        onBlur={persistCurrent}
                      />
                    </Field>
                    <Field orientation="horizontal" data-disabled={locked || undefined}>
                      <FieldLabel htmlFor="backup-s3-path">{t('settings.backupS3PathStyle')}</FieldLabel>
                      <Switch
                        id="backup-s3-path"
                        checked={settings.pathStyleAccess}
                        disabled={locked}
                        onCheckedChange={(pathStyleAccess) => update({ pathStyleAccess })}
                      />
                    </Field>
                    <TextField
                      id="backup-s3-prefix"
                      label={t('settings.backupS3Prefix')}
                      value={settings.prefix}
                      disabled={locked}
                      onChange={(prefix) => patchString('prefix', prefix)}
                      onBlur={persistCurrent}
                    />
                    <Field orientation="horizontal">
                      <Button type="button" variant="outline" disabled={locked} onClick={() => void testS3()}>
                        {t('settings.backupS3Test')}
                      </Button>
                    </Field>
                    {status.lastUpload ? (
                      <FieldDescription>
                        {t('settings.backupLastUpload')}: {status.lastUpload}
                      </FieldDescription>
                    ) : null}
                  </FieldGroup>
                ) : null}
              </FieldGroup>
            ) : null}
          </FieldGroup>
        </FieldSet>
      </FieldGroup>
    </form>
  )
}

function TextField({
  id,
  label,
  value,
  disabled,
  onChange,
  onBlur,
}: {
  id: string
  label: string
  value: string
  disabled: boolean
  onChange: (value: string) => void
  onBlur: () => void
}) {
  return (
    <Field data-disabled={disabled || undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        value={value}
        disabled={disabled}
        spellCheck={false}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
      />
    </Field>
  )
}
