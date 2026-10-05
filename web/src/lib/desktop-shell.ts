import { isTauri } from '@tauri-apps/api/core'

import {
  ensureHandbookWindow,
  waitHandbookPageReady,
  type HandbookTheme,
} from '@/lib/handbook-window'

export const HANDBOOK_WARM_MS = 1500

let warming: Promise<void> | null = null

export function firstSettled(done: Promise<void>, ms: number): Promise<void> {
  return Promise.race([
    done,
    new Promise<void>((resolve) => {
      setTimeout(resolve, ms)
    }),
  ])
}

/** Preload the handbook, then show main. Never waits for Fava. */
export async function warmAndRevealMainWindow(
  title: string,
  locale: string,
  theme: HandbookTheme,
): Promise<void> {
  if (!isTauri()) return
  if (warming) return warming
  warming = (async () => {
    try {
      await ensureHandbookWindow(title, locale, theme)
      await firstSettled(waitHandbookPageReady(), HANDBOOK_WARM_MS)
    } catch {
      // The main window still has to appear.
    }
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    const win = getCurrentWindow()
    await win.show()
    await win.setFocus()
  })()
  return warming
}
