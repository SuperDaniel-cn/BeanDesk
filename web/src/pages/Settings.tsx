import { useEffect, useRef, useState, type ReactNode } from 'react'

import { invoke, isTauri } from '@tauri-apps/api/core'
import {
  Archive,
  ChevronDown,
  ChevronUp,
  Copy,
  Cpu,
  FilePlus2,
  FolderOpen,
  Link2,
  Plug,
  Settings as SettingsIcon,
  Terminal,
} from 'lucide-react'

import { useAppUpdate } from '@/components/app-update'
import { BackupSettingsPanel } from '@/components/backup-settings'
import { formatConnectionLog, formatConnectionLogLine, useDesktop } from '@/components/desktop-gate'
import { LedgerErrors } from '@/components/ledger-errors'
import { LocaleToggle } from '@/components/locale-toggle'
import { ThemeToggle } from '@/components/theme-toggle'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardAction, CardContent, CardHeader } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { formTitleClass } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from '@/components/ui/sidebar'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { useI18n } from '@/i18n'
import {
  activeConnection,
  connectionStepKey,
  emptyConnectionForm,
  explainConnectionError,
  fileForLinkMode,
  formFromConnectionFile,
  isPristineConnectionForm,
  linkModeOf,
  localWorkdir,
  normalizeOrigin,
  type ConnectionFile,
  type LinkMode,
} from '@/lib/connection'
import {
  connectionAction,
  hostUptime,
  switchNeedsConfirm,
  switchWarning,
  type DesktopStatus,
} from '@/lib/host'
import {
  disconnectSession,
  favaWasStarted,
  openConnection,
  saveConnection,
  setSuspended,
  stopStartedFava,
} from '@/lib/desktop'
import { loadMcpHostConfig, mcpHostConfigText } from '@/lib/mcp-host'

type SettingsTab = 'general' | 'simple' | 'backup'

function linkModeMessage(mode: LinkMode) {
  if (mode === 'shell') return 'settings.modeShell'
  if (mode === 'direct') return 'settings.modeDirect'
  return 'settings.modeEngine'
}

function GeneralSettings({ tauri }: { tauri: boolean }) {
  const { t } = useI18n()

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col items-start gap-1.5">
        <span className={formTitleClass}>{t('theme.label')}</span>
        <ThemeToggle />
      </div>
      <Separator />
      <div className="flex flex-col items-start gap-1.5">
        <span className={formTitleClass}>{t('locale.switcherLabel')}</span>
        <LocaleToggle />
      </div>
      {tauri ? (
        <>
          <Separator />
          <UpdateCheck />
          <Separator />
          <McpHostSettings />
        </>
      ) : null}
    </section>
  )
}

export function Settings() {
  const { t } = useI18n()
  const desktop = useDesktop()
  const tauri = isTauri()
  const needsHost = desktop.status !== 'ready'
  const [tab, setTab] = useState<SettingsTab>(needsHost ? 'simple' : 'general')
  const items = [
    { value: 'general' as const, icon: SettingsIcon, label: t('settings.tabGeneral') },
    { value: 'simple' as const, icon: Plug, label: t('settings.tabSimple') },
    { value: 'backup' as const, icon: Archive, label: t('settings.tabBackup') },
  ]

  if (!tauri) {
    return (
      <section className="flex max-w-xl flex-col gap-4">
        <GeneralSettings tauri={false} />
        <Separator />
        <Alert>
          <AlertDescription>{t('settings.backupBrowser')}</AlertDescription>
        </Alert>
      </section>
    )
  }

  return (
    <SidebarProvider className="h-full min-h-0">
      <Sidebar collapsible="none">
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                {items.map((item) => (
                  <SidebarMenuItem key={item.value}>
                    <SidebarMenuButton
                      type="button"
                      isActive={tab === item.value}
                      onClick={() => setTab(item.value)}
                    >
                      <item.icon />
                      <span>{item.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
      </Sidebar>
      {/* relative: Radix switches in a form add absolute hidden inputs; without a positioned
          ancestor they hang off the page and stretch the window's scroll height. */}
      <div className="relative min-w-0 flex-1 overflow-auto px-6 py-8">
        <div className="mx-auto flex w-full max-w-xl flex-col gap-6">
          <LedgerErrors />
          {tab === 'general' ? <GeneralSettings tauri /> : null}
          {tab === 'simple' ? <ConnectionSettings /> : null}
          {tab === 'backup' ? (
            <BackupSettingsPanel workDirectory={desktop.file?.local?.directory ?? ''} />
          ) : null}
        </div>
      </div>
    </SidebarProvider>
  )
}

function McpHostSettings() {
  const { t } = useI18n()
  const [copied, setCopied] = useState<'json' | 'prompt' | ''>('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!copied) return
    const id = window.setTimeout(() => setCopied(''), 2000)
    return () => window.clearTimeout(id)
  }, [copied])

  async function copy(kind: 'json' | 'prompt') {
    try {
      const config = await loadMcpHostConfig()
      const text =
        kind === 'json'
          ? mcpHostConfigText(config)
          : t('settings.mcpPrompt', {
              command: config.command,
              args: JSON.stringify(config.args),
            })
      await navigator.clipboard.writeText(text)
      setCopied(kind)
      setError('')
    } catch {
      setError(t('settings.mcpFailed'))
    }
  }

  return (
    <div className="flex flex-col items-start gap-1.5">
      <span className={formTitleClass}>{t('settings.mcpLabel')}</span>
      <p className="text-xs text-muted-foreground">{t('settings.mcpHint')}</p>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" onClick={() => void copy('json')}>
          <Copy data-icon="inline-start" />
          {copied === 'json' ? t('settings.mcpCopied') : t('settings.mcpCopyJson')}
        </Button>
        <Button type="button" variant="outline" onClick={() => void copy('prompt')}>
          <Copy data-icon="inline-start" />
          {copied === 'prompt' ? t('settings.mcpCopied') : t('settings.mcpCopyPrompt')}
        </Button>
      </div>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  )
}

function UpdateCheck() {
  const { t } = useI18n()
  const { phase, check } = useAppUpdate()
  const [version, setVersion] = useState('0.1.0')
  const busy = phase === 'checking' || phase === 'installing'

  useEffect(() => {
    if (isTauri()) {
      void import('@tauri-apps/api/app')
        .then(({ getVersion }) => getVersion())
        .then(setVersion)
        .catch(() => undefined)
    }
  }, [])

  return (
    <div className="flex flex-col items-start gap-1.5">
      <span className={formTitleClass}>{t('update.label')}</span>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[0.8rem]">{`v${version}`}</span>
        <Button variant="outline" disabled={busy} onClick={() => void check(true)}>
          {phase === 'checking' ? t('update.checking') : t('update.check')}
        </Button>
      </div>
      {phase === 'none' ? <p className="text-xs text-muted-foreground">{t('update.none')}</p> : null}
      {phase === 'failed' ? (
        <p className="text-xs text-muted-foreground">{t('update.failed')}</p>
      ) : null}
    </div>
  )
}

function ConnectionSettings() {
  const { t } = useI18n()
  const desktop = useDesktop()
  const saved = desktop.file
  const blank = emptyConnectionForm()
  const [mode, setMode] = useState<LinkMode>(() => linkModeOf(saved))
  const [pendingMode, setPendingMode] = useState<LinkMode | null>(null)
  const [directory, setDirectory] = useState(saved?.local?.directory ?? blank.directory)
  const [command, setCommand] = useState(saved?.local?.command ?? blank.command)
  const [localOrigin, setLocalOrigin] = useState(saved?.local?.origin ?? blank.localOrigin)
  const [remoteOrigin, setRemoteOrigin] = useState(saved?.remote?.origin ?? blank.remoteOrigin)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [logOpen, setLogOpen] = useState(true)
  const logRef = useRef<HTMLDivElement>(null)
  const writeLock = useRef(Promise.resolve())
  const connectInFlight = useRef(false)
  const modeTouched = useRef(false)
  const fields = useRef({ directory, command, localOrigin, remoteOrigin, saved, mode })
  fields.current.directory = directory
  fields.current.command = command
  fields.current.localOrigin = localOrigin
  fields.current.remoteOrigin = remoteOrigin
  fields.current.saved = saved
  fields.current.mode = mode

  useEffect(() => {
    if (!saved || modeTouched.current) return
    const current = {
      kind: fields.current.mode === 'direct' ? 'remote' : 'local',
      directory: fields.current.directory,
      command: fields.current.command,
      localOrigin: fields.current.localOrigin,
      remoteOrigin: fields.current.remoteOrigin,
    } as const
    if (!isPristineConnectionForm(current)) return
    const next = formFromConnectionFile(saved)
    setMode(linkModeOf(saved))
    setDirectory(next.directory)
    setCommand(next.command)
    setLocalOrigin(next.localOrigin)
    setRemoteOrigin(next.remoteOrigin)
  }, [saved])

  useEffect(() => {
    const node = logRef.current
    if (node) node.scrollTop = node.scrollHeight
  }, [desktop.log])

  useEffect(() => {
    if (!copied) return
    const id = window.setTimeout(() => setCopied(false), 2000)
    return () => window.clearTimeout(id)
  }, [copied])

  function enqueue(task: () => Promise<void>) {
    const run = writeLock.current.then(task, task)
    writeLock.current = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  function persistDraft() {
    return enqueue(async () => {
      if (connectInFlight.current) return
      const current = fields.current
      const next = fileForLinkMode(
        current.mode,
        current.directory,
        current.command,
        current.localOrigin,
        current.remoteOrigin,
        current.saved,
      )
      if (!next.local && !next.remote) return
      if (sameFile(current.saved, next)) return
      try {
        await saveConnection(next)
        fields.current.saved = next
        desktop.remember(next)
      } catch (caught) {
        desktop.appendLog(explainConnectionError(caught, t), 'error')
      }
    })
  }

  function commitMode(next: LinkMode) {
    modeTouched.current = true
    fields.current.mode = next
    setMode(next)
    void persistDraft()
  }

  function requestMode(next: string) {
    if (next !== 'engine' && next !== 'shell' && next !== 'direct') return
    if (next === fields.current.mode || busy) return
    if (switchNeedsConfirm(desktop.status)) {
      setPendingMode(next)
      return
    }
    commitMode(next)
  }

  async function createFirstLedger() {
    if (!directory) {
      fail(t('settings.missingWorkDirectory'))
      return
    }
    setBusy(true)
    try {
      await invoke('init_ledger', { directory })
      desktop.appendLog(t('settings.createFirstLedgerDone'))
    } catch (caught) {
      fail(explainConnectionError(caught, t))
    } finally {
      setBusy(false)
    }
  }

  async function browse() {
    const { open } = await import('@tauri-apps/plugin-dialog')
    const picked = await open({
      directory: true,
      multiple: false,
      title: t('settings.browse'),
      defaultPath: fields.current.directory || undefined,
    })
    if (typeof picked !== 'string') return
    fields.current.directory = picked
    setDirectory(picked)
    void persistDraft()
  }

  function fail(message: string) {
    desktop.appendLog(message, 'error')
    setLogOpen(true)
  }

  async function connect() {
    if (desktop.status !== 'setup' || busy) return
    if (mode === 'direct') {
      if (!normalizeOrigin(remoteOrigin)) {
        fail(t('settings.invalidOrigin'))
        return
      }
    } else {
      if (!directory) {
        fail(t('settings.missingWorkDirectory'))
        return
      }
      if (!normalizeOrigin(localOrigin)) {
        fail(t('settings.invalidOrigin'))
        return
      }
      if (mode === 'shell' && !command.trim()) {
        fail(t('settings.missingCommand'))
        return
      }
      const local = localWorkdir(directory, localOrigin, command, mode === 'shell' ? 'shell' : 'engine')
      if (!local) {
        fail(t('settings.loopback'))
        return
      }
    }
    await openSaved(
      fileForLinkMode(mode, directory, command, localOrigin, remoteOrigin, fields.current.saved),
    )
  }

  async function confirmModeSwitch() {
    const next = pendingMode
    if (!next || busy) return
    setBusy(true)
    try {
      const notice = switchWarning(desktop.status, desktop.host.owned)
      const outcome = await disconnectSession()
      desktop.release()
      desktop.appendLog(
        t(
          outcome === 'stopped'
            ? 'settings.logStop'
            : notice === 'interrupt'
              ? 'settings.logInterrupt'
              : 'settings.logDisconnect',
        ),
      )
      setPendingMode(null)
      commitMode(next)
    } catch (caught) {
      fail(explainConnectionError(caught, t))
    } finally {
      setBusy(false)
    }
  }

  async function openSaved(next: ConnectionFile) {
    setBusy(true)
    connectInFlight.current = true
    try {
      await setSuspended(false)
      await writeLock.current
      if (next.active === 'remote' && (await favaWasStarted())) {
        await stopStartedFava()
        desktop.appendLog(t('settings.logReleased'))
      }
      await saveConnection(next)
      fields.current.saved = next
      desktop.remember(next)
      const connection = activeConnection(next)
      if (!connection) throw new Error('missing')
      const opened = await openConnection(connection, (step) => {
        desktop.appendLog(t(connectionStepKey(step)))
      })
      if (!opened) return
      desktop.markConnected(next)
    } catch (caught) {
      fail(explainConnectionError(caught, t))
    } finally {
      connectInFlight.current = false
      setBusy(false)
    }
  }

  async function stop() {
    setBusy(true)
    try {
      const outcome = await disconnectSession()
      desktop.release()
      desktop.appendLog(t(outcome === 'stopped' ? 'settings.logStop' : 'settings.logDisconnect'))
    } catch (caught) {
      fail(explainConnectionError(caught, t))
    } finally {
      setBusy(false)
    }
  }

  async function copyLog() {
    try {
      await navigator.clipboard.writeText(formatConnectionLog(desktop.log))
      setCopied(true)
    } catch (caught) {
      fail(explainConnectionError(caught, t))
    }
  }

  const engineLabel = t(linkModeMessage('engine'))
  const shellLabel = t(linkModeMessage('shell'))
  const directLabel = t(linkModeMessage('direct'))
  const pendingLabel = pendingMode ? t(linkModeMessage(pendingMode)) : ''
  const warning = switchWarning(desktop.status, desktop.host.owned)
  const warningKey =
    warning === 'stop'
      ? 'settings.switchModeStop'
      : warning === 'detach'
        ? 'settings.switchModeDetach'
        : 'settings.switchModeInterrupt'

  return (
    <section className="flex flex-col gap-4">
      <HostStatus
        action={
          <ConnectionButton busy={busy} onConnect={() => void connect()} onStop={() => void stop()} />
        }
      />

      <Separator />

      <div className="flex flex-col items-start gap-1.5">
        <span className={formTitleClass}>{t('settings.connectionMode')}</span>
        <ToggleGroup
          type="single"
          variant="outline"
          spacing={0}
          value={mode}
          disabled={busy}
          aria-label={t('settings.connectionMode')}
          onValueChange={requestMode}
        >
          <ToggleGroupItem value="engine" aria-label={engineLabel} className="gap-1.5 px-3">
            <Cpu className="size-3.5" />
            <span>{engineLabel}</span>
          </ToggleGroupItem>
          <ToggleGroupItem value="shell" aria-label={shellLabel} className="gap-1.5 px-3">
            <Terminal className="size-3.5" />
            <span>{shellLabel}</span>
          </ToggleGroupItem>
          <ToggleGroupItem value="direct" aria-label={directLabel} className="gap-1.5 px-3">
            <Link2 className="size-3.5" />
            <span>{directLabel}</span>
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      {mode === 'direct' ? (
        <OriginField
          origin={remoteOrigin}
          setOrigin={setRemoteOrigin}
          onBlur={() => void persistDraft()}
          label={t('settings.origin')}
        />
      ) : (
        <>
          <label className="flex w-full flex-col items-start gap-1.5">
            <span className={formTitleClass}>{t('settings.directory')}</span>
            <span className="flex w-full flex-wrap gap-2">
              <Input value={directory} readOnly placeholder={t('settings.browse')} className="min-w-0 flex-1 font-mono" />
              <Button type="button" variant="outline" onClick={() => void browse()} disabled={busy} className="shrink-0">
                <FolderOpen data-icon="inline-start" />
                {t('settings.browse')}
              </Button>
              {mode === 'engine' ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void createFirstLedger()}
                  disabled={busy || !directory}
                  className="shrink-0"
                >
                  <FilePlus2 data-icon="inline-start" />
                  {t('settings.createFirstLedger')}
                </Button>
              ) : null}
            </span>
          </label>
          {mode === 'shell' ? (
            <>
              <label className="flex w-full flex-col items-start gap-1.5">
                <span className={formTitleClass}>{t('settings.command')}</span>
                <Textarea
                  value={command}
                  onChange={(event) => setCommand(event.target.value)}
                  onBlur={() => void persistDraft()}
                  placeholder={t('settings.commandPlaceholder')}
                  spellCheck={false}
                  rows={2}
                  className="resize-none font-mono"
                />
              </label>
              <OriginField
                origin={localOrigin}
                setOrigin={setLocalOrigin}
                onBlur={() => void persistDraft()}
                label={t('settings.localOrigin')}
              />
            </>
          ) : null}
        </>
      )}

      <Dialog
        open={pendingMode !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setPendingMode(null)
        }}
      >
        <DialogContent className="min-w-0 overflow-hidden sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('settings.switchModeTitle')}</DialogTitle>
            <DialogDescription>{t(warningKey, { mode: pendingLabel })}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={() => setPendingMode(null)}>
              {t('common.cancel')}
            </Button>
            <Button type="button" variant="destructive" disabled={busy} onClick={() => void confirmModeSwitch()}>
              {busy ? <Spinner data-icon="inline-start" /> : null}
              {t('settings.switchModeConfirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Separator />

      <div className="flex w-full flex-col items-start gap-1.5">
        <span className={formTitleClass}>{t('settings.log')}</span>
        <Card className="w-full">
          <CardHeader>
            <CardAction>
              <div className="flex items-center gap-1.5">
                <Button type="button" variant="ghost" size="xs" onClick={() => setLogOpen(!logOpen)}>
                  {logOpen ? <ChevronUp data-icon="inline-start" /> : <ChevronDown data-icon="inline-start" />}
                  {logOpen ? t('settings.logCollapse') : t('settings.logExpand')}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  onClick={desktop.clearLog}
                  disabled={desktop.log.length === 0}
                >
                  {t('settings.clearLog')}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  onClick={() => void copyLog()}
                  disabled={desktop.log.length === 0}
                >
                  {copied ? t('settings.copied') : t('settings.copyLog')}
                </Button>
              </div>
            </CardAction>
          </CardHeader>
          {logOpen ? (
            <CardContent>
              <div
                ref={logRef}
                aria-live="polite"
                className="max-h-40 overflow-auto font-mono text-[0.8rem] whitespace-pre-wrap"
              >
                {desktop.log.length === 0 ? (
                  <p className="text-muted-foreground">{t('settings.logEmpty')}</p>
                ) : (
                  desktop.log.map((line, index) => (
                    <p
                      key={`${line.time}:${index}`}
                      className={line.tone === 'error' ? 'text-destructive' : 'text-foreground'}
                    >
                      {formatConnectionLogLine(line)}
                    </p>
                  ))
                )}
              </div>
              <p className="pt-2 text-xs text-muted-foreground">{t('settings.logKept')}</p>
            </CardContent>
          ) : null}
        </Card>
      </div>
    </section>
  )
}

function HostStatus({ action }: { action?: ReactNode }) {
  const { t } = useI18n()
  const desktop = useDesktop()
  const { host, status } = desktop
  const session = sessionLook(status)
  const elapsed =
    host.startedAt == null || host.observedAt == null
      ? null
      : hostUptime(host.startedAt, host.observedAt)
  const uptime =
    elapsed == null
      ? null
      : elapsed.unit === 'minutes'
        ? t('settings.hostUptimeMinutes', { count: elapsed.count })
        : t('settings.hostUptimeSeconds', { count: elapsed.count })

  let detail: ReactNode = null
  if (status === 'ready' && host.owned) {
    detail = uptime ? `${t('settings.hostOwned')} · ${uptime}` : t('settings.hostOwned')
  } else if (status === 'ready') {
    detail = t('settings.hostAttached')
  } else if (status === 'setup') {
    detail = t('settings.hostPleaseConnect')
  }

  return (
    <div className="flex flex-col items-start gap-1.5">
      <span className={formTitleClass}>{t('settings.hostStatus')}</span>
      <div className="flex w-full flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={session.variant}>{t(session.key)}</Badge>
          {detail ? <span className="text-xs text-muted-foreground">{detail}</span> : null}
        </div>
        {action}
      </div>
    </div>
  )
}

function sessionLook(status: DesktopStatus) {
  if (status === 'ready') return { key: 'settings.hostSessionReady', variant: 'positive' } as const
  if (status === 'boot') return { key: 'settings.hostSessionBoot', variant: 'secondary' } as const
  return { key: 'settings.hostSessionSetup', variant: 'outline' } as const
}

function ConnectionButton({
  busy,
  onConnect,
  onStop,
}: {
  busy: boolean
  onConnect: () => void
  onStop: () => void
}) {
  const { t } = useI18n()
  const desktop = useDesktop()
  const action = connectionAction({
    status: desktop.status,
    owned: desktop.host.owned,
    busy,
  })
  const label =
    action === 'stop'
      ? t('settings.stop')
      : action === 'disconnect'
        ? t('settings.disconnect')
        : action === 'auto'
          ? t('settings.hostSessionBoot')
          : action === 'busy'
            ? t('settings.connecting')
            : t('settings.connect')
  const waiting = action === 'auto' || action === 'busy'
  const leave = action === 'stop' || action === 'disconnect'

  return (
    <Button
      type="button"
      variant={leave ? 'outline' : 'default'}
      disabled={waiting}
      onClick={leave ? onStop : onConnect}
    >
      {waiting ? <Spinner data-icon="inline-start" /> : <Plug data-icon="inline-start" />}
      {label}
    </Button>
  )
}

function OriginField({
  origin,
  setOrigin,
  onBlur,
  label,
}: {
  origin: string
  setOrigin: (value: string) => void
  onBlur: () => void
  label: string
}) {
  return (
    <label className="flex w-full flex-col items-start gap-1.5">
      <span className={formTitleClass}>{label}</span>
      <Input
        value={origin}
        onChange={(event) => setOrigin(event.target.value)}
        onBlur={onBlur}
        spellCheck={false}
        inputMode="url"
        className="font-mono"
      />
    </label>
  )
}

function sameFile(previous: ConnectionFile | null, next: ConnectionFile): boolean {
  return JSON.stringify(previous) === JSON.stringify(next)
}
