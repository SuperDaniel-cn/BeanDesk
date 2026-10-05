import { useEffect, useRef, useState } from 'react'

import { invoke } from '@tauri-apps/api/core'
import { FolderOpen } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
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
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { Switch } from '@/components/ui/switch'
import { useI18n } from '@/i18n'
import {
  archiveBlockReason,
  archiveNestsLedger,
  backupBannerError,
  canWriteArchive,
  destFolderMissing,
  emptyBackupSettings,
  emptyBackupStatus,
  explainBackupError,
  presentBackupRepo,
  presentBackupSnapshot,
  validateS3Endpoint,
  type BackupSettings,
  type RepoSnapshots,
  type BackupStatus,
} from '@/lib/backup'

export function BackupSettingsPanel({ workDirectory }: { workDirectory: string }) {
  const { t } = useI18n()
  const [settings, setSettings] = useState(emptyBackupSettings)
  const [status, setStatus] = useState(emptyBackupStatus)
  const [statusLoaded, setStatusLoaded] = useState(false)
  const [secret, setSecret] = useState('')
  const [passphrase, setPassphrase] = useState('')
  const [work, setWork] = useState<'backup' | 'restore' | 'list' | 'pick' | 'key' | 's3' | null>(null)
  const [repos, setRepos] = useState<RepoSnapshots[] | null>(null)
  const [restoreRepo, setRestoreRepo] = useState('')
  const [restoreSnapshot, setRestoreSnapshot] = useState('')
  const busy = work !== null
  const blocking = work === 'backup' || work === 'restore' || work === 'list'
  const settingsRef = useRef(settings)
  const writeLock = useRef(Promise.resolve())
  const ready = Boolean(workDirectory)
  const foreign = statusLoaded && ready && !status.appLedger
  const locked = !ready || busy || foreign
  const destMissing = destFolderMissing(settings, status)
  const hasKey = ready && status.hasKey
  const canArchive = ready && !busy && !foreign && canWriteArchive(settings, status)
  const endpointInvalid = Boolean(settings.endpoint.trim() && !validateS3Endpoint(settings.endpoint))
  const destNested = settings.archiveLocal && archiveNestsLedger(workDirectory, settings.archiveDirectory)
  const folderError = backupBannerError(status.lastError, status.appLedger)

  async function refreshStatus() {
    const next = await invoke<BackupStatus>('backup_status')
    setStatus(next)
    setStatusLoaded(true)
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
    await refreshStatus().catch(() => undefined)
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

  async function paint() {
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve())
    })
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
    setWork('backup')
    await paint()
    try {
      await enqueue(async () => {
        await persist(settingsRef.current)
      })
      const next = await invoke<BackupStatus>('backup_now')
      setStatus(next)
      toast.success(t('settings.backupOk'))
    } catch (caught) {
      fail(caught)
    } finally {
      setWork(null)
    }
  }

  async function saveKey() {
    setWork('key')
    try {
      const next = await invoke<BackupStatus>('backup_set_key', { password: passphrase })
      setStatus(next)
      setPassphrase('')
    } catch (caught) {
      fail(caught)
    } finally {
      setWork(null)
    }
  }

  async function restore() {
    if (!ready || busy) return
    setWork('list')
    await paint()
    try {
      const latest = await refreshStatus().catch(() => status)
      if (!latest.hasKey) {
        toast.error(t('settings.backupErrorKey'))
        return
      }
      const listed = await invoke<RepoSnapshots[]>('backup_snapshots').catch(() => [])
      const usable = listed.filter((repo) => repo.snapshots.length > 0)
      if (!usable.length) {
        fail('snapshot')
        return
      }
      const first = usable[0]
      const newest = first.snapshots[first.snapshots.length - 1]
      setRepos(usable)
      setRestoreRepo(first.location)
      setRestoreSnapshot(newest.id)
    } catch (caught) {
      fail(caught)
    } finally {
      setWork(null)
    }
  }

  function chooseRestoreRepo(location: string) {
    const repo = repos?.find((item) => item.location === location)
    setRestoreRepo(location)
    const newest = repo?.snapshots[repo.snapshots.length - 1]
    setRestoreSnapshot(newest?.id ?? '')
  }

  async function confirmRestore() {
    if (busy) return
    if (!restoreRepo || !restoreSnapshot) {
      fail('snapshot')
      return
    }
    setWork('pick')
    try {
      const { open } = await import('@tauri-apps/plugin-dialog')
      const output = await open({ directory: true, multiple: false })
      if (typeof output !== 'string') return
      const snapshot = restoreSnapshot
      const dest = restoreRepo
      setRepos(null)
      setWork('restore')
      await paint()
      await invoke('backup_restore', { snapshot, output, dest })
      toast.success(t('settings.backupRestoreOk'))
    } catch (caught) {
      fail(caught)
    } finally {
      setWork(null)
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
    setWork('s3')
    try {
      await enqueue(async () => {
        await persist(settingsRef.current)
      })
      await invoke('backup_test_s3')
      toast.success(t('settings.backupS3TestOk'))
    } catch (caught) {
      fail(caught)
    } finally {
      setWork(null)
    }
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
      }}
    >
      <Dialog open={repos !== null} onOpenChange={(open) => !open && setRepos(null)}>
        <DialogContent className="min-w-0 overflow-hidden sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('settings.backupRestorePick')}</DialogTitle>
            <DialogDescription>{t('settings.backupKeepHint')}</DialogDescription>
          </DialogHeader>
          <Field className="min-w-0">
            <FieldLabel>{t('settings.backupRestoreRepo')}</FieldLabel>
            <Select value={restoreRepo} onValueChange={chooseRestoreRepo}>
              <SelectTrigger className="min-w-0 w-full overflow-hidden **:data-[slot=select-value]:block **:data-[slot=select-value]:truncate">
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper" className="min-w-0 max-w-[var(--radix-select-trigger-width)]">
                <SelectGroup>
                  {repos?.map((repo) => (
                    <SelectItem key={repo.location} value={repo.location} className="min-w-0">
                      <span className="min-w-0 truncate">{presentBackupRepo(repo.location, t)}</span>
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          <Field className="min-w-0">
            <FieldLabel>{t('settings.backupRestoreSnapshot')}</FieldLabel>
            <Select value={restoreSnapshot} onValueChange={setRestoreSnapshot}>
              <SelectTrigger className="min-w-0 w-full overflow-hidden **:data-[slot=select-value]:block **:data-[slot=select-value]:truncate">
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper" className="min-w-0 max-w-[var(--radix-select-trigger-width)]">
                <SelectGroup>
                  {repos
                    ?.find((repo) => repo.location === restoreRepo)
                    ?.snapshots.map((snapshot) => (
                      <SelectItem key={snapshot.id} value={snapshot.id} className="min-w-0">
                        <span className="min-w-0 truncate">
                          {presentBackupSnapshot(snapshot.id, snapshot.time)}
                        </span>
                      </SelectItem>
                    ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          <DialogFooter>
            <Button
              type="button"
              disabled={busy || !restoreRepo || !restoreSnapshot}
              onClick={() => void confirmRestore()}
            >
              {work === 'restore' ? <Spinner data-icon="inline-start" /> : null}
              {t('settings.backupRestoreGo')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={blocking}>
        <DialogContent
          className="min-w-0 overflow-hidden"
          showCloseButton={false}
          onPointerDownOutside={(event) => event.preventDefault()}
          onEscapeKeyDown={(event) => event.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>
              {work === 'backup' ? t('settings.backupNow') : t('settings.backupRestore')}
            </DialogTitle>
            <DialogDescription>
              {work === 'list'
                ? t('settings.backupRestoreListing')
                : work === 'restore'
                  ? t('settings.backupRestoreWorking')
                  : t('settings.backupWorking')}
            </DialogDescription>
          </DialogHeader>
          <Spinner />
        </DialogContent>
      </Dialog>
      {foreign ? (
        <Alert>
          <AlertDescription>{t('settings.backupForeign')}</AlertDescription>
        </Alert>
      ) : null}
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
            {debounceField('backup-debounce')}
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
            {ready && !status.resticReady ? (
              <Alert>
                <AlertDescription>{t('settings.backupErrorRestic')}</AlertDescription>
              </Alert>
            ) : null}
            {folderError ? (
              <Alert>
                <AlertDescription>{explainBackupError(folderError, t)}</AlertDescription>
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
                  {work === 'key' ? <Spinner data-icon="inline-start" /> : null}
                  {t('settings.backupKeySave')}
                </Button>
                <Button
                  type="button"
                  disabled={!canArchive}
                  className="shrink-0"
                  onClick={() => void runBackup()}
                >
                  {work === 'backup' ? <Spinner data-icon="inline-start" /> : null}
                  {t('settings.backupNow')}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={!hasKey || busy || foreign}
                  className="shrink-0"
                  onClick={() => void restore()}
                >
                  {work === 'list' || work === 'restore' ? <Spinner data-icon="inline-start" /> : null}
                  {t('settings.backupRestore')}
                </Button>
              </div>
              {status.lastSnapshot ? (
                <FieldDescription>
                  {t('settings.backupLastSnapshot')}:{' '}
                  {presentBackupSnapshot(status.lastSnapshot, status.lastSnapshotAt ?? '')}
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
            <Field>
              <FieldLabel>{t('settings.backupKeep')}</FieldLabel>
              <FieldDescription>{t('settings.backupKeepHint')}</FieldDescription>
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
                <FieldError>{t('settings.backupErrorArchiveDirGone')}</FieldError>
              ) : null}
            </Field>
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
                    {work === 's3' ? <Spinner data-icon="inline-start" /> : null}
                    {t('settings.backupS3Test')}
                  </Button>
                </Field>
                {status.lastUpload ? (
                  <FieldDescription>
                    {t('settings.backupLastUpload')}: {presentBackupRepo(status.lastUpload, t)}
                  </FieldDescription>
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
