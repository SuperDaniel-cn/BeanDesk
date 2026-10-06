import { isTauri } from '@tauri-apps/api/core'

export const HANDBOOK_WINDOW = 'handbook'

export const HANDBOOK_READY_EVENT = 'handbook-ready'

export const HANDBOOK_WARM_MS = 1500

export const HANDBOOK_WINDOW_SIZE = {
  width: 1200,
  height: 800,
  minWidth: 720,
  minHeight: 560,
  resizable: true,
} as const

export type HandbookTheme = 'dark' | 'light'

let creating: Promise<Awaited<ReturnType<typeof existingHandbookWindow>>> | null = null
let opening: Promise<void> | null = null
let resolvePageReady: (() => void) | null = null
const pageReadyWait = new Promise<void>((resolve) => {
  resolvePageReady = resolve
})
let listening: Promise<void> | null = null

export function handbookWindowUrl(locale: string, theme: HandbookTheme): string {
  const path = locale === 'zh-CN' ? '/docs/zh-CN/index.html' : '/docs/index.html'
  return `${path}?theme=${theme}`
}

/** Native chrome while the Fumadocs page is still loading. */
export function handbookChrome(theme: HandbookTheme) {
  return {
    visible: false,
    theme,
    backgroundColor: theme === 'dark' ? '#171717' : '#ffffff',
  } as const
}

export async function openHandbookWindow(
  title: string,
  locale: string,
  theme: HandbookTheme,
): Promise<void> {
  if (!isTauri()) return
  if (opening) return opening
  opening = (async () => {
    const win = await ensureHandbookWindow(title, locale, theme)
    if (!win) return
    await applyHandbookTitle(win, title)
    await firstSettled(waitHandbookPageReady(), HANDBOOK_WARM_MS)
    await revealHandbookWindow(win)
  })().finally(() => {
    opening = null
  })
  return opening
}

export async function ensureHandbookWindow(
  title: string,
  locale: string,
  theme: HandbookTheme,
) {
  if (!creating) {
    creating = (async () => {
      const existing = await existingHandbookWindow()
      if (existing) return existing
      await ensureReadyListener()
      const { WebviewWindow } = await loadWebviewWindow()
      const win = new WebviewWindow(HANDBOOK_WINDOW, {
        url: handbookWindowUrl(locale, theme),
        title,
        ...HANDBOOK_WINDOW_SIZE,
        ...handbookChrome(theme),
      })
      await waitHandbookCreated(win)
      return win
    })().finally(() => {
      creating = null
    })
  }
  return creating
}

export async function setHandbookWindowTitle(title: string): Promise<void> {
  if (!isTauri()) return
  const existing = await existingHandbookWindow()
  if (existing) await applyHandbookTitle(existing, title)
}

export function firstSettled(done: Promise<void>, ms: number): Promise<void> {
  return Promise.race([
    done,
    new Promise<void>((resolve) => {
      setTimeout(resolve, ms)
    }),
  ])
}

export function waitHandbookPageReady(): Promise<void> {
  return pageReadyWait
}

function markHandbookReady() {
  resolvePageReady?.()
}

function ensureReadyListener(): Promise<void> {
  listening ??= import('@tauri-apps/api/event').then(({ listen }) =>
    listen(HANDBOOK_READY_EVENT, () => markHandbookReady()).then(() => undefined),
  )
  return listening
}

async function revealHandbookWindow(win: {
  unminimize: () => Promise<void>
  show: () => Promise<void>
  setFocus: () => Promise<void>
}): Promise<void> {
  await win.unminimize()
  await win.show()
  await win.setFocus()
}

function loadWebviewWindow() {
  return import('@tauri-apps/api/webviewWindow')
}

async function existingHandbookWindow() {
  const { WebviewWindow } = await loadWebviewWindow()
  return WebviewWindow.getByLabel(HANDBOOK_WINDOW)
}

async function applyHandbookTitle(
  win: { setTitle: (title: string) => Promise<void> },
  title: string,
) {
  await win.setTitle(title).catch(() => undefined)
}

function waitHandbookCreated(win: {
  once: (event: string, handler: (event: { payload: unknown }) => void) => Promise<unknown>
}): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    void win.once('tauri://created', () => resolve())
    void win.once('tauri://error', (event) => {
      reject(event.payload instanceof Error ? event.payload : new Error(String(event.payload)))
    })
  })
}
