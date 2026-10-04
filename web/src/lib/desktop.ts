import { invoke } from '@tauri-apps/api/core'

import { favaClient } from '@/lib/fava-client'
import {
  readConnectionFile,
  type ConnectionFile,
  type ConnectionStep,
  type LedgerConnection,
} from '@/lib/connection'
import { emptyHostSnapshot, type HostSnapshot } from '@/lib/host'

const STORE_FILE = 'connection.json'
const STORE_KEY = 'connection'
const SUSPEND_KEY = 'suspended'

let openToken = 0

export async function loadConnection(): Promise<ConnectionFile | null> {
  const { load } = await import('@tauri-apps/plugin-store')
  const store = await load(STORE_FILE, { autoSave: false })
  const value = await store.get<unknown>(STORE_KEY)
  return readConnectionFile(value)
}

export async function saveConnection(file: ConnectionFile): Promise<void> {
  const { load } = await import('@tauri-apps/plugin-store')
  const store = await load(STORE_FILE, { autoSave: false })
  await store.set(STORE_KEY, file)
  await store.save()
}

export async function loadHostSnapshot(): Promise<HostSnapshot> {
  try {
    return await invoke<HostSnapshot>('fava_host')
  } catch {
    return emptyHostSnapshot()
  }
}

export async function favaWasStarted(): Promise<boolean> {
  return (await loadHostSnapshot()).running
}

export async function stopStartedFava(): Promise<void> {
  await invoke('stop_saved_fava')
}

export async function loadSuspended(): Promise<boolean> {
  const { load } = await import('@tauri-apps/plugin-store')
  const store = await load(STORE_FILE, { autoSave: false })
  return (await store.get<boolean>(SUSPEND_KEY)) === true
}

export async function setSuspended(value: boolean): Promise<void> {
  const { load } = await import('@tauri-apps/plugin-store')
  const store = await load(STORE_FILE, { autoSave: false })
  await store.set(SUSPEND_KEY, value)
  await store.save()
}

/** Stop our process, if this window started one, and keep the next launch from opening it again. */
export async function disconnectSession(): Promise<'stopped' | 'detached'> {
  openToken += 1
  await setSuspended(true)
  const owned = await favaWasStarted()
  if (owned) await stopStartedFava()
  favaClient.useOrigin(null)
  return owned ? 'stopped' : 'detached'
}

/**
 * Point the client at a saved origin. A local project whose port is not yet
 * Fava gets the saved command first. Fava binds 127.0.0.1 with port reuse, so
 * it can take localhost even when another program already listens on the
 * wildcard address. An origin that is already Fava is left running.
 */
export async function openConnection(
  connection: LedgerConnection,
  onStep?: (step: ConnectionStep) => void,
): Promise<boolean> {
  const token = ++openToken
  const current = () => token === openToken
  favaClient.useOrigin(connection.origin)
  let started = false
  try {
    if (!current()) return false
    const state = await favaClient.probe()
    if (!current()) return false
    if (state.kind === 'fava') {
      await favaClient.ensureSlug()
      if (!current()) return false
      onStep?.('attach')
      onStep?.('ready')
      return true
    }
    if (connection.kind !== 'local') {
      if (state.kind === 'occupied') throw new Error('occupied')
      await favaClient.ensureSlug()
      return current()
    }
    if (!current()) return false
    onStep?.('start')
    await invoke('start_saved_fava')
    started = true
    const ready = await waitForLedger(onStep, current)
    return ready && current()
  } catch (error) {
    if (started && current()) await stopStartedFava().catch(() => undefined)
    if (current()) favaClient.useOrigin(null)
    if (!current()) return false
    throw error
  }
}

async function waitForLedger(
  onStep: ((step: ConnectionStep) => void) | undefined,
  current: () => boolean,
): Promise<boolean> {
  const deadline = Date.now() + 40_000
  let last: unknown = null
  while (Date.now() < deadline) {
    if (!current()) return false
    if (!(await favaWasStarted())) throw new Error('start-exited')
    const state = await favaClient.probe()
    if (!current()) return false
    if (state.kind === 'fava') {
      try {
        await favaClient.ensureSlug()
        if (!current()) return false
        onStep?.('ready')
        return true
      } catch (error) {
        last = error
      }
    }
    await delay(400)
  }
  if (!current()) return false
  if (last instanceof Error) throw last
  await favaClient.ensureSlug()
  if (!current()) return false
  onStep?.('ready')
  return true
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}
