import { useEffect, useRef, useState, type ReactNode } from 'react'

import { useNavigate } from 'react-router'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { Check, ChevronDown, ChevronUp, Copy, FolderOpen, Plug } from 'lucide-react'

import { useAppUpdate } from '@/components/app-update'
import { formatConnectionLog, formatConnectionLogLine, useDesktop } from '@/components/desktop-gate'
import { LocaleToggle } from '@/components/locale-toggle'
import { ThemeToggle } from '@/components/theme-toggle'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { useI18n } from '@/i18n'
import {
  activeConnection,
  connectionStepKey,
  emptyConnectionForm,
  explainConnectionError,
  formFromConnectionFile,
  isPristineConnectionForm,
  localDraft,
  normalizeOrigin,
  remoteDraft,
  withDrafts,
  type ConnectionFile,
  type LedgerConnection,
} from '@/lib/connection'
import { connectionAction, hostUptime, type DesktopStatus } from '@/lib/host'
import {
  disconnectSession,
  favaWasStarted,
  openConnection,
  saveConnection,
  setSuspended,
  stopStartedFava,
} from '@/lib/desktop'

type Kind = LedgerConnection['kind']

const FAVA_DOCS = 'https://beancount.github.io/fava/usage.html#installation'
const BEANCOUNT_DOCS = 'https://furius.ca/beancount/doc/install'

function useShowQuickSetup(enabled: boolean): boolean {
  const [show, setShow] = useState(false)

  useEffect(() => {
    if (!enabled) {
      setShow(false)
      return
    }
    let cancelled = false
    void invoke<boolean>('fava_installed')
      .then((installed) => {
        if (!cancelled) setShow(!installed)
      })
      .catch(() => {
        if (!cancelled) setShow(false)
      })
    return () => {
      cancelled = true
    }
  }, [enabled])

  return show
}

function GeneralSettings({ tauri }: { tauri: boolean }) {
  const { t } = useI18n()

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col items-start gap-1.5">
        <span className="text-xs text-muted-foreground">{t('theme.label')}</span>
        <ThemeToggle />
      </div>
      <div className="flex flex-col items-start gap-1.5">
        <span className="text-xs text-muted-foreground">{t('locale.switcherLabel')}</span>
        <LocaleToggle />
      </div>
      {tauri ? <UpdateCheck /> : null}
    </section>
  )
}

export function Settings() {
  const { t } = useI18n()
  const desktop = useDesktop()
  const tauri = isTauri()
  const showQuick = useShowQuickSetup(tauri && desktop.status === 'setup')
  const needsHost = desktop.status !== 'ready'

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-6">
      {tauri ? (
        <Tabs defaultValue={needsHost ? 'connection' : 'general'}>
          <TabsList variant="line">
            <TabsTrigger value="general">{t('settings.tabGeneral')}</TabsTrigger>
            <TabsTrigger value="connection">{t('settings.tabConnection')}</TabsTrigger>
          </TabsList>
          <TabsContent value="general">
            <GeneralSettings tauri />
          </TabsContent>
          <TabsContent value="connection" className="flex flex-col gap-4">
            {showQuick ? <SetupGuide /> : null}
            <ConnectionSettings />
          </TabsContent>
        </Tabs>
      ) : (
        <GeneralSettings tauri={false} />
      )}
    </div>
  )
}

function SetupGuide() {
  const { t } = useI18n()
  const [copied, setCopied] = useState(false)

  const copyPrompt = () => {
    void navigator.clipboard.writeText(t('settings.setupAgentPrompt')).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <section className="flex flex-col gap-3 rounded-lg border bg-card p-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-[0.8rem] font-medium">{t('settings.setupTitle')}</h2>
        <p className="text-[0.8rem]/relaxed text-muted-foreground">{t('settings.setupBody')}</p>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-[0.8rem] text-muted-foreground">{t('settings.setupInstallLead')}</span>
        <code className="w-fit rounded-md bg-muted px-2 py-1 font-mono text-xs text-foreground">
          {t('settings.setupInstallCommand')}
        </code>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-[0.8rem] text-muted-foreground">{t('settings.setupAgentLead')}</span>
        <div className="flex flex-wrap items-center gap-2">
          <code className="rounded-md bg-muted px-2 py-1 font-mono text-xs text-foreground">
            {t('settings.setupAgentPrompt')}
          </code>
          <Button variant="ghost" size="sm" onClick={copyPrompt}>
            {copied ? (
              <>
                <Check data-icon="inline-start" />
                {t('settings.setupCopiedPrompt')}
              </>
            ) : (
              <>
                <Copy data-icon="inline-start" />
                {t('settings.setupCopyPrompt')}
              </>
            )}
          </Button>
        </div>
      </div>

      <p className="text-[0.8rem]/relaxed text-muted-foreground">{t('settings.setupModesHint')}</p>

      <p className="flex flex-wrap gap-x-4 gap-y-1 text-[0.8rem]">
        <DocLink href={FAVA_DOCS}>{t('settings.setupFavaDocs')}</DocLink>
        <DocLink href={BEANCOUNT_DOCS}>{t('settings.setupBeancountDocs')}</DocLink>
      </p>
    </section>
  )
}

function DocLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <button
      type="button"
      className="underline underline-offset-4"
      onClick={() => {
        void import('@tauri-apps/plugin-opener').then(({ openUrl }) => openUrl(href))
      }}
    >
      {children}
    </button>
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
      <div className="flex items-baseline gap-2">
        <span className="text-xs text-muted-foreground">{t('update.label')}</span>
        <span className="font-mono text-xs text-muted-foreground">
          {t('update.currentVersion', { version: `v${version}` })}
        </span>
      </div>
      <Button variant="outline" disabled={busy} onClick={() => void check(true)}>
        {phase === 'checking' ? t('update.checking') : t('update.check')}
      </Button>
      {phase === 'none' ? <p className="text-xs text-muted-foreground">{t('update.none')}</p> : null}
      {phase === 'failed' ? (
        <p className="text-xs text-muted-foreground">{t('update.failed')}</p>
      ) : null}
    </div>
  )
}

function ConnectionSettings() {
  const { t } = useI18n()
  const navigate = useNavigate()
  const desktop = useDesktop()
  const saved = desktop.file
  const blank = emptyConnectionForm()
  const [kind, setKind] = useState<Kind>(saved?.active ?? blank.kind)
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
  const fields = useRef({ directory, command, localOrigin, remoteOrigin, saved, kind })
  fields.current.directory = directory
  fields.current.command = command
  fields.current.localOrigin = localOrigin
  fields.current.remoteOrigin = remoteOrigin
  fields.current.saved = saved
  fields.current.kind = kind

  useEffect(() => {
    if (!saved) return
    const current = {
      kind: fields.current.kind,
      directory: fields.current.directory,
      command: fields.current.command,
      localOrigin: fields.current.localOrigin,
      remoteOrigin: fields.current.remoteOrigin,
    }
    if (!isPristineConnectionForm(current)) return
    const next = formFromConnectionFile(saved)
    setKind(next.kind)
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

  function persistDraft(kindOverride?: Kind) {
    return enqueue(async () => {
      if (connectInFlight.current) return
      const current = fields.current
      const next = withDrafts(
        current.saved?.active ?? kindOverride ?? current.kind,
        localDraft(current.directory, current.command, current.localOrigin),
        remoteDraft(current.remoteOrigin),
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
    const local = localDraft(directory, command, localOrigin)
    const remote = remoteDraft(remoteOrigin)
    if (kind === 'local') {
      if (!directory) {
        fail(t('settings.missingDirectory'))
        return
      }
      if (!command.trim()) {
        fail(t('settings.missingCommand'))
        return
      }
      if (!normalizeOrigin(localOrigin)) {
        fail(t('settings.invalidOrigin'))
        return
      }
      if (!local) {
        fail(t('settings.loopback'))
        return
      }
    } else if (!remote) {
      fail(t('settings.invalidOrigin'))
      return
    }

    setBusy(true)
    connectInFlight.current = true
    try {
      await setSuspended(false)
      await writeLock.current
      if (kind === 'remote' && (await favaWasStarted())) {
        await stopStartedFava()
        desktop.appendLog(t('settings.logReleased'))
      }
      const next = withDrafts(kind, local, remote, fields.current.saved)
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
      navigate('/')
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

  return (
    <section className="flex flex-col gap-4">
      <HostStatus />

      <div className="flex flex-col gap-1.5">
        <span className="text-xs text-muted-foreground">{t('settings.connectionMode')}</span>
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          <Tabs
            value={kind}
            onValueChange={(value) => {
              const nextKind = value as Kind
              setKind(nextKind)
              void persistDraft(nextKind)
            }}
          >
            <TabsList>
              <TabsTrigger value="local">{t('settings.local')}</TabsTrigger>
              <TabsTrigger value="remote">{t('settings.remote')}</TabsTrigger>
            </TabsList>
          </Tabs>
          <ConnectionButton busy={busy} onConnect={() => void connect()} onStop={() => void stop()} />
        </div>
      </div>

      {kind === 'local' ? (
        <>
          <label className="flex w-full flex-col items-start gap-1.5">
            <span className="text-xs text-muted-foreground">{t('settings.directory')}</span>
            <span className="flex w-full gap-2">
              <Input value={directory} readOnly placeholder={t('settings.browse')} className="font-mono" />
              <Button type="button" variant="outline" onClick={() => void browse()} disabled={busy} className="shrink-0">
                <FolderOpen data-icon="inline-start" />
                {t('settings.browse')}
              </Button>
            </span>
          </label>
          <label className="flex w-full flex-col items-start gap-1.5">
            <span className="text-xs text-muted-foreground">{t('settings.command')}</span>
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
            label={t('settings.origin')}
          />
        </>
      ) : (
        <OriginField
          origin={remoteOrigin}
          setOrigin={setRemoteOrigin}
          onBlur={() => void persistDraft()}
          label={t('settings.origin')}
        />
      )}

      <Card>
        <CardContent className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <Button type="button" variant="ghost" size="xs" onClick={() => setLogOpen(!logOpen)}>
              {logOpen ? <ChevronUp data-icon="inline-start" /> : <ChevronDown data-icon="inline-start" />}
              {t('settings.log')}
              {desktop.log.length > 0 ? <Badge variant="secondary">{desktop.log.length}</Badge> : null}
            </Button>
            <div className="flex items-center gap-1.5">
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
          </div>
          {logOpen ? (
            <div>
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
            </div>
          ) : null}
        </CardContent>
      </Card>
    </section>
  )
}

function HostStatus() {
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
  } else if (status !== 'boot') {
    if (host.probe.kind === 'occupied') detail = t('settings.hostPortOccupied')
    else if (host.probe.kind === 'closed') detail = t('settings.hostPortClosed')
    else if (host.probe.kind === 'fava') detail = t('settings.hostPortReady')
  }

  return (
    <div className="flex flex-col items-start gap-1.5">
      <span className="text-xs text-muted-foreground">{t('settings.hostStatus')}</span>
      <div className="flex flex-wrap items-baseline gap-2">
        <Badge variant={session.variant}>{t(session.key)}</Badge>
        {detail ? <span className="text-xs text-muted-foreground">{detail}</span> : null}
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
      <span className="text-xs text-muted-foreground">{label}</span>
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
