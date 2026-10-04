import { useState } from 'react'

/** Period token that matches the figures on screen while a new period is loading. */
export function useShownTime(timeFilter: string, isPlaceholderData: boolean): string {
  const [shown, setShown] = useState(timeFilter)
  if (!isPlaceholderData && shown !== timeFilter) setShown(timeFilter)
  return isPlaceholderData ? shown : timeFilter
}

/** Prior figures that belong with the numbers on screen, not the period still loading. */
export function shownPrior<T>(
  shownKey: string | null,
  liveKey: string | null,
  live: T | undefined,
  cached: T | undefined,
): T | null {
  if (shownKey == null) return null
  return (shownKey === liveKey ? live : cached) ?? null
}
