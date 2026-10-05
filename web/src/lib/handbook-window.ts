import { isTauri } from '@tauri-apps/api/core'

export const HANDBOOK_WINDOW = 'handbook'

export const HANDBOOK_WINDOW_SIZE = {
  width: 1200,
  height: 800,
  minWidth: 720,
  minHeight: 560,
  resizable: true,
} as const

let opening: Promise<void> | null = null

export function handbookWindowUrl(locale: string): string {
  return locale === 'zh-CN' ? '/docs/zh-CN/index.html' : '/docs/index.html'
}

export async function openHandbookWindow(title: string, locale: string): Promise<void> {
  if (!isTauri()) return
  if (opening) return opening
  opening = createOrFocusHandbookWindow(title, locale).finally(() => {
    opening = null
  })
  return opening
}

async function createOrFocusHandbookWindow(title: string, locale: string): Promise<void> {
  const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow')
  const existing = await WebviewWindow.getByLabel(HANDBOOK_WINDOW)
  if (existing) {
    await existing.unminimize()
    await existing.setFocus()
    return
  }
  const win = new WebviewWindow(HANDBOOK_WINDOW, {
    url: handbookWindowUrl(locale),
    title,
    ...HANDBOOK_WINDOW_SIZE,
  })
  await new Promise<void>((resolve, reject) => {
    void win.once('tauri://created', () => resolve())
    void win.once('tauri://error', (event) => {
      reject(event.payload instanceof Error ? event.payload : new Error(String(event.payload)))
    })
  })
}
