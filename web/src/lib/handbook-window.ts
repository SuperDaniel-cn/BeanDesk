import { isTauri } from '@tauri-apps/api/core'

export const HANDBOOK_WINDOW = 'handbook'

export const HANDBOOK_WINDOW_SIZE = {
  width: 1200,
  height: 800,
  minWidth: 720,
  minHeight: 560,
  resizable: true,
} as const

export type HandbookTheme = 'dark' | 'light'

let opening: Promise<void> | null = null

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
  opening = createOrFocusHandbookWindow(title, locale, theme).finally(() => {
    opening = null
  })
  return opening
}

async function createOrFocusHandbookWindow(
  title: string,
  locale: string,
  theme: HandbookTheme,
): Promise<void> {
  const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow')
  const existing = await WebviewWindow.getByLabel(HANDBOOK_WINDOW)
  if (existing) {
    await revealHandbookWindow(existing)
    return
  }
  const win = new WebviewWindow(HANDBOOK_WINDOW, {
    url: handbookWindowUrl(locale, theme),
    title,
    ...HANDBOOK_WINDOW_SIZE,
    ...handbookChrome(theme),
  })
  await waitHandbookCreated(win)
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
