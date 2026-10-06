import { useEffect, useRef, useState } from 'react'

import { invoke } from '@tauri-apps/api/core'
import { Cloud, FolderOpen, HardDrive, Pencil, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Field, FieldContent, FieldDescription, FieldLabel } from '@/components/ui/field'
import { formTitleClass } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
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
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { useI18n } from '@/i18n'
import {
  archiveBlockReason,
  archiveNestsLedger,
  backupBannerError,
  canWriteArchive,
  destDraftReady,
  destPath,
  destPulseOf,
  destStatus,
  destsForSave,
  destTitle,
  destToDraft,
  draftToSave,
  emptyBackupSettings,
  emptyBackupStatus,
  emptyDestDraft,
  explainBackupError,
  presentBackupRepo,
  presentBackupSnapshot,
  presentBackupTime,
  validateS3Endpoint,
  type BackupDestDraft,
  type BackupDestKind,
  type BackupDestSave,
  type BackupDestView,
  type BackupSettings,
  type DestPulse,
  type RepoSnapshots,
  type BackupStatus,
} from '@/lib/backup'

export function BackupSettingsPanel({ workDirectory }: { workDirectory: string }) {
  const { t } = useI18n()
  const [settings, setSettings] = useState(emptyBackupSettings)
  const [status, setStatus] = useState(emptyBackupStatus)
  const [statusLoaded, setStatusLoaded] = useState(false)
  const [passphrase, setPassphrase] = useState('')
  const [keyDialog, setKeyDialog] = useState(false)
  const [keyRepeat, setKeyRepeat] = useState('')
  const [keyAck, setKeyAck] = useState(false)
  const [work, setWork] = useState<
    'backup' | 'restore' | 'list' | 'pick' | 'key' | 's3' | 'add' | 'edit' | 'remove' | null
  >(null)
  const [repos, setRepos] = useState<RepoSnapshots[] | null>(null)
  const [restoreRepo, setRestoreRepo] = useState('')
  const [restoreSnapshot, setRestoreSnapshot] = useState('')
  const [editorOpen, setEditorOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState<BackupDestDraft>(emptyDestDraft)
  const [removeId, setRemoveId] = useState<string | null>(null)
  const busy = work !== null
  const blocking = work === 'backup' || work === 'restore' || work === 'list'
  const settingsRef = useRef(settings)
  const writeLock = useRef(Promise.resolve())
  const ready = Boolean(workDirectory)
  const waitingInit = statusLoaded && ready && !status.hasLedgerFile
  const foreign = statusLoaded && ready && status.hasLedgerFile && !status.appLedger
  const locked = !ready || busy || foreign || waitingInit
  const hasKey = ready && status.hasKey
  const canArchive = !locked && canWriteArchive(settings, status)
  const folderError = backupBannerError(status.lastError, status.appLedger)
  const draftNested =
    draft.kind === 'local' && archiveNestsLedger(workDirectory, draft.directory)
  const draftEndpointInvalid = Boolean(
    draft.kind === 's3' && draft.endpoint.trim() && !validateS3Endpoint(draft.endpoint),
  )
  const canConfirmDraft = destDraftReady(draft) && !draftNested && !draftEndpointInvalid
  const editing = editingId !== null
  const removing = settings.dests.find((dest) => dest.id === removeId) ?? null

  async function refreshStatus() {
    const next = await invoke<BackupStatus>('backup_status')
    const saved = { ...emptyBackupStatus(), ...next }
    setStatus(saved)
    setStatusLoaded(true)
    return saved
  }

  useEffect(() => {
    void invoke<BackupSettings>('load_backup_settings')
      .then((next) => {
        const saved = { ...emptyBackupSettings(), ...next }
        settingsRef.current = saved
        setSettings(saved)
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

  async function persist(next: BackupSettings, extra: BackupDestSave[] = []) {
    const saved = await invoke<BackupSettings>('save_backup_settings', {
      input: {
        watch: next.watch,
        debounceSecs: next.debounceSecs,
        archiveAuto: next.archiveAuto,
        dests: destsForSave(next.dests, extra),
      },
    })
    settingsRef.current = saved
    setSettings(saved)
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

  function openKeyDialog() {
    if (!passphrase || locked) return
    setKeyRepeat('')
    setKeyAck(false)
    setKeyDialog(true)
  }

  function clearKeyDialog() {
    setKeyDialog(false)
    setKeyRepeat('')
    setKeyAck(false)
  }

  function closeKeyDialog() {
    if (work === 'key') return
    clearKeyDialog()
  }

  async function saveKey() {
    if (!keyAck || keyRepeat !== passphrase) return
    setWork('key')
    try {
      const next = await invoke<BackupStatus>('backup_set_key', { password: passphrase })
      setStatus(next)
      setPassphrase('')
      clearKeyDialog()
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

  function closeEditor() {
    if (busy) return
    setEditorOpen(false)
    setEditingId(null)
    setDraft(emptyDestDraft())
  }

  function openAdd() {
    setEditingId(null)
    setDraft(emptyDestDraft('local'))
    setEditorOpen(true)
  }

  function openEdit(dest: BackupDestView) {
    setEditingId(dest.id)
    setDraft(destToDraft(dest))
    setEditorOpen(true)
  }

  async function pickDraftDirectory() {
    const { open } = await import('@tauri-apps/plugin-dialog')
    const picked = await open({
      directory: true,
      multiple: false,
      title: t('settings.browse'),
      defaultPath: draft.directory || undefined,
    })
    if (typeof picked !== 'string') return
    if (archiveNestsLedger(workDirectory, picked)) {
      toast.error(explainBackupError('archive-nested', t))
      return
    }
    setDraft((current) => ({ ...current, directory: picked }))
  }

  async function confirmDest() {
    if (!canConfirmDraft || locked) return
    const wasEdit = editing
    setWork(wasEdit ? 'edit' : 'add')
    try {
      await enqueue(async () => {
        await persist(settingsRef.current, [draftToSave(draft)])
      })
      setEditorOpen(false)
      setEditingId(null)
      setDraft(emptyDestDraft())
      toast.success(t(wasEdit ? 'settings.backupDestSaved' : 'settings.backupDestAdded'))
    } catch (caught) {
      fail(caught)
    } finally {
      setWork(null)
    }
  }

  async function confirmRemove() {
    if (!removing) return
    setWork('remove')
    try {
      const next = {
        ...settingsRef.current,
        dests: settingsRef.current.dests.filter((dest) => dest.id !== removing.id),
      }
      await enqueue(async () => {
        await persist(next)
      })
      setRemoveId(null)
      toast.success(t('settings.backupDestRemoved'))
    } catch (caught) {
      fail(caught)
    } finally {
      setWork(null)
    }
  }

  async function testDraftS3() {
    if (draft.endpoint.trim() && !validateS3Endpoint(draft.endpoint)) {
      toast.error(t('settings.backupErrorS3Endpoint'))
      return
    }
    setWork('s3')
    try {
      await invoke('backup_test_s3', {
        input: {
          accessKeyId: draft.accessKeyId,
          secretAccessKey: draft.secretAccessKey,
          bucketName: draft.bucketName,
          region: draft.region,
          endpoint: draft.endpoint,
          pathStyleAccess: draft.pathStyleAccess,
          prefix: draft.prefix,
          destId: draft.id,
        },
      })
      toast.success(t('settings.backupS3TestOk'))
    } catch (caught) {
      fail(caught)
    } finally {
      setWork(null)
    }
  }

  const keyMismatch = keyRepeat !== '' && keyRepeat !== passphrase

  return (
    <section className="flex flex-col gap-4">
      <Dialog open={repos !== null} onOpenChange={(open) => !open && setRepos(null)}>
        <DialogContent className="min-w-0 overflow-hidden sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('settings.backupRestorePick')}</DialogTitle>
            <DialogDescription>{t('settings.backupKeepHint')}</DialogDescription>
          </DialogHeader>
          <div className="flex min-w-0 flex-col items-start gap-1.5">
            <span className={formTitleClass}>{t('settings.backupRestoreRepo')}</span>
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
          </div>
          <div className="flex min-w-0 flex-col items-start gap-1.5">
            <span className={formTitleClass}>{t('settings.backupRestoreSnapshot')}</span>
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
          </div>
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
      <Dialog open={editorOpen} onOpenChange={(open) => !open && closeEditor()}>
        <DialogContent className="flex max-h-[min(40rem,calc(100dvh-2rem))] min-w-0 flex-col overflow-hidden sm:max-w-lg">
          <DialogHeader className="shrink-0">
            <DialogTitle>
              {editing ? t('settings.backupEditDest') : t('settings.backupAddDest')}
            </DialogTitle>
            <DialogDescription>{t('settings.backupAddDestHint')}</DialogDescription>
          </DialogHeader>
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pr-1">
            <div className="flex flex-col items-start gap-1.5">
              <span className={formTitleClass}>{t('settings.backupDestKind')}</span>
              <ToggleGroup
                type="single"
                variant="outline"
                spacing={0}
                disabled={editing}
                value={draft.kind}
                onValueChange={(value) => {
                  if (value === 'local' || value === 's3') {
                    setDraft(emptyDestDraft(value as BackupDestKind))
                  }
                }}
              >
                <ToggleGroupItem value="local" className="px-3">
                  {t('settings.backupArchiveLocal')}
                </ToggleGroupItem>
                <ToggleGroupItem value="s3" className="px-3">
                  {t('settings.backupArchiveCloud')}
                </ToggleGroupItem>
              </ToggleGroup>
            </div>
            {draft.kind === 'local' ? (
              <label className="flex w-full flex-col items-start gap-1.5">
                <span className={formTitleClass}>{t('settings.backupArchiveDirectory')}</span>
                <div className="flex w-full gap-2">
                  <Input
                    id="backup-add-dir"
                    value={draft.directory}
                    readOnly
                    placeholder={t('settings.browse')}
                    className="min-w-0 flex-1 font-mono"
                    aria-invalid={draftNested || undefined}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    disabled={locked}
                    className="shrink-0"
                    onClick={() => void pickDraftDirectory()}
                  >
                    <FolderOpen data-icon="inline-start" />
                    {t('settings.browse')}
                  </Button>
                </div>
                {draftNested ? (
                  <p className="text-xs text-destructive">{t('settings.backupErrorArchiveNested')}</p>
                ) : null}
              </label>
            ) : (
              <>
                <p className="text-xs text-muted-foreground">{t('settings.backupS3Hint')}</p>
                <label className="flex w-full flex-col items-start gap-1.5">
                  <span className={formTitleClass}>{t('settings.backupS3Endpoint')}</span>
                  <Input
                    id="backup-add-endpoint"
                    value={draft.endpoint}
                    spellCheck={false}
                    aria-invalid={draftEndpointInvalid || undefined}
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, endpoint: event.target.value }))
                    }
                  />
                  {draftEndpointInvalid ? (
                    <p className="text-xs text-destructive">{t('settings.backupErrorS3Endpoint')}</p>
                  ) : null}
                </label>
                <DraftField
                  id="backup-add-bucket"
                  label={t('settings.backupS3Bucket')}
                  value={draft.bucketName}
                  onChange={(bucketName) => setDraft((current) => ({ ...current, bucketName }))}
                />
                <DraftField
                  id="backup-add-region"
                  label={t('settings.backupS3Region')}
                  value={draft.region}
                  onChange={(region) => setDraft((current) => ({ ...current, region }))}
                />
                <DraftField
                  id="backup-add-access"
                  label={t('settings.backupS3AccessKey')}
                  value={draft.accessKeyId}
                  onChange={(accessKeyId) => setDraft((current) => ({ ...current, accessKeyId }))}
                />
                <label className="flex w-full flex-col items-start gap-1.5">
                  <span className={formTitleClass}>{t('settings.backupS3Secret')}</span>
                  <Input
                    id="backup-add-secret"
                    type="password"
                    value={draft.secretAccessKey}
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, secretAccessKey: event.target.value }))
                    }
                  />
                </label>
                <div className="flex flex-col items-start gap-1.5">
                  <span className={formTitleClass}>{t('settings.backupS3PathStyle')}</span>
                  <Switch
                    id="backup-add-path"
                    checked={draft.pathStyleAccess}
                    onCheckedChange={(pathStyleAccess) =>
                      setDraft((current) => ({ ...current, pathStyleAccess }))
                    }
                  />
                </div>
                <DraftField
                  id="backup-add-prefix"
                  label={t('settings.backupS3Prefix')}
                  value={draft.prefix}
                  onChange={(prefix) => setDraft((current) => ({ ...current, prefix }))}
                />
                <Button
                  type="button"
                  variant="outline"
                  disabled={locked || !canConfirmDraft}
                  onClick={() => void testDraftS3()}
                >
                  {work === 's3' ? <Spinner data-icon="inline-start" /> : null}
                  {t('settings.backupS3Test')}
                </Button>
              </>
            )}
          </div>
          <DialogFooter className="shrink-0">
            <Button type="button" variant="outline" disabled={busy} onClick={closeEditor}>
              {t('common.cancel')}
            </Button>
            <Button
              type="button"
              disabled={locked || !canConfirmDraft}
              onClick={() => void confirmDest()}
            >
              {work === 'add' || work === 'edit' ? <Spinner data-icon="inline-start" /> : null}
              {editing ? t('settings.backupDestSave') : t('settings.backupDestAdd')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={removeId !== null} onOpenChange={(open) => !open && !busy && setRemoveId(null)}>
        <DialogContent className="min-w-0 overflow-hidden sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('settings.backupDestRemoveTitle')}</DialogTitle>
            <DialogDescription>{t('settings.backupDestRemoveBody')}</DialogDescription>
          </DialogHeader>
          {removing ? (
            <p className="font-mono text-xs break-all text-muted-foreground">
              {presentBackupRepo(removing.location, t)}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={() => setRemoveId(null)}>
              {t('common.cancel')}
            </Button>
            <Button type="button" disabled={locked} onClick={() => void confirmRemove()}>
              {work === 'remove' ? <Spinner data-icon="inline-start" /> : null}
              {t('settings.backupDestRemove')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={keyDialog} onOpenChange={(open) => !open && closeKeyDialog()}>
        <DialogContent className="min-w-0 overflow-hidden sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('settings.backupKeyConfirmTitle')}</DialogTitle>
          </DialogHeader>
          <label className="flex w-full flex-col items-start gap-1.5">
            <span className={formTitleClass}>{t('settings.backupKeyRepeat')}</span>
            <Input
              type="password"
              value={keyRepeat}
              autoComplete="new-password"
              spellCheck={false}
              aria-invalid={keyMismatch}
              onChange={(event) => setKeyRepeat(event.target.value)}
            />
            {keyMismatch ? (
              <p className="text-xs text-destructive">{t('settings.backupKeyMismatch')}</p>
            ) : null}
          </label>
          <Field orientation="horizontal" className="items-start">
            <Checkbox
              id="backup-key-ack"
              checked={keyAck}
              onCheckedChange={(value) => setKeyAck(value === true)}
            />
            <FieldLabel htmlFor="backup-key-ack" className={formTitleClass}>
              {t('settings.backupKeyAck')}
            </FieldLabel>
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={work === 'key'} onClick={closeKeyDialog}>
              {t('common.cancel')}
            </Button>
            <Button
              type="button"
              disabled={work === 'key' || !keyAck || keyRepeat !== passphrase}
              onClick={() => void saveKey()}
            >
              {work === 'key' ? <Spinner data-icon="inline-start" /> : null}
              {t('settings.backupKeySave')}
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
      {!workDirectory ? (
        <Alert>
          <AlertDescription>{t('settings.backupNeedFolder')}</AlertDescription>
        </Alert>
      ) : null}
      {waitingInit ? (
        <Alert>
          <AlertDescription>{t('settings.backupNeedsInit')}</AlertDescription>
        </Alert>
      ) : null}
      {foreign ? (
        <Alert>
          <AlertDescription>{t('settings.backupForeign')}</AlertDescription>
        </Alert>
      ) : null}
      <label className="flex w-full flex-col items-start gap-1.5">
        <span className={formTitleClass}>{t('settings.backupCurrentLedger')}</span>
        <span className="flex w-full gap-2">
          <Input
            id="backup-workdir"
            value={workDirectory}
            disabled
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
        </span>
      </label>

      <Separator />

      <div className="flex w-full flex-col gap-4">
        <Field orientation="horizontal" data-disabled={locked || undefined}>
          <FieldContent>
            <FieldLabel htmlFor="backup-watch" className={formTitleClass}>
              {t('settings.backupWatch')}
            </FieldLabel>
            <FieldDescription>{t('settings.backupWatchHint')}</FieldDescription>
          </FieldContent>
          <Switch
            id="backup-watch"
            className="self-center"
            checked={settings.watch}
            disabled={locked}
            onCheckedChange={(watch) => update({ watch })}
          />
        </Field>
        <label className="flex w-full flex-col items-start gap-1.5">
          <span className={formTitleClass}>{t('settings.backupDebounce')}</span>
          <Input
            id="backup-debounce"
            type="number"
            min={1}
            value={settings.debounceSecs}
            disabled={locked || !settings.watch}
            onChange={(event) =>
              patchString('debounceSecs', Math.max(1, Number(event.target.value) || 1))
            }
            onBlur={persistCurrent}
          />
        </label>
        {status.lastGitHash ? (
          <p className="text-xs text-muted-foreground">
            {t('settings.backupGitOk', { hash: status.lastGitHash })}
          </p>
        ) : null}
      </div>

      <Separator />

      <div className="flex w-full flex-col gap-4">
        <div className="flex flex-col items-start gap-1.5">
          <span className={formTitleClass}>{t('settings.backupEncrypt')}</span>
          <p className="text-xs text-muted-foreground">{t('settings.backupSectionEncrypt')}</p>
          <p className="text-xs text-muted-foreground">{t('settings.backupKeepHint')}</p>
        </div>
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
        <label className="flex w-full flex-col items-start gap-1.5">
          <span className={formTitleClass}>{t('settings.backupKey')}</span>
          <span className="flex w-full flex-wrap gap-2">
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
              onClick={openKeyDialog}
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
              disabled={!hasKey || locked}
              className="shrink-0"
              onClick={() => void restore()}
            >
              {work === 'list' || work === 'restore' ? <Spinner data-icon="inline-start" /> : null}
              {t('settings.backupRestore')}
            </Button>
          </span>
          {status.lastSnapshot ? (
            <p className="text-xs text-muted-foreground">
              {t('settings.backupLastSnapshot')}:{' '}
              {presentBackupSnapshot(status.lastSnapshot, status.lastSnapshotAt ?? '')}
            </p>
          ) : null}
        </label>
      </div>

      <Separator />

      <Field orientation="horizontal" data-disabled={!hasKey || locked || undefined}>
        <FieldContent>
          <FieldLabel htmlFor="backup-auto" className={formTitleClass}>
            {t('settings.backupArchiveAuto')}
          </FieldLabel>
          <FieldDescription>{t('settings.backupArchiveAutoHint')}</FieldDescription>
        </FieldContent>
        <Switch
          id="backup-auto"
          className="self-center"
          checked={settings.archiveAuto && status.hasKey}
          disabled={!hasKey || locked}
          onCheckedChange={(archiveAuto) => update({ archiveAuto })}
        />
      </Field>

      <Separator />

      <div className="flex w-full flex-col gap-4">
        <span className="flex w-full items-center justify-between gap-4">
          <span className={formTitleClass}>{t('settings.backupDests')}</span>
          <Button type="button" variant="outline" disabled={locked} onClick={openAdd}>
            <Plus data-icon="inline-start" />
            {t('settings.backupAddDest')}
          </Button>
        </span>
        {settings.dests.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t('settings.backupDestsEmpty')}</p>
        ) : (
          <div className="flex w-full flex-col gap-4">
            {settings.dests.map((dest) => (
              <DestCard
                key={dest.id}
                dest={dest}
                pulse={destPulseOf(status, dest.id)}
                locked={locked}
                onEdit={() => openEdit(dest)}
                onRemove={() => setRemoveId(dest.id)}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

function DestCard({
  dest,
  pulse,
  locked,
  onEdit,
  onRemove,
}: {
  dest: BackupDestView
  pulse: DestPulse | undefined
  locked: boolean
  onEdit: () => void
  onRemove: () => void
}) {
  const { t } = useI18n()
  const path = destPath(dest)
  const state = destStatus(dest)
  const when = presentBackupTime(pulse?.lastSnapshotAt ?? '')
  const stateLabel =
    state === 'missing'
      ? t('settings.backupDestMissing')
      : state === 'check-pending'
        ? t('settings.backupDestCheckPending')
        : state === 'ready'
          ? t('settings.backupDestReady')
          : t('settings.backupDestIncomplete')
  const stateVariant =
    state === 'ready' ? 'positive' : state === 'check-pending' ? 'warning' : state === 'missing' ? 'destructive' : 'secondary'

  return (
    <Card className="min-w-0" data-invalid={dest.missing || undefined}>
      <CardHeader>
        <CardTitle className="flex min-w-0 items-center gap-2 text-[0.8rem]">
          {dest.kind === 's3' ? (
            <Cloud className="size-3.5 shrink-0" aria-label={t('settings.backupArchiveCloud')} />
          ) : (
            <HardDrive className="size-3.5 shrink-0" aria-label={t('settings.backupArchiveLocal')} />
          )}
          <span className="min-w-0 truncate" title={destTitle(dest)}>
            {destTitle(dest)}
          </span>
          <Badge variant={stateVariant}>{stateLabel}</Badge>
        </CardTitle>
        <CardAction className="flex gap-1">
          <Button type="button" variant="ghost" size="xs" disabled={locked} onClick={onEdit}>
            <Pencil data-icon="inline-start" />
            {t('settings.backupDestEdit')}
          </Button>
          <Button type="button" variant="ghost" size="xs" disabled={locked} onClick={onRemove}>
            <Trash2 data-icon="inline-start" />
            {t('settings.backupDestRemove')}
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-[max-content_minmax(0,1fr)] items-center gap-x-4 gap-y-2 text-[0.8rem]">
          <dt className="text-muted-foreground">{t('settings.backupDestPath')}</dt>
          <dd className="min-w-0 truncate text-right font-mono" title={path}>
            {path}
          </dd>
          <dt className="text-muted-foreground">{t('settings.backupDestLast')}</dt>
          <dd className="text-right">{when || t('settings.backupDestNever')}</dd>
        </dl>
      </CardContent>
    </Card>
  )
}

function DraftField({
  id,
  label,
  value,
  onChange,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <label className="flex w-full flex-col items-start gap-1.5">
      <span className={formTitleClass}>{label}</span>
      <Input
        id={id}
        value={value}
        spellCheck={false}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  )
}
