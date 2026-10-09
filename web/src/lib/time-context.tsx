import { createContext, useContext, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { favaClient } from './fava-client'

interface TimeContextType {
  timeFilter: string
  setTimeFilter: (val: string) => void
  availableYears: string[]
  clearFilter: () => void
  isAllTime: boolean
}

const TimeContext = createContext<TimeContextType | null>(null)

const STORAGE_KEY = 'beancount_time_filter'

export function TimeFilterProvider({ children }: { children: ReactNode }) {
  const [timeFilter, setTimeFilterState] = useState<string>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) || ''
    } catch {
      return ''
    }
  })

  const postingYears = useQuery({
    queryKey: ['postingYears'],
    queryFn: ({ signal }) => favaClient.getPostingYears(signal),
    staleTime: 60_000,
  })

  const availableYears = postingYears.data ?? []

  const setTimeFilter = (val: string) => {
    setTimeFilterState(val)
    try {
      if (val) {
        localStorage.setItem(STORAGE_KEY, val)
      } else {
        localStorage.removeItem(STORAGE_KEY)
      }
    } catch {
      // ignore
    }
  }

  const clearFilter = () => {
    setTimeFilter('')
  }

  return (
    <TimeContext.Provider
      value={{
        timeFilter,
        setTimeFilter,
        availableYears,
        clearFilter,
        isAllTime: !timeFilter,
      }}
    >
      {children}
    </TimeContext.Provider>
  )
}

export function useTimeFilter(): TimeContextType {
  const ctx = useContext(TimeContext)
  if (!ctx) {
    throw new Error('useTimeFilter must be used within a TimeFilterProvider')
  }
  return ctx
}
