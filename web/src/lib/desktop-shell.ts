import { isTauri } from '@tauri-apps/api/core'

import {
  ensureHandbookWindow,
  firstSettled,
  HANDBOOK_WARM_MS,
  waitHandbookPageReady,
  type HandbookTheme,
} from '@/lib/handbook-window'

export { firstSettled, HANDBOOK_WARM_MS }

let warming: Promise<void> | null = null

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
